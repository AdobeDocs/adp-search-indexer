import { config } from './config/config';
import { AlgoliaService } from './services/algolia';
import { ContentIndexer } from './services/indexer';
import { ProductMappingService } from './services/product-mapping';
import { fetchSitemap, analyzeSitemap } from './services/sitemap';
import type { SitemapUrl } from './types/index';
import { parseArgs } from './utils/args';

/**
 * Main function that orchestrates the application startup.
 *
 * This function parses command-line arguments, logs configuration settings, and initializes the core services
 * (including product mapping, Algolia integration, sitemap fetching, and content indexing).
 * It handles different execution flows based on the selected mode (index, export, or console) and manages errors appropriately.
 *
 * @returns {Promise<void>} A promise that resolves when the application has completed its processing.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const { baseUrl, sitemapUrl, mode, partialIndexing, forceUpdate, indexFilter, testUrl } = args;

  // Only show detailed config in verbose mode or when explicilty testing a URL (likely debugging)
  const showDetailedConfig = args.verbose || testUrl;

  if (showDetailedConfig) {
    console.log('Configuration');
    console.log('==============');

    // Always show core settings
    console.log(`Mode: ${mode}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Sitemap URL: ${sitemapUrl}`);

    // Only show more detailed settings in verbose mode
    console.log(`Max Concurrent Requests: ${config.app.maxConcurrentRequests}`);
    console.log(`Batch Size: ${config.app.batchSize}`);
    console.log(`Log Level: ${config.app.logLevel}`);
    console.log(`Partial Indexing: ${partialIndexing ? 'yes' : 'no'}`);
    console.log(`Force Update: ${forceUpdate ? 'yes' : 'no'}`);

    if (testUrl) {
      console.log(`Test URL: ${testUrl}`);
    }

    if (indexFilter) {
      console.log(`Index Filter: ${indexFilter}`);
    }

    if (mode === 'index') {
      console.log(`Algolia Index: ${config.algolia.indexName}`);
      console.log(`Index Prefix: ${config.app.indexPrefix || 'none'}`);
    }
  } else {
    // In non-verbose mode, show a very simplified config
    console.log(`Mode: ${mode}`);

    // Combine flags into a single line
    const flags = [];
    if (partialIndexing) flags.push('partial');
    if (forceUpdate) flags.push('force');
    if (indexFilter) flags.push(`filter: ${indexFilter}`);

    if (flags.length > 0) {
      console.log(`Flags: ${flags.join(', ')}`);
    }

    // Show minimal Algolia config when in index mode
    if (mode === 'index') {
      console.log(
        `Algolia: ${config.algolia.indexName}${config.app.indexPrefix ? ` (prefix: ${config.app.indexPrefix})` : ''}`
      );
    }
  }

  try {
    // Initialize services
    const productMappingService = new ProductMappingService(args.verbose);
    await productMappingService.initialize(config.app.productMappingUrl);

    // Apply index filter if provided
    if (indexFilter) {
      const indices = indexFilter.split(',').map((i) => i.trim());
      if (args.verbose) {
        console.log(`Filtering to indices: ${indices.join(', ')}`);
      }
      productMappingService.filterIndices(indices);
    }

    const algoliaService = new AlgoliaService(
      {
        appId: config.algolia.appId,
        apiKey: config.algolia.apiKey,
        verbose: args.verbose,
        testMode: mode === 'console' ? 'console' : mode === 'export' ? 'file' : 'none',
      },
      productMappingService
    );

    // If testing a specific URL
    if (testUrl) {
      console.log(`\nTesting specific URL: ${testUrl}`);
      // Create a single URL sitemap entry
      const singleUrl: SitemapUrl = { loc: testUrl };

      // Analyze or process just this URL
      if (mode === 'console') {
        await analyzeSitemap([singleUrl], productMappingService);
      } else {
        const indexer = new ContentIndexer(
          config.app.productMappingUrl,
          baseUrl,
          algoliaService,
          config.app.maxConcurrentRequests,
          args.verbose
        );

        const validUrls = await analyzeSitemap([singleUrl], productMappingService, args.verbose);
        await indexer.run(validUrls);
      }
      return;
    }

    // Fetch and analyze sitemap
    const urls = await fetchSitemap(baseUrl, sitemapUrl, args.verbose);
    const validUrls = await analyzeSitemap(urls, productMappingService, args.verbose);

    if (mode === 'console') {
      console.log('\nAnalysis complete');
      return;
    }

    if (mode === 'export') {
      console.log('\nProcessing content for export...');
    }

    // Set environment variables for partial/force update
    process.env['PARTIAL'] = partialIndexing ? 'true' : 'false';
    process.env['FORCE'] = forceUpdate ? 'true' : 'false';

    const indexer = new ContentIndexer(
      config.app.productMappingUrl,
      baseUrl,
      algoliaService,
      config.app.maxConcurrentRequests,
      args.verbose
    );

    await indexer.run(validUrls);

    // Show notification about loaded env variables if present
    if (Object.keys(process.env).length > 0) {
      console.log('Loaded environment variables from .env file');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

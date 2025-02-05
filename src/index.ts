import { fetchSitemap, analyzeSitemap } from './services/sitemap';
import { ContentIndexer } from './services/indexer';
import { config } from './config/config';
import { ProductMappingService } from './services/product-mapping';
import { AlgoliaService } from './services/algolia';
import { parseArgs } from './utils/args';

const PRODUCT_MAPPING_URL = 'https://raw.githubusercontent.com/AdobeDocs/search-indices/refs/heads/main/product-index-map.json';

/**
 * Main function that orchestrates the application startup.
 *
 * This function parses command-line arguments, logs configuration settings, and initializes the core services
 * (including product mapping, Algolia integration, sitemap fetching, and content indexing).
 * It handles different execution flows based on the selected mode (index, export, or console) and manages errors appropriately.
 *
 * @returns {Promise<void>} A promise that resolves when the application has completed its processing.
 */
async function main() {
  const args = parseArgs();
  const { baseUrl, sitemapUrl, mode } = args;

  console.log('🔧 Configuration');
  console.log('==============');
  console.log(`Mode: ${mode}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Sitemap URL: ${sitemapUrl}`);
  console.log(`Max Concurrent Requests: ${config.app.maxConcurrentRequests}`);
  console.log(`Batch Size: ${config.app.batchSize}`);
  console.log(`Log Level: ${config.app.logLevel}`);
  if (mode === 'index') {
    console.log(`Algolia Index: ${config.algolia.indexName}`);
    console.log(`Index Prefix: ${config.app.indexPrefix || 'none'}`);
    console.log(`Partial Updates: ${config.app.partial ? 'yes' : 'no'}`);
  }

  try {
    // Initialize services
    const productMappingService = new ProductMappingService(args.verbose);
    await productMappingService.initialize(PRODUCT_MAPPING_URL);

    const algoliaService = new AlgoliaService({
      appId: config.algolia.appId,
      apiKey: config.algolia.apiKey,
      verbose: args.verbose,
      testMode: mode === 'console' ? 'console' : mode === 'export' ? 'file' : 'none'
    }, productMappingService);
    await algoliaService.initialize();

    // Fetch and analyze sitemap
    const urls = await fetchSitemap(baseUrl, sitemapUrl);
    await analyzeSitemap(urls, productMappingService);

    if (mode === 'console') {
      console.log('\n✅ Analysis complete');
      return;
    }

    if (mode === 'export') {
      console.log('\n📝 Processing content for export...');
    }

    const indexer = new ContentIndexer(
      PRODUCT_MAPPING_URL,
      baseUrl,
      config.app.maxConcurrentRequests,
      args.verbose
    );

    await indexer.run(urls);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Remove redundant configuration logging
main(); 
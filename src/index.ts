import { fetchSitemap, analyzeSitemapPatterns } from './services/sitemap';
import { analyzeSamplePages } from './services/content';
import { AlgoliaService } from './services/algolia';
import { TestIndexer } from './services/test-indexer';
import { config } from './config/config';

async function main() {
  try {
    console.log('🌐 Starting indexing process');
    console.log('========================\n');

    console.log('🔍 Fetching sitemap...');
    const urls = await fetchSitemap(config.sitemap.url);
    
    console.log('\n📊 Analyzing URL patterns...');
    analyzeSitemapPatterns(urls);

    console.log('\n🔎 Analyzing sample pages...');
    await analyzeSamplePages(urls);

    console.log('\n🔧 Initializing services...');
    // Initialize Algolia service
    const algolia = new AlgoliaService({
      appId: config.algolia.appId,
      apiKey: config.algolia.apiKey,
      indexName: config.algolia.indexName,
      testMode: config.algolia.testMode,
    });

    // Initialize and run test indexer
    const testIndexer = new TestIndexer(algolia);
    await testIndexer.run(urls);

  } catch (error) {
    console.error('\n❌ Error during processing:', error);
    process.exit(1);
  }
}

// Start the indexing process
console.log('🚀 Starting the indexer...\n');

// Log configuration
console.log('📝 Configuration:');
console.log('----------------');
console.log(`• Mode: ${config.app.mode}`);
console.log(`• Index: ${config.app.index || 'all'}`);
console.log(`• Index Prefix: ${config.app.indexPrefix || 'none'}`);
console.log(`• Partial Updates: ${config.app.partial ? 'yes' : 'no'}\n`);

main(); 
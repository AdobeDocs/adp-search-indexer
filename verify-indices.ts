import algoliasearch from 'algoliasearch';

const INDICES = [
  'express-for-developers',
  'franklin-commerce',
  'commerce-extensibility',
  'franklin-app-builder',
  'xd',
  'express-add-ons-docs',
  'adobe-dev-console',
  'franklin-lightroom',
  'franklin-adobe-io-events',
  'franklin-sign-api',
  'franklin-substance-3d',
  'franklin-audience-manager',
  'franklin-substance-3d-sdk',
  'franklin-adobe-dev-console',
  'franklin-adobe-io-runtime',
  'franklin-substance-3d-automation',
  'franklin-umapi',
  'express-add-ons'
];

async function main() {
  // Load environment variables
  const appId = process.env['ALGOLIA_APP_ID'];
  const apiKey = process.env['ALGOLIA_API_KEY'];

  if (!appId || !apiKey) {
    console.error('❌ Missing Algolia credentials in .env file');
    process.exit(1);
  }

  console.log('🔍 Verifying Algolia indices...\n');

  const client = algoliasearch(appId, apiKey);
  
  for (const indexName of INDICES) {
    try {
      const index = client.initIndex(indexName);
      const { nbHits } = await index.search('', {
        hitsPerPage: 0,
        analytics: false
      });
      
      console.log(`✓ ${indexName}: ${nbHits} records`);
      
      // Get a sample record to verify structure
      if (nbHits > 0) {
        const { hits } = await index.search('', {
          hitsPerPage: 1,
          analytics: false
        });
        
        if (hits.length > 0) {
          const record = hits[0];
          console.log('  Sample record fields:', Object.keys(record).join(', '));
        }
      }
      console.log('');
    } catch (error) {
      console.error(`❌ Error checking ${indexName}:`, error);
    }
  }
}

main().catch(console.error); 
import algoliasearch from 'algoliasearch';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

async function verifyAlgoliaIndices(appId: string, apiKey: string) {
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

function verifyExportedIndices() {
  console.log('🔍 Verifying exported indices in indexed-content directory...\n');
  
  const exportDir = 'indexed-content';
  if (!existsSync(exportDir)) {
    console.error(`❌ Export directory '${exportDir}' not found. Run 'npm run export' first.`);
    return;
  }
  
  const files = readdirSync(exportDir).filter(file => file.endsWith('.json'));
  
  if (files.length === 0) {
    console.error('❌ No exported index files found. Run "npm run export" first.');
    return;
  }
  
  for (const file of files) {
    try {
      const indexName = file.replace('.json', '');
      const filePath = join(exportDir, file);
      const fileContent = readFileSync(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      
      console.log(`✓ ${indexName}: ${data.records.length} records`);
      
      // Get a sample record to verify structure
      if (data.records.length > 0) {
        const record = data.records[0];
        console.log('  Sample record fields:', Object.keys(record).join(', '));
      }
      console.log('');
    } catch (error) {
      console.error(`❌ Error checking ${file}:`, error);
    }
  }
}

export async function verifyIndices() {
  // Load environment variables
  const appId = process.env['ALGOLIA_APP_ID'];
  const apiKey = process.env['ALGOLIA_API_KEY'];

  if (!appId || !apiKey) {
    console.warn('⚠️ Missing Algolia credentials in .env file');
    console.log('ℹ️ Checking exported indices instead\n');
    verifyExportedIndices();
  } else {
    await verifyAlgoliaIndices(appId, apiKey);
  }
} 
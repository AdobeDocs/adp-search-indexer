import { z } from 'zod';
import type { Config } from '../types';

const configSchema = z.object({
  SITEMAP_URL: z.string().startsWith('/'),
  BASE_URL: z.string().url(),
  ALGOLIA_APP_ID: z.string(),
  ALGOLIA_API_KEY: z.string(),
  ALGOLIA_INDEX_NAME: z.string(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  BATCH_SIZE: z.coerce.number().default(50),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().default(5),
  MODE: z.enum(['index', 'console', 'export']).default('console'),
  INDEX: z.string().optional(),
  INDEX_PREFIX: z.string().optional(),
  PARTIAL: z.coerce.boolean().default(true),
}).transform(config => {
  // If we're not in index mode, we don't need Algolia credentials
  if (config.MODE !== 'index') {
    return config;
  }
  
  // In index mode, validate Algolia credentials
  if (!config.ALGOLIA_APP_ID || !config.ALGOLIA_API_KEY || !config.ALGOLIA_INDEX_NAME) {
    throw new Error('Algolia credentials (APP_ID, API_KEY, INDEX_NAME) are required in index mode');
  }
  
  return config;
});

const validateEnv = () => {
  // Get mode from command line arguments if provided
  const mode = process.argv.includes('--index') 
    ? 'index' 
    : process.argv.includes('--export') 
      ? 'export' 
      : process.env['MODE'] || 'console';

  // Get index from command line arguments if provided
  const index = process.argv.find(arg => arg.startsWith('--index='))?.split('=')[1] || process.env['INDEX'];

  // Get index prefix from command line arguments if provided
  const indexPrefix = process.argv.find(arg => arg.startsWith('--index-prefix='))?.split('=')[1] || process.env['INDEX_PREFIX'];

  // Get partial flag from command line arguments if provided
  const partial = process.argv.includes('--no-partial') 
    ? false 
    : process.argv.includes('--partial') 
      ? true 
      : process.env['PARTIAL'] !== 'false';

  // Combine process.env with derived values
  const envWithDefaults = {
    ...process.env,
    MODE: mode,
    INDEX: index,
    INDEX_PREFIX: indexPrefix,
    PARTIAL: partial,
  };

  const result = configSchema.safeParse(envWithDefaults);
  
  if (!result.success) {
    console.error('❌ Configuration validation failed:');
    const formattedErrors = result.error.format();
    Object.entries(formattedErrors).forEach(([key, value]) => {
      if (key !== '_errors' && typeof value === 'object' && '_errors' in value) {
        console.error(`   • ${key}: ${value._errors.join(', ')}`);
      }
    });
    process.exit(1);
  }
  
  return result.data;
};

validateEnv();

export const config: Config = {
  sitemap: {
    url: process.env['SITEMAP_URL'] || 'https://example.com/sitemap.xml'
  },
  algolia: {
    appId: process.env['ALGOLIA_APP_ID'] || '',
    apiKey: process.env['ALGOLIA_API_KEY'] || '',
    indexName: process.env['ALGOLIA_INDEX_NAME'] || ''
  },
  app: {
    logLevel: process.env['LOG_LEVEL'] || 'info',
    batchSize: parseInt(process.env['BATCH_SIZE'] || '10', 10),
    maxConcurrentRequests: parseInt(process.env['MAX_CONCURRENT_REQUESTS'] || '5', 10),
    mode: process.env['MODE'] === 'index' ? 'none' : process.env['MODE'] === 'export' ? 'file' : 'console',
    verbose: process.env['VERBOSE'] === 'true',
    index: process.env['INDEX'],
    indexPrefix: process.env['INDEX_PREFIX'],
    partial: process.env['PARTIAL'] === 'true'
  }
}; 
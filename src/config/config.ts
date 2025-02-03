import { z } from 'zod';
import type { Config } from '../types';

const configSchema = z.object({
  SITEMAP_URL: z.string().url(),
  ALGOLIA_APP_ID: z.string().min(1, 'Algolia App ID is required'),
  ALGOLIA_API_KEY: z.string().min(1, 'Algolia API Key is required'),
  ALGOLIA_INDEX_NAME: z.string().min(1, 'Algolia Index Name is required'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  BATCH_SIZE: z.coerce.number().default(50),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().default(5),
  MODE: z.enum(['index', 'console', 'export']).default('console'),
  INDEX: z.string().optional(),
  INDEX_PREFIX: z.string().optional(),
  PARTIAL: z.coerce.boolean().default(true),
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

const env = validateEnv();

export const config: Config = {
  sitemap: {
    url: env.SITEMAP_URL,
  },
  algolia: {
    appId: env.ALGOLIA_APP_ID,
    apiKey: env.ALGOLIA_API_KEY,
    indexName: env.ALGOLIA_INDEX_NAME,
  },
  app: {
    logLevel: env.LOG_LEVEL,
    batchSize: env.BATCH_SIZE,
    maxConcurrentRequests: env.MAX_CONCURRENT_REQUESTS,
    mode: env.MODE,
    index: env.INDEX,
    indexPrefix: env.INDEX_PREFIX,
    partial: env.PARTIAL,
  },
}; 
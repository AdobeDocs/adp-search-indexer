import { z } from 'zod';
import type { Config } from '../types/index';

const configSchema = z.object({
  SITEMAP_URL: z.string().startsWith('/'),
  BASE_URL: z.string().url(),
  ALGOLIA_APP_ID: z.string(),
  ALGOLIA_API_KEY: z.string(),
  ALGOLIA_INDEX_NAME: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  BATCH_SIZE: z.coerce.number().default(50),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().default(5),
  MODE: z.enum(['index', 'export', 'console']).default('console'),
  INDEX: z.string().optional(),
  INDEX_PREFIX: z.string().optional(),
  PARTIAL: z.coerce.boolean().default(true),
}).transform(config => {
  // If we're not in index mode, we don't need Algolia credentials
  if (config.MODE !== 'index') {
    return config;
  }
  
  // In index mode, validate Algolia credentials
  if (!config.ALGOLIA_APP_ID || !config.ALGOLIA_API_KEY) {
    throw new Error('Algolia credentials (APP_ID, API_KEY) are required in index mode');
  }
  
  return config;
});

/**
 * Validates and parses environment configuration.
 *
 * This function extracts configuration values from process.argv and process.env, applies default values, and validates them
 * using the defined zod schema. If validation fails, it logs detailed error messages and exits the process.
 *
 * @returns The validated environment configuration.
 */
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

/**
 * Application configuration object.
 *
 * This object aggregates the validated environment settings to configure the application.
 *
 * @property {Object} sitemap - Contains sitemap-related settings.
 * @property {string} sitemap.url - The URL for the sitemap.
 *
 * @property {Object} algolia - Contains Algolia related credentials and settings.
 * @property {string} algolia.appId - The Algolia application ID.
 * @property {string} algolia.apiKey - The Algolia API key.
 * @property {string} algolia.indexName - The Algolia index name.
 *
 * @property {Object} app - Contains application specific settings.
 * @property {string} app.logLevel - The logging level ('debug', 'info', 'warn', 'error').
 * @property {number} app.batchSize - Controls the batch size for processing.
 * @property {number} app.maxConcurrentRequests - Maximum number of concurrent requests.
 * @property {string} app.mode - Operational mode ('none', 'file', 'console').
 * @property {boolean} app.verbose - Flag to enable verbose logging.
 * @property {string|undefined} app.index - Optional index value from CLI or environment.
 * @property {string|undefined} app.indexPrefix - Optional prefix for index.
 * @property {boolean} app.partial - Indicates if partial indexing is enabled.
 */
export const config: Config = {
  sitemap: {
    url: process.env['SITEMAP_URL'] || ''
  },
  algolia: {
    appId: process.env['ALGOLIA_APP_ID'] || '',
    apiKey: process.env['ALGOLIA_API_KEY'] || '',
    indexName: process.env['ALGOLIA_INDEX_NAME']
  },
  app: {
    logLevel: process.env['LOG_LEVEL'] || 'info',
    batchSize: parseInt(process.env['BATCH_SIZE'] || '10', 10),
    maxConcurrentRequests: parseInt(process.env['MAX_CONCURRENT_REQUESTS'] || '5', 10),
    mode: (process.env['MODE'] || 'console') as 'index' | 'export' | 'console',
    verbose: process.env['VERBOSE'] === 'true',
    index: process.env['INDEX'],
    indexPrefix: process.env['INDEX_PREFIX'],
    partial: process.env['PARTIAL'] === 'true'
  }
}; 
import { z } from 'zod';
import type { Config } from '../types';

const configSchema = z.object({
  SITEMAP_URL: z.string().url(),
  ALGOLIA_APP_ID: z.string().optional(),
  ALGOLIA_API_KEY: z.string().optional(),
  ALGOLIA_INDEX_NAME: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  BATCH_SIZE: z.coerce.number().default(50),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().default(5),
});

const validateEnv = () => {
  const result = configSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
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
    appId: env.ALGOLIA_APP_ID || '',
    apiKey: env.ALGOLIA_API_KEY || '',
    indexName: env.ALGOLIA_INDEX_NAME || '',
  },
  app: {
    logLevel: env.LOG_LEVEL,
    batchSize: env.BATCH_SIZE,
    maxConcurrentRequests: env.MAX_CONCURRENT_REQUESTS,
  },
}; 
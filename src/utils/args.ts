import minimist from 'minimist';

/**
 * Configuration options parsed from command line arguments.
 */
export interface IndexerArgs {
  /** Base URL for the site being indexed */
  baseUrl: string;
  /** Path to the sitemap file */
  sitemapUrl: string;
  /** Operating mode for the indexer */
  mode: 'console' | 'index' | 'export';
  /** Whether to enable verbose logging */
  verbose: boolean;
}

/**
 * Parses command line arguments and environment variables to configure the indexer.
 * 
 * @returns An IndexerArgs object containing the parsed configuration.
 */
export function parseArgs(): IndexerArgs {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['verbose'],
    default: {
      verbose: false
    }
  });
  
  return {
    baseUrl: process.env['BASE_URL'] || '',
    sitemapUrl: process.env['SITEMAP_URL'] || '/sitemap.xml',
    mode: argv['mode'] || 'console',
    verbose: argv['verbose']
  };
} 
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
  /** Whether to use partial indexing (default true) */
  partialIndexing: boolean;
  /** Whether to force update all records */
  forceUpdate: boolean;
  /** Optional specific URL to test */
  testUrl?: string;
  /** Optional specific index to process */
  indexFilter?: string;
}

/**
 * Parses command line arguments and environment variables to configure the indexer.
 * 
 * @returns An IndexerArgs object containing the parsed configuration.
 */
export function parseArgs(): IndexerArgs {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['verbose', 'partial', 'force', 'index', 'export', 'test-console'],
    default: {
      verbose: false,
      partial: true
    }
  });
  
  // Determine mode from args
  let mode = 'console';
  if (argv['index']) mode = 'index';
  else if (argv['export']) mode = 'export';
  else if (argv['test-console']) mode = 'console';
  else if (argv['mode']) mode = argv['mode'];
  
  return {
    baseUrl: process.env['BASE_URL'] || '',
    sitemapUrl: process.env['SITEMAP_URL'] || '/sitemap.xml',
    mode: mode as 'console' | 'index' | 'export',
    verbose: argv['verbose'],
    partialIndexing: argv['partial'] !== false, // Default to true unless --no-partial
    forceUpdate: !!argv['force'],
    testUrl: argv['test-url'],
    indexFilter: argv['index-filter'] || process.env['INDEX'] || undefined
  };
} 
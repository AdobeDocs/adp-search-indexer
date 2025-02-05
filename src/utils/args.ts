import minimist from 'minimist';

export interface IndexerArgs {
  baseUrl: string;
  sitemapUrl: string;
  mode: 'console' | 'index' | 'export';
  verbose: boolean;
}

export function parseArgs(): IndexerArgs {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['verbose'],
    default: {
      verbose: false
    }
  });
  
  return {
    baseUrl: process.env['BASE_URL'] || 'https://main--adp-devsite--adobedocs.aem.page',
    sitemapUrl: process.env['SITEMAP_URL'] || '/sitemap.xml',
    mode: argv['mode'] || 'console',
    verbose: argv['verbose']
  };
} 
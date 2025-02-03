import { XMLParser } from 'fast-xml-parser';
import type { Sitemap, SitemapUrl } from '../types';

const isTestUrl = (url: string) => {
  const testPatterns = [
    '/test/',
    '/tools/',
    '/nav/',
    '/assets/',
    '/fragments/',
    '/blocks/',
    '/drafts/',
    '/internal/'
  ];
  return testPatterns.some(pattern => url.includes(pattern));
};

export async function fetchSitemap(sitemapUrl: string): Promise<SitemapUrl[]> {
  try {
    const response = await Bun.fetch(sitemapUrl, {
      client: 'bun',
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap: ${response.statusText}`);
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '_',
    });

    const sitemap = parser.parse(xml) as Sitemap;
    return sitemap.urlset.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch or parse sitemap: ${message}`);
  }
}

export const analyzeSitemapPatterns = (urls: SitemapUrl[]): void => {
  const verbose = process.argv.includes('--verbose');
  const patterns = new Map<string, string[]>();

  // Group URLs by pattern
  urls.forEach(url => {
    const urlPath = new URL(url.loc).pathname;
    const pattern = urlPath.split('/').slice(0, 2).join('/') + '/*';
    if (!patterns.has(pattern)) {
      patterns.set(pattern, []);
    }
    patterns.get(pattern)!.push(urlPath);
  });

  // Sort patterns by number of URLs
  const sortedPatterns = Array.from(patterns.entries())
    .sort((a, b) => b[1].length - a[1].length);

  if (verbose) {
    console.log('\nURL Pattern Analysis (Excluding test, tools, nav, and assets):');
    console.log('=========================================================\n');

    sortedPatterns.forEach(([pattern, paths]) => {
      console.log(`${pattern}: ${paths.length} URLs`);
      console.log('Sample paths' + (paths.length > 5 ? ' (first 5)' : ':'));
      paths.slice(0, 5).forEach(path => console.log(`  ${path}`));
      console.log('');
    });

    console.log('Summary:');
    console.log('========');
  }

  console.log(`Total URLs (before filtering): ${urls.length}`);
  console.log(`Total URL patterns: ${patterns.size}`);
}; 
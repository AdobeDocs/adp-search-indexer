import cheerio from 'cheerio';

import type { SitemapUrl } from '../types/index';

import { ProductMappingService } from './product-mapping';

/**
 * Fetches the sitemap XML from the given URL and returns an array of sitemap entries.
 *
 * @param baseUrl - The base URL of the website.
 * @param sitemapPath - The relative or absolute path to the sitemap XML.
 * @param verbose - Optional flag to enable verbose logging.
 * @returns A promise that resolves to an array of SitemapUrl objects.
 * @throws An error if the sitemap cannot be fetched.
 */
export async function fetchSitemap(baseUrl: string, sitemapPath: string, verbose = false): Promise<SitemapUrl[]> {
  const sitemapUrl = new URL(sitemapPath, baseUrl).toString();
  
  if (verbose) {
    console.log(`Fetching sitemap from: ${sitemapUrl}`);
  }

  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.statusText}`);
  }

  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  
  const urls: SitemapUrl[] = [];
  $('url').each((_, element) => {
    const loc = $(element).find('loc').text().trim();
    const lastmod = $(element).find('lastmod').text().trim() || undefined;
    
    if (loc) {
      urls.push({ loc, lastmod });
    }
  });

  if (verbose) {
    console.log(`Fetched sitemap with ${urls.length} URLs`);
  }

  return urls;
}

/**
 * Analyzes sitemap URLs by filtering out excluded URLs and logging summary information.
 *
 * @param urls - An array of SitemapUrl objects to analyze.
 * @param productMappingService - The ProductMappingService instance used to decide on URL exclusions.
 * @param verbose - Optional flag to enable verbose logging.
 * @returns A promise that resolves with the validated URLs array.
 */
export async function analyzeSitemap(
  urls: SitemapUrl[], 
  productMappingService: ProductMappingService,
  verbose = false
): Promise<SitemapUrl[]> {
  if (verbose) {
    console.log('\nAnalyzing sitemap URLs...');
  }
  
  // Filter out URLs that should be excluded
  const validUrls = urls.filter(({ loc }) => {
    try {
      const url = new URL(loc);
      // Process pathname without fragments for exclusion check
      const pathname = url.pathname;
      return !productMappingService.shouldExcludePath(pathname);
    } catch (error: unknown) {
      if (verbose) {
        console.warn(`Invalid URL: ${loc}. Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  });

  // Only show detailed analysis in verbose mode
  if (verbose) {
    console.log(`Total URLs in sitemap: ${urls.length}`);
    console.log(`URLs to process: ${validUrls.length}`);
    console.log(`URLs skipped: ${urls.length - validUrls.length}`);

    // Count URLs with fragments
    const urlsWithFragments = validUrls.filter(({ loc }) => {
      try {
        return loc.includes('#');
      } catch (error: unknown) {
        if (verbose) {
          console.warn(`Error checking for fragments in URL: ${loc}. Error: ${error instanceof Error ? error.message : String(error)}`);
        }
        return false;
      }
    });
    console.log(`URLs with fragments: ${urlsWithFragments.length}`);

    // Analyze path segments
    const pathSegments = new Map<string, number>();
    validUrls.forEach(({ loc }) => {
      try {
        const url = new URL(loc);
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length > 0) {
          const firstSegment = `/${segments[0]}/`;
          pathSegments.set(firstSegment, (pathSegments.get(firstSegment) || 0) + 1);
        }
      } catch (error: unknown) {
        console.warn(`Invalid URL for path analysis: ${loc}. Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Print top path segments
    console.log('\nTop path segments (excluding skipped paths):');
    const sortedSegments = Array.from(pathSegments.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    sortedSegments.forEach(([segment, count]) => {
      console.log(`${segment}: ${count} URLs`);
    });
  } else {
    // Non-verbose mode: don't print any sitemap analysis, let product mapping handle it
    // The product mapping service will show a single concise line
  }

  // Analyze product mapping matches for valid URLs only
  productMappingService.analyzeUrlMatches(validUrls, verbose);

  // Return the filtered URLs
  return validUrls;
} 
import type { SitemapUrl } from '../types/index';
import cheerio from 'cheerio';
import { ProductMappingService } from './product-mapping';

/**
 * Fetches the sitemap XML from the given URL and returns an array of sitemap entries.
 *
 * @param baseUrl - The base URL of the website.
 * @param sitemapPath - The relative or absolute path to the sitemap XML.
 * @returns A promise that resolves to an array of SitemapUrl objects.
 * @throws An error if the sitemap cannot be fetched.
 */
export async function fetchSitemap(baseUrl: string, sitemapPath: string): Promise<SitemapUrl[]> {
  const sitemapUrl = new URL(sitemapPath, baseUrl).toString();
  console.log(`Fetching sitemap from: ${sitemapUrl}`);

  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.statusText}`);
  }

  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  
  const urls: SitemapUrl[] = [];
  $('url').each((_, element) => {
    const loc = $(element).find('loc').text().trim();
    if (loc) {
      urls.push({ loc });
    }
  });

  return urls;
}

/**
 * Analyzes sitemap URLs by filtering out excluded URLs and logging summary information.
 *
 * @param urls - An array of SitemapUrl objects to analyze.
 * @param productMappingService - The ProductMappingService instance used to decide on URL exclusions.
 * @returns A promise that resolves when analysis is complete.
 */
export async function analyzeSitemap(urls: SitemapUrl[], productMappingService: ProductMappingService): Promise<void> {
  console.log('\n🔍 Analyzing sitemap URLs...');
  
  // Filter out URLs that should be excluded
  const validUrls = urls.filter(({ loc }) => {
    try {
      const url = new URL(loc);
      return !productMappingService.shouldExcludePath(url.pathname);
    } catch (error) {
      console.warn(`⚠️  Invalid URL: ${loc}`);
      return false;
    }
  });

  console.log(`Total URLs in sitemap: ${urls.length}`);
  console.log(`URLs to process: ${validUrls.length}`);
  console.log(`URLs skipped: ${urls.length - validUrls.length}`);

  // Analyze path segments of valid URLs only
  const pathSegments = new Map<string, number>();
  validUrls.forEach(({ loc }) => {
    try {
      const url = new URL(loc);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        const firstSegment = `/${segments[0]}/`;
        pathSegments.set(firstSegment, (pathSegments.get(firstSegment) || 0) + 1);
      }
    } catch (error) {
      console.warn(`⚠️  Invalid URL: ${loc}`);
    }
  });

  // Print top path segments
  console.log('\n📊 Top path segments (excluding skipped paths):');
  const sortedSegments = Array.from(pathSegments.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  
  sortedSegments.forEach(([segment, count]) => {
    console.log(`${segment}: ${count} URLs`);
  });

  // Analyze product mapping matches for valid URLs only
  productMappingService.analyzeUrlMatches(validUrls);
} 
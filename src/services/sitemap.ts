import { XMLParser } from 'fast-xml-parser';
import type { Sitemap, SitemapUrl } from '../types';
import { config } from '../config/config';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_',
});

const EXCLUDED_PATTERNS = [
  /^\/test\//,
  /^\/franklin_assets\//,
  /^\/tools\//,
  /\/nav$/
];

function shouldIncludeUrl(url: string): boolean {
  return !EXCLUDED_PATTERNS.some(pattern => pattern.test(new URL(url).pathname));
}

export async function fetchSitemap(): Promise<SitemapUrl[]> {
  try {
    const response = await fetch(config.sitemap.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const result = parser.parse(xmlText) as Sitemap;

    // Ensure we have URLs to process
    if (!result.urlset?.url) {
      throw new Error('No URLs found in sitemap');
    }

    // Filter out excluded URLs
    return result.urlset.url.filter(url => shouldIncludeUrl(url.loc));
  } catch (error) {
    console.error('Error fetching sitemap:', error);
    throw error;
  }
}

export function analyzeSitemapPatterns(urls: SitemapUrl[]): void {
  const urlPatterns = new Map<string, number>();
  const fullPaths = new Map<string, string[]>();
  
  urls.forEach(({ loc }) => {
    try {
      const url = new URL(loc);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const pattern = pathSegments.length > 0 ? `/${pathSegments[0]}/*` : '/';
      
      // Track pattern count
      urlPatterns.set(pattern, (urlPatterns.get(pattern) || 0) + 1);
      
      // Track full paths for each pattern
      if (!fullPaths.has(pattern)) {
        fullPaths.set(pattern, []);
      }
      fullPaths.get(pattern)?.push(url.pathname);
    } catch (error) {
      console.error(`Invalid URL: ${loc}`);
    }
  });

  console.log('\nURL Pattern Analysis (Excluding test, tools, nav, and assets):');
  console.log('=========================================================');
  
  // Sort patterns by count
  const sortedPatterns = Array.from(urlPatterns.entries())
    .sort(([, a], [, b]) => b - a);

  for (const [pattern, count] of sortedPatterns) {
    console.log(`\n${pattern}: ${count} URLs`);
    
    // Show sample paths for patterns with fewer URLs
    const paths = fullPaths.get(pattern) || [];
    if (paths.length <= 5) {
      console.log('Sample paths:');
      paths.forEach(path => console.log(`  ${path}`));
    } else {
      console.log('Sample paths (first 5):');
      paths.slice(0, 5).forEach(path => console.log(`  ${path}`));
    }
  }
  
  console.log('\nSummary:');
  console.log('========');
  console.log('Total URLs (before filtering):', urls.length);
  console.log('Total URL patterns:', urlPatterns.size);
} 
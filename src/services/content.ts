import { parseHTML } from 'linkedom';
import type { SitemapUrl } from '../types';
import type { Element, HTMLElement, Document } from 'linkedom';
import { TaskQueue } from '../utils/queue';
import { retry } from '../utils/retry';

export interface PageContent {
  url: string;
  title: string;
  headings: string[];
  mainContent: string;
  metadata: Record<string, string>;
}

interface ContentAnalysis {
  url: string;
  contentLength: number;
  headingCount: number;
  metadataFields: string[];
  mainContentSelector: string;
}

async function fetchWithRetry(url: string): Promise<Response> {
  return retry(
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch page: ${response.statusText}`);
      }
      return response;
    },
    {
      maxAttempts: 3,
      delay: 1000,
      shouldRetry: (error: unknown) => {
        if (error instanceof Error) {
          // Don't retry 404s
          return !error.message.includes('Not Found');
        }
        return false;
      },
    }
  );
}

export async function fetchPageContent(url: string): Promise<PageContent> {
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    const { document } = parseHTML(html) as { document: Document };

    // Remove script and style elements
    document.querySelectorAll('script, style').forEach((el: Element) => el.remove());

    // Extract metadata
    const metadata: Record<string, string> = {};
    document.querySelectorAll('meta').forEach((el: Element) => {
      const name = el.getAttribute('name') || el.getAttribute('property');
      const content = el.getAttribute('content');
      if (name && content) {
        metadata[name] = content;
      }
    });

    // Extract headings
    const headings: string[] = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el: Element) => {
      const text = el.textContent?.trim();
      if (text) headings.push(text);
    });

    // Extract main content
    const mainContent = document.querySelector('main')?.textContent?.trim() || 
                       document.querySelector('article')?.textContent?.trim() || 
                       document.body.textContent?.trim() || '';

    return {
      url,
      title: document.title.trim(),
      headings,
      mainContent,
      metadata
    };
  } catch (error) {
    console.error(`Error fetching content for ${url}:`, error);
    throw error;
  }
}

export async function analyzeContent(url: string): Promise<ContentAnalysis> {
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    const { document } = parseHTML(html) as { document: Document };

    // Analyze potential main content containers
    const containers = [
      { selector: 'main', count: document.querySelectorAll('main').length },
      { selector: 'article', count: document.querySelectorAll('article').length },
      { selector: '.content', count: document.querySelectorAll('.content').length },
      { selector: '#content', count: document.querySelectorAll('#content').length }
    ];

    const mainContentSelector = containers.find(c => c.count > 0)?.selector || 'body';

    return {
      url,
      contentLength: html.length,
      headingCount: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      metadataFields: Array.from(document.querySelectorAll('meta'))
        .map((el: Element) => el.getAttribute('name') || el.getAttribute('property'))
        .filter((name): name is string => Boolean(name)),
      mainContentSelector
    };
  } catch (error) {
    console.error(`Error analyzing content for ${url}:`, error);
    throw error;
  }
}

export async function analyzeSamplePages(urls: SitemapUrl[]): Promise<void> {
  // Sample pages from different sections
  const sampleUrls = new Set<string>();
  
  urls.forEach(({ loc }) => {
    const url = new URL(loc);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    if (pathSegments.length > 0) {
      const pattern = `/${pathSegments[0]}`;
      if (!Array.from(sampleUrls).some(u => u.includes(pattern))) {
        sampleUrls.add(loc);
      }
    }
  });

  console.log('\nAnalyzing sample pages from each section:');
  console.log('=======================================');

  // Create a task queue for concurrent processing
  const queue = new TaskQueue(5);
  const promises: Promise<void>[] = [];

  for (const url of sampleUrls) {
    promises.push(
      queue.add(async () => {
        console.log(`\nAnalyzing ${url}...`);
        try {
          const analysis = await analyzeContent(url);
          console.log('Analysis results:');
          console.log('- Content length:', analysis.contentLength, 'bytes');
          console.log('- Number of headings:', analysis.headingCount);
          console.log('- Main content selector:', analysis.mainContentSelector);
          console.log('- Available metadata fields:', analysis.metadataFields.join(', '));
        } catch (error) {
          if (error instanceof Error && error.message.includes('Not Found')) {
            console.warn(`Skipping ${url}: Page not found`);
          } else {
            console.error(`Failed to analyze ${url}:`, error);
          }
        }
      })
    );
  }

  // Wait for all tasks to complete
  await Promise.all(promises);
} 
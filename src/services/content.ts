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
      const response = await Bun.fetch(url, {
        // Use Bun's optimized HTTP client
        client: 'bun',
        // Add reasonable timeout
        timeout: 5000
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Page not found (404): ${url}`);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    },
    {
      maxAttempts: 3,
      delay: 1000,
      shouldRetry: (error: unknown) => {
        if (error instanceof Error) {
          // Don't retry 404s
          return !error.message.includes('404');
        }
        return false;
      },
    }
  );
}

export const fetchPageContent = async (url: string): Promise<PageContent> => {
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    
    // Parse the HTML using linkedom
    const { document } = parseHTML(html) as { document: Document };
    
    // Extract metadata
    const metadata: Record<string, string> = {};
    document.querySelectorAll('meta').forEach((meta: Element) => {
      const name = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');
      if (name && content) {
        metadata[name] = content;
      }
    });
    
    // Extract title
    const title = document.querySelector('title')?.textContent || '';
    
    // Extract main content
    const mainContent = document.querySelector('main')?.textContent || '';
    
    // Extract headings
    const headings: string[] = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading: Element) => {
      if (heading.textContent) {
        headings.push(heading.textContent);
      }
    });
    
    return {
      url,
      title,
      mainContent,
      headings,
      metadata
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Not Found')) {
      console.warn(`Skipping ${url}: Page not found (404)`);
    } else {
      console.error(`Failed to fetch content from ${url}:`, error);
    }
    throw error;
  }
};

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

export const analyzeSamplePages = async (urls: SitemapUrl[]): Promise<void> => {
  const verbose = process.argv.includes('--verbose');
  const queue = new TaskQueue(5);
  const sampleSize = 5;
  
  // Group URLs by section
  const sections = new Map<string, SitemapUrl[]>();
  urls.forEach(url => {
    const path = new URL(url.loc).pathname;
    const section = path.split('/')[1] || 'root';
    if (!sections.has(section)) {
      sections.set(section, []);
    }
    sections.get(section)!.push(url);
  });
  
  if (verbose) {
    console.log('\nAnalyzing sample pages from each section:');
    console.log('=======================================\n');
  }
  
  // Analyze a sample from each section
  for (const [section, sectionUrls] of sections) {
    // Take a random sample
    const sample = sectionUrls.sort(() => 0.5 - Math.random()).slice(0, sampleSize);
    
    for (const url of sample) {
      if (verbose) {
        console.log(`Analyzing ${url.loc}...`);
      }
      
      try {
        const content = await queue.add(() => fetchPageContent(url.loc));
        
        if (verbose) {
          console.log('Analysis results:');
          console.log(`- Content length: ${content.mainContent.length} bytes`);
          console.log(`- Number of headings: ${content.headings.length}`);
          console.log('- Main content selector: main');
          console.log('- Available metadata fields:', Object.keys(content.metadata).join(', '));
          console.log('');
        }
      } catch (error) {
        if (verbose) {
          console.error(`Failed to analyze ${url.loc}:`, error);
        }
      }
    }
  }
}; 
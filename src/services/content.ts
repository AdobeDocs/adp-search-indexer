import cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { SitemapUrl } from '../types';
import { TaskQueue } from '../utils/queue';
import { retry } from '../utils/retry';

type CheerioRoot = ReturnType<typeof cheerio.load>;

export interface ContentSegment {
  heading: string;
  content: string;
  level: number;
}

export interface PageContent {
  url: string;
  title: string;
  mainContent: string;
  segments: ContentSegment[];
  headings: string[];
  metadata: Record<string, string>;
}

export interface ContentAnalysis {
  url: string;
  contentLength: number;
  headingCount: number;
  metadataFields: string[];
  mainContentSelector: string;
}

async function fetchWithRetry(url: string): Promise<Response> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        // Quietly skip 404s by throwing a skip error
        throw {
          type: 'skip',
          reason: '404',
          message: `Page not found: ${url}`
        };
      }
      // Only retry non-404 errors
      return await retry(
        async () => {
          const retryResponse = await fetch(url);
          if (!retryResponse.ok) {
            throw new Error(`HTTP error! status: ${retryResponse.status}`);
          }
          return retryResponse;
        },
        {
          maxAttempts: 3,
          delay: 1000,
          shouldRetry: (error: unknown) => {
            if (error instanceof Error) {
              return !error.message.includes('404');
            }
            return true;
          },
        }
      );
    }
    return response;
  } catch (error) {
    if (error && typeof error === 'object' && 'type' in error) {
      throw error; // Re-throw skip errors
    }
    throw error;
  }
}

// Enhanced content cleaning utilities
const cleanHtml = (html: string): string => {
  if (!html) return '';
  
  return html
    // Remove complete script, style, and other unwanted tags with their content
    .replace(/<(script|style|noscript|iframe|svg|nav|header|footer|button|form|aside|dialog|meta)[^>]*>[\s\S]*?<\/\1>/gi, '')
    
    // Remove all data attributes and their content more aggressively
    .replace(/\s*data-[^\s>]*(?:="[^"]*")?/g, '')
    
    // Remove specific class patterns that indicate UI elements
    .replace(/<[^>]*class="[^"]*(?:button|nav|menu|sidebar|footer|header|toolbar|dialog|modal|popup|overlay|search|pagination|breadcrumb)[^"]*"[^>]*>[\s\S]*?<\/[^>]*>/gi, '')
    
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    
    // Remove links that are likely navigation or UI elements
    .replace(/<a[^>]*>(?:Previous|Next|Back|Home|Top|Menu|Close|Cancel|Submit|Skip|More|Learn More|Read More|Get Started)[^<]*<\/a>/gi, '')
    
    // Remove all attributes except for specific allowed ones (href for links, src for images)
    .replace(/<([a-z0-9]+)(?:[^>]*?)(?:\s(?:href|src|alt|title)="[^"]*")*[^>]*>/gi, '<$1>')
    
    // Clean up remaining HTML tags while preserving meaningful whitespace
    .replace(/<[^>]*>/g, ' ')
    
    // Remove common UI text patterns and instructions
    .replace(/\b(?:click|tap|swipe|drag|drop|scroll|press|type|enter|submit)\b\s+(?:here|to|for|the|button)\b/gi, '')
    .replace(/\b(?:learn|read|view|see|click|tap|get)\s+(?:more|started|docs|documentation|guide)\b/gi, '')
    .replace(/\b(?:loading|please wait|processing)\b/gi, '')
    
    // Remove CSS-related content
    .replace(/\b(?:font-family|var|--[a-z-]+)\b/g, '')
    .replace(/\s*(?:background-color|color|font-size|margin|padding|border):[^;]+;?\s*/g, '')
    .replace(/\s*style="[^"]*"/g, '')
    
    // Clean up special characters and formatting
    .replace(/\s*[|•·]\s*/g, '. ')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s*[_]\s*/g, ' ')
    .replace(/\s*[()[\]{}]\s*/g, ' ')
    .replace(/\s*[\\/@#$%^&*+=]\s*/g, ' ')
    
    // Normalize whitespace and punctuation
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/([.,!?])\s+/g, '$1 ')
    
    // Remove duplicate adjacent content (improved pattern)
    .replace(/(.{20,}?)\1+/g, '$1')
    .replace(/(\b\w+(?:\s+\w+){2,}\b)\s+\1/g, '$1')
    .replace(/(\b\w+(?:\s+\w+){3,}\b).*?\1/g, '$1')
    .replace(/(\b[^.!?]+)[.!?]+\s+\1\b/gi, '$1')
    
    // Clean up remaining formatting artifacts
    .replace(/(?:\s*-\s*)+/g, '-')
    .replace(/\b(\w+)(?:\s*-\s*\1)+\b/gi, '$1')
    .replace(/\b(\w+)(?:\s+\1)+\b/gi, '$1')
    
    .trim();
};

const removeDuplicateContent = (content: string): string => {
  // Split into sentences/segments for more accurate deduplication
  const segments = content.split(/[.!?]+\s+/);
  const uniqueSegments = new Set<string>();
  const processedSegments: string[] = [];
  
  for (const segment of segments) {
    const cleanSegment = segment.trim();
    
    // Skip empty segments or very short ones
    if (!cleanSegment || cleanSegment.length < 5) continue;
    
    // Skip navigation-like segments and UI instructions
    if (/^(?:click|tap|learn more|read more|view|see|previous|next|back|home|close|cancel|submit|loading|please wait|get started)\b/i.test(cleanSegment)) {
      continue;
    }
    
    // Skip segments that are just numbers, single words, or common UI patterns
    if (/^\d+$/.test(cleanSegment) || 
        !/\s/.test(cleanSegment) || 
        /^(?:yes|no|ok|cancel|submit|close|loading|menu|navigation)\b/i.test(cleanSegment)) {
      continue;
    }
    
    // Skip segments that are just product names or common headings
    if (/^(?:adobe|commerce|experience|cloud|platform|service|api|sdk)\s*$/i.test(cleanSegment)) {
      continue;
    }
    
    // For longer segments, check for near-duplicates and substrings
    if (cleanSegment.length > 20) {
      let isDuplicate = false;
      for (const existing of uniqueSegments) {
        // Check for exact duplicates, near-duplicates, and significant overlaps
        if (existing === cleanSegment || 
            existing.includes(cleanSegment) || 
            cleanSegment.includes(existing) ||
            (existing.length > 20 && cleanSegment.length > 20 && 
             (existing.includes(cleanSegment.substring(0, Math.floor(cleanSegment.length * 0.8))) ||
              cleanSegment.includes(existing.substring(0, Math.floor(existing.length * 0.8))) ||
              levenshteinDistance(existing, cleanSegment) / Math.max(existing.length, cleanSegment.length) < 0.2))) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;
    }
    
    uniqueSegments.add(cleanSegment);
    processedSegments.push(cleanSegment);
  }
  
  return processedSegments
    .filter(segment => segment.length >= 10 || /[.!?]$/.test(segment)) // Keep only meaningful segments
    .join('. ')
    .replace(/\.\s*\./g, '.') // Clean up multiple periods
    .replace(/\s+/g, ' ') // Clean up whitespace
    .trim();
};

// Helper function to calculate Levenshtein distance for better duplicate detection
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + 1, // substitution
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1      // insertion
        );
      }
    }
  }

  return dp[m][n];
}

const normalizeHeading = (heading: string): string => {
  return heading
    .replace(/\s+/g, ' ')
    .replace(/^[0-9.]+\s+/, '') // Remove leading numbers/periods
    .trim();
};

const extractMetadata = ($: CheerioRoot): Record<string, string> => {
  const metadata: Record<string, string> = {};
  
  // Process meta tags
  $('meta').each(function(this: Element) {
    const $el = $(this);
    const name = $el.attr('name') || $el.attr('property');
    const content = $el.attr('content');
    
    if (name && content) {
      // Skip social media tags
      if (!name.startsWith('og:') && !name.startsWith('twitter:')) {
        metadata[name] = content.trim();
      }
    }
  });
  
  // Add last modified date if available
  const lastModified = $('meta[name="last-modified"]').attr('content');
  if (lastModified) {
    metadata['lastModified'] = lastModified;
  } else {
    // Use current date as fallback
    metadata['lastModified'] = new Date().toISOString().split('T')[0];
  }
  
  return metadata;
};

const extractSegments = ($: CheerioRoot, $element: ReturnType<typeof $>): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  let currentSegment: ContentSegment | null = null;
  let contentBuffer: string[] = [];
  
  // Remove unwanted elements before processing
  $element.find('nav, header, footer, .navigation, .menu, .sidebar, [role="navigation"], button, .button, .toolbar, .dialog, [aria-hidden="true"], aside, [role="complementary"], .search-container, .breadcrumb, .pagination, [data-block-name="footer"], [data-block-name="header"]');
  
  // Process all elements in order
  $element.find('*').each(function(this: Element) {
    const $node = $(this);
    const tagName = this.name?.toLowerCase();
    
    // Skip processing if this is a navigation or UI element
    if ($node.attr('role') === 'navigation' || 
        $node.hasClass('nav') || 
        $node.hasClass('menu') || 
        $node.hasClass('button') ||
        $node.hasClass('search') ||
        $node.hasClass('pagination') ||
        $node.hasClass('breadcrumb') ||
        $node.attr('aria-hidden') === 'true' ||
        /^(?:nav|header|footer|button|form|aside|dialog|meta)$/.test(tagName || '')) {
      return;
    }

    if (tagName && /^h[1-6]$/.test(tagName)) {
      // Save previous segment if exists
      if (currentSegment && contentBuffer.length > 0) {
        const content = removeDuplicateContent(cleanHtml(contentBuffer.join('\n')));
        if (content && content.length >= 20) { // Only keep segments with meaningful content
          segments.push({
            heading: currentSegment.heading,
            content,
            level: currentSegment.level
          } as ContentSegment);
        }
      }
      
      // Start new segment
      const level = parseInt(tagName[1]);
      const heading = normalizeHeading($node.text());
      
      // Check if this heading is already used or is navigation-like
      const isDuplicateHeading = segments.some(s => 
        s.heading === heading && Math.abs(s.level - level) <= 1
      );
      const isNavigationHeading = /^(?:navigation|menu|links|related|see also|quick links|resources|tools|more|get started)\b/i.test(heading);
      
      if (!isDuplicateHeading && !isNavigationHeading && heading) {
        currentSegment = {
          heading,
          content: '',
          level
        };
        contentBuffer = [];
      }
    } else if (currentSegment) {
      // Skip unwanted elements and their content
      if (!/^(?:script|style|noscript|iframe|svg|nav|button|form|aside|dialog)$/.test(tagName || '')) {
        const text = cleanHtml($node.text());
        if (text && text.length >= 10) { // Only keep meaningful content
          contentBuffer.push(text);
        }
      }
    }
  });
  
  // Save the last segment
  if (currentSegment && contentBuffer.length > 0) {
    const content = removeDuplicateContent(cleanHtml(contentBuffer.join('\n')));
    if (content && content.length >= 20) {
      segments.push({
        heading: currentSegment.heading,
        content,
        level: currentSegment.level
      } as ContentSegment);
    }
  }

  return segments;
};

export async function fetchPageContent(url: string): Promise<PageContent> {
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract metadata
    const metadata = extractMetadata($);

    // Find main content container
    const $main = $('main').length ? $('main') :
                 $('article').length ? $('article') :
                 $('.content').length ? $('.content') :
                 $('#content').length ? $('#content') :
                 $('body');

    // Extract headings
    const headings = $main.find('h1, h2, h3, h4, h5, h6')
      .map((_, el) => normalizeHeading($(el).text()))
      .get()
      .filter(heading => heading.length > 0);

    // Extract segments
    const segments = extractSegments($, $main);

    // Get main content
    const mainContent = cleanHtml($main.text());

    if (segments.length === 0 && (!mainContent || mainContent.length < 100)) {
      // Only warn about no content if it's not a navigation page
      if (!url.endsWith('/nav')) {
        console.warn(`⚠️  No meaningful content found for ${url}`);
      }
    }

    return {
      url,
      title: $('title').text().trim() || metadata['title'] || '',
      mainContent,
      segments,
      headings,
      metadata
    };
  } catch (error) {
    // Don't log 404 errors, just throw them
    if (error && typeof error === 'object' && 'type' in error && error.type === 'skip') {
      throw error;
    }
    console.error(`❌ Error fetching content for ${url}:`, error);
    throw error;
  }
}

export async function analyzeContent(url: string): Promise<ContentAnalysis> {
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Analyze potential main content containers
    const containers = [
      { selector: 'main', count: $('main').length },
      { selector: 'article', count: $('article').length },
      { selector: '.content', count: $('.content').length },
      { selector: '#content', count: $('#content').length }
    ];

    const mainContentSelector = containers.find(c => c.count > 0)?.selector || 'body';

    return {
      url,
      contentLength: html.length,
      headingCount: $('h1, h2, h3, h4, h5, h6').length,
      metadataFields: $('meta')
        .map((_, el) => $(el).attr('name') || $(el).attr('property'))
        .get()
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
    const rootSection = path.split('/')[1] || 'root';
    if (!sections.has(rootSection)) {
      sections.set(rootSection, []);
    }
    sections.get(rootSection)!.push(url);
  });
  
  if (verbose) {
    console.log('\nAnalyzing sample pages from each section:');
    console.log('=======================================\n');
  }
  
  // Analyze a sample from each section
  for (const [, sectionUrls] of sections) {
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
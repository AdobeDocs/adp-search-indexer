import cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { SitemapUrl, PageContent, ContentSegment } from '../types/index';
import type { AlgoliaRecord } from '../types/algolia';
import { TaskQueue } from '../utils/queue';
import { retry } from '../utils/retry';

type CheerioRoot = ReturnType<typeof cheerio.load>;

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

/**
 * Cleans and normalizes HTML content by removing unwanted elements and formatting.
 * 
 * @param html - The raw HTML content to clean
 * @returns Cleaned and normalized text content
 */
const cleanHtml = (html: string): string => {
  if (!html) return '';
  
  // First remove template data blocks and code blocks that aren't content
  html = html.replace(/<pre><code>data-slots=[^<]*<\/code><\/pre>/g, '')
             .replace(/<pre><code>[^<]*<\/code><\/pre>/g, '');
             
  // Remove video embeds and iframes
  html = html.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/g, '')
             .replace(/<div[^>]*class="[^"]*(?:video|youtube|vimeo|embed|media-embed|video-container|player)[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
             .replace(/<div[^>]*data-[^>]*(?:video|youtube|vimeo|embed|media)[^>]*>[\s\S]*?<\/div>/g, '')
             .replace(/<video[^>]*>[\s\S]*?<\/video>/g, '')
             .replace(/<audio[^>]*>[\s\S]*?<\/audio>/g, '');
  
  // Decode HTML entities
  html = html.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#x26;/g, '&')
             .replace(/&#x3C;/g, '<')
             .replace(/&#x3E;/g, '>')
             .replace(/&#x22;/g, '"');
             
  return html
    // Remove complete script, style, and other unwanted tags with their content
    .replace(/<(script|style|noscript|iframe|svg|nav|header|footer|button|form|aside|dialog|meta)[^>]*>[\s\S]*?<\/\1>/gi, '')
    
    // Remove all data attributes and their content more aggressively
    .replace(/\s*data-[^\s>]*(?:="[^"]*")?/g, '')
    
    // Remove specific class patterns that indicate UI elements, but preserve their content
    .replace(/<[^>]*class="[^"]*(?:button|nav|menu|sidebar|footer|header|toolbar|dialog|modal|popup|overlay|search|pagination|breadcrumb)[^"]*"[^>]*>([\s\S]*?)<\/[^>]*>/gi, '$1')
    
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    
    // Preserve strong tags for emphasis
    .replace(/<strong([^>]*)>(.*?)<\/strong>/gi, '**$2**')
    
    // Convert paragraphs and divs to line breaks for better readability
    .replace(/<\/(p|div|section|article)>\s*<\1[^>]*>/gi, '\n\n')
    .replace(/<(p|div|section|article)[^>]*>/gi, '')
    .replace(/<\/(p|div|section|article)>/gi, '\n\n')
    
    // Remove links that are likely navigation or UI elements but keep meaningful ones
    .replace(/<a[^>]*>(?:Previous|Next|Back|Home|Top|Menu|Close|Cancel|Submit|Skip)[^<]*<\/a>/gi, '')
    
    // Remove URLs and links but keep their text content
    .replace(/<a[^>]*href="[^"]*"[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/https?:\/\/[^\s<>)"]+/g, '')
    .replace(/www\.[^\s<>)"]+/g, '')
    .replace(/\b(?:youtube\.com|youtu\.be|vimeo\.com|twitter\.com|facebook\.com|linkedin\.com|devpost\.com)\/?[^\s<>)"]*\b/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links
    .replace(/\b(?:check it out on|view on|watch on|available on|visit|go to)\s+(?:devpost|youtube|github|npm)\b/gi, '') // Remove common URL references
    
    // Clean up remaining HTML tags while preserving meaningful whitespace
    .replace(/<[^>]*>/g, ' ')
    
    // Remove common UI text patterns and instructions
    .replace(/\b(?:click|tap|swipe|drag|drop|scroll|press|type|enter|submit)\b\s+(?:here|to|for|the|button)\b/gi, '')
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
    
    // Normalize multiple newlines to maximum of two
    .replace(/\n{3,}/g, '\n\n')
    
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

/**
 * Calculates the Levenshtein distance between two strings.
 * Used for detecting similar or duplicate content.
 * 
 * @param str1 - First string to compare
 * @param str2 - Second string to compare
 * @returns The Levenshtein distance between the strings
 */
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

/**
 * Normalizes a heading by removing leading numbers and extra whitespace.
 * 
 * @param heading - The heading text to normalize
 * @returns The normalized heading text
 */
const normalizeHeading = (heading: string): string => {
  return heading
    .replace(/\s+/g, ' ')
    .replace(/^[0-9.]+\s+/, '')
    .trim();
};

/**
 * Extracts metadata from meta tags in the HTML document.
 * 
 * @param $ - Cheerio instance containing the parsed HTML
 * @returns Object containing extracted metadata key-value pairs
 */
const extractMetadata = ($: CheerioRoot): Record<string, string> => {
  const metadata: Record<string, string> = {};
  
  // Process meta tags
  $('meta').each(function(this: Element) {
    const $el = $(this);
    const name = $el.attr('name') || $el.attr('property');
    const content = $el.attr('content');
    
    if (name && content) {
      metadata[name] = content.trim();
    }
  });

  // Add important metadata fields with fallbacks
  metadata['source'] = metadata['source'] || '';
  metadata['pathprefix'] = metadata['pathprefix'] || '';
  metadata['githubblobpath'] = metadata['githubblobpath'] || '';
  metadata['template'] = metadata['template'] || 'documentation';
  
  // Extract Open Graph metadata
  metadata['og_title'] = metadata['og:title'] || '';
  metadata['og_description'] = metadata['og:description'] || '';
  metadata['og_image'] = metadata['og:image'] || '';
  
  // Add last modified date if available
  const lastModified = metadata['last-modified'] || $('meta[name="last-modified"]').attr('content');
  if (lastModified) {
    metadata['lastModified'] = lastModified;
  } else {
    // Use current date as fallback
    metadata['lastModified'] = new Date().toISOString();
  }
  
  return metadata;
};

/**
 * Extracts content segments from an HTML element, organizing content by headings.
 * Removes navigation and UI elements, and cleans the content.
 * 
 * @param $ - Cheerio instance
 * @param $root - Root cheerio element to extract segments from
 * @returns Array of ContentSegment objects
 */
const extractSegments = ($: CheerioRoot, $root: ReturnType<CheerioRoot>): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  let currentSegment: ContentSegment | null = null;
  let contentBuffer: string[] = [];

  function createSegment(heading: string, content: string, level: number): ContentSegment {
    return { heading, content, level };
  }

  function isContentSegment(segment: unknown): segment is ContentSegment {
    if (!segment || typeof segment !== 'object') return false;
    const s = segment as Record<string, unknown>;
    return typeof s['heading'] === 'string' &&
           typeof s['content'] === 'string' &&
           typeof s['level'] === 'number';
  }

  // Remove unwanted elements before processing
  $root.find('nav, header, footer, .navigation, .menu, .sidebar, [role="navigation"], button, .button, .toolbar, .dialog, [aria-hidden="true"], aside, [role="complementary"], .search-container, .breadcrumb, .pagination, [data-block-name="footer"], [data-block-name="header"]').remove();
  
  // Process all elements in order
  $root.find('*').each(function(this: Element) {
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
      if (currentSegment && isContentSegment(currentSegment)) {
        const content = removeDuplicateContent(cleanHtml(contentBuffer.join('\n')));
        if (content && content.length >= 20) {
          segments.push(createSegment(
            currentSegment['heading'],
            content,
            currentSegment['level']
          ));
        }
      }
      
      // Start new segment
      const level = parseInt(tagName[1]);
      const heading = normalizeHeading($node.text());
      
      // Check if this heading is already used or is navigation-like
      const isDuplicateHeading = segments.some(segment => segment.heading === heading);
      const isNavigationHeading = /^(?:navigation|menu|links|related|see also|quick links|resources|tools|more|get started)\b/i.test(heading);
      
      if (!isDuplicateHeading && !isNavigationHeading && heading) {
        currentSegment = createSegment(heading, '', level);
        contentBuffer = [];
      } else {
        currentSegment = null;
      }
    } else if (currentSegment && isContentSegment(currentSegment)) {
      // Skip unwanted elements and their content
      if (!/^(?:script|style|noscript|iframe|svg|nav|button|form|aside|dialog)$/.test(tagName || '')) {
        const text = cleanHtml($node.text());
        if (text && text.length >= 10) {
          contentBuffer.push(text);
        }
      }
    }
  });
  
  // Save the last segment
  if (currentSegment && isContentSegment(currentSegment) && contentBuffer.length > 0) {
    const content = removeDuplicateContent(cleanHtml(contentBuffer.join('\n')));
    if (content && content.length >= 20) {
      segments.push(createSegment(
        currentSegment['heading'],
        content,
        currentSegment['level']
      ));
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

    // Extract title with better fallbacks
    const title = $('title').text().trim() || 
                 $('h1').first().text().trim() || 
                 metadata['og:title'] || 
                 metadata['og_title'] || 
                 '';

    // Extract headings, filtering out empty ones
    const headings = $main.find('h1, h2, h3, h4, h5, h6')
      .map((_, el) => normalizeHeading($(el).text()))
      .get()
      .filter(heading => heading.length > 0);

    // Extract segments
    const segments = extractSegments($, $main);

    // Get main content with template data removed
    const mainContent = cleanHtml($main.html() || '');

    // Get description with better fallbacks
    const description = metadata['description'] || 
                       metadata['og:description'] ||
                       metadata['og_description'] ||
                       cleanHtml($main.find('p').first().text()) || 
                       mainContent.slice(0, 200) || '';

    // Track content structure
    const structure = {
      hasHeroSection: $main.find('.herosimple').length > 0,
      hasDiscoverBlocks: $main.find('.discoverblock').length > 0,
      contentTypes: Array.from(new Set($main.find('[class]').map((_, el) => $(el).attr('class')).get())),
    };

    if (segments.length === 0 && mainContent.length < 100) {
      // Only warn about no content if it's not a navigation page
      if (!url.endsWith('/nav')) {
        console.warn(`⚠️  No meaningful content found for ${url}`);
      }
    }

    return {
      url,
      title,
      mainContent,
      content: mainContent || '', // Ensure content is always defined
      description,
      segments,
      headings,
      metadata,
      structure
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
          console.log(`- Content length: ${content.mainContent?.length || 0} bytes`);
          console.log(`- Number of headings: ${content.headings.length}`);
          console.log('- Main content selector: main');
          console.log('- Available metadata fields:', Object.keys(content.metadata || {}).join(', '));
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

/**
 * Determines if a page's content should be segmented into multiple records.
 * Content is segmented if:
 * 1. Content size exceeds 8KB (leaving room for metadata)
 * 2. Page has multiple distinct sections with headings
 * 3. Content is structured (has clear hierarchy)
 */
export function shouldSegmentContent(content: PageContent): boolean {
  const CONTENT_SIZE_THRESHOLD = 8 * 1024; // 8KB
  const MIN_SEGMENTS = 3; // Minimum number of segments to consider breaking down

  // Check content size
  if (content.content.length > CONTENT_SIZE_THRESHOLD) {
    return true;
  }

  // Check if we have enough distinct segments
  if (content.segments.length >= MIN_SEGMENTS) {
    return true;
  }

  // If content has a clear hierarchy (multiple heading levels)
  const headingLevels = new Set(content.segments.map(segment => segment.level));
  if (headingLevels.size > 1) {
    return true;
  }

  return false;
}

/**
 * Creates multiple Algolia records from a single page content by segmenting it.
 * Returns an array of records: one parent record and multiple segment records.
 */
export function createSegmentedRecords(content: PageContent, indexName: string, productName: string): AlgoliaRecord[] {
  const records: AlgoliaRecord[] = [];
  const parentId = Buffer.from(content.url).toString('base64');
  const urlObj = new URL(content.url);
  const urlPath = urlObj.pathname;
  const urlFragment = urlObj.hash || undefined;
  const pathSegments = urlPath.split('/').filter(Boolean);
  
  // Build base hierarchy from path
  const baseHierarchy = {
    lvl0: pathSegments[0] || productName,
    lvl1: pathSegments.length > 1 ? pathSegments.slice(0, 2).join('/') : undefined,
    lvl2: pathSegments.length > 2 ? pathSegments.slice(0, 3).join('/') : undefined
  };
  
  // Determine the best title
  const title = content.title || 
                content.metadata?.['og_title'] || 
                content.headings[0] || 
                pathSegments[pathSegments.length - 1]?.toUpperCase() || 
                productName;
  
  const parentRecord: AlgoliaRecord = {
    objectID: parentId,
    url: content.url,
    path: urlPath,
    fragment: urlFragment,
    indexName,
    title,
    description: content.description || content.metadata?.['og_description'] || '',
    content: content.description || '',
    headings: content.headings || [],
    product: productName,
    type: 'documentation',
    topics: Array.isArray(content.metadata?.['topics']) ? content.metadata['topics'] : [],
    lastModified: new Date().toISOString(),
    hierarchy: {
      ...baseHierarchy,
      lvl0: pathSegments[0] || productName,
      lvl1: content.headings[0] || pathSegments.slice(0, 2).join('/'),
      lvl2: content.headings[1] || pathSegments.slice(0, 3).join('/')
    },
    metadata: {
      keywords: content.metadata?.['keywords'] || '',
      products: productName,
      og_title: content.metadata?.['og_title'] || title,
      og_description: content.metadata?.['og_description'] || content.description || '',
      og_image: content.metadata?.['og_image'] || ''
    },
    structure: content.structure || {
      hasHeroSection: false,
      hasDiscoverBlocks: false,
      contentTypes: []
    },
    isParent: true
  };
  
  records.push(parentRecord);

  // Create child records for each segment
  content.segments.forEach((segment, index) => {
    const segmentHierarchy = {
      lvl0: pathSegments[0] || productName,
      lvl1: content.headings[0] || pathSegments.slice(0, 2).join('/'),
      lvl2: segment.heading
    };

    // Create a fragment for the segment based on the heading
    const segmentFragment = `#${segment.heading.toLowerCase().replace(/\s+/g, '-')}`;
    const segmentUrl = `${urlObj.origin}${urlPath}${segmentFragment}`;

    const segmentRecord: AlgoliaRecord = {
      ...parentRecord,
      objectID: `${parentId}_${index}`,
      url: segmentUrl,
      path: urlPath,
      fragment: segmentFragment,
      title: segment.heading || title,
      content: segment.content,
      isParent: false,
      parentObjectID: parentId,
      sectionTitle: segment.heading,
      sectionLevel: segment.level,
      headings: [segment.heading],
      hierarchy: segmentHierarchy
    };
    
    records.push(segmentRecord);
  });

  return records;
} 
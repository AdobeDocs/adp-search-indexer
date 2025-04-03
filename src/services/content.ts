import cheerio from 'cheerio';
import type { Element } from 'domhandler';

import type { SitemapUrl, PageContent, ContentSegment } from '../types/index';
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
 * Comprehensive content cleaning function that properly handles HTML removal,
 * duplicate text detection, and text normalization in a single pass.
 * 
 * @param html - Raw HTML or text content to clean
 * @returns Clean, normalized text content
 */
const cleanContent = (html: string): string => {
  if (!html) return '';
  
  // Step 1: Remove complete elements that are never useful content
  let content = html
    // Remove scripts, styles, SVGs, and other non-content elements completely
    .replace(/<(script|style|noscript|iframe|object|embed|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Remove comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Remove specific UI elements with their content
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, ' ')
    // Remove elements with UI-related classes or roles
    .replace(/<[^>]*(?:class|id)="[^"]*(?:menu|navigation|sidebar|toolbar|breadcrumb|pagination)[^"]*"[^>]*>[\s\S]*?<\/[^>]*>/gi, ' ')
    .replace(/<[^>]*role="(?:navigation|complementary|banner|dialog)"[^>]*>[\s\S]*?<\/[^>]*>/gi, ' ');
  
  // Step 1.5: Clean up special data attributes (like data-slots)
  content = content
    // Remove data-slots attributes that appear in text
    .replace(/data-slots=\w+,\s*\w+/g, '')
    // Remove other common data attributes that might appear in text
    .replace(/data-\w+=["'][^"']*["']/g, '');
  
  // Step 2: Preserve content but remove HTML tags
  content = content
    // First convert some elements to text patterns we want to preserve
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _level, text) => `\n\n${text.trim()}\n\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `${text.trim()}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `• ${text.trim()}\n`)
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, text) => `${text.trim()}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    // Then remove all remaining HTML tags but keep their content
    .replace(/<[^>]+>/g, ' ');
  
  // Step 3: Decode HTML entities
  content = content
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&[a-z0-9]+;/gi, ' '); // Handle any other entities
  
  // Step 4: Normalize whitespace and improve text structure
  content = content
    // Normalize newlines
    .replace(/\r\n?/g, '\n')
    // Ensure consistent spacing around punctuation
    .replace(/\s+([.,;:!?)])/g, '$1')
    .replace(/([({])\s+/g, '$1')
    // Normalize multiple spaces and newlines
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  // Step 5: Split into sentences for deduplication
  const sentences = content.split(/(?<=[.!?])\s+/);
  const uniqueSentences: string[] = [];
  const seen = new Set<string>();
  
  for (const sentence of sentences) {
    // Skip very short sentences or common UI text
    const trimmed = sentence.trim();
    if (trimmed.length < 10 || /^(click|view|learn more|see more|read more|next|previous)$/i.test(trimmed)) {
      continue;
    }
    
    // Normalize the sentence for comparison (lowercase, remove punctuation)
    const normalized = trimmed.toLowerCase().replace(/[.,;:!?()[\]{}'"]/g, '');
    
    // Skip if it's a duplicate or close variant
    if (seen.has(normalized)) continue;
    
    // Check for significant overlap with existing sentences
    let isDuplicate = false;
    for (const existing of seen) {
      // If sentences are very similar (>80% overlap), consider it a duplicate
      if (normalized.length > 20 && existing.length > 20) {
        if (
          normalized.includes(existing.substring(0, Math.floor(existing.length * 0.8))) ||
          existing.includes(normalized.substring(0, Math.floor(normalized.length * 0.8)))
        ) {
          isDuplicate = true;
          break;
        }
      }
    }
    
    if (!isDuplicate) {
      seen.add(normalized);
      uniqueSentences.push(trimmed);
    }
  }
  
  // Step 6: Join unique sentences and do final cleanup
  return uniqueSentences.join(' ')
    // Remove duplicate adjacent words (e.g., "the the")
    .replace(/\b(\w+)\s+\1\b/gi, '$1')
    // Remove common UI text that might have survived previous filters
    .replace(/\b(click here|tap here|learn more|read more|view more|see details)\b/gi, '')
    // Final whitespace cleanup
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Normalizes a heading by removing excess whitespace and unwanted characters.
 */
const normalizeHeading = (heading: string): string => {
  if (!heading) return '';
  
  return heading
    .replace(/\s+/g, ' ')
    .replace(/^[-–—•*]+\s*/, '') // Remove leading bullets or dashes
    .replace(/\s*[-–—•*]+$/, '') // Remove trailing bullets or dashes
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
 * Uses a more robust, simplified approach to ensure more accurate content association.
 * 
 * @param $ - Cheerio instance
 * @param $root - Root cheerio element to extract segments from
 * @returns Array of ContentSegment objects
 */
const extractSegments = ($: CheerioRoot, $root: ReturnType<CheerioRoot>): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  
  // First, create a clean clone of the content for processing
  const $content = $root.clone();
  
  // Remove elements that aren't content
  $content.find('nav, header, footer, .navigation, .menu, .sidebar, script, style, noscript, iframe, svg, form, button, [role="navigation"], [role="banner"], [aria-hidden="true"]').remove();
  
  // Detect the type of page based on content structure
  const isDocumentationPage = $content.find('.markdown-body, .docs-container, .documentation, [data-slots], article, .article').length > 0;
  const hasSections = $content.find('section').length > 3; // Multiple sections usually indicates a structured page
  
  // Find all headings in the document and their positions
  const headings: Array<{heading: string; level: number; $element: ReturnType<typeof $>}> = [];
  
  $content.find('h1, h2, h3, h4, h5, h6').each(function(this: Element) {
    const $heading = $(this);
    const level = parseInt($heading.prop('tagName').substring(1), 10);
    const text = normalizeHeading($heading.text());
    
    // Skip empty, duplicate, or navigation-like headings
    if (!text || 
        headings.some(h => h.heading === text) || 
        /^(?:navigation|menu|links|related|see also|quick links|resources|tools|more|get started)$/i.test(text)) {
      return;
    }
    
    headings.push({
      heading: text,
      level,
      $element: $heading
    });
  });
  
  // If we found no headings, return an empty array
  if (headings.length === 0) {
    return segments;
  }
  
  // Map to track headings we've already processed to avoid duplicates
  const processedHeadings = new Set<string>();
  
  // Special handling for documentation pages with links
  if (isDocumentationPage) {
    // First, process the main heading and introduction content
    if (headings.length > 0 && headings[0].level === 1) {
      const mainHeading = headings[0];
      let introContent = "";
      
      // Gather introduction content (everything until the next heading)
      let $nextElement = mainHeading.$element.next();
      while ($nextElement.length && 
             !$nextElement.is('h1, h2, h3, h4, h5, h6')) {
        
        if (!$nextElement.is('script, style, iframe, button, form, nav, aside')) {
          // Add to intro content
          introContent += $nextElement.text() + " ";
        }
        
        $nextElement = $nextElement.next();
      }
      
      // Clean and add the intro segment
      const cleanedIntro = cleanContent(introContent);
      if (cleanedIntro && cleanedIntro.length >= 50) {
        segments.push({
          heading: mainHeading.heading,
          content: cleanedIntro,
          level: mainHeading.level
        });
        
        processedHeadings.add(mainHeading.heading);
      }
    }
    
    // Then process links and other structured content as separate segments
    if ($content.find('a').length > 5) { // If the page has several links
      // Find all sections that contain links with text
      const processedLinkTexts = new Set<string>(); // Track processed link texts to avoid duplication
      
      $content.find('a').each(function(this: Element) {
        const $link = $(this);
        const $linkParent = $link.parent();
        const linkText = $link.text().trim();
        
        // Skip navigation links and already processed links
        if ($linkParent.is('nav') || 
            $linkParent.closest('nav').length || 
            linkText.length < 10 ||
            processedLinkTexts.has(linkText)) {
          return;
        }
        
        // Mark this link as processed
        processedLinkTexts.add(linkText);
        
        // Find the nearest heading for this link
        let linkHeading = null;
        let $currentElement = $link;
        
        // Look up for the nearest heading
        while ($currentElement.length && !linkHeading) {
          $currentElement = $currentElement.prev();
          
          if ($currentElement.is('h1, h2, h3, h4, h5, h6')) {
            linkHeading = normalizeHeading($currentElement.text());
            break;
          }
        }
        
        // If no heading found above, look for the previous heading in the document
        if (!linkHeading) {
          for (let i = headings.length - 1; i >= 0; i--) {
            if ($link.index() > headings[i].$element.index()) {
              linkHeading = headings[i].heading;
              break;
            }
          }
        }
        
        // If still no heading, use the first heading or a default
        if (!linkHeading && headings.length > 0) {
          linkHeading = headings[0].heading;
        }
        
        if (linkHeading) {
          // Get surrounding text content
          const $contextParent = $link.closest('p, div, section, article');
          let contextContent = "";
          
          if ($contextParent.length) {
            contextContent = cleanContent($contextParent.text());
          } else {
            // If no context parent, get a reasonable context from siblings
            const $prev = $link.prev();
            const $next = $link.next();
            
            contextContent = ($prev.text() + " " + $link.text() + " " + $next.text()).trim();
            contextContent = cleanContent(contextContent);
          }
          
          // Only add if we have meaningful content
          if (contextContent && contextContent.length >= 50) {
            // Check if we already have this heading in a segment
            const existingSegmentIndex = segments.findIndex(s => s.heading === linkHeading);
            
            if (existingSegmentIndex >= 0) {
              // If the content doesn't already exist in this segment, add it
              if (!segments[existingSegmentIndex].content.includes(contextContent)) {
                segments[existingSegmentIndex].content += " " + contextContent;
              }
            } else {
              // Find the level of this heading
              const headingObj = headings.find(h => h.heading === linkHeading);
              
              segments.push({
                heading: linkHeading,
                content: contextContent,
                level: headingObj ? headingObj.level : 2 // Default to h2 if not found
              });
              
              processedHeadings.add(linkHeading);
            }
          }
        }
      });
    }
  }
  
  // Process the remaining headings in a traditional way
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    
    // Skip if we've already processed this heading
    if (processedHeadings.has(current.heading)) {
      continue;
    }
    
    // Mark this heading as processed
    processedHeadings.add(current.heading);
    
    let contentElements = [];
    
    // Get all elements between this heading and the next
    let $nextElement = current.$element.next();
    while ($nextElement.length && 
           (!$nextElement.is('h1, h2, h3, h4, h5, h6') || 
            headings.every(h => !h.$element.is($nextElement)))) {
      
      // Skip elements that are likely not content
      if (!$nextElement.is('script, style, iframe, button, form, nav, aside')) {
        contentElements.push($nextElement.clone());
      }
      
      $nextElement = $nextElement.next();
    }
    
    // Create a container to hold all the content
    const $container = $('<div>');
    contentElements.forEach($el => $container.append($el));
    
    // Clean the content text
    const contentText = cleanContent($container.text());
    
    // Only add the segment if it has substantial content
    if (contentText && contentText.length >= 30) {
      segments.push({
        heading: current.heading,
        content: contentText,
        level: current.level
      });
    }
  }
  
  // Handle case where there's content before the first heading
  if (headings.length > 0 && segments.length > 0) {
    const firstHeadingPos = $content.find('*').index(headings[0].$element);
    
    if (firstHeadingPos > 2) { // Has substantial content before first heading
      const $preHeadingContent = $('<div>');
      let $current = $content.children().first();
      
      while ($current.length && !$current.is(headings[0].$element)) {
        if (!$current.is('script, style, iframe, button, form, nav, aside')) {
          $preHeadingContent.append($current.clone());
        }
        $current = $current.next();
      }
      
      const preHeadingText = cleanContent($preHeadingContent.text());
      
      if (preHeadingText && preHeadingText.length >= 50) {
        // Check if we already have a segment with the first heading
        const firstHeadingSegmentIndex = segments.findIndex(s => s.heading === headings[0].heading);
        
        if (firstHeadingSegmentIndex >= 0) {
          // Combine the pre-heading content with the existing segment
          segments[firstHeadingSegmentIndex].content = preHeadingText + " " + segments[firstHeadingSegmentIndex].content;
        } else {
          // If there's significant content before the first heading, add it as a segment
          // with a unique prefix to avoid duplication
          segments.unshift({
            heading: segments[0].heading,
            content: preHeadingText,
            level: segments[0].level
          });
        }
      }
    }
  }
  
  // Special handling for sections that might contain meaningful structured content
  if (hasSections) {
    $content.find('section').each(function(this: Element) {
      const $section = $(this);
      
      // Skip if this is a navigation, header, or footer section
      if ($section.is('[role="navigation"], [role="banner"], [role="contentinfo"]') ||
          $section.hasClass('navigation') || $section.hasClass('footer') || $section.hasClass('header')) {
        return;
      }
      
      // Try to find a heading within this section
      let sectionHeading = null;
      let headingLevel = 2; // Default level if no heading found
      
      const $sectionHeading = $section.find('h1, h2, h3, h4, h5, h6').first();
      if ($sectionHeading.length) {
        sectionHeading = normalizeHeading($sectionHeading.text());
        headingLevel = parseInt($sectionHeading.prop('tagName').substring(1), 10);
      }
      
      // If no heading in section, look for other identifiers like strong text or class names
      if (!sectionHeading) {
        const $strong = $section.find('strong').first();
        if ($strong.length) {
          sectionHeading = normalizeHeading($strong.text());
        } else {
          // Try to use section class name as heading
          const className = $section.attr('class');
          if (className) {
            const mainClass = className.split(' ')[0].replace(/-/g, ' ');
            if (mainClass && mainClass.length > 3) {
              sectionHeading = normalizeHeading(mainClass);
            }
          }
        }
      }
      
      // If we found a heading and it's not already processed
      if (sectionHeading && !processedHeadings.has(sectionHeading)) {
        // Get the content of this section excluding any navigation elements
        const $sectionContent = $section.clone();
        $sectionContent.find('nav, .navigation, [role="navigation"]').remove();
        
        const sectionText = cleanContent($sectionContent.text());
        
        // Only add if we have meaningful content
        if (sectionText && sectionText.length >= 50) {
          segments.push({
            heading: sectionHeading,
            content: sectionText,
            level: headingLevel
          });
          
          processedHeadings.add(sectionHeading);
        }
      }
    });
  }
  
  // Ensure unique segments by combining any with the same heading
  const uniqueSegments: ContentSegment[] = [];
  const segmentsByHeading = new Map<string, ContentSegment>();
  
  segments.forEach(segment => {
    if (segmentsByHeading.has(segment.heading)) {
      // Combine content with existing segment
      const existing = segmentsByHeading.get(segment.heading)!;
      existing.content = `${existing.content} ${segment.content}`.trim();
    } else {
      segmentsByHeading.set(segment.heading, { ...segment });
    }
  });
  
  // Convert map back to array
  segmentsByHeading.forEach(segment => uniqueSegments.push(segment));
  
  return uniqueSegments;
};

/**
 *
 */
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
    const mainContent = cleanContent($main.html() || '');

    // Get description with better fallbacks
    const description = metadata['description'] || 
                       metadata['og:description'] ||
                       metadata['og_description'] ||
                       cleanContent($main.find('p').first().text()) || 
                       mainContent.slice(0, 200) || '';

    // Track content structure
    const structure = {
      hasHeroSection: $main.find('.herosimple').length > 0,
      hasDiscoverBlocks: $main.find('.discoverblock').length > 0,
      contentTypes: Array.from(new Set($main.find('[class]').map((_, el) => $(el).attr('class')).get())),
    };

    // Log warnings or errors for failed fetches but don't fail the entire process
    if (!response) {
      console.warn(`No response for URL: ${url}`);
      return {
        url,
        title: '',
        content: '',
        mainContent: '',
        description: '',
        segments: [],
        metadata: {},
        headings: [],
        structure: { hasHeroSection: false, hasDiscoverBlocks: false, contentTypes: [] }
      };
    }

    if (response.status === 404) {
      console.warn(`Not found (404): ${url}`);
      return {
        url,
        title: '',
        content: '',
        mainContent: '',
        description: '',
        segments: [],
        metadata: {},
        headings: [],
        structure: { hasHeroSection: false, hasDiscoverBlocks: false, contentTypes: [] }
      };
    }

    if (!response.ok) {
      console.warn(`Failed to fetch content for ${url}: ${response.status} ${response.statusText}`);
      return {
        url,
        title: '',
        content: '',
        mainContent: '',
        description: '',
        segments: [],
        metadata: {},
        headings: [],
        structure: { hasHeroSection: false, hasDiscoverBlocks: false, contentTypes: [] }
      };
    }

    // Check if we found meaningful content (only warn for non-nav pages)
    if (mainContent.trim().length < 100) {
      // Only warn about no content if it's not a navigation page
      if (!url.endsWith('/nav')) {
        console.warn(`No meaningful content found for ${url}`);
      }
      return {
        url,
        title,
        content: '',
        mainContent: '',
        description,
        segments: [],
        metadata,
        headings,
        structure
      };
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

/**
 *
 */
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
  } else {
    console.log('\nAnalyzing sample pages...');
  }
  
  let analyzedCount = 0;
  
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
        analyzedCount++;
        
        if (verbose) {
          console.log('Analysis results:');
          console.log(`- Content length: ${content.mainContent?.length || 0} bytes`);
          console.log(`- Number of headings: ${content.headings.length}`);
          console.log('- Main content selector: main');
          console.log('- Available metadata fields:', Object.keys(content.metadata || {}).join(', '));
          console.log('');
        }
      } catch (error) {
        // Always show errors, but format them differently based on verbosity
        if (verbose) {
          console.error(`Failed to analyze ${url.loc}:`, error);
        } else {
          console.error(`Failed to analyze URL: ${url.loc}`);
        }
      }
    }
  }
  
  // Add a summary message in non-verbose mode
  if (!verbose) {
    console.log(`Completed analysis of ${analyzedCount} sample pages\n`);
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
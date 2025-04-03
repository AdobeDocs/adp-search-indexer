import { createHash } from 'crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import algoliasearch, { type SearchClient, type SearchIndex } from 'algoliasearch';
import chalk from 'chalk';

import type { AlgoliaRecord, IndexingResult, AlgoliaIndexSettings } from '../types/algolia';
import type { PageContent, ContentSegment } from '../types/index';
import { normalizeDate, getCurrentTimestamp, isFutureDate, isMoreRecent } from '../utils/dates';
import { ensureDir } from '../utils/ensure-dir';
import { headingToFragmentId, normalizeUrl } from '../utils/url';

import { ProductMappingService } from './product-mapping';

export interface AlgoliaServiceConfig {
  appId: string;
  apiKey: string;
  verbose?: boolean;
  testMode?: 'none' | 'file' | 'console';
}

interface IndexMatch {
  indexName: string;
  productName: string;
}

/**
 * Service for interacting with Algolia search.
 *
 * This service initializes an Algolia client using the provided credentials and options,
 * and provides functionality to synchronize content to Algolia based on product mappings.
 * It supports different modes (index, export, or console) to accommodate various use cases.
 *
 * @param config - The configuration object containing Algolia credentials and other options.
 * @param productMappingService - An instance of ProductMappingService to incorporate product mapping logic.
 */
export class AlgoliaService {
  private client: SearchClient;
  private indices: Map<string, SearchIndex> = new Map();
  private productMappingService: ProductMappingService;
  private verbose: boolean;
  private testMode: 'none' | 'file' | 'console';

  /**
   *
   */
  constructor(config: AlgoliaServiceConfig, productMappingService: ProductMappingService) {
    this.client = algoliasearch(config.appId, config.apiKey);
    this.productMappingService = productMappingService;
    this.verbose = config.verbose || false;
    this.testMode = config.testMode || 'none';
  }

  private log(message: string, type: 'info' | 'warn' | 'error' = 'info', forceShow = false): void {
    if (this.verbose || forceShow) {
      switch (type) {
        case 'warn':
          console.warn(message);
          break;
        case 'error':
          console.error(message);
          break;
        default:
          console.log(message);
      }
    }
  }

  private async saveTestData(
    indexName: string,
    data: { settings: AlgoliaIndexSettings; records: AlgoliaRecord[]; productName: string }
  ): Promise<void> {
    if (this.testMode === 'none') return;

    if (this.testMode === 'console') {
      console.log(`\nTest Data for ${indexName}:`);
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    try {
      const outputDir = 'indexed-content';
      await ensureDir(outputDir);

      const fileName = `${indexName}.json`;
      const filePath = join(outputDir, fileName);

      await writeFile(filePath, JSON.stringify(data, null, 2));
      this.log(`Saved test data to ${filePath}`, 'info', true);
    } catch (error) {
      this.log(`Failed to save test data: ${error}`, 'error', true);
    }
  }

  private getIndexSettings(): AlgoliaIndexSettings {
    return {
      searchableAttributes: [
        'title',
        'unordered(headings)',
        'unordered(description)',
        'unordered(content)',
        'topics',
        'hierarchy.lvl0',
        'hierarchy.lvl1',
        'hierarchy.lvl2',
      ],
      attributesForFaceting: [
        'filterOnly(product)',
        'filterOnly(type)',
        'filterOnly(topics)',
        'filterOnly(hierarchy.lvl0)',
        'filterOnly(hierarchy.lvl1)',
        'filterOnly(hierarchy.lvl2)',
      ],
      customRanking: ['desc(lastModified)', 'asc(hierarchy.lvl0)', 'asc(hierarchy.lvl1)', 'asc(hierarchy.lvl2)'],
      ranking: ['typo', 'geo', 'words', 'filters', 'proximity', 'attribute', 'exact', 'custom'],
      minWordSizefor1Typo: 4,
      minWordSizefor2Typos: 8,
      queryLanguages: ['en'],
      removeStopWords: true,
      advancedSyntax: true,
    };
  }

  private async configureIndex(index: SearchIndex, records: AlgoliaRecord[], productName: string): Promise<void> {
    const settings = this.getIndexSettings();

    // Save combined data in test mode
    if (this.testMode !== 'none') {
      await this.saveTestData(index.indexName, {
        settings,
        records,
        productName,
      });
      return;
    }

    try {
      // First check if index exists
      let algoliaIndex: SearchIndex;
      try {
        await index.getSettings();
        algoliaIndex = index;
        this.log(`Using existing index: ${index.indexName}`, 'info', true);
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          this.log(`Creating new index: ${index.indexName}`, 'info', true);
          algoliaIndex = this.client.initIndex(index.indexName);

          // Configure settings for new index
          this.log(`Configuring settings for new index: ${index.indexName}`, 'info', true);
          await algoliaIndex.setSettings(settings);
        } else {
          throw error;
        }
      }

      // Save records
      this.log(`Saving ${records.length} records to index: ${index.indexName}`, 'info', this.verbose);
      await algoliaIndex.saveObjects(records);
      this.log(`✅ Successfully saved ${records.length} records to ${index.indexName}`, 'info', this.verbose);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Failed to configure index: ${message}`, 'error', true);
      throw error;
    }
  }

  private getIndexForUrl(url: string): IndexMatch | null {
    const path = new URL(url).pathname;
    if (this.verbose) {
      console.log(`🔍 Finding index for path: ${path}`);
    }

    const match = this.productMappingService.findBestMatch(path);
    if (match && this.verbose) {
      console.log(`✅ Found matching index: ${match.indexName} for product: ${match.productName}`);
    }
    return match;
  }

  private getIndex(indexName: string): SearchIndex {
    if (!this.indices.has(indexName)) {
      this.indices.set(indexName, this.client.initIndex(indexName));
    }
    return this.indices.get(indexName)!;
  }

  /**
   * Extracts and normalizes metadata from content.
   * @deprecated This method is maintained for backward compatibility but not actively used.
   */
  // @ts-expect-error: method is kept for future reference but not used
  private extractMetadata(metadata: Record<string, unknown>): AlgoliaRecord['metadata'] {
    const defaultMetadata = {
      keywords: '',
      products: '',
      og_title: '',
      og_description: '',
      og_image: '',
    };

    // Convert metadata values to strings and extract known fields
    const extracted: Record<string, string> = {};
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        extracted[key] = String(value);
      }
    });

    // Merge with default metadata, ensuring all required fields exist
    return {
      ...defaultMetadata,
      keywords: extracted['keywords'] || defaultMetadata.keywords,
      products: extracted['products'] || defaultMetadata.products,
      og_title: extracted['og_title'] || defaultMetadata.og_title,
      og_description: extracted['og_description'] || defaultMetadata.og_description,
      og_image: extracted['og_image'] || defaultMetadata.og_image,
    };
  }

  /**
   * Creates a better description from content by finding natural sentence breaks
   * and ensuring appropriate length.
   */
  private createBetterDescription(content: string): string {
    if (!content || content.length <= 160) {
      return content;
    }

    // Try to find a sentence break around 120-160 characters
    const sentenceBreakMatch = content.match(/^.{120,160}[.!?]/);
    if (sentenceBreakMatch) {
      return sentenceBreakMatch[0];
    }

    // Otherwise, try to break at a word boundary
    const truncated = content.substring(0, 157);
    const lastSpaceIndex = truncated.lastIndexOf(' ');

    if (lastSpaceIndex > 100) {
      // Add ellipsis to indicate truncation
      return truncated.substring(0, lastSpaceIndex) + '...';
    }

    // If no good breaking point found, just truncate with ellipsis
    return truncated + '...';
  }

  /**
   * Simplified hierarchy building that focuses on logical document structure
   * based on heading levels. Creates a consistent, gap-free hierarchy.
   */
  private buildHierarchyFromSegment(segment: ContentSegment, content: PageContent): AlgoliaRecord['hierarchy'] {
    // Initialize the hierarchy with sensible defaults
    const hierarchy: AlgoliaRecord['hierarchy'] = {
      lvl0: content.title || segment.heading || 'Documentation',
    };

    // If we don't have a segment or it doesn't have a heading, return the basic hierarchy
    if (!segment.heading) {
      return hierarchy;
    }

    // Simple approach: directly put the segment heading at the appropriate level based on its HTML level
    switch (segment.level) {
      case 1:
        // H1 is always the top level
        hierarchy.lvl0 = segment.heading;
        break;

      case 2:
        // For H2, find its parent H1 if available
        const parentH1 = this.findParentHeading(segment, content.segments, 1);
        if (parentH1) {
          hierarchy.lvl0 = parentH1;
          hierarchy.lvl1 = segment.heading;
        } else {
          // If no parent H1, treat this H2 as lvl0 (likely the main heading)
          hierarchy.lvl0 = segment.heading;
        }
        break;

      case 3:
        // For H3, try to find its parent H2, then parent H1
        const parentH2 = this.findParentHeading(segment, content.segments, 2);
        const topH1 = this.findParentHeading(segment, content.segments, 1);

        if (parentH2) {
          // If we have a parent H2, use it and its parent or the document title
          hierarchy.lvl0 = topH1 || content.title || 'Documentation';
          hierarchy.lvl1 = parentH2;
          hierarchy.lvl2 = segment.heading;
        } else if (topH1) {
          // If only a parent H1 is found, skip lvl1
          hierarchy.lvl0 = topH1;
        } else {
          // No parents found, use the segment heading at lvl0
          hierarchy.lvl0 = segment.heading;
        }
        break;

      default:
        // For H4+ headings, find the best parent headings
        const h3Parent = this.findParentHeading(segment, content.segments, 3);
        const h2Parent = this.findParentHeading(segment, content.segments, 2);
        const h1Parent = this.findParentHeading(segment, content.segments, 1);

        if (h3Parent && h2Parent) {
          // Full hierarchy available
          hierarchy.lvl0 = h1Parent || content.title || 'Documentation';
          hierarchy.lvl1 = h2Parent;
          hierarchy.lvl2 = h3Parent;
        } else if (h2Parent) {
          // Only H2 parent available
          hierarchy.lvl0 = h1Parent || content.title || 'Documentation';
          hierarchy.lvl1 = h2Parent;
          hierarchy.lvl2 = segment.heading;
        } else if (h1Parent) {
          // Only H1 parent available
          hierarchy.lvl0 = h1Parent;
          hierarchy.lvl1 = segment.heading;
        } else {
          // No parents found
          hierarchy.lvl0 = content.title || 'Documentation';
          hierarchy.lvl1 = segment.heading;
        }
        break;
    }

    return hierarchy;
  }

  /**
   * Helper method to find the nearest parent heading of a specific level
   * that comes before the given segment in the document.
   */
  private findParentHeading(
    segment: ContentSegment,
    allSegments: ContentSegment[],
    targetLevel: number
  ): string | null {
    // Find the index of the current segment
    const segmentIndex = allSegments.findIndex((s) => s.heading === segment.heading && s.level === segment.level);

    if (segmentIndex <= 0) return null;

    // Look backward through segments to find the most recent heading of the target level
    for (let i = segmentIndex - 1; i >= 0; i--) {
      if (allSegments[i].level === targetLevel) {
        return allSegments[i].heading;
      }
    }

    return null;
  }

  private createRecordFromSegment = (
    content: PageContent,
    segment: ContentSegment,
    indexInfo: {
      indexName: string;
      productName: string;
    },
    isMainContent: boolean = false,
    sitemapLastmod?: string,
    timestamp?: string,
    isBaseRecord: boolean = false
  ): AlgoliaRecord => {
    const url = normalizeUrl(content.url);
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // Ensure fragment starts with #
    const fragment = segment.heading ? headingToFragmentId(segment.heading) : undefined;

    // Get metadata
    const metadata = content.metadata || {};

    // Only include essential metadata fields to reduce redundancy
    const essentialMetadata = {
      og_title: metadata['og_title'] || content.title || '',
      og_description: metadata['og_description'] || content.description || '',
      keywords: '',
      products: indexInfo.productName,
      og_image: metadata['og_image'] || '',
    };

    // Extract topics and type, with fallbacks
    const topics = metadata['topics'];
    const type = metadata['type'];

    // Build the hierarchy based on the segment
    const hierarchy = this.buildHierarchyFromSegment(segment, content);

    // Improved description creation
    let description: string;
    if (isMainContent && content.description) {
      description = content.description;
    } else if (metadata['og_description']) {
      description = String(metadata['og_description']);
    } else {
      description = this.createBetterDescription(segment.content);
    }

    // Get the current timestamp if not provided
    const indexedAt = timestamp || getCurrentTimestamp();

    // Get the lastModified date with proper validation
    let lastModified = metadata['lastModified'] || sitemapLastmod;

    // Ensure lastModified is a valid date in the past
    lastModified = normalizeDate(lastModified);

    // Check if date is in the future and fix if needed
    if (isFutureDate(lastModified)) {
      console.warn(`⚠️ Future date detected in lastModified: ${lastModified}, using current date instead`);
      lastModified = normalizeDate(new Date());
    }

    const record: AlgoliaRecord = {
      objectID: this.generateObjectId(url, segment.heading),
      url,
      path,
      fragment,
      title: segment.heading || content.title || essentialMetadata.og_title,
      content: segment.content,
      product: indexInfo.productName,
      indexName: indexInfo.indexName,
      metadata: essentialMetadata,
      lastModified,
      sourceLastmod: sitemapLastmod,
      indexedAt,
      hierarchy,
      type: typeof type === 'string' ? type : 'unknown',
      topics: Array.isArray(topics) ? topics : [],
      headings: [], // Empty default, will be populated for base record
      description: '', // Empty default, will be populated for base record
    };

    // Only include headings array in base record to reduce redundancy
    if (isBaseRecord) {
      record.headings = content.headings || [];
      record.description = description;

      // Only include structure in base record if there's meaningful data
      const hasHeroSection = content.structure?.hasHeroSection || false;
      const hasDiscoverBlocks = content.structure?.hasDiscoverBlocks || false;

      if (hasHeroSection || hasDiscoverBlocks) {
        record.structure = {
          hasHeroSection,
          hasDiscoverBlocks,
          contentTypes: content.structure?.contentTypes || [],
        };
      }
    }

    return record;
  };

  /**
   *
   */
  createRecord(content: PageContent, sitemapLastmod?: string): AlgoliaRecord[] {
    // Only log in verbose mode or if it's a test URL
    if (this.verbose) {
      console.log(`\n🔄 Creating records for: ${content.url}`);
    }

    const url = normalizeUrl(content.url);
    const urlObj = new URL(url);
    const fragment = urlObj.hash || undefined;
    const indexInfo = this.getIndexForUrl(url);
    const metadata = content.metadata || {};

    if (!indexInfo) {
      console.warn('❌ Skipping: No index mapping found');
      return [];
    }

    const records: AlgoliaRecord[] = [];
    const timestamp = getCurrentTimestamp();

    // Minimum content length for a viable segment
    const MIN_SEGMENT_LENGTH = 80;

    // Track objectIDs we've already used to prevent duplicates
    const usedObjectIds = new Set<string>();

    // Create a base record for the whole page without fragment
    const baseObjectId = this.generateObjectId(url);
    usedObjectIds.add(baseObjectId);

    // Generate page title
    const pageTitle = content.title || metadata['og_title'] || content.headings[0] || indexInfo.productName;

    // Generate page description
    const pageDescription =
      content.description ||
      metadata['og_description'] ||
      (content.mainContent ? this.createBetterDescription(content.mainContent) : '');

    // Get the lastModified date with proper validation
    let lastModified = metadata['lastModified'] || sitemapLastmod;
    lastModified = normalizeDate(lastModified);

    // Check if date is in the future and fix if needed
    if (isFutureDate(lastModified)) {
      console.warn(`⚠️ Future date detected in lastModified: ${lastModified}, using current date instead`);
      lastModified = normalizeDate(new Date());
    }

    // Create a base segment for the page
    const baseSegment: ContentSegment = {
      heading: pageTitle,
      content: pageDescription,
      level: 1,
    };

    // Create the base record using our segment function
    const baseRecord = this.createRecordFromSegment(
      content,
      baseSegment,
      indexInfo,
      true,
      sitemapLastmod,
      timestamp,
      true // This is a base record
    );

    // Override objectID and fragment
    baseRecord.objectID = baseObjectId;
    baseRecord.fragment = undefined;

    records.push(baseRecord);
    if (this.verbose) {
      console.log(`✅ Created base record for ${url}`);
    }

    // Create records for each content segment
    (content.segments || []).forEach((segment, index) => {
      // Skip empty or very short content
      if (!segment.content.trim() || segment.content.length < MIN_SEGMENT_LENGTH) {
        if (this.verbose) {
          console.log(`⚠️  Skipping segment: Too short (${segment.content.length} chars)`);
        }
        return;
      }

      // Generate the objectID
      const objectID = this.generateObjectId(url, segment.heading);

      // If we've already used this objectID, make it unique by adding a suffix
      let uniqueObjectID = objectID;
      let suffix = 0;

      while (usedObjectIds.has(uniqueObjectID)) {
        suffix++;
        // Add a suffix to make the ID unique
        uniqueObjectID = `${objectID}_${suffix}`;
      }

      // Mark this objectID as used
      usedObjectIds.add(uniqueObjectID);

      const record = this.createRecordFromSegment(
        content,
        segment,
        indexInfo,
        index === 0,
        sitemapLastmod,
        timestamp,
        false // Not a base record
      );

      // Override the objectID with our unique one
      record.objectID = uniqueObjectID;

      records.push(record);
      if (this.verbose) {
        console.log(`✅ Created record for segment: ${(segment.heading || '').substring(0, 50)}...`);
      }
    });

    // If no segment records were created (but we still have the base record)
    if (records.length === 1 && content.mainContent) {
      if (this.verbose) {
        console.log('ℹ️  No segments created, using main content for a detailed record');
      }

      // Use the already cleaned content from the PageContent object
      const mainContent = content.mainContent;

      // Create a main segment from the content to use with our buildHierarchyFromSegment
      const mainSegment: ContentSegment = {
        heading: content.headings[0] || pageTitle,
        content: mainContent,
        level: 1,
      };

      // Generate the objectID (with a suffix to make it different from the base record)
      const objectID = this.generateObjectId(url, 'main');

      // Skip if somehow we've already used this objectID
      if (!usedObjectIds.has(objectID)) {
        // Track this ID
        usedObjectIds.add(objectID);

        const mainRecord = this.createRecordFromSegment(
          content,
          mainSegment,
          indexInfo,
          true,
          sitemapLastmod,
          timestamp,
          false // Not a base record (we already have one)
        );

        // Override properties
        mainRecord.objectID = objectID;
        mainRecord.fragment = fragment;

        records.push(mainRecord);
        if (this.verbose) {
          console.log(`✅ Created detailed record for ${url}`);
        }
      }
    }

    return records;
  }

  /**
   *
   */
  async saveRecords(records: AlgoliaRecord[]): Promise<IndexingResult[]> {
    const stats = {
      total: records.length,
      byIndex: new Map<string, number>(),
      skipped: 0,
      errors: 0,
      successfulIndices: 0,
      failedIndices: 0,
    };

    // Only show starting message in verbose mode
    if (this.verbose) {
      console.log('\n🔍 Debug: Starting record processing');
      console.log(`Total records received: ${records.length}`);
    }

    // Group records by index
    const recordsByIndex = new Map<string, AlgoliaRecord[]>();

    // Group and validate records
    for (const record of records) {
      // Only show detailed per-record logs in verbose mode
      if (this.verbose) {
        console.log(`\n📄 Processing record:`);
        console.log(`URL: ${record.url}`);
        console.log(`Current Index Name: ${record.indexName}`);
        console.log(`Record Content Length: ${record.content.length}`);
        console.log(`Record Title: ${record.title}`);
        console.log(`Record Product: ${record.product}`);
      }

      const indexInfo = this.getIndexForUrl(record.url);

      if (!indexInfo) {
        // Show errors only in verbose mode unless critical
        if (this.verbose) {
          console.warn(`❌ Skipping: No index mapping found for URL: ${record.url}`);
        }
        stats.skipped++;
        continue;
      }

      // Only log detailed match info in verbose mode
      if (this.verbose) {
        console.log(`✓ Found index mapping:`);
        console.log(`  • Index Name: ${indexInfo.indexName}`);
        console.log(`  • Product: ${indexInfo.productName}`);
      }

      const { indexName } = indexInfo;
      if (!recordsByIndex.has(indexName)) {
        // Only log new record group in verbose mode
        if (this.verbose) {
          console.log(`Creating new record group for index: ${indexName}`);
        }
        recordsByIndex.set(indexName, []);
      }
      recordsByIndex.get(indexName)!.push(record);
      stats.byIndex.set(indexName, (stats.byIndex.get(indexName) || 0) + 1);
    }

    // Detailed record grouping summary in verbose mode only
    if (this.verbose) {
      console.log('\n📊 Record grouping summary:');
      for (const [indexName, indexRecords] of recordsByIndex) {
        console.log(`${indexName}: ${indexRecords.length} records`);
      }
    }

    // Process each group of records
    const results: IndexingResult[] = [];
    let currentIndex = 0;

    // Build a summary of operations to display at the end
    const indexSummary: Map<string, { recordCount: number; updated: number; deleted: number }> = new Map();

    // Process all indices
    for (const [indexName, indexRecords] of recordsByIndex) {
      currentIndex++;
      try {
        // Show detailed info in verbose mode only
        if (this.verbose) {
          console.log(`\n🔄 Processing index ${currentIndex}/${recordsByIndex.size}: ${indexName}`);
          console.log(`Records to index: ${indexRecords.length}`);
          console.log('Sample record:');
          console.log(JSON.stringify(indexRecords[0], null, 2));
        }

        // Get the index
        if (this.verbose) {
          console.log('Getting index instance...');
        }

        const index = {
          indexObj: this.getIndex(indexName),
          indexName: indexName,
          productName: indexRecords[0].product,
        };

        // Decide on update strategy
        const forceUpdate = process.env['FORCE'] === 'true';
        // If force is true, automatically disable partial mode for more logical behavior
        const partialUpdate = forceUpdate ? false : process.env['PARTIAL'] !== 'false';

        if (this.verbose) {
          if (partialUpdate) {
            console.log(`Using partial update mode (force=${forceUpdate})`);
          } else {
            console.log('Using full reindex mode');
          }
        }

        let summary: { updated: number; deleted: number } = { updated: 0, deleted: 0 };

        // Perform the appropriate indexing strategy
        if (partialUpdate) {
          // In partial update mode, compare and sync records
          summary = await this.compareAndSyncRecords(index, indexRecords, forceUpdate);
        } else {
          // In full reindex mode, configure the index and save all records
          if (this.verbose) {
            console.log(`Using existing index: ${indexName}`);
            console.log(`Saving ${indexRecords.length} records to index: ${indexName}`);
          }

          await this.configureIndex(index.indexObj, indexRecords, index.productName);
          summary = { updated: indexRecords.length, deleted: 0 };

          if (this.verbose) {
            console.log(`✅ Successfully saved ${indexRecords.length} records to ${indexName}`);
          }
        }

        // Save index stats
        results.push({
          indexName: indexName,
          recordCount: indexRecords.length,
          status: 'success',
          updated: summary.updated,
          deleted: summary.deleted,
        });

        // Save summary for final display
        indexSummary.set(indexName, {
          recordCount: indexRecords.length,
          updated: summary.updated,
          deleted: summary.deleted,
        });

        stats.successfulIndices++;

        if (this.verbose) {
          console.log(`✅ Successfully configured and saved records to ${indexName}`);
        } else {
          // In non-verbose mode, don't show per-index status - we'll show it in the summary
        }
      } catch (error) {
        console.error(
          `${chalk.red('✗')} ${chalk.cyan(indexName)}: Error processing ${indexRecords.length} records`,
          error
        );
        results.push({
          indexName: indexName,
          recordCount: indexRecords.length,
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        });

        stats.failedIndices++;
        stats.errors += indexRecords.length;
      }
    }

    // Only show detailed stats in verbose mode
    if (this.verbose) {
      console.log('\nFinal Indexing Statistics');
      console.log('=========================');
      console.log(`Total records processed: ${stats.total}`);
      console.log(`Records skipped: ${stats.skipped}`);
      console.log(`Records with errors: ${stats.errors}`);
      console.log(`Successful indices: ${stats.successfulIndices}`);
      console.log(`Failed indices: ${stats.failedIndices}`);

      console.log('\nBreakdown by index:');
      for (const [indexName, count] of stats.byIndex) {
        console.log(`  • ${indexName}: ${count} records`);
      }
    } else {
      // Show a consolidated summary at the end with all indices
      console.log(`\n${chalk.bold('Index summary:')}`);

      // Show one line per index with total records
      for (const [indexName, count] of stats.byIndex) {
        const summary = indexSummary.get(indexName) || { updated: 0, deleted: 0 };
        const total = count;
        const updateType =
          summary.updated === total
            ? `${chalk.green('full update')}`
            : `${chalk.yellow('partial update')} (${summary.updated} of ${total})`;
        console.log(`${chalk.cyan(indexName)}: ${total} records, ${updateType}`);
      }

      // Skip the redundant Saved message - let the ContentIndexer show the final summary
      if (stats.skipped > 0 || stats.errors > 0 || stats.failedIndices > 0) {
        console.log(
          `${chalk.yellow('Issues')}: ${stats.skipped} skipped, ${stats.errors} errors, ${stats.failedIndices} failed indices`
        );
      }
    }

    return results;
  }

  /**
   * Performs a partial update to an Algolia index using timestamp-based comparison.
   *
   * This method uses our improved compareAndSyncRecords function to:
   * 1. Gets all existing records from the index
   * 2. Compares them with new records to identify what needs updating/deleting
   * 3. Only updates records that are newer based on lastmod timestamp
   * 4. Deletes records that no longer exist in the current sitemap
   *
   * @param index The Algolia index to update
   * @param newRecords The new records to add/update in the index
   * @param forceUpdate Whether to force update all records regardless of timestamp
   * @returns A Promise with the update statistics
   */
  async partialUpdate(
    index: SearchIndex,
    newRecords: AlgoliaRecord[],
    forceUpdate = false
  ): Promise<{ updated: number; deleted: number }> {
    // Ensure all dates are normalized and valid before updating
    newRecords.forEach((record) => {
      // Fix any future dates
      if (isFutureDate(record.lastModified)) {
        console.warn(
          `⚠️ Future date detected in record lastModified: ${record.lastModified}, using current date instead`
        );
        record.lastModified = normalizeDate(new Date());
      }

      // Update indexedAt timestamp
      record.indexedAt = getCurrentTimestamp();
    });

    console.log('\n📊 Partial update analysis:');
    console.log(`Index: ${index.indexName}`);
    console.log(`New records: ${newRecords.length}`);

    try {
      // Get index name and find product mapping
      const indexName = index.indexName;
      const indexInfo = this.productMappingService.getIndexForUrl(`https://example.com${indexName}`) || {
        indexName,
        productName: 'unknown',
      };

      // Use our improved compare and sync method
      return await this.compareAndSyncRecords(
        {
          indexObj: index,
          indexName,
          productName: indexInfo.productName,
        },
        newRecords,
        forceUpdate
      );
    } catch (error) {
      console.error(`❌ Error performing partial update:`, error);
      throw error;
    }
  }

  private generateObjectId = (url: string, segment?: string): string => {
    // Use the normalized URL function from utils/url for better consistency
    const normalizedUrl = normalizeUrl(url);

    // If we have a segment, combine it with the URL in a consistent way
    // Make sure to clean and normalize the segment text
    const input = segment ? `${normalizedUrl}#${headingToFragmentId(segment).replace(/^#/, '')}` : normalizedUrl;

    // Add a timestamp component to ensure uniqueness when regenerating
    // This will only make the ID unique during a single generation run, not across runs
    // But that's sufficient to avoid collisions in a single content object
    const contextHash = segment ? segment.length.toString(16) : '';

    // Generate MD5 hash of the combined input
    return createHash('md5').update(`${input}${contextHash}`).digest('hex');
  };

  private async compareAndSyncRecords(
    index: {
      indexObj: SearchIndex;
      indexName: string;
      productName: string;
    },
    records: AlgoliaRecord[],
    forceUpdate = false
  ): Promise<{ updated: number; deleted: number }> {
    // Organize new records by objectID for easier lookup
    const newRecordsMap = new Map<string, AlgoliaRecord>();
    records.forEach((record) => newRecordsMap.set(record.objectID, record));

    // Initialize counters
    let existingRecordsCount = 0;
    const recordsToUpdate: AlgoliaRecord[] = [];
    const objectIDsToDelete: string[] = [];

    // Fetch all existing records
    try {
      // Only show detailed logs in verbose mode
      if (this.verbose) {
        console.log(`\n📥 Fetching existing records for "${index.indexName}"...`);
      }

      const browser = index.indexObj.browseObjects({
        batch: (existingRecords) => {
          existingRecordsCount += existingRecords.length;

          existingRecords.forEach((existingRecord) => {
            const objectID = existingRecord.objectID;

            if (newRecordsMap.has(objectID)) {
              const newRecord = newRecordsMap.get(objectID)!;

              // Use our date utility to safely compare dates - handle type safety
              const existingRecordDate =
                (existingRecord as { sourceLastmod?: string; lastModified?: string }).sourceLastmod ||
                (existingRecord as { sourceLastmod?: string; lastModified?: string }).lastModified;
              const newRecordDate = newRecord.sourceLastmod || newRecord.lastModified;

              // Update if forced or new content is newer (and not a future date)
              const shouldUpdate =
                forceUpdate || !existingRecordDate || !newRecordDate || isMoreRecent(newRecordDate, existingRecordDate);

              if (shouldUpdate) {
                // Ensure the lastModified date is valid (not in the future)
                if (isFutureDate(newRecord.lastModified)) {
                  console.warn(
                    `⚠️ Future date detected in record lastModified: ${newRecord.lastModified}, using current date instead`
                  );
                  newRecord.lastModified = normalizeDate(new Date());
                }

                // Ensure indexedAt is current
                newRecord.indexedAt = getCurrentTimestamp();

                recordsToUpdate.push(newRecord);
              }

              // Remove from map so we don't process it again
              newRecordsMap.delete(objectID);
            } else {
              // Record no longer in sitemap, mark for deletion
              objectIDsToDelete.push(objectID);
            }
          });
        },
      });

      // Wait for browsing to complete
      await browser;

      // Add remaining new records (not in existing set)
      recordsToUpdate.push(...newRecordsMap.values());

      // Log stats based on verbosity level and only if there are changes
      if (this.verbose) {
        console.log(`\n📊 Index "${index.indexName}" update summary:`);
        console.log(`  • Existing records: ${existingRecordsCount}`);
        console.log(`  • Records to update: ${recordsToUpdate.length}`);
        console.log(`  • Records to delete: ${objectIDsToDelete.length}`);
      }

      // Perform operations without additional logging in non-verbose mode
      if (objectIDsToDelete.length > 0) {
        if (this.verbose) {
          console.log(`\n🗑️  Deleting ${objectIDsToDelete.length} records...`);
        }
        if (this.testMode === 'none') {
          await index.indexObj.deleteObjects(objectIDsToDelete);
        }
      }

      if (recordsToUpdate.length > 0) {
        if (this.verbose) {
          console.log(`\n📤 Updating ${recordsToUpdate.length} records...`);
        }
        if (this.testMode === 'none') {
          const response = await index.indexObj.saveObjects(recordsToUpdate);
          // Only show detailed task IDs in verbose mode
          if (this.verbose) {
            console.log(`  • Task IDs: ${response.taskIDs.length}`);
            console.log(`  • Object IDs: ${response.objectIDs.length}`);
          }
        }
      }

      return { updated: recordsToUpdate.length, deleted: objectIDsToDelete.length };
    } catch (error) {
      console.error(`❌ Failed to sync records for ${index.indexName}:`, error);
      throw error;
    }
  }

  /**
   * Gets an existing Algolia index or creates a new one if it doesn't exist.
   *
   * @param indexName - The name of the index to get or create
   * @returns The Algolia search index object
   */
  private getOrCreateIndex(indexName: string): SearchIndex {
    if (this.indices.has(indexName)) {
      return this.indices.get(indexName)!;
    }

    // Create a new index
    console.log(`🆕 Creating new index: ${indexName}`);
    const index = this.client.initIndex(indexName);
    this.indices.set(indexName, index);
    return index;
  }

  /**
   * Regenerates records from existing content pages, applying all cleanup and improvements.
   * This is useful when you want to refresh records after making changes to the content processing logic.
   *
   * @param contents Array of page content objects to regenerate records from
   * @param force Whether to force update all records in Algolia
   * @returns Promise with results for each index
   */
  async regenerateRecords(contents: PageContent[], force = false): Promise<IndexingResult[]> {
    console.log(`\n🔄 Regenerating records from ${contents.length} content pages`);

    // Map to store records by index
    const recordsByIndex = new Map<string, AlgoliaRecord[]>();

    // Create records from each content
    let processedCount = 0;
    let skippedCount = 0;

    for (const content of contents) {
      try {
        // Get index info for this content
        const url = normalizeUrl(content.url);
        const indexInfo = this.getIndexForUrl(url);

        if (!indexInfo) {
          console.warn(`⚠️ Skipping content: No index mapping found for ${url}`);
          skippedCount++;
          continue;
        }

        // Create records from this content
        const sourceLastmod =
          content.metadata?.['lastModified'] || content.metadata?.['sourceLastmod'] || new Date().toISOString();

        // Generate records with our improved methods
        const records = this.createRecord(content, sourceLastmod);

        // Skip if no records were created
        if (records.length === 0) {
          console.warn(`⚠️ No records created for ${url}`);
          skippedCount++;
          continue;
        }

        // Add to the map by index
        const { indexName } = indexInfo;
        if (!recordsByIndex.has(indexName)) {
          recordsByIndex.set(indexName, []);
        }

        recordsByIndex.get(indexName)!.push(...records);
        processedCount++;
      } catch (error) {
        console.error(`❌ Error processing content:`, error);
        skippedCount++;
      }
    }

    // Print stats so far
    console.log(`\n📊 Processing statistics:`);
    console.log(`Processed content pages: ${processedCount}`);
    console.log(`Skipped content pages: ${skippedCount}`);
    console.log(`Total records generated: ${Array.from(recordsByIndex.values()).flat().length}`);

    // Synchronize each index with its records
    const results: IndexingResult[] = [];

    for (const [indexName, records] of recordsByIndex.entries()) {
      console.log(`\n🔄 Synchronizing index: ${indexName} (${records.length} records)`);

      try {
        // Get or create the index
        const index = this.getOrCreateIndex(indexName);

        // Configure and update the index
        await this.configureIndex(index, records, indexName);

        // Use our improved partialUpdate method
        const updateResult = await this.partialUpdate(index, records, force);

        // Add result to results array
        results.push({
          indexName,
          recordCount: records.length,
          status: 'success',
          updated: updateResult.updated,
          deleted: updateResult.deleted,
        });
      } catch (error) {
        console.error(`❌ Error synchronizing index ${indexName}:`, error);

        results.push({
          indexName,
          recordCount: records.length,
          status: 'error',
          error: error as Error,
        });
      }
    }

    return results;
  }
}

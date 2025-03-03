import algoliasearch, { type SearchClient, type SearchIndex } from 'algoliasearch';
import type { AlgoliaRecord, IndexingResult, AlgoliaIndexSettings } from '../types/algolia';
import type { PageContent, ContentSegment } from '../types/index';
import { createHash } from 'crypto';
import { ensureDir } from '../utils/ensure-dir';
import { join } from 'node:path';
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
 * It supports different modes (real, console, or export) to accommodate various use cases.
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

  constructor(config: AlgoliaServiceConfig, productMappingService: ProductMappingService) {
    this.client = algoliasearch(config.appId, config.apiKey);
    this.productMappingService = productMappingService;
    this.verbose = config.verbose || false;
    this.testMode = config.testMode || 'none';
  }

  private log(message: string, type: 'info' | 'warn' | 'error' = 'info', forceShow = false) {
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

  private async saveTestData(indexName: string, data: { settings: AlgoliaIndexSettings; records: AlgoliaRecord[]; productName: string }): Promise<void> {
    if (this.testMode === 'none') return;

    if (this.testMode === 'console') {
      console.log(`\n📝 Test Data for ${indexName}:`);
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    try {
      const outputDir = 'indexed-content';
      await ensureDir(outputDir);
      
      const fileName = `${indexName}.json`;
      const filePath = join(outputDir, fileName);
      
      await Bun.write(filePath, JSON.stringify(data, null, 2));
      this.log(`💾 Saved test data to ${filePath}`, 'info', true);
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
        'hierarchy.lvl2'
      ],
      attributesForFaceting: [
        'filterOnly(product)',
        'filterOnly(type)',
        'filterOnly(topics)',
        'filterOnly(hierarchy.lvl0)',
        'filterOnly(hierarchy.lvl1)',
        'filterOnly(hierarchy.lvl2)'
      ],
      customRanking: [
        'desc(lastModified)',
        'asc(hierarchy.lvl0)',
        'asc(hierarchy.lvl1)',
        'asc(hierarchy.lvl2)'
      ],
      ranking: [
        'typo',
        'geo',
        'words',
        'filters',
        'proximity',
        'attribute',
        'exact',
        'custom'
      ],
      minWordSizefor1Typo: 4,
      minWordSizefor2Typos: 8,
      queryLanguages: ['en'],
      removeStopWords: true,
      advancedSyntax: true
    };
  }

  private async configureIndex(index: SearchIndex, records: AlgoliaRecord[], productName: string): Promise<void> {
    const settings = this.getIndexSettings();

    // Save combined data in test mode
    if (this.testMode !== 'none') {
      await this.saveTestData(index.indexName, {
        settings,
        records,
        productName
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
        if ((error as any).status === 404) {
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
      this.log(`Saving ${records.length} records to index: ${index.indexName}`, 'info', true);
      await algoliaIndex.saveObjects(records);
      this.log(`✅ Successfully saved ${records.length} records to ${index.indexName}`, 'info', true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Failed to configure index: ${message}`, 'error', true);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    // No initialization needed anymore as we'll configure indices when saving records
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

  private normalizeUrl = (url: string): string => {
    try {
      const normalized = new URL(url);
      // Remove trailing slash
      normalized.pathname = normalized.pathname.replace(/\/+$/, '');
      // Remove default ports
      if ((normalized.protocol === 'http:' && normalized.port === '80') ||
          (normalized.protocol === 'https:' && normalized.port === '443')) {
        normalized.port = '';
      }
      // Remove unnecessary query parameters
      const cleanParams = new URLSearchParams();
      normalized.searchParams.forEach((value, key) => {
        if (!['utm_source', 'utm_medium', 'utm_campaign'].includes(key)) {
          cleanParams.append(key, value);
        }
      });
      normalized.search = cleanParams.toString();
      return normalized.toString();
    } catch (e) {
      return url; // Return original if URL is invalid
    }
  };

  private generateObjectId = (url: string, segment?: string): string => {
    const input = segment ? `${url}#${segment}` : url;
    return createHash('md5').update(input).digest('hex');
  };

  private extractMetadata(metadata: Record<string, unknown>): AlgoliaRecord['metadata'] {
    const defaultMetadata = {
      keywords: '',
      products: '',
      og_title: '',
      og_description: '',
      og_image: ''
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
      og_image: extracted['og_image'] || defaultMetadata.og_image
    };
  }

  private createRecordFromSegment = (
    content: PageContent,
    segment: ContentSegment,
    indexInfo: { indexName: string; productName: string },
    isFirstSegment: boolean
  ): AlgoliaRecord => {
    const url = this.normalizeUrl(content.url);
    const path = new URL(url).pathname;
    const metadata = content.metadata || {};
    const extractedMetadata = this.extractMetadata(metadata);
    
    // Extract and validate metadata fields
    const topics = metadata['topics'];
    const type = metadata['type'];
    
    return {
      objectID: this.generateObjectId(url, segment.heading),
      url,
      path,
      title: isFirstSegment ? content.title : '',
      content: segment.content,
      headings: segment.heading ? [segment.heading] : [],
      product: indexInfo.productName,
      indexName: indexInfo.indexName,
      metadata: extractedMetadata,
      lastModified: metadata['lastModified'] || new Date().toISOString().split('T')[0],
      hierarchy: this.buildHierarchy(content.headings || []),
      type: typeof type === 'string' ? type : 'unknown',
      topics: Array.isArray(topics) ? topics : [],
      description: '',
      structure: {
        hasHeroSection: false,
        hasDiscoverBlocks: false,
        contentTypes: []
      }
    };
  };

  createRecord(content: PageContent): AlgoliaRecord[] {
    console.log(`\n🔄 Creating records for: ${content.url}`);
    const url = this.normalizeUrl(content.url);
    const indexInfo = this.getIndexForUrl(url);
    const metadata = content.metadata || {};
    const extractedMetadata = this.extractMetadata(metadata);
    
    // Extract and validate metadata fields
    const topics = metadata['topics'];
    const type = metadata['type'];
    
    if (!indexInfo) {
      console.warn('❌ Skipping: No index mapping found');
      return [];
    }

    const records: AlgoliaRecord[] = [];

    // Create records for each content segment
    (content.segments || []).forEach((segment, index) => {
      // Skip empty or very short content
      if (!segment.content.trim() || segment.content.length < 20) {
        console.log(`⚠️  Skipping segment: Too short or empty (${segment.content.length} chars)`);
        return;
      }

      const record = this.createRecordFromSegment(
        content,
        segment,
        indexInfo,
        index === 0
      );
      records.push(record);
      console.log(`✅ Created record for segment: ${(segment.heading || '').substring(0, 50)}...`);
    });

    // If no segments created records, create one record for the whole page
    if (records.length === 0 && content.mainContent) {
      console.log('ℹ️  No segments created, using main content');
      records.push({
        objectID: this.generateObjectId(url),
        url,
        path: new URL(url).pathname,
        title: content.title,
        content: content.mainContent,
        headings: content.headings[0] ? [content.headings[0]] : [],
        product: indexInfo.productName,
        indexName: indexInfo.indexName,
        metadata: extractedMetadata,
        lastModified: metadata['lastModified'] || new Date().toISOString().split('T')[0],
        hierarchy: this.buildHierarchy(content.headings || []),
        type: typeof type === 'string' ? type : 'unknown',
        topics: Array.isArray(topics) ? topics : [],
        description: '',
        structure: {
          hasHeroSection: false,
          hasDiscoverBlocks: false,
          contentTypes: []
        }
      });
    }

    console.log(`📊 Created ${records.length} records for ${url}`);
    return records;
  }

  async saveRecords(records: AlgoliaRecord[]): Promise<IndexingResult[]> {
    const stats = {
      total: records.length,
      byIndex: new Map<string, number>(),
      skipped: 0,
      errors: 0,
      successfulIndices: 0,
      failedIndices: 0
    };

    console.log('\n🔍 Debug: Starting record processing');
    console.log(`Total records received: ${records.length}`);

    // First, group records by index
    const recordsByIndex = new Map<string, AlgoliaRecord[]>();
    
    // Group and validate records
    for (const record of records) {
      console.log(`\n📄 Processing record:`);
      console.log(`URL: ${record.url}`);
      console.log(`Current Index Name: ${record.indexName}`);
      console.log(`Record Content Length: ${record.content.length}`);
      console.log(`Record Title: ${record.title}`);
      console.log(`Record Product: ${record.product}`);
      
      const indexInfo = this.getIndexForUrl(record.url);
      
      if (!indexInfo) {
        console.log(`⚠️  No index mapping found for URL: ${record.url}`);
        stats.skipped++;
        continue;
      }

      console.log(`✓ Found index mapping:`);
      console.log(`  • Index Name: ${indexInfo.indexName}`);
      console.log(`  • Product: ${indexInfo.productName}`);

      const { indexName } = indexInfo;
      if (!recordsByIndex.has(indexName)) {
        console.log(`Creating new record group for index: ${indexName}`);
        recordsByIndex.set(indexName, []);
      }
      recordsByIndex.get(indexName)!.push(record);
      stats.byIndex.set(indexName, (stats.byIndex.get(indexName) || 0) + 1);
    }

    console.log('\n📊 Record grouping summary:');
    for (const [indexName, indexRecords] of recordsByIndex) {
      console.log(`${indexName}: ${indexRecords.length} records`);
    }

    // Process each index
    const results: IndexingResult[] = [];

    for (const [indexName, indexRecords] of recordsByIndex) {
      console.log(`\n🔄 Configuring index: ${indexName}`);
      console.log(`Records to index: ${indexRecords.length}`);
      console.log('Sample record:');
      console.log(JSON.stringify(indexRecords[0], null, 2));
      
      try {
        console.log('Getting index instance...');
        const index = this.getIndex(indexName);
        
        console.log('Configuring index and saving records...');
        await this.configureIndex(index, indexRecords, indexRecords[0]?.product || '');
        
        console.log(`✅ Successfully configured and saved records to ${indexName}`);
        results.push({
          url: '',
          indexName,
          success: true
        });
        stats.successfulIndices++;
      } catch (error) {
        console.error(`❌ Error configuring index ${indexName}:`, error);
        results.push({
          url: '',
          indexName,
          success: false,
          error: error as Error
        });
        stats.errors += indexRecords.length;
        stats.failedIndices++;
      }
    }

    // Print final stats
    console.log('\n📈 Final Indexing Statistics');
    console.log('=========================');
    console.log(`Total records processed: ${stats.total}`);
    console.log(`Records skipped: ${stats.skipped}`);
    console.log(`Records with errors: ${stats.errors}`);
    console.log(`Successful indices: ${stats.successfulIndices}`);
    console.log(`Failed indices: ${stats.failedIndices}`);
    
    if (stats.byIndex.size > 0) {
      console.log('\nBreakdown by index:');
      for (const [indexName, count] of stats.byIndex) {
        console.log(`  • ${indexName}: ${count} records`);
      }
    }

    return results;
  }

  private buildHierarchy(headings: string[]): AlgoliaRecord['hierarchy'] {
    return {
      lvl0: headings[0] || 'Documentation', // Ensure lvl0 always has a value
      lvl1: headings[1],
      lvl2: headings[2]
    };
  }
}
import algoliasearch, { type SearchClient, type SearchIndex } from 'algoliasearch';
import type { AlgoliaRecord, ProductIndexMapping, IndexingResult, AlgoliaIndexSettings } from '../types/algolia';
import type { PageContent, SitemapUrl, ContentSegment } from '../types';
import { createHash } from 'crypto';
import { ensureDir } from '../utils/ensure-dir';
import { join } from 'node:path';
import { ProductMappingService } from './product-mapping';

const PRODUCT_MAPPING_URL = 'https://raw.githubusercontent.com/AdobeDocs/search-indices/refs/heads/main/product-index-map.json';

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
    }

    // Only send to Algolia if not in test mode
    if (this.testMode === 'none') {
      try {
        await index.setSettings(settings);
        await index.saveObjects(records);
        this.log('✅ Index configured and records saved successfully');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`Failed to configure index: ${message}`, 'error', true);
        throw error;
      }
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

  private cleanContent(content: string): string {
    if (!content) return '';
    
    return content
      // Remove HTML tags and their contents for specific elements
      .replace(/<(style|script|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      
      // Remove common formatting artifacts
      .replace(/\\n\s+/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\t/g, ' ')
      
      // Remove specific patterns
      .replace(/\b\w+[-]?family\s*:\s*[^;]+;?/g, '')
      .replace(/\b(?:var|const|let)\s*\([^)]+\)/g, '')
      .replace(/\b[A-Za-z]+\([^)]*\)/g, '')
      .replace(/data-[^\s>]+/g, '')
      .replace(/font-family:[^;]+;?/g, '')
      .replace(/--[a-zA-Z0-9-]+/g, '')
      .replace(/\(\s*--[^)]+\)/g, '')
      
      // Clean up punctuation and spacing
      .replace(/\s+([.,!?])/g, '$1')
      .replace(/([.,!?])\s+/g, '$1 ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private shouldSplitContent(content: string): boolean {
    const SPLIT_THRESHOLD = 7000; // 7KB threshold
    return content.length > SPLIT_THRESHOLD;
  }

  private segmentContent(content: string, headings: string[]): string[] {
    if (!this.shouldSplitContent(content)) {
      return [content];
    }

    const segments: string[] = [];
    const lines = content.split(/\n+/);
    let currentSegment = '';
    let currentHeading = '';

    for (const line of lines) {
      const cleanLine = this.cleanContent(line);
      
      // Check if this line is a heading
      if (headings.includes(cleanLine)) {
        // Save the current segment if it exists
        if (currentSegment) {
          segments.push(currentSegment.trim());
        }
        currentHeading = cleanLine;
        currentSegment = currentHeading + '\n';
        continue;
      }

      // Add line to current segment
      currentSegment += cleanLine + '\n';

      // Check if we should split the segment
      if (this.shouldSplitContent(currentSegment)) {
        segments.push(currentSegment.trim());
        currentSegment = currentHeading ? currentHeading + '\n' : '';
      }
    }

    // Add the last segment if it exists
    if (currentSegment) {
      segments.push(currentSegment.trim());
    }

    return segments.map((segment: string, index: number) => {
      if (index === 0) return segment;
      return (currentHeading ? currentHeading + '\n' : '') + segment;
    });
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

  private extractMetadata(metadata: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
    return result;
  }

  private async processContent(content: PageContent, indexName: string): Promise<AlgoliaRecord[]> {
    const records: AlgoliaRecord[] = [];
    
    // Ensure metadata exists and has required fields
    if (!content.metadata) {
      this.log(`Skipping content without metadata`, 'warn');
      return records;
    }

    // Create base record from metadata
    const baseRecord: Partial<AlgoliaRecord> = {
      topics: Array.isArray(content.metadata.topics) ? content.metadata.topics : [],
      type: typeof content.metadata.type === 'string' ? content.metadata.type : 'unknown',
      lastModified: typeof content.metadata.lastModified === 'string' ? content.metadata.lastModified : new Date().toISOString(),
      ...this.extractMetadata(content.metadata)
    };

    // Process segments if they exist
    if (!content.segments || content.segments.length === 0) {
      this.log(`No segments found in content`, 'warn');
      return records;
    }

    // Process each segment
    for (const segment of content.segments) {
      if (!segment.id || !segment.content) {
        this.log(`Skipping invalid segment`, 'warn');
        continue;
      }

      const record: AlgoliaRecord = {
        ...baseRecord as AlgoliaRecord,
        objectID: segment.id,
        title: segment.heading || '',
        content: segment.content,
        hierarchy: segment.hierarchy || {},
        product: indexName
      };

      records.push(record);
    }

    return records;
  }

  private createRecordFromSegment = (
    content: PageContent,
    segment: ContentSegment,
    indexInfo: { indexName: string; productName: string },
    isFirstSegment: boolean
  ): AlgoliaRecord => {
    const url = this.normalizeUrl(content.url);
    const path = new URL(url).pathname;
    
    return {
      objectID: this.generateObjectId(url, segment.heading),
      url,
      path,
      // Only include title in first segment
      title: isFirstSegment ? content.title : '',
      content: segment.content,
      headings: segment.heading,
      product: indexInfo.productName,
      indexName: indexInfo.indexName,
      metadata: this.cleanMetadata(content.metadata),
      lastModified: content.metadata['lastModified'] || new Date().toISOString().split('T')[0],
      hierarchy: this.buildHierarchy(content.headings || []),
      type: content.metadata?.type || 'unknown',
      topics: content.metadata?.topics || [],
      ...this.extractMetadata(content.metadata)
    };
  };

  createRecord(content: PageContent, sitemapUrl: SitemapUrl): AlgoliaRecord[] {
    console.log(`\n🔄 Creating records for: ${content.url}`);
    const url = this.normalizeUrl(content.url);
    const indexInfo = this.getIndexForUrl(url);
    
    if (!indexInfo) {
      console.warn('❌ Skipping: No index mapping found');
      return [];
    }

    const records: AlgoliaRecord[] = [];

    // Create records for each content segment
    content.segments.forEach((segment, index) => {
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
      console.log(`✅ Created record for segment: ${segment.heading.substring(0, 50)}...`);
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
        headings: content.headings[0] || '',
        product: indexInfo.productName,
        indexName: indexInfo.indexName,
        metadata: this.cleanMetadata(content.metadata),
        lastModified: content.metadata['lastModified'] || new Date().toISOString().split('T')[0],
        hierarchy: this.buildHierarchy(content.headings || []),
        type: content.metadata?.type || 'unknown',
        topics: content.metadata?.topics || [],
        ...this.extractMetadata(content.metadata)
      });
    }

    console.log(`📊 Created ${records.length} records for ${url}`);
    return records;
  }

  private validateRecords(records: AlgoliaRecord[]): string[] {
    const issues: string[] = [];
    
    for (const record of records) {
      if (!record.objectID) {
        issues.push(`Record missing objectID: ${record.url}`);
      }
      if (!record.title) {
        issues.push(`Record missing title: ${record.url}`);
      }
      if (!record.url) {
        issues.push('Record missing URL');
      }
      if (!record.lastModified) {
        issues.push(`Record missing lastModified: ${record.url}`);
      }
    }
    
    return issues;
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

    // First, group records by index
    const recordsByIndex = new Map<string, AlgoliaRecord[]>();
    
    console.log('\n📊 Processing Records', 'info', true);
    console.log('==================', 'info', true);
    console.log(`Total records to process: ${records.length}`, 'info', true);
    
    // Group and validate records
    for (const record of records) {
      const indexInfo = this.getIndexForUrl(record.url);
      if (!indexInfo) {
        console.warn(`⚠️  Skipping record: ${record.url}`);
        console.warn('   Reason: No matching index found in product mapping');
        stats.skipped++;
        continue;
      }

      const { indexName } = indexInfo;
      if (!recordsByIndex.has(indexName)) {
        recordsByIndex.set(indexName, []);
      }
      recordsByIndex.get(indexName)!.push(record);
      stats.byIndex.set(indexName, (stats.byIndex.get(indexName) || 0) + 1);
    }

    // Process each index
    const results: IndexingResult[] = [];
    console.log('\n📝 Processing Indices');
    console.log('===================');

    for (const [indexName, indexRecords] of recordsByIndex) {
      console.log(`\n🔄 Processing index: ${indexName}`);
      console.log(`   Records to index: ${indexRecords.length}`);
      
      try {
        const index = this.getIndex(indexName);
        await this.configureIndex(index, indexRecords, indexRecords[0]?.product || '');
        console.log(`✅ Successfully indexed ${indexRecords.length} records to ${indexName}`);
        
        results.push({
          indexName,
          recordCount: indexRecords.length,
          status: 'success'
        });
        stats.successfulIndices++;
      } catch (error) {
        console.error(`❌ Failed to index records to ${indexName}:`, error);
        results.push({
          indexName,
          recordCount: 0,
          status: 'error',
          error: error as Error
        });
        stats.errors += indexRecords.length;
        stats.failedIndices++;
      }
    }

    // Print final statistics
    console.log('\n📈 Final Statistics');
    console.log('=================');
    console.log(`Total records processed: ${stats.total}`);
    console.log(`Successfully indexed: ${stats.total - stats.skipped - stats.errors}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`\nBy Index:`);
    for (const [index, count] of stats.byIndex) {
      console.log(`${index}: ${count} records`);
    }

    return results;
  }

  private buildHierarchy(headings: string[]): { lvl0?: string; lvl1?: string; lvl2?: string } {
    const hierarchy: { lvl0?: string; lvl1?: string; lvl2?: string } = {};
    
    // Map headings to hierarchy levels based on their order
    headings.slice(0, 3).forEach((heading, index) => {
      if (heading) {
        hierarchy[`lvl${index}`] = heading;
      }
    });

    return hierarchy;
  }

  private async processPageContent(page: PageContent): Promise<AlgoliaRecord[]> {
    const indexInfo = this.getIndexForUrl(page.url);
    if (!indexInfo) {
      this.log(`No index found for URL: ${page.url}`, 'warn');
      return [];
    }

    const { indexName, productName } = indexInfo;
    const records: AlgoliaRecord[] = [];
    const path = new URL(page.url).pathname;

    // Create base record with common fields
    const baseRecord: Omit<AlgoliaRecord, 'content' | 'headings'> = {
      objectID: createHash('md5').update(page.url).digest('hex'),
      url: page.url,
      path,
      indexName,
      title: page.title || '',
      description: page.description || '',
      product: productName,
      type: page.metadata?.type || page.type || 'documentation',
      topics: page.metadata?.topics || page.topics || [],
      lastModified: page.metadata?.lastModified || page.lastModified || new Date().toISOString(),
      hierarchy: this.buildHierarchy(page.headings || []),
      metadata: {
        type: page.metadata?.type || page.type || 'documentation',
        lastModified: page.metadata?.lastModified || page.lastModified || new Date().toISOString(),
        ...(Object.entries(page.metadata || {}).reduce<Record<string, string>>((acc, [key, value]) => ({
          ...acc,
          [key]: String(value)
        }), {}))
      }
    };

    // Process content segments
    if (page.segments && page.segments.length > 0) {
      page.segments.forEach((segment: ContentSegment, index: number) => {
        records.push({
          ...baseRecord,
          objectID: `${baseRecord.objectID}_${index}`,
          content: this.cleanContent(segment.content),
          headings: segment.heading ? [segment.heading] : []
        });
      });
    } else {
      // Use main content if available, otherwise use the full content
      const content = page.mainContent || page.content;
      const segments = this.segmentContent(content, page.headings || []);

      segments.forEach((segment: string, index: number) => {
        records.push({
          ...baseRecord,
          objectID: `${baseRecord.objectID}_${index}`,
          content: this.cleanContent(segment),
          headings: page.headings || []
        });
      });
    }

    return records;
  }

  private async indexContent(content: PageContent, indexInfo: IndexMatch): Promise<void> {
    try {
      const records = await this.processContent(content, indexInfo.indexName);
      if (records.length === 0) {
        this.log(`No valid records to index for ${indexInfo.indexName}`, 'warn');
        return;
      }

      const index = this.getIndex(indexInfo.indexName);
      await this.configureIndex(index, records, indexInfo.productName);
      this.log(`✅ Configured and indexed ${records.length} records to ${indexInfo.indexName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Failed to index content: ${message}`, 'error', true);
      throw error;
    }
  }
}
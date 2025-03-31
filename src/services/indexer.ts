import type { SitemapUrl } from '../types/index';
import type { AlgoliaRecord } from '../types/algolia';
import type { PageContent } from '../types/index';
import { ProductMappingService } from './product-mapping';
import { AlgoliaService } from './algolia';
import { fetchPageContent, shouldSegmentContent, createSegmentedRecords } from './content';
import { TaskQueue } from '../utils/queue';
import { ensureDir } from '../utils/ensure-dir';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface IndexingStats {
  total: number;
  success: number;
  notFound: number;
  failed: number;
  noMapping: number;
  byIndex: Map<string, number>;
}

interface IndexedContent {
  indexName: string;
  productName: string;
  records: AlgoliaRecord[];
}

interface IndexInfo {
  indexName: string;
  productName: string;
}

export class ContentIndexer {
  private productMapping: ProductMappingService;
  private queue: TaskQueue;
  private stats: IndexingStats;
  private outputDir: string;
  private verbose: boolean;
  private mappingUrl: string;
  private recordsByIndex: Map<string, AlgoliaRecord[]>;
  private baseUrl: string;
  private algolia: AlgoliaService;

  constructor(
    mappingUrl: string, 
    baseUrl: string, 
    algolia: AlgoliaService,
    concurrency = 5, 
    verbose = false
  ) {
    this.productMapping = new ProductMappingService(verbose);
    this.queue = new TaskQueue(concurrency);
    this.verbose = verbose;
    this.outputDir = join(process.cwd(), 'indexed-content');
    this.stats = {
      total: 0,
      success: 0,
      notFound: 0,
      failed: 0,
      noMapping: 0,
      byIndex: new Map()
    };
    this.mappingUrl = mappingUrl;
    this.recordsByIndex = new Map();
    this.baseUrl = baseUrl;
    this.algolia = algolia;
  }

  async initialize(): Promise<void> {
    await this.productMapping.initialize(this.mappingUrl);
    await ensureDir(this.outputDir);
  }

  private updateStats(indexName: string | undefined | null, error?: Error): void {
    this.stats.total++;
    
    if (indexName) {
      this.stats.success++;
      this.stats.byIndex.set(
        indexName, 
        (this.stats.byIndex.get(indexName) || 0) + 1
      );
    } else if (error?.message.includes('404')) {
      this.stats.notFound++;
    } else if (!error) {
      this.stats.noMapping++;
    } else {
      this.stats.failed++;
    }
  }

  async processUrl(url: SitemapUrl): Promise<void> {
    try {
      // Transform URL to use our base URL
      const urlObj = new URL(url.loc);
      const transformedUrl = new URL(urlObj.pathname, this.baseUrl).toString();
      
      const content = await fetchPageContent(transformedUrl);
      const indexInfo = this.productMapping.getIndexForUrl(transformedUrl);
      
      if (!indexInfo) {
        this.updateStats(null);
        return;
      }

      // Update content URL to use our base URL
      content.url = transformedUrl;

      // Determine if content should be segmented - pass lastmod
      if (shouldSegmentContent(content)) {
        const records = this.algolia.createRecord(content, url.lastmod);
        await this.addRecordsToIndex(records, indexInfo);
      } else {
        await this.indexContent(content, indexInfo, url.lastmod);
      }

      if (this.verbose) {
        console.log(`✓ ${transformedUrl}`);
      }
      
      this.updateStats(indexInfo.indexName);
    } catch (error) {
      if (error && typeof error === 'object' && 'type' in error && (error as { type: string }).type === 'skip') {
        this.updateStats(null, new Error((error as { message?: string }).message || 'Skip error'));
        return;
      }
      
      console.error(`Failed to process ${url.loc}:`, error);
      this.updateStats(null, error instanceof Error ? error : new Error(String(error)));
    }
  }

  async processUrls(urls: SitemapUrl[]): Promise<void> {
    // Filter out URLs that should be excluded
    const validUrls = urls.filter(({ loc }) => {
      try {
        const url = new URL(loc);
        return !this.productMapping.shouldExcludePath(url.pathname);
      } catch (error) {
        if (this.verbose) {
          console.warn(`⚠️  Invalid URL: ${loc}`);
        }
        return false;
      }
    });

    const promises: Promise<void>[] = [];

    for (const url of validUrls) {
      promises.push(
        this.queue.add(async () => {
          await this.processUrl(url);
        })
      );
    }

    await Promise.all(promises);
  }

  private async saveIndexedContent(recordsByIndex: Map<string, AlgoliaRecord[]>): Promise<void> {
    const savedCounts = new Map<string, number>();
    
    for (const [indexName, records] of recordsByIndex) {
      const indexedContent: IndexedContent = {
        indexName,
        productName: records[0].product, // All records in an index should have the same product
        records
      };

      // Save to file
      const filePath = join(this.outputDir, `${indexName}-records.json`);
      await writeFile(filePath, JSON.stringify(indexedContent, null, 2));
      
      // Save to Algolia
      if (this.algolia) {
        console.log(`\n📤 Saving ${records.length} records to Algolia index: ${indexName}`);
        await this.algolia.saveRecords(records);
      }
      
      // Track the number of records saved for each index
      savedCounts.set(indexName, (savedCounts.get(indexName) || 0) + records.length);
    }

    // Log a single consolidated message for each index
    if (this.verbose) {
      for (const [indexName, count] of savedCounts) {
        console.log(`✅ Saved ${count} records for ${indexName}`);
      }
    }
  }

  private printStats(): void {
    console.log('\n📊 Indexing Results');
    console.log('=================');
    console.log(`Processed: ${this.stats.total} URLs`);
    
    if (this.stats.success > 0) {
      console.log(`✓ Successfully indexed: ${this.stats.success}`);
      if (this.verbose) {
        console.log('\nBy index:');
        for (const [index, count] of this.stats.byIndex) {
          console.log(`  • ${index}: ${count}`);
        }
      }
    }

    const failures = [];
    if (this.stats.notFound > 0) failures.push(`404 Not Found: ${this.stats.notFound}`);
    if (this.stats.noMapping > 0) failures.push(`No mapping: ${this.stats.noMapping}`);
    if (this.stats.failed > 0) failures.push(`Failed: ${this.stats.failed}`);
    
    if (failures.length > 0) {
      console.log('\nIssues:');
      failures.forEach(failure => console.log(`  • ${failure}`));
    }
  }

  async run(urls: SitemapUrl[]): Promise<void> {
    try {
      await this.initialize();
      await this.processUrls(urls);
      this.printStats();
    } catch (error) {
      console.error('❌ Error running indexer:', error);
      throw error;
    }
  }

  private async indexContent(content: PageContent, indexInfo: IndexInfo, lastmod?: string): Promise<void> {
    try {
      // Determine the best title to use
      const title = content.title || 
                   content.metadata?.['og_title'] || 
                   content.headings[0] || 
                   content.metadata?.['title'] ||
                   indexInfo.productName;

      // Create the Algolia record
      const record: AlgoliaRecord = {
        objectID: Buffer.from(content.url).toString('base64'),
        url: content.url,
        path: new URL(content.url).pathname,
        indexName: indexInfo.indexName,
        title,
        description: content.description || content.metadata?.['og_description'] || '',
        content: content.mainContent || content.content || '',
        headings: content.headings || [],
        product: indexInfo.productName,
        type: content.metadata?.['type'] || 'documentation',
        topics: Array.isArray(content.metadata?.['topics']) ? content.metadata['topics'] : [],
        lastModified: content.metadata?.['lastModified'] || lastmod || new Date().toISOString(),
        sourceLastmod: lastmod,
        indexedAt: new Date().toISOString(),
        hierarchy: this.buildHierarchy(content.url, content.headings),
        metadata: {
          keywords: Array.isArray(content.metadata?.['keywords']) 
            ? content.metadata['keywords'].join(',') 
            : String(content.metadata?.['keywords'] || ''),
          products: indexInfo.productName,
          og_title: content.metadata?.['og_title'] || title,
          og_description: content.metadata?.['og_description'] || content.description || '',
          og_image: content.metadata?.['og_image'] || ''
        },
        structure: content.structure || {
          hasHeroSection: false,
          hasDiscoverBlocks: false,
          contentTypes: []
        }
      };

      // Get or create the array for this index
      let records = this.recordsByIndex.get(indexInfo.indexName);
      if (!records) {
        records = [];
        this.recordsByIndex.set(indexInfo.indexName, records);
      }

      // Add the record
      records.push(record);

      // Save to file if we have records
      if (records.length > 0) {
        await this.saveIndexedContent(this.recordsByIndex);
      }
    } catch (error) {
      console.error(`Error indexing content: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private buildHierarchy(url: string, headings: string[] = []): { lvl0: string; lvl1?: string; lvl2?: string; } {
    try {
      const pathname = new URL(url).pathname;
      const segments = pathname.split('/').filter(Boolean);
      
      return {
        lvl0: segments[0] || headings[0] || '',
        ...(segments[1] && { lvl1: segments.slice(0, 2).join('/') }),
        ...(segments[2] && { lvl2: segments.slice(0, 3).join('/') })
      };
    } catch {
      return { lvl0: headings[0] || '' };
    }
  }

  private async addRecordsToIndex(records: AlgoliaRecord[], indexInfo: IndexInfo): Promise<void> {
    const { indexName } = indexInfo;
    
    if (!this.recordsByIndex.has(indexName)) {
      this.recordsByIndex.set(indexName, []);
    }
    
    this.recordsByIndex.get(indexName)?.push(...records);
  }
} 
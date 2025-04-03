import type { SitemapUrl } from '../types/index';
import type { AlgoliaRecord } from '../types/algolia';
import type { PageContent } from '../types/index';
import { ProductMappingService } from './product-mapping';
import { AlgoliaService } from './algolia';
import { fetchPageContent, shouldSegmentContent } from './content';
import { TaskQueue } from '../utils/queue';
import { ensureDir } from '../utils/ensure-dir';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'crypto';
import chalk from 'chalk';

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

  private updateProcessedCount(): void {
    // Only increment the total counter, not the success counter
    this.stats.total++;
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
      
      // Don't update stats with indexName here - we'll update based on actual indexing results later
      this.updateProcessedCount();
    } catch (error) {
      if (error && typeof error === 'object' && 'type' in error && (error as { type: string }).type === 'skip') {
        this.updateStats(null, new Error((error as { message?: string }).message || 'Skip error'));
        return;
      }
      
      // Only log errors in verbose mode unless it's a critical error
      console.error(`Failed to process ${url.loc}:`, error);
      this.updateStats(null, error instanceof Error ? error : new Error(String(error)));
    }
  }

  async processUrls(urls: SitemapUrl[]): Promise<void> {
    // In verbose mode, show the queue configuration
    if (this.verbose) {
      console.log(`\nProcessing URLs with concurrency: ${this.queue.concurrency}`);
    }
    
    // Track total progress
    let processed = 0;
    const total = urls.length;
    
    // Add progress reporting to log every 10% of progress
    const progressStep = Math.max(1, Math.floor(total / 10));
    
    const tasks = urls.map(url => async () => {
      await this.processUrl(url);
      
      // Increment the processed counter
      processed++;
      
      // Report progress only in verbose mode
      if (this.verbose && processed % progressStep === 0) {
        const percent = Math.floor((processed / total) * 100);
        console.log(`Progress: ${processed}/${total} URLs processed (${percent}%)`);
      }
    });
    
    await this.queue.addBatch(tasks);
  }

  private async saveAllRecords(): Promise<void> {
    if (this.recordsByIndex.size === 0) {
      return;
    }
    
    const totalRecords = Array.from(this.recordsByIndex.values())
      .reduce((sum, records) => sum + records.length, 0);
    
    if (!this.verbose) {
      console.log(`\nProcessing all ${totalRecords} records across ${this.recordsByIndex.size} indices at once`);
    }
      
    // Save to Algolia in a single batch
    if (this.algolia) {
      const allRecords: AlgoliaRecord[] = [];
      for (const records of this.recordsByIndex.values()) {
        allRecords.push(...records);
      }
      
      // Get actual indexing results from Algolia
      const results = await this.algolia.saveRecords(allRecords);
      
      // Reset current counts and update based on actual results
      this.stats.success = 0;
      this.stats.byIndex = new Map();
      
      // Update stats based on what was ACTUALLY indexed
      for (const result of results) {
        if (result.status === 'success' && result.updated && result.updated > 0) {
          // Only count records that were actually updated
          this.stats.success += result.updated;
          this.stats.byIndex.set(
            result.indexName,
            result.updated
          );
        }
      }
    }
  }

  private async saveIndexedContent(recordsByIndex: Map<string, AlgoliaRecord[]>): Promise<void> {
    if (recordsByIndex.size === 0) {
      return;
    }
    
    const savedCounts = new Map<string, number>();
    const totalRecords = Array.from(recordsByIndex.values())
      .reduce((sum, records) => sum + records.length, 0);
    
    // Only log before saving in verbose mode
    if (this.verbose) {
      console.log(`\nSaving ${totalRecords} records across ${recordsByIndex.size} indices...`);
    }
    
    for (const [indexName, records] of recordsByIndex) {
      const indexedContent: IndexedContent = {
        indexName,
        productName: records[0].product, // All records in an index should have the same product
        records
      };

      // Save to file
      const filePath = join(this.outputDir, `${indexName}-records.json`);
      await writeFile(filePath, JSON.stringify(indexedContent, null, 2));
      
      // Track the number of records saved for each index
      savedCounts.set(indexName, (savedCounts.get(indexName) || 0) + records.length);
    }

    // Log a single consolidated message for saved content
    if (this.verbose) {
      for (const [indexName, count] of savedCounts) {
        console.log(`Saved ${count} records for ${indexName}`);
      }
    }
  }

  private printStats(): void {
    // Total records that were processed (not necessarily updated)
    const totalRecords = Array.from(this.recordsByIndex.values())
      .reduce((sum, records) => sum + records.length, 0);
      
    if (this.verbose) {
      console.log('\nIndexing Results');
      console.log('=================');
      console.log(`Processed: ${this.stats.total} URLs`);
      console.log(`Generated: ${totalRecords} records`);
      
      if (this.stats.success > 0) {
        console.log(`Updated in Algolia: ${this.stats.success} records`);
        console.log('\nBy index:');
        for (const [index, count] of this.stats.byIndex) {
          console.log(`  • ${index}: ${count} records updated`);
        }
      } else {
        console.log('No records needed updating in Algolia');
      }

      const failures = [];
      if (this.stats.notFound > 0) failures.push(`404 Not Found: ${this.stats.notFound}`);
      if (this.stats.noMapping > 0) failures.push(`No mapping: ${this.stats.noMapping}`);
      if (this.stats.failed > 0) failures.push(`Failed: ${this.stats.failed}`);
      
      if (failures.length > 0) {
        console.log('\nIssues:');
        failures.forEach(failure => console.log(`  • ${failure}`));
      }
    } else {
      // Just add a spacing line after the Algolia summary
      console.log();

      // Final consolidated summary
      console.log(`${chalk.bold('Final Summary')}`);
      console.log(`Processed ${chalk.cyan(this.stats.total)} URLs, generated ${chalk.cyan(totalRecords)} records`);
      console.log(`Updated ${chalk.green(this.stats.success)} records in Algolia`);
      
      // Only show issues if there are any
      const totalIssues = this.stats.notFound + this.stats.noMapping + this.stats.failed;
      if (totalIssues > 0) {
        console.log(`${chalk.yellow('Issues')}: ${totalIssues} (${this.stats.notFound} not found, ${chalk.yellow(this.stats.noMapping)} no mapping, ${chalk.red(this.stats.failed)} failed)`);
      }
    }
  }

  async run(urls: SitemapUrl[]): Promise<void> {
    try {
      await this.initialize();
      
      if (this.verbose) {
        console.log(`\nProcessing ${urls.length} URLs...`);
      } else {
        console.log(`\n${chalk.bold('Processing')} ${chalk.cyan(urls.length)} URLs from sitemap`);
      }
      
      await this.processUrls(urls);
      
      // In non-verbose mode, don't show the intermediate processing messages
      // Just save all records at once at the end
      await this.saveAllRecords();
      
      this.printStats();
    } catch (error) {
      console.error(chalk.red('Error running indexer:'), error);
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
        objectID: createHash('md5').update(content.url).digest('hex'),
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
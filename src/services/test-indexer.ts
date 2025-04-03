import { join } from 'node:path';

import type { AlgoliaRecord } from '../types/algolia';
import type { SitemapUrl } from '../types/index';
import { ensureDir } from '../utils/ensure-dir';
import { TaskQueue } from '../utils/queue';

import { AlgoliaService } from './algolia';
import { fetchPageContent } from './content';

interface IndexingStats {
  total: number;
  success: number;
  notFound: number;
  failed: number;
  products: Map<string, number>;
  types: Map<string, number>;
}

/**
 *
 */
export class TestIndexer {
  private algolia: AlgoliaService;
  private queue: TaskQueue;
  private stats: IndexingStats;
  private outputDir: string;

  /**
   *
   */
  constructor(algolia: AlgoliaService) {
    this.algolia = algolia;
    this.queue = new TaskQueue(5);
    this.stats = {
      total: 0,
      success: 0,
      notFound: 0,
      failed: 0,
      products: new Map(),
      types: new Map(),
    };
    this.outputDir = join(process.cwd(), 'indexed-content');
  }

  private updateStats(record: AlgoliaRecord | null, error?: Error): void {
    this.stats.total++;

    if (record) {
      this.stats.success++;
      this.stats.products.set(record.product, (this.stats.products.get(record.product) || 0) + 1);
      if (record.type) {
        this.stats.types.set(record.type, (this.stats.types.get(record.type) || 0) + 1);
      }
    } else if (error?.message.includes('Not Found')) {
      this.stats.notFound++;
    } else {
      this.stats.failed++;
    }
  }

  /**
   *
   */
  async processUrl(url: SitemapUrl): Promise<AlgoliaRecord[]> {
    try {
      console.log(`Processing: ${url.loc}`);
      const content = await fetchPageContent(url.loc);
      const records = this.algolia.createRecord(content);

      if (records && records.length > 0) {
        records.forEach((record) => this.updateStats(record));
        console.log(`Successfully processed: ${url.loc} (${records.length} records)`);
        return records;
      } else {
        console.warn(`No records created for: ${url.loc}`);
        this.updateStats(null);
        return [];
      }
    } catch (error) {
      if (error instanceof Error) {
        this.updateStats(null, error);
        if (error.message.includes('Not Found')) {
          console.warn(`Skipping ${url.loc}: Page not found`);
        } else {
          console.error(`Failed to process ${url.loc}:`, error);
        }
      }
      return [];
    }
  }

  /**
   *
   */
  async processUrls(urls: SitemapUrl[]): Promise<AlgoliaRecord[]> {
    console.log('\nProcessing URLs');
    console.log('================');

    const allRecords: AlgoliaRecord[] = [];
    const promises: Promise<void>[] = [];

    for (const url of urls) {
      promises.push(
        this.queue.add(async () => {
          const records = await this.processUrl(url);
          allRecords.push(...records);
        })
      );
    }

    await Promise.all(promises);
    return allRecords;
  }

  private printStats(): void {
    console.log('\nIndexing Statistics');
    console.log('===================');
    console.log(`Total URLs processed: ${this.stats.total}`);
    console.log(`Successfully indexed: ${this.stats.success}`);
    console.log(`Not found (404): ${this.stats.notFound}`);
    console.log(`Failed: ${this.stats.failed}`);

    console.log('\nProduct Distribution');
    console.log('====================');
    for (const [product, count] of this.stats.products) {
      console.log(`${product}: ${count} pages`);
    }

    console.log('\nContent Type Distribution');
    console.log('=========================');
    for (const [type, count] of this.stats.types) {
      console.log(`${type}: ${count} pages`);
    }
  }

  /**
   *
   */
  async run(urls: SitemapUrl[]): Promise<void> {
    try {
      console.log('Initializing test indexer...');

      // Ensure output directory exists
      await ensureDir(this.outputDir);

      const records = await this.processUrls(urls);

      console.log('\nSaving records to Algolia and generating test files...');
      await this.algolia.saveRecords(records);

      this.printStats();
    } catch (error) {
      console.error('Error running test indexer:', error);
    }
  }
}

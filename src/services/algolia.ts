import algoliasearch from 'algoliasearch';
import type { SearchClient, SearchIndex } from 'algoliasearch';
import type { AlgoliaRecord, IndexConfig, ProductIndexMapping, IndexingResult, AlgoliaIndexSettings } from '../types/algolia';
import type { PageContent } from './content';
import type { SitemapUrl } from '../types';
import { config } from '../config/config';
import { writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class AlgoliaService {
  private client: SearchClient;
  private indices: Map<string, SearchIndex> = new Map();
  private productMappings: ProductIndexMapping[] = [];
  private verbose: boolean;
  private testMode: 'file' | 'console' | 'none';

  constructor(config: IndexConfig & { testMode: 'file' | 'console' | 'none' }) {
    this.client = algoliasearch(config.appId, config.apiKey);
    this.verbose = process.argv.includes('--verbose');
    this.testMode = config.testMode;
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

  private async saveTestData(indexName: string, data: unknown, type: 'settings' | 'records'): Promise<void> {
    if (this.testMode === 'none') return;

    if (this.testMode === 'console') {
      console.log(`\n📝 Test Data for ${indexName} (${type}):`);
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    try {
      const outputDir = 'test-output';
      await Bun.write(`${outputDir}/.gitkeep`, '');
      
      const fileName = `${indexName}-${type}.json`;
      const filePath = `${outputDir}/${fileName}`;
      
      const file = Bun.file(filePath);
      await Bun.write(file, JSON.stringify(data, null, 2));
      this.log(`💾 Saved test ${type} to ${filePath}`, 'info', true);
    } catch (error) {
      this.log(`Failed to save test data: ${error}`, 'error', true);
    }
  }

  private async configureIndexSettings(index: SearchIndex): Promise<void> {
    const settings: AlgoliaIndexSettings = {
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

    // Save settings in test mode
    await this.saveTestData(index.indexName, settings, 'settings');

    // Only send to Algolia if not in test mode
    if (this.testMode === 'none') {
      try {
        await index.setSettings(settings);
        this.log('✅ Index settings configured successfully');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`Failed to configure index settings: ${message}`, 'error', true);
        throw error;
      }
    }
  }

  async initialize(): Promise<void> {
    try {
      // Fetch product mappings from GitHub
      const response = await Bun.fetch(
        'https://raw.githubusercontent.com/AdobeDocs/search-indices/refs/heads/main/product-index-map.json',
        {
          client: 'bun',
          timeout: 10000
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch product mappings: ${response.statusText}`);
      }
      
      this.productMappings = await response.json();
      
      // Log mapping statistics
      const totalProducts = this.productMappings.length;
      const totalIndices = this.productMappings.reduce((sum, p) => sum + p.productIndices.length, 0);
      
      this.log('📊 Initialization Summary:', 'info', true);
      this.log(`   • Products: ${totalProducts}`, 'info', true);
      this.log(`   • Indices: ${totalIndices}`, 'info', true);
      if (this.testMode !== 'none') {
        this.log(`   • Test Mode: ${this.testMode}`, 'info', true);
      }

      if (this.verbose) {
        this.log('\nDetailed Index Mappings:');
        this.productMappings.forEach(p => {
          p.productIndices.forEach(i => {
            this.log(`   ${p.productName}: ${i.indexPathPrefix} -> ${i.indexName}`);
          });
        });
      }

      // Configure settings for each index
      const uniqueIndices = new Set(this.productMappings.flatMap(p => p.productIndices.map(i => i.indexName)));
      for (const indexName of uniqueIndices) {
        const index = this.getIndex(indexName);
        await this.configureIndexSettings(index);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('Failed to initialize: ' + message, 'error', true);
      throw error;
    }
  }

  private getIndexForUrl(url: string): { indexName: string; productName: string } | null {
    const urlPath = new URL(url).pathname;
    const cleanUrlPath = urlPath.replace(/\/$/, '');
    
    // Special case for root URLs
    if (urlPath === '/' || urlPath === '') {
      this.log('Using default mapping for root URL');
      return {
        indexName: 'developer-site',
        productName: 'Adobe Developer'
      };
    }

    // Find all matching path prefixes
    interface Match {
      product: string;
      index: string;
      prefix: string;
      segments: number;
    }

    const matches: Match[] = [];
    
    for (const product of this.productMappings) {
      for (const index of product.productIndices) {
        const cleanIndexPath = index.indexPathPrefix.replace(/\/$/, '');
        
        // Check if this path prefix matches the URL
        if (cleanUrlPath === cleanIndexPath || cleanUrlPath.startsWith(cleanIndexPath + '/')) {
          matches.push({
            product: product.productName,
            index: index.indexName,
            prefix: cleanIndexPath,
            segments: cleanIndexPath.split('/').filter(Boolean).length
          });
        }
      }
    }

    // If we have matches, use the most specific one (longest matching path)
    if (matches.length > 0) {
      // Sort by number of segments (most specific first)
      matches.sort((a, b) => b.segments - a.segments);
      
      const bestMatch = matches[0];
      this.log(`Found mapping: ${bestMatch.product} -> ${bestMatch.index}`, 'info');
      if (this.verbose && matches.length > 1) {
        this.log('Alternative matches:');
        matches.slice(1).forEach(m => this.log(`  • ${m.prefix} -> ${m.index}`));
      }
      
      return {
        indexName: bestMatch.index,
        productName: bestMatch.product
      };
    }

    // Log that no mapping was found
    this.log(`No index mapping found for URL: ${urlPath}`, 'warn', true);
    if (this.verbose) {
      this.log('Available path prefixes:');
      this.productMappings.forEach(product => {
        product.productIndices.forEach(index => {
          this.log(`  • ${index.indexPathPrefix} (${product.productName} -> ${index.indexName})`);
        });
      });
    }
    
    return null;
  }

  private getIndex(indexName: string): SearchIndex {
    if (!this.indices.has(indexName)) {
      this.indices.set(indexName, this.client.initIndex(indexName));
    }
    return this.indices.get(indexName)!;
  }

  private createObjectId(url: string): string {
    // Create a deterministic objectID from the URL
    return Buffer.from(url).toString('base64').replace(/[/+=]/g, '_');
  }

  private extractHierarchy(url: string): AlgoliaRecord['hierarchy'] {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return {
      lvl0: segments[0] || '',
      lvl1: segments[1] || undefined,
      lvl2: segments[2] || undefined,
    };
  }

  private determineType(url: string): AlgoliaRecord['type'] {
    const path = new URL(url).pathname;
    if (path.includes('/api/') || path.includes('-api')) return 'api';
    if (path.includes('/community/') || path.includes('/developer-champion/')) return 'community';
    if (path.includes('/tools/')) return 'tool';
    return 'documentation';
  }

  private extractUrls(content: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return Array.from(content.matchAll(urlRegex), m => m[1]);
  }

  private cleanContent(content: string): string {
    if (!content) return '';
    
    return content
      // Remove HTML tags and their contents for specific elements
      .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')  // Remove style/script tags and their content
      .replace(/<[^>]*>/g, ' ')                              // Remove remaining HTML tags
      
      // Remove common formatting artifacts
      .replace(/\\n\s+/g, ' ')                               // Remove \n followed by spaces
      .replace(/\s*\n\s*/g, ' ')                             // Remove newlines and surrounding spaces
      .replace(/\s{2,}/g, ' ')                               // Collapse multiple spaces
      .replace(/\t/g, ' ')                                   // Replace tabs with space
      
      // Remove specific patterns found in the content
      .replace(/\b\w+[-]?family\s+[^\\n]+/g, '')            // Remove CSS properties
      .replace(/https?:\/\/[^\s]+/g, '')                     // Remove URLs
      .replace(/\b(?:var|const|let)\s*\([^)]+\)/g, '')      // Remove JavaScript variable declarations
      .replace(/\b[A-Za-z]+\([^)]*\)/g, '')                 // Remove function calls
      .replace(/\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:PST|EST|UTC|GMT)?/gi, '') // Remove time stamps
      .replace(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/g, '') // Remove dates
      
      // Clean up punctuation and spacing
      .replace(/\s+([.,!?])/g, '$1')                        // Remove spaces before punctuation
      .replace(/([.,!?])\s+/g, '$1 ')                       // Ensure single space after punctuation
      .replace(/\|/g, '. ')                                 // Replace pipes with periods
      .replace(/\s+/g, ' ')                                 // Final collapse of whitespace
      .trim();
  }

  private segmentContent(content: string): { text: string; position: number }[] {
    if (!content) return [];

    // Split on sentence boundaries followed by space or newline
    const segments = content
      .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\.) (?=[A-Z])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);  // Remove empty segments
    
    return segments
      .map((text, index) => ({
        text: this.cleanContent(text),
        position: index
      }))
      .filter(segment => 
        segment.text.length > 0 &&
        !/^[0-9\s]*$/.test(segment.text) &&           // Remove segments that are just numbers
        !/^[.,!?]\s*$/.test(segment.text) &&          // Remove segments that are just punctuation
        !/^(?:and|or|but|the)\s/i.test(segment.text)  // Remove segments starting with conjunctions
      );
  }

  private extractTopics(content: PageContent): string[] {
    const topics = new Set<string>();
    
    // Extract from keywords
    if (content.metadata['keywords']) {
      content.metadata['keywords']
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0)
        .forEach(k => topics.add(k));
    }
    
    // Extract from headings
    content.headings
      .map(h => this.cleanContent(h).toLowerCase())
      .filter(h => h.length > 0 && !h.includes('\n'))  // Skip headings with newlines
      .forEach(h => topics.add(h));
    
    // Extract from content based on common patterns
    const contentText = this.cleanContent(content.mainContent);
    
    // Match technology and feature names
    const techPatterns = [
      /(?:using|with|for|in)\s+([A-Z][a-zA-Z0-9\s]+)(?=[\s.,])/g,
      /(?:API|SDK|Framework|Platform|Tool|Service)s?\s+([A-Z][a-zA-Z0-9\s]+)(?=[\s.,])/g,
      /([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)\s+(?:integration|plugin|add-on|extension)/g,
      /(?:Adobe)\s+([A-Z][a-zA-Z0-9\s]+)(?=[\s.,])/g  // Adobe product names
    ];

    techPatterns.forEach(pattern => {
      const matches = contentText.matchAll(pattern);
      for (const match of matches) {
        const topic = match[1]?.trim().toLowerCase();
        if (topic && topic.length > 2) {  // Avoid single letters or very short matches
          topics.add(topic);
        }
      }
    });
    
    return Array.from(topics)
      .filter(topic => 
        topic.length > 2 &&                    // Skip very short topics
        !/^\d+$/.test(topic) &&               // Skip pure numbers
        !/^[a-z]$/.test(topic) &&             // Skip single letters
        !topic.includes('\n') &&               // Skip topics with newlines
        !/^(?:and|or|but|the)\s/i.test(topic) // Skip topics starting with conjunctions
      );
  }

  createRecord(content: PageContent, sitemapUrl: SitemapUrl): AlgoliaRecord | null {
    const url = new URL(content.url);
    const indexInfo = this.getIndexForUrl(url.toString());
    
    if (!indexInfo) {
      // Try to create a fallback record for unmapped URLs
      const urlPath = url.pathname;
      const segments = urlPath.split('/').filter(Boolean);
      
      if (segments.length > 0) {
        const fallbackProduct = segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
        const fallbackIndex = `franklin-${segments[0]}`;
        
        this.log(`⚠️ Creating fallback record for unmapped URL: ${url}`);
        this.log(`   - Using fallback product: ${fallbackProduct}`);
        this.log(`   - Using fallback index: ${fallbackIndex}`);
        
        return {
          objectID: this.createObjectId(url.toString()),
          url: url.toString(),
          title: content.title || this.cleanContent(content.headings[0] || ''),
          description: this.cleanContent(content.metadata['description'] || content.metadata['og:description'] || ''),
          content: this.cleanContent(content.mainContent),
          contentSegments: this.segmentContent(content.mainContent),
          headings: content.headings.map(h => this.cleanContent(h)),
          lastModified: sitemapUrl.lastmod || new Date().toISOString(),
          product: fallbackProduct,
          topics: this.extractTopics(content),
          hierarchy: this.extractHierarchy(url.toString()),
          type: this.determineType(url.toString()),
          metadata: {
            og: {
              title: content.metadata['og:title'],
              description: this.cleanContent(content.metadata['og:description'] || ''),
              image: content.metadata['og:image'],
            },
            keywords: content.metadata['keywords']?.split(',').map(k => k.trim()),
            products: content.metadata['products']?.split(',').map(p => p.trim()),
            embeddedUrls: this.extractUrls(content.mainContent)
          }
        };
      }
      
      return null;
    }

    return {
      objectID: this.createObjectId(url.toString()),
      url: url.toString(),
      title: content.title || this.cleanContent(content.headings[0] || ''),
      description: this.cleanContent(content.metadata['description'] || content.metadata['og:description'] || ''),
      content: this.cleanContent(content.mainContent),
      contentSegments: this.segmentContent(content.mainContent),
      headings: content.headings.map(h => this.cleanContent(h)),
      lastModified: sitemapUrl.lastmod || new Date().toISOString(),
      product: indexInfo.productName,
      topics: this.extractTopics(content),
      hierarchy: this.extractHierarchy(url.toString()),
      type: this.determineType(url.toString()),
      metadata: {
        og: {
          title: content.metadata['og:title'],
          description: this.cleanContent(content.metadata['og:description'] || ''),
          image: content.metadata['og:image'],
        },
        keywords: content.metadata['keywords']?.split(',').map(k => k.trim()),
        products: content.metadata['products']?.split(',').map(p => p.trim()),
        embeddedUrls: this.extractUrls(content.mainContent)
      }
    };
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
    
    this.log('\n📊 Processing Records', 'info', true);
    this.log('==================', 'info', true);
    this.log(`Total records to process: ${records.length}`, 'info', true);
    
    // Group and validate records
    for (const record of records) {
      const indexInfo = this.getIndexForUrl(record.url);
      if (!indexInfo) {
        this.log(`⚠️  Skipping record: ${record.url}`, 'warn');
        this.log('   Reason: No matching index found in product mapping', 'warn');
        stats.skipped++;
        continue;
      }

      const { indexName } = indexInfo;
      if (!recordsByIndex.has(indexName)) {
        recordsByIndex.set(indexName, []);
      }
      recordsByIndex.get(indexName)!.push(record);
    }

    // Process each index
    const results: IndexingResult[] = [];
    this.log('\n📝 Processing Indices', 'info', true);
    this.log('===================', 'info', true);
    
    for (const [indexName, indexRecords] of recordsByIndex.entries()) {
      this.log(`\n🔍 Processing index: ${indexName}`, 'info', true);
      this.log(`   Records to process: ${indexRecords.length}`, 'info', true);
      
      try {
        // Validate records
        const validationIssues = this.validateRecords(indexRecords);
        if (validationIssues.length > 0) {
          this.log('   ⚠️  Validation issues found:', 'warn');
          validationIssues.forEach(issue => this.log(`      - ${issue}`, 'warn'));
        }

        // Save test data
        await this.saveTestData(indexName, indexRecords, 'records');

        // Only send to Algolia if not in test mode
        if (this.testMode === 'none') {
          try {
            const index = this.getIndex(indexName);
            const result = await index.saveObjects(indexRecords);
            await index.waitTask(result.taskIDs[0]);
            this.log('   ✅ Successfully uploaded to Algolia');
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`   ⚠️  Failed to upload to Algolia: ${message}`, 'error');
            if (this.testMode === 'none') {
              this.log('   ℹ️  Consider using --test-file or --test-console to debug', 'info');
            }
          }
        }
        
        stats.byIndex.set(indexName, indexRecords.length);
        stats.successfulIndices++;
        results.push({
          indexName,
          recordCount: indexRecords.length,
          status: 'success'
        });
        
        this.log('   ✅ Successfully processed', 'info', true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`   ❌ Error processing index ${indexName}: ${message}`, 'error', true);
        stats.errors += indexRecords.length;
        stats.failedIndices++;
        results.push({
          indexName,
          recordCount: 0,
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }

    // Print final summary
    this.log('\n📈 Final Summary', 'info', true);
    this.log('==============', 'info', true);
    this.log(`Total records processed: ${stats.total}`, 'info', true);
    this.log(`Records by index:`, 'info', true);
    stats.byIndex.forEach((count, index) => {
      this.log(`   - ${index}: ${count} records`, 'info', true);
    });
    this.log(`Skipped records: ${stats.skipped}`, 'info', true);
    this.log(`Failed records: ${stats.errors}`, 'info', true);
    this.log(`Successful indices: ${stats.successfulIndices}`, 'info', true);
    this.log(`Failed indices: ${stats.failedIndices}`, 'info', true);

    return results;
  }
}
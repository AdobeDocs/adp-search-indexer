import algoliasearch from 'algoliasearch';
import type { SearchClient, SearchIndex } from 'algoliasearch';
import type { AlgoliaRecord, IndexConfig, ProductIndexMapping, IndexingResult } from '../types/algolia';
import type { PageContent } from './content';
import type { SitemapUrl } from '../types';

export class AlgoliaService {
  private client: SearchClient;
  private indices: Map<string, SearchIndex> = new Map();
  private productMappings: ProductIndexMapping[] = [];

  constructor(config: IndexConfig) {
    this.client = algoliasearch(config.appId, config.apiKey);
  }

  async initialize(): Promise<void> {
    try {
      // Fetch product mappings from GitHub
      const response = await fetch('https://raw.githubusercontent.com/AdobeDocs/search-indices/refs/heads/main/product-index-map.json');
      if (!response.ok) {
        throw new Error(`Failed to fetch product mappings: ${response.statusText}`);
      }
      this.productMappings = await response.json();
      
      // Log mapping statistics
      const totalProducts = this.productMappings.length;
      const totalIndices = this.productMappings.reduce((sum, p) => sum + p.productIndices.length, 0);
      const indexPaths = this.productMappings.flatMap(p => 
        p.productIndices.map(i => `${p.productName}: ${i.indexPathPrefix} -> ${i.indexName}`)
      );
      
      console.log(`✅ Product mappings loaded successfully:`);
      console.log(`   - Total products: ${totalProducts}`);
      console.log(`   - Total indices: ${totalIndices}`);
      console.log('   - Index paths:');
      indexPaths.forEach(path => console.log(`     ${path}`));
    } catch (error) {
      console.error('Failed to initialize product mappings:', error);
      throw error;
    }
  }

  private getIndexForUrl(url: string): { indexName: string; productName: string } | null {
    const urlPath = new URL(url).pathname;
    const cleanUrlPath = urlPath.replace(/\/$/, '');
    
    // Special case for root URLs
    if (urlPath === '/' || urlPath === '') {
      console.log('ℹ️ Using default mapping for root URL');
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
      console.log(`✅ Found index mapping for ${urlPath}:`);
      console.log(`   - Product: ${bestMatch.product}`);
      console.log(`   - Index: ${bestMatch.index}`);
      console.log(`   - Path prefix: ${bestMatch.prefix}`);
      if (matches.length > 1) {
        console.log(`   - Note: Selected most specific match (${matches.length} total matches):`);
        matches.slice(1).forEach(m => 
          console.log(`     • ${m.prefix} -> ${m.index}`)
        );
      }
      
      return {
        indexName: bestMatch.index,
        productName: bestMatch.product
      };
    }

    // Log that no mapping was found
    console.warn(`❌ No index mapping found for URL: ${urlPath}`);
    console.warn('Available path prefixes that were checked:');
    this.productMappings.forEach(product => {
      product.productIndices.forEach(index => {
        console.warn(`   - ${index.indexPathPrefix} (${product.productName} -> ${index.indexName})`);
      });
    });
    
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
        
        console.warn(`⚠️ Creating fallback record for unmapped URL: ${url}`);
        console.warn(`   - Using fallback product: ${fallbackProduct}`);
        console.warn(`   - Using fallback index: ${fallbackIndex}`);
        
        return this.createRecordWithFallback(content, sitemapUrl, {
          indexName: fallbackIndex,
          productName: `Adobe ${fallbackProduct}`
        });
      }
      
      console.error(`❌ Cannot create record for URL: ${url} - No mapping found and cannot create fallback`);
      return null;
    }

    return this.createRecordWithFallback(content, sitemapUrl, indexInfo);
  }

  private createRecordWithFallback(
    content: PageContent, 
    sitemapUrl: SitemapUrl,
    indexInfo: { indexName: string; productName: string }
  ): AlgoliaRecord {
    const url = new URL(content.url);
    const type = this.determineType(url.toString());
    const cleanContent = this.cleanContent(content.mainContent);
    const segments = this.segmentContent(cleanContent);
    const topics = this.extractTopics(content);
    const urls = this.extractUrls(content.mainContent);

    return {
      objectID: this.createObjectId(url.toString()),
      url: url.toString(),
      title: content.title || this.cleanContent(content.headings[0] || ''),
      description: this.cleanContent(content.metadata['description'] || content.metadata['og:description'] || ''),
      content: cleanContent,
      contentSegments: segments,
      headings: content.headings.map(h => this.cleanContent(h)),
      lastModified: sitemapUrl.lastmod || new Date().toISOString(),
      product: indexInfo.productName,
      topics,
      hierarchy: this.extractHierarchy(url.toString()),
      type,
      metadata: {
        og: {
          title: content.metadata['og:title'],
          description: this.cleanContent(content.metadata['og:description'] || ''),
          image: content.metadata['og:image'],
        },
        keywords: content.metadata['keywords']?.split(',').map((k: string) => k.trim()),
        products: content.metadata['products']?.split(',').map((p: string) => p.trim()),
        embeddedUrls: urls,
      },
    };
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
    
    console.log('\n📊 Processing Records');
    console.log('==================');
    console.log(`Total records to process: ${records.length}`);
    
    // Group and validate records
    for (const record of records) {
      const indexInfo = this.getIndexForUrl(record.url);
      if (!indexInfo) {
        console.log(`⚠️  Skipping record: ${record.url}`);
        console.log('   Reason: No matching index found in product mapping');
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
    console.log('\n📝 Processing Indices');
    console.log('===================');
    
    for (const [indexName, indexRecords] of recordsByIndex.entries()) {
      console.log(`\n🔍 Processing index: ${indexName}`);
      console.log(`   Records to process: ${indexRecords.length}`);
      
      try {
        // Validate records
        const validationIssues = this.validateRecords(indexRecords);
        if (validationIssues.length > 0) {
          console.log('   ⚠️  Validation issues found:');
          validationIssues.forEach(issue => console.log(`      - ${issue}`));
        }

        // Always try to save local test records first
        await this.outputRecordsToFile(indexName, indexRecords);

        // Try to save to Algolia if credentials are provided
        if (this.client) {
          try {
            const index = this.getIndex(indexName);
            const result = await index.saveObjects(indexRecords);
            await index.waitTask(result.taskIDs[0]);
            console.log('   ✅ Successfully uploaded to Algolia');
          } catch (error: unknown) {
            const algoliaError = error as Error;
            console.error(`   ⚠️  Failed to upload to Algolia: ${algoliaError.message}`);
            console.log('   ℹ️  Records were saved locally but not to Algolia');
          }
        } else {
          console.log('   ℹ️  Skipping Algolia upload (no credentials provided)');
        }
        
        stats.byIndex.set(indexName, indexRecords.length);
        stats.successfulIndices++;
        results.push({
          indexName,
          recordCount: indexRecords.length,
          status: 'success'
        });
        
        console.log('   ✅ Successfully processed');
      } catch (error) {
        console.error(`   ❌ Error processing index ${indexName}:`, error);
        stats.errors += indexRecords.length;
        stats.failedIndices++;
        results.push({
          indexName,
          recordCount: 0,
          status: 'error',
          error: error as Error
        });
      }
    }

    // Print final summary
    console.log('\n📈 Final Summary');
    console.log('==============');
    console.log(`Total records processed: ${stats.total}`);
    console.log(`Records by index:`);
    stats.byIndex.forEach((count, index) => {
      console.log(`   - ${index}: ${count} records`);
    });
    console.log(`Skipped records: ${stats.skipped}`);
    console.log(`Failed records: ${stats.errors}`);
    console.log(`Successful indices: ${stats.successfulIndices}`);
    console.log(`Failed indices: ${stats.failedIndices}`);

    return results;
  }

  private validateRecords(records: AlgoliaRecord[]): string[] {
    const issues: string[] = [];
    
    records.forEach(record => {
      // Check required fields
      if (!record.title?.trim()) {
        issues.push(`Record ${record.objectID} has empty title`);
      }
      if (!record.content?.trim()) {
        issues.push(`Record ${record.objectID} has empty content`);
      }
      if (!record.url?.trim()) {
        issues.push(`Record ${record.objectID} has empty URL`);
      }
      
      // Check content quality
      if (record.content?.length < 50) {
        issues.push(`Record ${record.objectID} has very short content (${record.content?.length} chars)`);
      }
      if (record.content?.includes('<') && record.content?.includes('>')) {
        issues.push(`Record ${record.objectID} may contain HTML tags`);
      }
      
      // Check segments
      if (!record.contentSegments?.length) {
        issues.push(`Record ${record.objectID} has no content segments`);
      } else if (record.contentSegments.some(s => s.text.length < 10)) {
        issues.push(`Record ${record.objectID} has very short segments`);
      }
      
      // Check metadata
      if (!record.description?.trim()) {
        issues.push(`Record ${record.objectID} has no description`);
      }
      if (!record.topics?.length) {
        issues.push(`Record ${record.objectID} has no topics`);
      }
    });
    
    return issues;
  }

  private async outputRecordsToFile(indexName: string, records: AlgoliaRecord[]): Promise<void> {
    try {
      const outputDir = 'test-records';
      const fs = require('fs').promises;
      const path = require('path');

      // Create output directory if it doesn't exist
      await fs.mkdir(outputDir, { recursive: true });

      // Create a summary of the records
      const summary = {
        indexName,
        totalRecords: records.length,
        recordTypes: {
          documentation: records.filter(r => r.type === 'documentation').length,
          api: records.filter(r => r.type === 'api').length,
          community: records.filter(r => r.type === 'community').length,
          tool: records.filter(r => r.type === 'tool').length
        },
        products: Array.from(new Set(records.map(r => r.product))),
        urls: records.map(r => r.url),
        validationIssues: this.validateRecords(records)
      };

      // Save records
      const recordsPath = path.join(outputDir, `${indexName}.json`);
      await fs.writeFile(
        recordsPath,
        JSON.stringify(records, null, 2),
        'utf8'
      );

      // Save summary
      const summaryPath = path.join(outputDir, `${indexName}.summary.json`);
      await fs.writeFile(
        summaryPath,
        JSON.stringify(summary, null, 2),
        'utf8'
      );

      console.log(`   💾 Saved ${records.length} records to ${recordsPath}`);
      console.log(`   📑 Saved summary to ${summaryPath}`);
    } catch (error) {
      console.error(`   ⚠️  Failed to save records for index ${indexName}:`, error);
    }
  }

  async clearIndex(indexName: string): Promise<void> {
    try {
      const index = this.getIndex(indexName);
      const result = await index.clearObjects();
      await index.waitTask(result.taskID);
      console.log(`✅ Index ${indexName} cleared successfully`);
    } catch (error) {
      console.error(`Failed to clear index ${indexName}:`, error);
      throw error;
    }
  }

  async clearAllIndices(): Promise<void> {
    const uniqueIndices = new Set(
      this.productMappings.flatMap(p => p.productIndices.map(i => i.indexName))
    );

    for (const indexName of uniqueIndices) {
      await this.clearIndex(indexName);
    }
  }
} 

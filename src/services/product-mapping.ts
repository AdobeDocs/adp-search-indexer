import type { ProductMapping, ProductIndex, SitemapUrl } from '../types';

const EXCLUDED_PATHS = [
  '/nav/',
  '/nav$',  // Skip paths ending in /nav
  '/fragments/',
  '/blocks/',
  '/drafts/',
  '/tools/',
  '/tools/sidekick/',  // Skip all sidekick content
  '/internal/',
  '/test/',
  '/assets/',
  '/_reference/'
];

export interface IndexMatch {
  indexName: string;
  productName: string;
  pathPrefix: string;
  url: string;
}

interface Pattern {
  pattern: string;
  indexName: string;
  exclude: boolean;
}

interface Match {
  indexName: string;
  excluded: boolean;
}

interface IndexInfo {
  indexName: string;
  productName: string;
}

export class ProductMappingService {
  private productMappings: ProductMapping[] = [];
  private verbose: boolean;
  private validMatches: Map<string, IndexMatch> = new Map();
  private patterns: Pattern[] = [];

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  getProductMappings(): ProductMapping[] {
    return this.productMappings;
  }

  getValidMatches(): Map<string, IndexMatch> {
    return this.validMatches;
  }

  shouldExcludePath(path: string): boolean {
    // First normalize the path
    const normalizedPath = path.replace(/\/$/, '');

    return EXCLUDED_PATHS.some(excludedPath => {
      // Handle exact suffix match for /nav
      if (excludedPath === '/nav$' && normalizedPath.endsWith('/nav')) {
        return true;
      }
      
      // Handle prefix matches for directories
      if (excludedPath.endsWith('/')) {
        return normalizedPath.includes(excludedPath);
      }
      
      // Handle exact matches for other patterns
      return normalizedPath.includes(excludedPath);
    });
  }

  async initialize(mappingUrl: string): Promise<void> {
    try {
      const response = await fetch(mappingUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch product mappings: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('Product mappings response is not an array');
      }
      
      this.productMappings = data;
      
      // Only log summary in verbose mode
      if (this.verbose) {
        const totalIndices = this.getTotalIndices();
        console.log(`Found ${this.productMappings.length} products with ${totalIndices} indices`);
      }
    } catch (error) {
      throw new Error(`Failed to initialize product mappings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getTotalIndices(): number {
    return this.productMappings.reduce((sum, product) => sum + product.productIndices.length, 0);
  }

  findBestMatch(urlPath: string): IndexMatch | null {
    // First check if we already have a match for this path
    if (this.validMatches.has(urlPath)) {
      return this.validMatches.get(urlPath)!;
    }

    // Check if this is a path we should exclude
    if (this.shouldExcludePath(urlPath)) {
      if (this.verbose) {
        console.log(`🚫 Skipping excluded path: ${urlPath}`);
      }
      return null;
    }

    // Clean the URL path
    const cleanPath = urlPath.replace(/\/$/, '');
    
    // Find all matching indices
    interface Match {
      product: string;
      index: string;
      prefix: string;
      segments: number;
    }

    const matches: Match[] = [];
    
    if (this.verbose) {
      console.log(`\n🔍 Finding match for path: ${cleanPath}`);
    }
    
    for (const product of this.productMappings) {
      for (const index of product.productIndices) {
        const cleanPrefix = index.indexPathPrefix.replace(/\/$/, '');
        
        // Check if this path prefix matches the URL exactly
        if (cleanPath === cleanPrefix || cleanPath.startsWith(cleanPrefix + '/')) {
          matches.push({
            product: product.productName,
            index: index.indexName,
            prefix: cleanPrefix,
            segments: cleanPrefix.split('/').filter(Boolean).length
          });
        }
      }
    }

    // If we have matches, use the most specific one (longest matching path)
    if (matches.length > 0) {
      // Sort by number of segments (most specific first)
      matches.sort((a, b) => b.segments - a.segments);
      
      const bestMatch = matches[0];
      if (this.verbose) {
        console.log(`✨ Best match for ${cleanPath}:`);
        console.log(`   • ${bestMatch.prefix} → ${bestMatch.index}`);
        if (matches.length > 1) {
          console.log('   Alternative matches:');
          matches.slice(1).forEach(m => {
            console.log(`     - ${m.prefix} → ${m.index}`);
          });
        }
      }
      
      const match: IndexMatch = {
        indexName: bestMatch.index,
        productName: bestMatch.product,
        pathPrefix: bestMatch.prefix,
        url: urlPath
      };

      // Cache the match
      this.validMatches.set(urlPath, match);
      
      return match;
    }

    if (this.verbose) {
      console.log(`❌ No mapping found for: ${cleanPath}`);
    }
    
    return null;
  }

  analyzeUrlMatches(urls: SitemapUrl[]): void {
    const matchStats = new Map<string, {
      total: number;
      matched: number;
      excluded: number;
      urls: string[];
    }>();

    let totalMatched = 0;
    let totalSkipped = 0;
    let totalNoMatch = 0;

    // Track unmapped paths for analysis
    const unmappedPaths = new Map<string, number>();
    
    // Get existing index names for conflict checking
    const existingIndices = new Set(
      this.productMappings.flatMap(p => 
        p.productIndices.map(i => i.indexName.toLowerCase())
      )
    );

    // First list skip patterns
    console.log('\n🚫 URLs will be skipped if they contain:');
    EXCLUDED_PATHS.forEach(path => {
      console.log(`  • ${path}`);
    });

    // Analyze URLs
    for (const url of urls) {
      const urlPath = new URL(url.loc).pathname;
      
      if (this.shouldExcludePath(urlPath)) {
        totalSkipped++;
        continue;
      }

      const match = this.findBestMatch(urlPath);
      if (match) {
        totalMatched++;
        const stats = matchStats.get(match.indexName) || {
          total: 0,
          matched: 0,
          excluded: 0,
          urls: []
        };
        stats.matched++;
        if (stats.urls.length < 3) {
          stats.urls.push(url.loc);
        }
        matchStats.set(match.indexName, stats);
      } else {
        totalNoMatch++;
        // Get the first path segment for unmapped analysis
        const segments = urlPath.split('/').filter(Boolean);
        if (segments.length > 0) {
          const rootPath = `/${segments[0]}`;
          unmappedPaths.set(rootPath, (unmappedPaths.get(rootPath) || 0) + 1);
        }
      }
    }

    // Print summary stats
    console.log('\n📈 URL Analysis:');
    console.log(`Total URLs found: ${urls.length}`);
    console.log(`URLs to be indexed: ${totalMatched}`);
    console.log(`URLs to be skipped: ${totalSkipped}`);
    console.log(`URLs with no matches: ${totalNoMatch}`);

    // Only show per-index breakdown in verbose mode
    if (this.verbose && totalMatched > 0) {
      console.log('\nBreakdown by index:');
      for (const [indexName, stats] of matchStats) {
        if (stats.matched > 0) {
          console.log(`  • ${indexName}: ${stats.matched} URLs`);
        }
      }
    }

    // Show recommended indices if there are unmapped paths
    if (unmappedPaths.size > 0) {
      console.log('\n💡 Recommended indices to consider:');
      const recommendations = Array.from(unmappedPaths.entries())
        .filter(([path, count]) => {
          // Filter out paths we know should be excluded
          if (path === '/nav' || path === '/fragments' || path === '/blocks' || 
              path === '/drafts' || path === '/tools' || path === '/internal' || 
              path === '/test' || path === '/assets') {
            return false;
          }
          // Only recommend paths with more than one URL
          return count > 1;
        })
        .sort((a, b) => b[1] - a[1]); // Sort by count descending

      if (recommendations.length > 0) {
        recommendations.forEach(([path, count]) => {
          // Generate suggested name without franklin prefix
          const suggestedName = path.replace('/', '').replace(/-/g, '-');
          
          // Check for conflicts with existing indices (case insensitive)
          const isConflict = existingIndices.has(suggestedName.toLowerCase());
          
          console.log(
            `  • ${path}/* (${count} URLs) → Suggested index: ${suggestedName}` + 
            (isConflict ? ' ⚠️ Conflicts with existing index' : '')
          );
        });
      } else {
        console.log('  No recommendations - all unmapped paths are expected to be excluded');
      }
    }
  }

  getUniqueIndices(): Set<string> {
    return new Set(
      this.productMappings.flatMap(p => p.productIndices.map(i => i.indexName))
    );
  }

  private findMatches(url: string): Match[] {
    try {
      const urlPath = new URL(url).pathname;
      
      // First check if path should be excluded
      if (this.shouldExcludePath(urlPath)) {
        return [{
          indexName: 'excluded',
          excluded: true
        }];
      }

      const matches: Match[] = [];
      for (const pattern of this.patterns) {
        if (url.includes(pattern.pattern)) {
          matches.push({
            indexName: pattern.indexName,
            excluded: pattern.exclude
          });
        }
      }
      return matches;
    } catch (error) {
      console.warn(`Invalid URL: ${url}`);
      return [];
    }
  }

  getIndexForUrl(url: string): IndexInfo | null {
    try {
      const urlPath = new URL(url).pathname;
      const match = this.findBestMatch(urlPath);
      
      if (match) {
        return {
          indexName: match.indexName,
          productName: match.productName
        };
      }

      return null;
    } catch (error) {
      console.warn(`Invalid URL: ${url}`);
      return null;
    }
  }
} 
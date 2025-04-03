import type { ProductIndexMapping, SitemapUrl } from '../types/index';

const EXCLUDED_PATHS = [
  '/nav/',
  '/nav$', // Skip paths ending in /nav
  '/fragments/',
  '/blocks/',
  '/drafts/',
  '/tools/',
  '/tools/sidekick/', // Skip all sidekick content
  '/internal/',
  '/test/',
  '/assets/',
  '/_reference/',
  '/github-actions-test/', // Skip test content from github actions
];

export interface IndexMatch {
  indexName: string;
  productName: string;
  pathPrefix: string;
  url: string;
  fragment?: string;
}

interface IndexInfo {
  indexName: string;
  productName: string;
}

/**
 * Service responsible for managing product mappings and matching URL paths to their corresponding product indices.
 * This service loads mapping data from a remote JSON file and provides methods to analyze URLs against product mapping rules.
 */
export class ProductMappingService {
  private productMappings: ProductIndexMapping[] = [];
  private verbose: boolean;
  private validMatches: Map<string, IndexMatch> = new Map();
  private activeIndices: Set<string> | null = null;

  /**
   * Constructs a new ProductMappingService instance.
   * @param verbose - Optional flag to enable verbose logging.
   */
  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /**
   * Retrieves the list of product mappings.
   * @returns The array of ProductIndexMapping objects.
   */
  getProductMappings(): ProductIndexMapping[] {
    return this.productMappings;
  }

  /**
   * Retrieves the map of valid URL-to-product matches.
   * @returns A Map where the key is the URL path and the value is the IndexMatch object.
   */
  getValidMatches(): Map<string, IndexMatch> {
    return this.validMatches;
  }

  /**
   * Determines if a given URL path should be excluded from mapping.
   *
   * @param path - The URL path to check.
   * @returns True if the path should be excluded, false otherwise.
   */
  shouldExcludePath(path: string): boolean {
    // First normalize the path
    const normalizedPath = path.replace(/\/$/, '');

    return EXCLUDED_PATHS.some((excludedPath) => {
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

  /**
   * Initializes the product mappings by fetching data from the provided URL.
   *
   * @param mappingUrl - The URL from which to fetch the product mappings JSON.
   * @returns A Promise that resolves when the mappings are successfully loaded.
   * @throws An error if the fetch or the processing fails.
   */
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
      throw new Error(
        `Failed to initialize product mappings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private getTotalIndices(): number {
    return this.productMappings.reduce((sum, product) => sum + product.productIndices.length, 0);
  }

  /**
   * Filters the product mappings to only include specific indices.
   *
   * @param indices - An array of index names to include
   */
  filterIndices(indices: string[]): void {
    if (!indices || indices.length === 0) {
      this.activeIndices = null;
      return;
    }

    this.activeIndices = new Set(indices.map((i: string) => i.toLowerCase()));

    if (this.verbose) {
      console.log(`Filtering to ${this.activeIndices.size} indices: ${Array.from(this.activeIndices).join(', ')}`);
    }

    // Clear any cached matches as they might not be valid after filtering
    this.validMatches.clear();
  }

  /**
   * Finds the best matching product index for a given URL path.
   *
   * @param urlPath - The URL path to match.
   * @returns The best matching IndexMatch if a match is found, or null if no match is found or the path is excluded.
   */
  findBestMatch(urlPath: string): IndexMatch | null {
    // First check if we already have a match for this path
    if (this.validMatches.has(urlPath)) {
      return this.validMatches.get(urlPath)!;
    }

    // Extract fragment if present
    let fragment = '';
    let pathWithoutFragment = urlPath;

    // Check for and extract fragment
    const fragmentIndex = urlPath.indexOf('#');
    if (fragmentIndex !== -1) {
      fragment = urlPath.substring(fragmentIndex);
      pathWithoutFragment = urlPath.substring(0, fragmentIndex);
    }

    // Check if this is a path we should exclude
    if (this.shouldExcludePath(pathWithoutFragment)) {
      if (this.verbose) {
        console.log(`Skipping excluded path: ${pathWithoutFragment}`);
      }
      return null;
    }

    // Clean the URL path (without fragment)
    const cleanPath = pathWithoutFragment.replace(/\/$/, '');

    // Find all matching indices
    interface Match {
      product: string;
      index: string;
      prefix: string;
      segments: number;
    }

    const matches: Match[] = [];

    if (this.verbose) {
      console.log(`\nFinding match for path: ${cleanPath}`);
    }

    for (const product of this.productMappings) {
      for (const index of product.productIndices) {
        // Skip indices that are not in the active set, if filtering is enabled
        if (this.activeIndices && !this.activeIndices.has(index.indexName.toLowerCase())) {
          continue;
        }

        const cleanPrefix = index.indexPathPrefix.replace(/\/$/, '');

        // Check if this path prefix matches the URL exactly
        if (cleanPath === cleanPrefix || cleanPath.startsWith(cleanPrefix + '/')) {
          matches.push({
            product: product.productName,
            index: index.indexName,
            prefix: cleanPrefix,
            segments: cleanPrefix.split('/').filter(Boolean).length,
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
          matches.slice(1).forEach((m) => {
            console.log(`     - ${m.prefix} → ${m.index}`);
          });
        }
      }

      const match: IndexMatch = {
        indexName: bestMatch.index,
        productName: bestMatch.product,
        pathPrefix: bestMatch.prefix,
        url: urlPath, // Preserve the original URL with fragment
        fragment: fragment || undefined, // Add fragment if present
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

  /**
   * Analyzes URLs to determine matching product indices and provides statistics.
   *
   * @param urls The URLs to analyze
   * @param verbose Whether to show verbose output
   */
  analyzeUrlMatches(urls: SitemapUrl[], verbose = false): void {
    const matchStats = new Map<
      string,
      {
        total: number;
        matched: number;
        excluded: number;
        urls: string[];
      }
    >();

    let totalMatched = 0;
    let totalSkipped = 0;
    let totalNoMatch = 0;

    // Track unmapped paths for analysis
    const unmappedPaths = new Map<string, number>();

    // Get existing index names for conflict checking
    const existingIndices = new Set(
      this.productMappings.flatMap((p) => p.productIndices.map((i) => i.indexName.toLowerCase()))
    );

    // Show excluded paths only in verbose mode
    if (this.verbose || verbose) {
      console.log('\n🚫 URLs will be skipped if they contain:');
      EXCLUDED_PATHS.forEach((path) => {
        console.log(`  • ${path}`);
      });
    }

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
          urls: [],
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

    // Print summary stats based on verbosity level
    if (this.verbose || verbose) {
      // Detailed stats for verbose mode
      console.log('\nURL Analysis:');
      console.log(`Total URLs found: ${urls.length}`);
      console.log(`URLs to be indexed: ${totalMatched}`);
      console.log(`URLs to be skipped: ${totalSkipped}`);
      console.log(`URLs with no matches: ${totalNoMatch}`);

      // Per-index breakdown
      if (totalMatched > 0) {
        console.log('\nBreakdown by index:');
        for (const [indexName, stats] of matchStats) {
          if (stats.matched > 0) {
            console.log(`  • ${indexName}: ${stats.matched} URLs`);
          }
        }
      }

      // Recommendations for unmapped paths
      if (unmappedPaths.size > 0) {
        console.log('\nRecommended indices to consider:');
        const recommendations = Array.from(unmappedPaths.entries())
          .filter(([path, count]) => {
            // Filter out paths we know should be excluded
            if (
              path === '/nav' ||
              path === '/fragments' ||
              path === '/blocks' ||
              path === '/drafts' ||
              path === '/tools' ||
              path === '/internal' ||
              path === '/test' ||
              path === '/assets' ||
              path === '/github-actions-test'
            ) {
              return false;
            }
            // Only recommend paths with more than one URL
            return count > 1;
          })
          .sort((a, b) => b[1] - a[1]);

        if (recommendations.length > 0) {
          recommendations.forEach(([path, count]) => {
            // Generate suggested name without franklin prefix
            const suggestedName = path.replace('/', '').replace(/-/g, '-');

            // Check for conflicts with existing indices (case insensitive)
            const isConflict = existingIndices.has(suggestedName.toLowerCase());

            console.log(
              `  • ${path}/* (${count} URLs) → Suggested index: ${suggestedName}` +
                (isConflict ? ' Conflicts with existing index' : '')
            );
          });
        } else {
          console.log('  No recommendations - all unmapped paths are expected to be excluded');
        }
      }
    } else {
      // Ultra-concise single line for non-verbose mode
      console.log(`URLs: ${totalMatched} matched, ${totalSkipped} skipped, ${totalNoMatch} unmatched`);
    }
  }

  /**
   * Retrieves a set of unique index names based on the product mappings.
   *
   * @returns A Set of unique index names.
   */
  getUniqueIndices(): Set<string> {
    return new Set(this.productMappings.flatMap((p) => p.productIndices.map((i) => i.indexName)));
  }

  /**
   * Determines the product index for a given URL by evaluating mapping rules.
   *
   * @param url - The URL to evaluate.
   * @returns The IndexInfo if a valid mapping is found, or null otherwise.
   */
  getIndexForUrl(url: string): IndexInfo | null {
    try {
      const urlPath = new URL(url).pathname;
      const match = this.findBestMatch(urlPath);

      if (match) {
        return {
          indexName: match.indexName,
          productName: match.productName,
        };
      }

      return null;
    } catch (error: unknown) {
      console.warn(`Invalid URL: ${url}. Error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

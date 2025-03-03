import type { AlgoliaRecord } from './algolia';

/**
 * Represents a URL entry in a sitemap with optional metadata.
 */
export interface SitemapUrl {
  /** The location (URL) of the page */
  loc: string;
  /** The date of last modification */
  lastmod?: string;
  /** How frequently the page is likely to change */
  changefreq?: string;
  /** The priority of this URL relative to other URLs */
  priority?: string;
}

/**
 * Represents the structure of a sitemap XML file.
 */
export interface Sitemap {
  urlset: {
    url: SitemapUrl[];
  };
}

/**
 * Application configuration interface that defines all necessary settings.
 */
export interface Config {
  /** Sitemap-related configuration */
  sitemap: {
    /** The URL path to the sitemap */
    url: string;
  };
  /** Algolia search configuration */
  algolia: {
    /** Algolia application ID */
    appId: string;
    /** Algolia API key */
    apiKey: string;
    /** Name of the Algolia index to use */
    indexName?: string;
  };
  /** Application-specific settings */
  app: {
    /** The logging level to use */
    logLevel: string;
    /** Number of items to process in each batch */
    batchSize: number;
    /** Maximum number of concurrent requests allowed */
    maxConcurrentRequests: number;
    /** Operational mode for the application */
    mode: 'index' | 'export' | 'console';
    /** Whether to enable verbose logging */
    verbose: boolean;
    /** Optional specific index to target */
    index?: string;
    /** Optional prefix for index names */
    indexPrefix?: string;
    /** Whether to perform partial indexing */
    partial: boolean;
  };
}

/**
 * Represents a segment of content with its heading and hierarchical level.
 */
export interface ContentSegment {
  /** The heading text for this segment */
  heading: string;
  /** The actual content text of the segment */
  content: string;
  /** The heading level (1-6) */
  level: number;
}

/**
 * Represents the structured content of a page with metadata.
 */
export interface PageContent {
  /** The full URL of the page */
  url: string;
  /** The page title */
  title: string;
  /** Optional page description */
  description: string;
  /** Optional raw content */
  content: string;
  /** The main content of the page */
  mainContent: string;
  /** Array of content segments */
  segments: ContentSegment[];
  /** Array of page headings */
  headings: string[];
  /** Additional metadata key-value pairs */
  metadata: Record<string, string>;
  structure: {
    hasHeroSection: boolean;
    hasDiscoverBlocks: boolean;
    contentTypes: string[];
  };
}

/**
 * Represents an index configuration for a product.
 */
export interface ProductIndex {
  /** The name of the index */
  indexName: string;
  /** The path prefix used to match content to this index */
  indexPathPrefix: string;
}

/**
 * Represents the mapping between a product and its indices.
 */
export interface ProductMapping {
  /** The name of the product */
  productName: string;
  /** Array of index configurations for this product */
  productIndices: ProductIndex[];
}

/**
 * Represents the result of content indexing.
 */
export interface IndexedContent {
  /** The name of the index where content was stored */
  indexName: string;
  /** The name of the product this content belongs to */
  productName: string;
  /** Array of Algolia records created from the content */
  records: AlgoliaRecord[];
} 
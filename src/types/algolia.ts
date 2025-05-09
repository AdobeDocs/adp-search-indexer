/**
 * Represents a record in the Algolia search index.
 * Contains all searchable and displayable content for a page or page segment.
 */
export interface AlgoliaRecord {
  /** Unique identifier for the record */
  objectID: string;
  /** Full URL of the page, including any fragment identifier */
  url: string;
  /** URL path component without fragment */
  path: string;
  /** Fragment identifier (anchor) from the URL, if any */
  fragment?: string;
  /** Name of the Algolia index containing this record */
  indexName: string;
  /** Page title */
  title: string;
  /** Page description or excerpt */
  description: string;
  /** Main content text */
  content: string;
  /** Array of headings found in the content */
  headings: string[];
  /** Product name this content belongs to */
  product: string;
  /** Content type (e.g., 'guide', 'reference', 'tutorial') */
  type: string;
  /** Array of topic tags */
  topics: string[];
  /** Last modification date of the content */
  lastModified: string;
  /** Original lastmod value from sitemap */
  sourceLastmod?: string;
  /** Timestamp when this record was indexed */
  indexedAt?: string;
  /** Hierarchical structure of the content */
  hierarchy: {
    /** Top level heading */
    lvl0: string;
    /** Second level heading */
    lvl1?: string;
    /** Third level heading */
    lvl2?: string;
  };
  /** Additional metadata key-value pairs */
  metadata: {
    keywords: string;
    products: string;
    og_title: string;
    og_description: string;
    og_image: string;
  };
  /** Record structure information for UI features */
  structure?: {
    hasHeroSection: boolean;
    hasDiscoverBlocks: boolean;
    contentTypes: string[];
  };
  /** Each record can have custom fields for the specific type */
  [key: string]: unknown;
}

/**
 * Maps URL paths to product and content type information.
 */
export interface ProductMapping {
  [path: string]: {
    /** Product identifier */
    product: string;
    /** Content type */
    type: string;
  };
}

/**
 * Defines an index configuration for a product.
 */
export interface ProductIndex {
  /** Name of the Algolia index */
  indexName: string;
  /** URL path prefix used to match content to this index */
  indexPathPrefix: string;
}

/**
 * Maps a product to its associated indices.
 */
export interface ProductIndexMapping {
  /** Name of the product */
  productName: string;
  /** Array of index configurations for this product */
  productIndices: {
    /** Name of the Algolia index */
    indexName: string;
    /** URL path prefix for content matching */
    indexPathPrefix: string;
  }[];
}

/**
 * Configuration for connecting to an Algolia index.
 */
export interface IndexConfig {
  /** Algolia application ID */
  appId: string;
  /** Algolia API key */
  apiKey: string;
  /** Name of the index to use */
  indexName: string;
}

/**
 * Result of an indexing operation.
 */
export interface IndexingResult {
  /** Name of the index that was updated */
  indexName: string;
  /** Number of records processed */
  recordCount: number;
  /** Status of the operation: 'success' or 'error' */
  status: 'success' | 'error';
  /** Number of records that were updated (only present for success) */
  updated?: number;
  /** Number of records that were deleted (only present for success) */
  deleted?: number;
  /** Optional error information if indexing failed */
  error?: Error;
}

/**
 * Settings configuration for an Algolia index.
 */
export interface AlgoliaIndexSettings {
  /** Ordered list of attributes to search in */
  searchableAttributes: string[];
  /** Attributes that can be used for faceting */
  attributesForFaceting: string[];
  /** Attributes used for custom ranking */
  customRanking: string[];
  /** Order of ranking criteria */
  ranking: string[];
  /** Minimum word length to allow one typo */
  minWordSizefor1Typo: number;
  /** Minimum word length to allow two typos */
  minWordSizefor2Typos: number;
  /** Languages to use for query analysis */
  queryLanguages: string[];
  /** Whether to remove stop words from queries */
  removeStopWords: boolean;
  /** Whether to enable advanced query syntax */
  advancedSyntax: boolean;
}

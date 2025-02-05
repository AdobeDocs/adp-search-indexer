export interface AlgoliaRecord {
  objectID: string;
  url: string;
  path: string;
  indexName: string;
  title: string;
  description: string;
  content: string;
  headings: string[];
  product: string;
  type: string;
  topics: string[];
  lastModified: string;
  hierarchy: {
    lvl0?: string;
    lvl1?: string;
    lvl2?: string;
  };
  metadata: Record<string, string>;
}

export interface ProductMapping {
  [path: string]: {
    product: string;
    type: string;
  };
}

export interface ProductIndex {
  indexName: string;
  indexPathPrefix: string;
}

export interface ProductIndexMapping {
  productName: string;
  productIndices: {
    indexName: string;
    indexPathPrefix: string;
  }[];
}

export interface IndexConfig {
  appId: string;
  apiKey: string;
  indexName: string;
}

export interface IndexingResult {
  url: string;
  indexName: string;
  success: boolean;
  error?: Error;
}

export interface AlgoliaIndexSettings {
  searchableAttributes: string[];
  attributesForFaceting: string[];
  customRanking: string[];
  ranking: string[];
  minWordSizefor1Typo: number;
  minWordSizefor2Typos: number;
  queryLanguages: string[];
  removeStopWords: boolean;
  advancedSyntax: boolean;
} 
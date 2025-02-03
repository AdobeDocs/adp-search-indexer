export interface AlgoliaRecord {
  objectID: string;
  url: string;
  title: string;
  description: string;
  content: string;
  contentSegments: {
    text: string;
    position: number;
  }[];
  headings: string[];
  lastModified: string;
  product: string;
  topics: string[];
  hierarchy: {
    lvl0: string;
    lvl1?: string;
    lvl2?: string;
  };
  type: 'documentation' | 'api' | 'community' | 'tool';
  metadata: {
    og?: {
      title?: string;
      description?: string;
      image?: string;
    };
    keywords?: string[];
    products?: string[];
    embeddedUrls?: string[];
  };
}

export interface ProductMapping {
  [path: string]: {
    product: string;
    type: AlgoliaRecord['type'];
  };
}

export interface ProductIndex {
  indexName: string;
  indexPathPrefix: string;
}

export interface ProductIndexMapping {
  productName: string;
  productIndices: ProductIndex[];
}

export interface IndexConfig {
  appId: string;
  apiKey: string;
  indexName: string;
}

export interface IndexingResult {
  indexName: string;
  recordCount: number;
  status: 'success' | 'error';
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
  removeStopWords: boolean | string[];
  advancedSyntax: boolean;
  synonyms?: Array<{
    objectID: string;
    type: 'synonym' | 'oneWaySynonym' | 'altCorrection1' | 'altCorrection2';
    input: string;
    synonyms: string[];
  }>;
} 
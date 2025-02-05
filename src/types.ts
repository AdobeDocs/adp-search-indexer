export interface SitemapUrl {
  loc: string;
}

export interface ProductMapping {
  productName: string;
  productIndices: ProductIndex[];
}

export interface ProductIndex {
  indexName: string;
  indexPathPrefix: string;
}

export interface PageContent {
  url: string;
  title: string;
  description: string;
  content: string;
  mainContent?: string;
  headings: string[];
  segments?: ContentSegment[];
  metadata?: {
    topics?: string[];
    type?: string;
    lastModified?: string;
    [key: string]: unknown;
  };
  lastModified?: string;
  topics?: string[];
  type?: string;
}

export interface ContentSegment {
  content: string;
  heading?: string;
} 
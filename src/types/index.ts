import type { AlgoliaRecord } from './algolia';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface Sitemap {
  urlset: {
    url: SitemapUrl[];
  };
}

export interface Config {
  sitemap: {
    url: string;
  };
  algolia: {
    appId: string;
    apiKey: string;
    indexName: string;
  };
  app: {
    logLevel: string;
    batchSize: number;
    maxConcurrentRequests: number;
    mode: 'none' | 'file' | 'console';
    verbose: boolean;
    index?: string;
    indexPrefix?: string;
    partial: boolean;
  };
}

export interface ContentSegment {
  heading: string;
  content: string;
  level: number;
}

export interface PageContent {
  url: string;
  title: string;
  mainContent: string;
  segments: ContentSegment[];
  headings: string[];
  metadata: Record<string, string>;
}

export interface ProductIndex {
  indexName: string;
  indexPathPrefix: string;
}

export interface ProductMapping {
  productName: string;
  productIndices: ProductIndex[];
}

export interface IndexedContent {
  indexName: string;
  productName: string;
  records: AlgoliaRecord[];
} 
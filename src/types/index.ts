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
  };
} 
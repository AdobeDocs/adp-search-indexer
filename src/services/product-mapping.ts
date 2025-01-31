import type { ProductMapping } from '../types/algolia';

export class ProductMappingService {
  private mapping: ProductMapping = {};

  async loadMapping(): Promise<void> {
    try {
      const response = await fetch(
        'https://raw.githubusercontent.com/AdobeDocs/search-indices/refs/heads/main/product-index-map.json'
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch product mapping: ${response.statusText}`);
      }

      this.mapping = await response.json();
      console.log('✅ Product mapping loaded successfully');
    } catch (error) {
      console.error('Failed to load product mapping:', error);
      throw error;
    }
  }

  findProduct(url: string): { product: string; type: string } {
    const urlPath = new URL(url).pathname;
    
    // Try exact match first
    if (this.mapping[urlPath]) {
      return this.mapping[urlPath];
    }

    // Try pattern matching
    for (const [pattern, mapping] of Object.entries(this.mapping)) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (urlPath.startsWith(prefix)) {
          return mapping;
        }
      }
    }

    // Default mapping
    return {
      product: 'other',
      type: 'documentation'
    };
  }
} 
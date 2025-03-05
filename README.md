# ADP Search Indexer

A specialized search indexer for [developer.adobe.com](https://developer.adobe.com), built by the Adobe Developer Platform (ADP) team. It processes documentation content and indexes it to Algolia to power the developer portal's search functionality.

## Overview

This tool enhances the developer.adobe.com search experience by:
- Processing documentation from multiple Adobe products
- Creating optimized search records for Algolia
- Maintaining content hierarchy and relationships
- Ensuring up-to-date search results

## Quick Start

1. Install dependencies:
```bash
bun install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Run the indexer:
```bash
# Test mode (output to console)
bun start --test-console

# Production mode (index to Algolia)
bun start --index
```

## Key Features

- 🚀 High-performance content processing with Bun and TypeScript
- 📑 Smart content segmentation for improved search relevance
- 🔄 Reliable processing with automatic retries
- 🗂️ Adobe product-based content organization
- 🔍 Search optimization for developer documentation

## How It Works

1. **Content Processing**
   - Fetches content from developer.adobe.com sitemap
   - Segments documentation into searchable chunks
   - Preserves product and API relationships
   - Optimizes content for developer search

2. **Search Records**
   Documentation is processed into search-optimized records:
   ```typescript
   interface AlgoliaRecord {
     objectID: string;     // Unique identifier
     url: string;         // Documentation URL
     title: string;      // Content title
     content: string;    // Processed content
     product: string;    // Adobe product identifier
     metadata: {        // Enhanced metadata
       type: string;   // e.g., 'api', 'guide', 'reference'
       lastModified: string;
     };
     hierarchy: {      // Documentation structure
       lvl0?: string; // Product level
       lvl1?: string; // Category level
       lvl2?: string; // Page level
     };
   }
   ```

## URL Fragment Handling

The indexer now properly handles URL fragments (anchor links) throughout the indexing process:

- The `AlgoliaRecord` type includes a dedicated `fragment` field to store anchor information
- URL fragments are preserved when processing sitemap URLs
- Path matching logic properly separates fragments from paths for accurate product matching
- Segment records automatically generate appropriate fragment identifiers based on headings
- A utility function `constructUrlFromRecord()` is provided to help construct complete URLs with fragments

When using search results in your application, make sure to use the full URL including fragments:

```typescript
// Import the utility function
import { constructUrlFromRecord } from './utils/url';

// Use it to construct complete URLs from search results
const completeUrl = constructUrlFromRecord(searchResult);
```

This ensures users are directed to the exact section of content they're looking for, rather than just the top of the page.

## Development

### Testing
```bash
# Test specific documentation URLs
bun start --test-url="https://developer.adobe.com/commerce/docs/..."

# Analyze content structure
bun start --analyze
```

### Error Handling
- Automatic retries for transient failures
- Graceful handling of 404s
- Detailed error reporting

### Contributing
1. Code Quality
   - Use TypeScript strict mode
   - Add JSDoc comments
   - Run `bun run format`

2. Testing
   - Test with diverse documentation types
   - Verify content quality
   - Validate error handling

## License

Copyright Adobe. All rights reserved.

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.

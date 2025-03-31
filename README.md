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
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Run the indexer:
```bash
# Analyze mode (just analyze, no indexing)
npm run analyze

# Export mode (save to JSON files)
npm run export

# Verify indices (check exported files or Algolia)
npm run verify

# Default mode (partial update with timestamp-based checking)
npm run partial-update

# Force update (update all records regardless of timestamp)
npm run force-update

# Full reindex (clear and rebuild indices)
npm run full-reindex
```

## Key Features

- 🚀 High-performance content processing with Node.js and TypeScript
- 📑 Smart content segmentation for improved search relevance
- 🔄 Reliable processing with automatic retries
- 🗂️ Adobe product-based content organization
- 🔍 Search optimization for developer documentation
- 🕒 Timestamp-based partial updates for efficient indexing
- 🏷️ Intelligent record ID generation for consistent updates

## How It Works

1. **Content Processing**
   - Fetches content from developer.adobe.com sitemap
   - Extracts `lastmod` timestamps from sitemap entries
   - Segments documentation into searchable chunks
   - Preserves product and API relationships
   - Optimizes content for developer search

2. **Intelligent Updating**
   - Uses deterministic MD5 hashing to generate consistent object IDs
   - Compares sitemap `lastmod` timestamps with existing records
   - Only updates records when content is newer
   - Removes records for URLs no longer in the sitemap
   - Preserves records in indices not matched by the sitemap

3. **Search Records**
   Documentation is processed into search-optimized records:
   ```typescript
   interface AlgoliaRecord {
     objectID: string;     // Unique identifier (MD5 hash of URL)
     url: string;         // Documentation URL
     title: string;      // Content title
     content: string;    // Processed content
     product: string;    // Adobe product identifier
     lastModified: string; // Content modification date
     sourceLastmod?: string; // Original sitemap lastmod timestamp
     indexedAt?: string;    // When this record was indexed
     metadata: {        // Enhanced metadata
       type: string;   // e.g., 'api', 'guide', 'reference'
     };
     hierarchy: {      // Documentation structure
       lvl0?: string; // Product level
       lvl1?: string; // Category level
       lvl2?: string; // Page level
     };
   }
   ```

## Indexing Modes

The indexer supports several operational modes to suit different scenarios:

### Partial Indexing (Default)

The default mode uses timestamp-based partial updates to efficiently keep your Algolia indices up to date:

- Only updates records that are newer (based on sitemap `lastmod` values)
- Removes records for URLs no longer in the sitemap
- Leaves unchanged records intact
- Preserves records in indices not matched by your sitemap

```bash
npm run partial-update
```

### Force Update

Updates all records regardless of timestamps:

```bash
npm run force-update
```

### Full Reindexing

Performs a complete rebuild of indices matched by your sitemap:

```bash
npm run full-reindex
```

### Analysis Only

Analyzes your sitemap and prints mapping information without indexing:

```bash
npm run analyze
```

### Export Mode

Saves records to JSON files without updating Algolia:

```bash
npm run export
```

## Advanced CLI Options

For more control, you can use the CLI directly with these options:

```bash
# Test a specific URL
npm start -- --test-url="https://developer.adobe.com/path/to/test"

# Filter to specific indices (comma-separated)
npm start -- --index --index-filter="photoshop,illustrator"

# Force update specific indices
npm start -- --index --index-filter="photoshop" --force

# Full reindex of specific indices
npm start -- --index --index-filter="commerce" --no-partial
```

## URL Fragment Handling

The indexer properly handles URL fragments (anchor links) throughout the indexing process:

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

This project uses:
- **TypeScript** for type-safe JavaScript
- **ESM** (ECMAScript Modules) for modern JavaScript module syntax
- **tsup** for bundling
- **Node.js** 22.6.0 for Adobe I/O Runtime compatibility

### Project Structure

```
src/
├── cli/             # Command-line interfaces
│   └── verify.ts    # Index verification CLI
├── config/          # Configuration
├── services/        # Core services (Algolia, content processing)
├── types/           # TypeScript type definitions
└── utils/           # Utility functions
    └── verify-indices.ts  # Index verification utilities
```

### Running Locally
```bash
# Analyze sitemap without indexing
npm run analyze

# Export to JSON files (no Algolia updates)
npm run export

# Standard partial update (default)
npm run partial-update

# Development mode with auto-restart
npm run dev

# Verify indices
npm run verify
```

### Testing Specific Content
```bash
# Test a specific URL
npm start -- --test-url="https://developer.adobe.com/commerce/docs/..."

# Test with specific indices only
npm start -- --index --index-filter="photoshop,illustrator" --verbose

# Process only a specific section of the documentation
npm start -- --index --index-filter="commerce" --partial --verbose
```

### Production Indexing
```bash
# Regular incremental update (recommended for scheduled jobs)
npm run partial-update

# Force update regardless of timestamps
npm run force-update

# Complete reindexing (use with caution)
npm run full-reindex
```

### Building
```bash
# Compile TypeScript to JavaScript
npm run build

# Create distribution package
npm run dist
```

### Error Handling
- Automatic retries for transient failures
- Graceful handling of 404s
- Detailed error reporting

### Contributing
1. Code Quality
   - Use TypeScript strict mode
   - Add JSDoc comments
   - Run `npm run format`

2. Testing
   - Test with diverse documentation types
   - Verify content quality
   - Validate error handling

## Deployment

This project is designed to run on Adobe I/O Runtime with Node.js 22.6.0.

## License

Copyright Adobe. All rights reserved.

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) file for details.

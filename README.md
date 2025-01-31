# ADP Search Indexer

A robust sitemap-based content indexer for Adobe Documentation Portal (ADP) that processes and indexes content to Algolia for enhanced search capabilities.

## Features

- 🚀 Built with Bun and TypeScript for maximum performance
- 📑 Intelligent content extraction from HTML pages
- 🔄 Concurrent processing with rate limiting
- 🗂️ Product-based content categorization
- 📊 Detailed indexing statistics
- 🔍 Optimized Algolia record structure
- 🧪 Test mode with local file output

## Setup

1. Install dependencies:
```bash
bun install
```

2. Configure environment:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Sitemap Configuration
SITEMAP_URL=https://main--adp-devsite--adobedocs.aem.page/sitemap.xml

# Algolia Configuration
ALGOLIA_APP_ID=your_app_id
ALGOLIA_API_KEY=your_api_key
ALGOLIA_INDEX_NAME=your_index_name

# Application Configuration
LOG_LEVEL=info
BATCH_SIZE=50
MAX_CONCURRENT_REQUESTS=5
```

## Development

Run in development mode with watch:
```bash
bun run dev
```

Run normally:
```bash
bun run start
```

Build for production:
```bash
bun run build
```

## Record Structure

The indexer creates Algolia records with the following structure:

```typescript
interface AlgoliaRecord {
  objectID: string;        // Base64 encoded URL
  url: string;            // Full page URL
  title: string;          // Page title
  description: string;    // Meta description
  content: string;        // Main content
  headings: string[];     // All headings (h1-h6)
  lastModified: string;   // Last modification date
  product: string;        // Product identifier
  topics: string[];       // Topic tags
  hierarchy: {           // URL-based hierarchy
    lvl0: string;       // Top level (e.g., "Commerce")
    lvl1?: string;      // Second level
    lvl2?: string;      // Third level
  };
  type: 'documentation' | 'api' | 'community' | 'tool';
  metadata: {           // Additional metadata
    og: {...};         // OpenGraph metadata
    keywords: string[];
    products: string[];
  };
}
```

## Content Processing

The indexer processes content in the following steps:

1. **Sitemap Fetching**
   - Fetches and parses XML sitemap
   - Filters out non-content URLs (nav, assets, etc.)

2. **Content Extraction**
   - Removes scripts and styles
   - Extracts metadata and OpenGraph tags
   - Processes main content from semantic HTML
   - Builds content hierarchy

3. **Product Mapping**
   - Maps URLs to Adobe products
   - Determines content type
   - Applies content categorization

4. **Record Creation**
   - Creates deterministic objectIDs
   - Structures content for optimal search
   - Validates record format

5. **Indexing**
   - Batches records for efficiency
   - Applies rate limiting
   - Updates Algolia index

## Testing

Before indexing to Algolia, you can test the processing:

```bash
bun run dev
```

This will:
1. Analyze URL patterns
2. Sample content structure
3. Save records to `test-records.json`
4. Show indexing statistics

## Algolia Configuration

The indexer configures the following Algolia settings:

### Searchable Attributes
- title
- description
- content
- headings
- topics
- hierarchy

### Faceting Attributes
- product
- type
- topics
- hierarchy levels

### Ranking
1. Typo tolerance
2. Geo location
3. Word proximity
4. Filter matches
5. Attribute importance
6. Exact matches
7. Custom ranking (lastModified)

## Test Records

The indexer generates test records for each processed index in the `test-records/` directory. This feature helps with:
- Debugging index mappings
- Validating content processing
- Testing without Algolia credentials

### File Organization

For each index, two files are generated:
- `{index-name}.json`: Contains all processed records for the index
- `{index-name}.summary.json`: Contains metadata about the records:
  - Total record count
  - Record type distribution
  - Product distribution
  - Validation issues (if any)

### Local Development

Test records are automatically saved locally even if Algolia upload fails. This allows you to:
1. Develop without Algolia credentials
2. Validate record structure before uploading
3. Debug content processing issues

The `test-records/` directory is git-ignored to prevent committing large JSON files.

## Contributing

1. Code Style
   - Use TypeScript features
   - Follow existing patterns
   - Add JSDoc comments
   - Run `bun run format`

2. Testing
   - Test with sample content
   - Verify record structure
   - Check error handling

3. Performance
   - Monitor memory usage
   - Optimize batch sizes
   - Handle rate limits

4. Documentation
   - Update README
   - Document new features
   - Add code comments

## Future Enhancements

- [ ] Incremental updates
- [ ] Content validation rules
- [ ] Advanced error recovery
- [ ] Performance monitoring
- [ ] CI/CD integration
- [ ] Algolia synonyms support
- [ ] Custom ranking rules
- [ ] Content deduplication

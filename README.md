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

### Content Segmentation Approach

The system breaks down large pages into smaller, more focused segments:

1. Pages are analyzed to identify sections based on headings
2. Each section becomes a separate search record with its own objectID
3. ObjectIDs are generated as: `MD5(url#heading)`
4. Each record includes a fragment identifier (e.g., `#introduction`)
5. When users click search results, they go directly to the specific section

This approach has several advantages:
- More precise search results pointing to specific sections
- Better support for partial indexing with deterministic objectIDs
- Improved search relevance with more focused content
- Maintains standard web navigation patterns with URL fragments

When using search results in your application, make sure to use the full URL including fragments:

```typescript
// Import the utility function
import { constructUrlFromRecord } from './utils/url';

// Use it to construct complete URLs from search results
const completeUrl = constructUrlFromRecord(searchResult);
```

This ensures users are directed to the exact section of content they're looking for, rather than just the top of the page.

## Content Authoring Best Practices

The search indexer's effectiveness depends heavily on how content is authored. Following these guidelines will ensure optimal search results and user experience.

### Document Structure

- **Use clear heading hierarchy (H1 → H6)**: Proper heading structure is critical for accurate segmentation
  - Start with a single H1 for the page title
  - Use H2 for main sections, H3 for subsections, etc.
  - Avoid skipping heading levels (e.g., going from H2 to H4)
  - Don't use headings solely for styling purposes

- **Keep heading text unique and descriptive**: 
  - Use specific, descriptive headings that clearly indicate the section content
  - Avoid generic headings like "Introduction" or "Overview" for multiple sections
  - Include relevant keywords in headings for better search relevance

- **Structure content in discrete sections**:
  - Each section should focus on a single topic or concept
  - Aim for sections that can stand alone as search results
  - Include enough context within each section

### Content Quality

- **Front-load important information**:
  - Place key concepts and terms at the beginning of sections
  - Use descriptive first paragraphs that summarize the section
  - Include relevant keywords naturally in the first few sentences

- **Use descriptive link text**:
  - Avoid generic link text like "click here" or "read more"
  - Use keywords that describe the linked content
  - Link text should make sense out of context

- **Provide sufficient context**:
  - Don't rely on previous sections for understanding
  - Define acronyms and terms within each major section
  - Include enough information for each section to be useful on its own

### Metadata

- **Add comprehensive metadata**:
  - Include accurate page titles that reflect the content
  - Write descriptive meta descriptions (150-160 characters)
  - Use relevant keywords in meta tags
  - Add appropriate product tags and categories

- **Optimize Open Graph metadata**:
  - Include `og:title` and `og:description` tags
  - Add `og:image` with relevant visuals
  - Specify `og:type` appropriately

### Examples and Code

- **Label code examples clearly**:
  - Use descriptive headers for code blocks
  - Include language identifiers for syntax highlighting
  - Comment code thoroughly

- **Make examples self-contained**:
  - Include all necessary imports and dependencies
  - Explain prerequisites or assumptions
  - Show complete, working examples where possible

### Testing Your Content

Before publishing, test how your content will appear in search:

1. Check that heading hierarchy is logical and complete
2. Ensure each section contains sufficient standalone information
3. Verify that link text is descriptive and contextual
4. Review content with the indexer's segmentation logic in mind

Following these best practices will ensure your content is optimally indexed, resulting in:
- More accurate search results
- Better content segmentation
- Improved user experience through direct section navigation
- Higher search relevance and discoverability

## Development

This project uses:

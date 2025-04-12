# ADP Search Indexer

A specialized search indexer for [developer.adobe.com](https://developer.adobe.com), built by the Adobe Developer Platform (ADP) team. It processes documentation content and indexes it to Algolia to power the developer portal's search functionality.

## Overview

This tool enhances the developer.adobe.com search experience by:

- Processing documentation from multiple Adobe products
- Creating optimized search records for Algolia
- Maintaining content hierarchy and relationships
- Ensuring up-to-date search results using timestamp-based updates

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
npm run index:partial

# Full reindex (clear and rebuild indices completely)
npm run index:full
```

## Key Features

- 🚀 High-performance content processing with Node.js 22.6.0 and TypeScript
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
   Documentation is processed into search-optimized records with the following structure:
   ```typescript
   interface AlgoliaRecord {
     objectID: string;       // Unique identifier (MD5 hash of URL)
     url: string;            // Full URL including fragment identifier
     path: string;           // URL path component without fragment
     fragment?: string;      // Fragment identifier (anchor) if any
     indexName: string;      // Name of the Algolia index
     title: string;          // Content title
     description: string;    // Content description
     content: string;        // Processed content
     headings: string[];     // Array of headings found in content
     product: string;        // Adobe product identifier
     type: string;           // Content type (guide, reference, etc.)
     topics: string[];       // Array of topic tags
     lastModified: string;   // Content modification date
     sourceLastmod?: string; // Original sitemap lastmod timestamp
     indexedAt?: string;     // When this record was indexed
     hierarchy: {
       lvl0: string;         // Top level heading
       lvl1?: string;        // Second level heading
       lvl2?: string;        // Third level heading
     };
     metadata: {
       keywords: string;
       products: string;
       og_title: string;
       og_description: string;
       og_image: string;
     };
     structure?: {
       hasHeroSection: boolean;
       hasDiscoverBlocks: boolean;
       contentTypes: string[];
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
npm run index:partial
```

### Full Reindexing

Performs a complete rebuild of indices matched by your sitemap:

- Clears and rebuilds all matched indices from scratch
- Updates all records regardless of timestamps
- Best used when you need to ensure indices are completely refreshed
- Useful after schema changes or when troubleshooting issues

```bash
npm run index:full
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

For more control, you can use the command line arguments directly with the scripts:

```bash
# Test a specific URL
npm run analyze -- --test-url="https://developer.adobe.com/path/to/test"

# Filter to specific indices (comma-separated)
npm run index:partial -- --index-filter="photoshop,illustrator"

# Full reindex of specific indices
npm run index:full -- --index-filter="commerce"
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

## Common Team Tasks

This section provides guidance for common workflows when using the ADP Search Indexer locally.

### 1. Environment Setup

*   **`.env` File:** Copy `.env.example` to `.env` (`cp .env.example .env`). This file is ignored by Git (`.gitignore`) and should **never** be committed.
*   **`SITEMAP_URL`**: The full URL to the sitemap index file (e.g., `https://developer.adobe.com/sitemap.xml`).
*   **`BASE_URL`**: The base domain for the website being indexed (e.g., `https://developer.adobe.com`). This is used to correctly construct URLs if the sitemap contains relative paths (though typically it shouldn't) and potentially for other URL normalizations.
*   **Algolia Credentials (`ALGOLIA_APP_ID`, `ALGOLIA_API_KEY`)**:
    *   These are required only when running in `index` mode (`npm run index:partial` or `npm run index:full`).
    *   Obtain these from the Algolia dashboard for the relevant Adobe Developer site search application. You'll likely need Admin API Key privileges for indexing operations (creating indices, adding/deleting records, setting settings). Consult with the project maintainers if you need access.
*   **`ALGOLIA_INDEX_NAME`**: (Optional) A base name for indices. If using an `INDEX_PREFIX`, the final index name might be constructed from this prefix and the name defined in the product mapping. Check the Algolia dashboard for existing index naming conventions.
*   **`PRODUCT_MAPPING_URL`**: (Optional) Defaults to the production mapping file hosted on GitHub (`https://raw.githubusercontent.com/AdobeDocs/search-indices/refs/heads/main/product-index-map.json`). You generally don't need to change this unless you are testing changes to the mapping file itself by pointing to a local file path (`file:///path/to/your/local/product-index-map.json`) or a different remote URL.

### 2. Indexing Content (Partial Update - Recommended Daily Task)

This is the standard mode for keeping Algolia up-to-date with the latest content changes based on the sitemap's `lastmod` timestamps.

1.  Ensure your `.env` file has the correct `SITEMAP_URL`, `BASE_URL`, and Algolia credentials (`ALGOLIA_APP_ID`, `ALGOLIA_API_KEY`).
2.  Run the partial index command:
    ```bash
    npm run index:partial
    ```
3.  **What it does:**
    *   Fetches the sitemap.
    *   Compares `lastmod` timestamps in the sitemap with `sourceLastmod` in existing Algolia records.
    *   **Adds/Updates:** Records for new URLs or URLs with a newer `lastmod` timestamp.
    *   **Deletes:** Records for URLs present in Algolia but *not* found in the current sitemap (for the matched indices).
    *   **Ignores:** Records that haven't changed (`lastmod` is the same or older).
    *   **Preserves:** Records in indices that are *not* referenced by the current product mapping file (prevents accidental deletion of unrelated indices).

### 3. Indexing Content (Full Reindex)

This mode completely rebuilds Algolia indices based on the current sitemap and product mapping. Use this cautiously.

1.  Ensure your `.env` file is configured correctly (Sitemap, Base URL, Algolia credentials).
2.  Run the full reindex command:
    ```bash
    npm run index:full
    ```
3.  **What it does:**
    *   Fetches the sitemap.
    *   **Clears:** *Completely removes all records* from any Algolia index that matches an index name found in the `product-index-map.json` for the processed URLs.
    *   **Rebuilds:** Indexes all content found in the sitemap for those matched indices from scratch.
    *   **Use Cases:** Needed after significant changes to content structure, mapping logic, Algolia schema/settings, or to recover from inconsistent index states. **Avoid running this routinely.**

### 4. Analyzing Sitemap & Mappings (No Indexing)

This mode is useful for checking how URLs map to products/indices based on the current `PRODUCT_MAPPING_URL` without actually fetching content or talking to Algolia.

1.  Ensure your `.env` file has the correct `SITEMAP_URL`. `BASE_URL` and Algolia keys are not strictly needed but should be present.
2.  Run the analyze command:
    ```bash
    npm run analyze
    ```
3.  Add `--verbose` for more detailed output, including skipped URLs and path segment analysis:
    ```bash
    npm run analyze -- --verbose
    ```
4.  **What it does:**
    *   Fetches the sitemap.
    *   Applies exclusion rules (`src/services/product-mapping.ts`).
    *   Uses the product mapping file (`PRODUCT_MAPPING_URL`) to determine which index each valid URL belongs to.
    *   Prints a summary of total URLs, URLs to process/skip, and (in verbose mode) a breakdown by matched index, top path segments, and potential recommendations for unmapped paths.

### 5. Exporting Data Locally (Debugging/Testing)

This mode processes the sitemap and fetches content, creating the Algolia record structures, but saves them as JSON files locally instead of sending them to Algolia. Useful for debugging content extraction, segmentation, or record generation logic.

1.  Ensure your `.env` file has the correct `SITEMAP_URL` and `BASE_URL`. Algolia keys are not needed.
2.  Run the export command:
    ```bash
    npm run export
    ```
3.  **What it does:**
    *   Fetches the sitemap and analyzes URLs.
    *   Fetches content for valid URLs.
    *   Generates Algolia record structures (including segmentation).
    *   Saves the generated records and index settings into JSON files within the `indexed-content/` directory (this directory is gitignored). Each file corresponds to an index (e.g., `indexed-content/photoshop.json`).
    *   You can then inspect these JSON files to verify the data being generated before sending it to Algolia.

### 6. Updating the Product Index Map

When new products are added to developer.adobe.com or existing ones change their URL structure significantly, the product index map needs updating.

1.  **Location:** The primary map is maintained in the `AdobeDocs/search-indices` repository: [`product-index-map.json`](https://github.com/AdobeDocs/search-indices/blob/main/product-index-map.json).
2.  **Structure:** The file is an array of products, each containing `productName` and an array of `productIndices`. Each `productIndex` has an `indexName` (the Algolia index) and an `indexPathPrefix` (the URL path used for matching).
    ```json
    [
      {
        "productName": "Photoshop",
        "productIndices": [
          {
            "indexName": "photoshop",
            "indexPathPrefix": "/photoshop"
          },
          {
            "indexName": "photoshop-api",
            "indexPathPrefix": "/photoshop/api"
          }
        ]
      },
      // ... other products
    ]
    ```
3.  **Process:**
    *   Changes should be proposed via a Pull Request to the `AdobeDocs/search-indices` repository.
    *   Coordinate with the owners of that repository and the ADP team.
    *   Once merged, the indexer (both this local version and the serverless function) will automatically pick up the changes on the next run, as it fetches the map from the default `PRODUCT_MAPPING_URL`.
    *   Run `npm run analyze -- --verbose` locally after changes are merged to verify the new mappings are working as expected.

### 7. Standalone vs. Serverless Function

*   **This Repository (`adp-search-indexer`):** This codebase is designed for local development, testing, debugging, analysis, and potentially manual full re-indexing runs.
*   **Serverless Counterpart (`developer-website-search-engine`):** The core indexing logic (partial updates) is also implemented as an Adobe App Builder serverless function in a separate repository: [adobe-developer-platform/developer-website-search-engine](https://github.com/adobe-developer-platform/developer-website-search-engine). This function typically runs on an automated schedule (e.g., daily cron job) to perform the standard partial updates for production.
*   **Synchronization:** Currently, fixes and features related to the core indexing logic might need to be implemented and tested here first, and then mirrored in the serverless function repository. Coordinate with **Misha** for any changes needed in the serverless function codebase. This separation exists for historical and deployment reasons; a future merge might occur.

## Development

This project uses Node.js 22.6.0 and TypeScript with the following tools:

- TypeScript for type-safe development
- tsup for fast bundling and compilation
- ESLint for code quality and consistency
- Prettier for consistent code formatting

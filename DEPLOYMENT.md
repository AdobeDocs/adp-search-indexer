# Deployment Guide

This document provides instructions for deploying the ADP Search Indexer to production environments.

## Prerequisites

- Node.js 22.6.0 (required for Adobe I/O Runtime compatibility)
- Access to your Algolia account
- Production API keys for Algolia

## Environment Setup

1. Create a production `.env` file based on the example:

```bash
cp .env.example .env.production
```

2. Configure your production environment variables:

```
# Sitemap Configuration
SITEMAP_URL=https://developer.adobe.com/sitemap.xml
BASE_URL=https://developer.adobe.com

# Algolia Configuration
ALGOLIA_APP_ID=your_production_app_id
ALGOLIA_API_KEY=your_production_admin_api_key
ALGOLIA_INDEX_NAME=prod_index_name_prefix

# Application Configuration
LOG_LEVEL=info
BATCH_SIZE=50
MAX_CONCURRENT_REQUESTS=10

# Indexing Configuration
PARTIAL=true
```

## Production Deployment Options

### Option 1: Scheduled Partial Updates (Recommended)

For regular maintenance, use partial updates which only update records when content has changed (based on sitemap's `lastmod` timestamps):

```bash
# Build the application
npm run build

# Run with production env
NODE_ENV=production npm run partial-update
```

This approach:
- Only updates records for content that has changed
- Removes records for URLs no longer in the sitemap
- Preserves existing records that haven't changed
- Preserves records in indices not matched by your sitemap

### Option 2: Force Update

If you need to ensure all content is refreshed (regardless of timestamps):

```bash
NODE_ENV=production npm run force-update
```

### Option 3: Full Reindex

For a complete rebuild of matched indices:

```bash
NODE_ENV=production npm run full-reindex
```

**⚠️ Warning**: This will clear and rebuild all matched indices. Only use when necessary.

## Setting Up Automated Indexing

### Cron Job Example

For a daily update at 2 AM:

```bash
0 2 * * * cd /path/to/indexer && NODE_ENV=production npm run partial-update >> /var/log/adp-indexer.log 2>&1
```

### Docker Example

```bash
docker run --env-file .env.production -v $(pwd)/logs:/app/logs adobe/adp-search-indexer:latest npm run partial-update
```

## Monitoring

After deployment, check:

1. The application logs for any issues
2. Algolia dashboard to confirm records were updated
3. Search functionality on your site

## Troubleshooting

### Common Issues

- **API Key Permissions**: Ensure your Algolia API key has write permissions
- **Rate Limiting**: If hitting rate limits, reduce `MAX_CONCURRENT_REQUESTS` in your .env file
- **Memory Issues**: For large sitemaps, ensure your environment has sufficient memory

### Recovery Steps

If indexing fails:

1. Check logs for specific errors
2. Fix any configuration issues
3. Run with the `--verbose` flag for detailed output
4. If necessary, run a force update to resync indices:

```bash
NODE_ENV=production npm start -- --index --force --verbose
```

## Additional Resources

- [Adobe I/O Runtime Documentation](https://developer.adobe.com/runtime/docs/guides/)
- [Node.js on Adobe I/O Runtime](https://developer.adobe.com/runtime/docs/guides/reference/runtimes/) 
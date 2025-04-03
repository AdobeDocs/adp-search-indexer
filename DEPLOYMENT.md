# Deployment Guide

This document provides instructions for deploying the ADP Search Indexer to production environments.

## Prerequisites

- Node.js 22.6.0 (required version for Adobe I/O Runtime compatibility)
- npm 10.x or newer
- Access to your Algolia account with admin privileges
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
INDEX_PREFIX=prod_  # Optional prefix for production indices

# Indexing Configuration
PARTIAL=true
```

## Build for Production

Before deployment, build the application:

```bash
npm run build:clean
```

This creates optimized JavaScript files in the `dist/` directory.

## Production Deployment Options

### Option 1: Scheduled Partial Updates (Recommended)

For regular maintenance, use partial updates which only update records when content has changed (based on sitemap's `lastmod` timestamps):

```bash
# Run with production env
NODE_ENV=production npm run index:partial
```

This approach:

- Only updates records for content that has changed
- Removes records for URLs no longer in the sitemap
- Preserves existing records that haven't changed
- Preserves records in indices not matched by your sitemap

### Option 2: Full Reindex

For a complete rebuild of matched indices:

```bash
NODE_ENV=production npm run index:full
```

This option:
- Clears and rebuilds all matched indices from scratch
- Updates all records regardless of timestamps
- Best used when you need to ensure indices are completely refreshed
- Useful after schema changes or when troubleshooting issues

**⚠️ Warning**: This will clear and rebuild all matched indices. Only use when necessary.

## Setting Up Automated Indexing

### Cron Job Example

For a daily update at 2 AM:

```bash
0 2 * * * cd /path/to/indexer && NODE_ENV=production npm run index:partial >> /var/log/adp-indexer.log 2>&1
```

### Docker Example

```bash
docker run --env-file .env.production -v $(pwd)/logs:/app/logs adobe/adp-search-indexer:latest npm run index:partial
```

## Monitoring and Maintenance

After deployment, check:

1. The application logs for any issues:
   ```bash
   tail -f /var/log/adp-indexer.log
   ```

2. Algolia dashboard to confirm records were updated

3. Search functionality on your site using the dev tools to inspect search requests and responses

### Verification

Use the built-in verification tool to check your indices:

```bash
NODE_ENV=production npm run verify
```

This will output statistics about your indices and help identify any potential issues.

## Troubleshooting

### Common Issues

- **API Key Permissions**: Ensure your Algolia API key has write permissions for all indices
- **Rate Limiting**: If hitting rate limits, reduce `MAX_CONCURRENT_REQUESTS` in your .env file
- **Memory Issues**: For large sitemaps, ensure your environment has sufficient memory (at least 4GB recommended)
- **Timeout Errors**: Increase the request timeout in your .env file if processing large pages

### Recovery Steps

If indexing fails:

1. Check logs for specific errors
2. Fix any configuration issues
3. Run with the `--verbose` flag for detailed output:
   ```bash
   NODE_ENV=production npm run index:partial -- --verbose
   ```
4. If necessary, run a full reindex to completely rebuild indices:
   ```bash
   NODE_ENV=production npm run index:full -- --verbose
   ```

## Security Considerations

- Store your `.env.production` file securely and never commit it to version control
- Use an Algolia API key with the minimum required permissions
- Consider using environment-specific API keys for each deployment environment
- Rotate API keys regularly according to your security policies

## Additional Resources

- [Adobe I/O Runtime Documentation](https://developer.adobe.com/runtime/docs/guides/)
- [Node.js on Adobe I/O Runtime](https://developer.adobe.com/runtime/docs/guides/reference/runtimes/)
- [Algolia Documentation](https://www.algolia.com/doc/)

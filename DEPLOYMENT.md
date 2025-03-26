# Deployment Guide

This document provides instructions for deploying the ADP Search Indexer to Adobe I/O Runtime.

## Prerequisites

- Node.js 22.6.0 (use nvm to manage Node.js versions)
- Adobe I/O CLI
- Adobe I/O Runtime credentials

## Setup Environment

1. Install the Adobe I/O CLI and Runtime plugin:

```bash
npm install -g @adobe/aio-cli
aio plugins:install @adobe/aio-cli-plugin-runtime
```

2. Log in to Adobe I/O Runtime:

```bash
aio auth:login
aio runtime:namespace:list
```

## Build and Deploy

1. Build the project:

```bash
npm run build
```

2. Test locally with export mode:

```bash
npm run export
```

3. Verify the exported indices:

```bash
npm run verify
```

4. Create a distribution package:

```bash
npm run dist
```

5. Deploy to Adobe I/O Runtime:

```bash
cd dist
aio runtime:action:create adp-search-indexer index.js --kind nodejs:22 --web true
```

## Configuration 

Environment variables can be set in the Adobe I/O Runtime console or via the CLI:

```bash
aio runtime:action:update adp-search-indexer --param ALGOLIA_APP_ID "your-app-id" --param ALGOLIA_API_KEY "your-api-key"
```

## Running the Indexer

To trigger the indexer, make an HTTP request to the deployed action:

```bash
curl -X POST "https://runtime.adobe.io/api/v1/web/{your-namespace}/default/adp-search-indexer" \
  -H "Content-Type: application/json" \
  -d '{"base_url": "https://developer.adobe.com", "mode": "index"}'
```

## Monitoring

View logs and metrics for the action:

```bash
aio runtime:activation:logs -l 10
```

## Troubleshooting

- **Cold Start Issues**: Adobe I/O Runtime actions have cold start latency. For long-running indexing tasks, consider breaking up the work into smaller chunks.
- **Memory Limits**: If you hit memory limits, try adjusting the batch size or concurrent requests in your configuration.
- **Timeouts**: Actions have a maximum timeout of 60 seconds. For large sitemaps, implement pagination or chunking.
- **Verify Local Results**: If having issues with Algolia indexing, try running with `npm run export` and then `npm run verify` locally to inspect the records that would be created.

## Additional Resources

- [Adobe I/O Runtime Documentation](https://developer.adobe.com/runtime/docs/guides/)
- [Node.js on Adobe I/O Runtime](https://developer.adobe.com/runtime/docs/guides/reference/runtimes/) 
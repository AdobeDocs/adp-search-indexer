/**
 * Utility functions for handling URLs and fragments
 */

/**
 * Converts a heading text to a URL-friendly fragment identifier.
 * Ensures consistent fragment generation for the same content.
 *
 * @param heading - The heading text to convert
 * @returns A URL-friendly fragment identifier starting with #
 */
export function headingToFragmentId(heading: string): string {
  if (!heading) return '';

  return (
    '#' +
    heading
      .toLowerCase()
      // Strip HTML tags if any remain
      .replace(/<[^>]+>/g, '')
      // Remove diacritics/accents
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Replace common punctuation with nothing
      .replace(/[,.;:'"!?()[\]{}/\\]/g, '')
      // Replace special characters with hyphens
      .replace(/[\s+&*%$#@=_|<>^~`]+/g, '-')
      // Remove any consecutive hyphens
      .replace(/-+/g, '-')
      // Remove leading and trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Normalizes a URL for consistent handling and comparison.
 *
 * @param url - The URL to normalize
 * @returns A consistently formatted URL
 */
export function normalizeUrl(url: string): string {
  try {
    const normalized = new URL(url);

    // Remove trailing slash
    normalized.pathname = normalized.pathname.replace(/\/+$/, '');

    // Remove default ports
    if (
      (normalized.protocol === 'http:' && normalized.port === '80') ||
      (normalized.protocol === 'https:' && normalized.port === '443')
    ) {
      normalized.port = '';
    }

    // Remove unnecessary query parameters
    const cleanParams = new URLSearchParams();
    normalized.searchParams.forEach((value, key) => {
      if (!['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].includes(key)) {
        cleanParams.append(key, value);
      }
    });

    normalized.search = cleanParams.toString();

    // Handle fragments consistently
    if (normalized.hash) {
      // Make sure fragment starts with # and uses our consistent format
      const rawFragment = normalized.hash.replace(/^#/, '');
      if (rawFragment) {
        normalized.hash = headingToFragmentId(rawFragment);
      } else {
        normalized.hash = '';
      }
    }

    return normalized.toString();
  } catch (error: unknown) {
    // Log error and return the original URL
    console.warn(
      `URL normalization failed for: ${url}. Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return url;
  }
}

/**
 * Constructs a complete URL from a record, ensuring that fragment identifiers are preserved.
 *
 * @param record - The AlgoliaRecord containing URL information
 * @param record.url - The full URL if available 
 * @param record.path - The path component of the URL
 * @param record.fragment - The fragment identifier (hash) of the URL
 * @returns The complete URL with fragment if available
 */
export function constructUrlFromRecord(record: { url?: string; path?: string; fragment?: string }): string {
  // If the full URL is available and contains a fragment, use it directly
  if (record.url && record.url.includes('#')) {
    return record.url;
  }

  // If we have a full URL without a fragment but a separate fragment field, combine them
  if (record.url && record.fragment) {
    // Avoid duplicate fragments if the URL already has one
    if (record.url.includes('#')) {
      return record.url;
    }
    return `${record.url}${record.fragment}`;
  }

  // If we only have a path and fragment, construct the URL
  if (record.path && record.fragment) {
    // This assumes the base URL is known in the context where this function is called
    // In a real application, you might need to pass the base URL as a parameter
    return `${record.path}${record.fragment}`;
  }

  // If we only have a URL, use it
  if (record.url) {
    return record.url;
  }

  // If we only have a path, use it
  if (record.path) {
    return record.path;
  }

  // If we have nothing, return an empty string
  return '';
}

/**
 * Extracts the fragment identifier from a URL.
 *
 * @param url - The URL to extract the fragment from
 * @returns The fragment identifier or undefined if none exists
 */
export function extractFragmentFromUrl(url: string): string | undefined {
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    return url.substring(hashIndex);
  }
  return undefined;
}

/**
 * Removes the fragment identifier from a URL.
 *
 * @param url - The URL to remove the fragment from
 * @returns The URL without the fragment
 */
export function removeFragmentFromUrl(url: string): string {
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    return url.substring(0, hashIndex);
  }
  return url;
}

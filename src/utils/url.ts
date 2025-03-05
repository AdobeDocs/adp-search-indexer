/**
 * Utility functions for handling URLs and fragments
 */

/**
 * Converts a heading text to a URL-friendly fragment identifier.
 * 
 * @param heading - The heading text to convert
 * @returns A URL-friendly fragment identifier
 */
export function headingToFragmentId(heading: string): string {
  if (!heading) return '';
  
  return '#' + heading
    .toLowerCase()
    // Replace commas, periods, slashes and other punctuation with nothing
    .replace(/[,.;:'"!?()[\]{}/\\]/g, '')
    // Replace spaces, plus signs, and ampersands with hyphens
    .replace(/[\s+&]+/g, '-')
    // Remove any consecutive hyphens
    .replace(/-+/g, '-')
    // Remove leading and trailing hyphens
    .replace(/^-+|-+$/g, '');
}

/**
 * Constructs a complete URL from a record, ensuring that fragment identifiers are preserved.
 * 
 * @param record - The AlgoliaRecord containing URL information
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
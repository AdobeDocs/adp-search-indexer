/**
 * Utilities for consistent date handling across the application
 */

/**
 * Normalizes a date to ISO format (YYYY-MM-DD)
 * Handles various date formats and ensures consistent output
 * Returns current date as fallback if input is invalid
 * 
 * @param date - The date to normalize (string, Date, or undefined)
 * @param provideFallback - Whether to provide today's date as fallback (default: true)
 * @returns Normalized date in ISO format YYYY-MM-DD
 */
export function normalizeDate(date?: string | Date, provideFallback = true): string {
  if (!date && !provideFallback) {
    return '';
  }
  
  try {
    // If no date provided and fallback is enabled, use current date
    if (!date) {
      return new Date().toISOString().split('T')[0];
    }
    
    // If already a Date object, format it
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    
    // Check if it's a timestamp (all digits)
    if (/^\d+$/.test(date)) {
      return new Date(parseInt(date, 10)).toISOString().split('T')[0];
    }
    
    // Convert string date to Date object and format
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return provideFallback ? new Date().toISOString().split('T')[0] : '';
    }
    
    return dateObj.toISOString().split('T')[0];
  } catch (error: unknown) {
    // Log the error and return fallback
    if (provideFallback) {
      return new Date().toISOString().split('T')[0];
    } else {
      console.warn(`Date normalization failed: ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  }
}

/**
 * Returns the current timestamp in ISO format
 * 
 * @returns Current timestamp in ISO format
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Compares two dates and returns true if date1 is more recent than date2
 * 
 * @param date1 - First date to compare
 * @param date2 - Second date to compare
 * @returns True if date1 is more recent than date2
 */
export function isMoreRecent(date1?: string | Date, date2?: string | Date): boolean {
  if (!date1) return false;
  if (!date2) return true;
  
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    
    return d1.getTime() > d2.getTime();
  } catch (error: unknown) {
    console.warn(`Date comparison failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Determines if a date is in the future
 * 
 * @param date - Date to check
 * @returns True if the date is in the future
 */
export function isFutureDate(date?: string | Date): boolean {
  if (!date) return false;
  
  try {
    const checkDate = new Date(date);
    const now = new Date();
    
    return checkDate.getTime() > now.getTime();
  } catch (error: unknown) {
    console.warn(`Future date check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
} 
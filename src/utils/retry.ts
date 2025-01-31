interface RetryOptions {
  maxAttempts?: number;
  delay?: number;
  backoff?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 3,
  delay: 1000,
  backoff: 2,
  shouldRetry: (error: unknown) => {
    if (error instanceof Error) {
      // Don't retry 404s
      if (error.message.includes('Not Found')) {
        return false;
      }
      // Retry on network errors and 5xx
      return error.message.includes('Failed to fetch') || 
             error.message.includes('500') ||
             error.message.includes('502') ||
             error.message.includes('503') ||
             error.message.includes('504');
    }
    return false;
  },
};

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;
  let delay = opts.delay;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === opts.maxAttempts || !opts.shouldRetry(error)) {
        throw error;
      }

      console.warn(
        `Attempt ${attempt} failed, retrying in ${delay}ms:`,
        error instanceof Error ? error.message : error
      );

      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= opts.backoff;
    }
  }

  throw lastError;
} 
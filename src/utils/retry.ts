interface RetryOptions {
  maxAttempts?: number;
  delay?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const delay = options.delay ?? 1000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
} 
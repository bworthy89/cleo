/**
 * Generic retry wrapper with exponential backoff.
 * Use for any network call that may transiently fail.
 */
export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoff?: 'exponential' | 'linear' | 'fixed';
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoff = 'exponential',
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxAttempts) break;

      const delay =
        backoff === 'exponential'
          ? initialDelayMs * Math.pow(2, attempt - 1)
          : backoff === 'linear'
            ? initialDelayMs * attempt
            : initialDelayMs;

      if (onRetry) onRetry(attempt, err);

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

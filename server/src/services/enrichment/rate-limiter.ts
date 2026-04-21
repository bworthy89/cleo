/**
 * Shared promise-chain serializer with minimum interval between calls.
 * Extracted from DefaultEnrichmentFetcher so each source fetcher can use
 * its own queue without duplicating the class.
 */
export class RateLimitedFetcher {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await new Promise(r => setTimeout(r, this.minIntervalMs));
      return fn();
    });
    this.queue = result.catch(() => {});
    return result as Promise<T>;
  }
}

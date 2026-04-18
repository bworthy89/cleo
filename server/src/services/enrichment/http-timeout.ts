export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * fetch() wrapper with AbortController-based timeout. Default timeout is 10s
 * to match our per-call budget for enrichment API requests.
 */
export async function fetchWithTimeout(
  url: string | URL,
  opts: FetchWithTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, fetchImpl = fetch, ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_ENRICHMENT_TIMEOUT_MS = 10_000;

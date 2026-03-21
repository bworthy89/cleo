import { getIdToken } from './AuthService';
import { withRetry } from '../utils/retry';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL
  ?? 'https://api.worthymedia.tech';

/**
 * Fetch wrapper that attaches the Firebase ID token to every request.
 * Always gets a fresh token — Firebase handles refresh automatically.
 * Retries transient failures (5xx, network errors) up to 3 times with exponential backoff.
 */
export async function authenticatedFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (!token) {
    throw new Error('authenticatedFetch: no authenticated user — cannot make API request');
  }

  headers['Authorization'] = `Bearer ${token}`;

  return withRetry(
    async () => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
      });

      // Retry on server errors and rate limits, not on client errors
      if (response.status >= 500 || response.status === 429) {
        throw new Error(`Server error ${response.status} on ${path}`);
      }

      return response;
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      backoff: 'exponential',
      onRetry: (attempt, err) => {
        console.warn(`[API] Retry ${attempt} for ${path}:`, err);
      },
    }
  );
}

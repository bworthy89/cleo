import { getIdToken } from './AuthService';

export const API_BASE_URL = 'https://feisty-exploration-production-064e.up.railway.app';

/**
 * Fetch wrapper that attaches the Firebase ID token to every request.
 * Always gets a fresh token — Firebase handles refresh automatically.
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

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });
}

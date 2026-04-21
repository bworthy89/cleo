import { authenticatedFetch, API_BASE_URL } from '../services/api';
import type { Manifest } from './BroadcastPlayer.types';

// Chunked base64 encoder that works in Node (Jest) and React Native.
// Avoids pulling Node's `buffer` module, which Metro can't bundle.
function arrayBufferToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return globalThis.btoa(binary);
}

export interface CreateBroadcastRequest {
  playlistId: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  userContext: {
    timeOfDay: string;
    dayOfWeek: string;
    firstTimeUser: boolean;
    lastSessionSummary?: string;
    tracksRecentlyPlayed?: string[];
    listenerName?: string;
  };
  tracks: Array<{
    id: string; title: string; artistName: string;
    albumTitle: string; duration: number; artworkUrl?: string;
    genreNames?: string[];
    isrc?: string;
  }>;
  /** Ask ONAY sets this to true — Groq already curated the sequence, so
   *  the server should NOT re-order via its deterministic sequencer. */
  preserveOrder?: boolean;
}

export interface CreateBroadcastResponse {
  manifest: Manifest;
  firstSegmentUrls: string[];
}

function isAbsoluteUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/**
 * Filter raw MusicKit tracks down to ones the bake server will accept and
 * normalize borderline fields. Matches the Zod schema on `POST /broadcast/create`:
 *   id/title/artistName non-empty, duration > 0, artworkUrl valid http(s) URL,
 *   strings within length caps.
 *
 * Apple Music occasionally returns tracks with `duration === 0` (regional
 * unavailability), empty or malformed `artworkUrl`, or titles longer than
 * the server's 200-char cap. Filtering here prevents a 400 error response
 * that would otherwise surface as "invalid request" to the user with no
 * actionable signal.
 */
export function sanitizeTracksForBake(
  input: Array<{
    id: string; title: string; artistName: string;
    albumTitle?: string | null; duration?: number | null;
    artworkUrl?: string | null; genreNames?: string[] | null;
    isrc?: string | null;
  }>,
): CreateBroadcastRequest['tracks'] {
  return input
    .filter(t =>
      t.id && t.id.length <= 80
      && t.title && t.title.length > 0
      && t.artistName && t.artistName.length > 0
      && typeof t.duration === 'number' && t.duration > 0 && t.duration <= 7200,
    )
    .map(t => ({
      id: t.id,
      title: t.title.slice(0, 200),
      artistName: t.artistName.slice(0, 200),
      albumTitle: (t.albumTitle ?? '').slice(0, 200),
      duration: t.duration as number,
      artworkUrl: t.artworkUrl && isAbsoluteUrl(t.artworkUrl) && t.artworkUrl.length <= 2048
        ? t.artworkUrl
        : undefined,
      genreNames: t.genreNames
        ? t.genreNames.filter(g => g && g.length <= 100).slice(0, 10)
        : undefined,
      // ISRC is 12 chars: 2-letter country + 3-alphanumeric registrant + 7 digits
      // (5-digit year-of-reference + designation). Normalize first (strip
      // whitespace/spaces/hyphens, uppercase) so variants like "us-rc1-76-07839"
      // or "USRC1 7607839" still validate, then test canonical shape. Reject
      // anything that still doesn't match so the server's Zod regex passes.
      isrc: (() => {
        if (!t.isrc) return undefined;
        const normalized = t.isrc.trim().replace(/[\s-]/g, '').toUpperCase();
        return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized) ? normalized : undefined;
      })(),
    }));
}

export class BroadcastManifestClient {
  async createBroadcast(req: CreateBroadcastRequest): Promise<CreateBroadcastResponse> {
    const res = await authenticatedFetch('/broadcast/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : '';
      throw new Error(`createBroadcast failed: ${res.status} ${msg}`);
    }
    return (await res.json()) as CreateBroadcastResponse;
  }

  async fetchManifest(id: string): Promise<Manifest> {
    const res = await authenticatedFetch(`/broadcast/${id}/manifest`);
    if (!res.ok) throw new Error(`fetchManifest failed: ${res.status}`);
    return (await res.json()) as Manifest;
  }

  async fetchSegmentAudio(urlOrPath: string): Promise<string> {
    // URL dispatch:
    //  - Relative path → authenticatedFetch (JWT attached, API_BASE_URL prepended).
    //  - Absolute URL at our own API host (local-FS dev mode) → strip the origin
    //    and authenticatedFetch, since /broadcast-asset/* requires requireAuth.
    //  - Absolute URL at a different host (R2 presigned) → plain fetch; the
    //    URL carries its own auth in the query string.
    const res = isAbsoluteUrl(urlOrPath)
      ? urlOrPath.startsWith(API_BASE_URL)
        ? await authenticatedFetch(urlOrPath.slice(API_BASE_URL.length))
        : await fetch(urlOrPath)
      : await authenticatedFetch(urlOrPath);
    if (!res.ok) throw new Error(`fetchSegmentAudio failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    return arrayBufferToBase64(buffer);
  }
}

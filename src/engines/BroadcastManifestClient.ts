import { authenticatedFetch } from '../services/api';
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
  }>;
}

export interface CreateBroadcastResponse {
  manifest: Manifest;
  firstSegmentUrls: string[];
}

function isAbsoluteUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
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
    // R2 presigned URLs (and any other absolute URL) carry their own auth in
    // the query string — fetch them directly. Relative paths point at the
    // API server's local-FS asset mount (dev) and need our JWT.
    const res = isAbsoluteUrl(urlOrPath)
      ? await fetch(urlOrPath)
      : await authenticatedFetch(urlOrPath);
    if (!res.ok) throw new Error(`fetchSegmentAudio failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    return arrayBufferToBase64(buffer);
  }
}

import { Buffer } from 'buffer';
import { authenticatedFetch } from '../services/api';
import type { Manifest } from './BroadcastPlayer.types';

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
  }>;
}

export interface CreateBroadcastResponse {
  manifest: Manifest;
  firstSegmentUrls: string[];
}

function toRelativePath(urlOrPath: string): string {
  if (urlOrPath.startsWith('/')) return urlOrPath;
  try {
    const parsed = new URL(urlOrPath);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  }
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
    const path = toRelativePath(urlOrPath);
    const res = await authenticatedFetch(path);
    if (!res.ok) throw new Error(`fetchSegmentAudio failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  }
}

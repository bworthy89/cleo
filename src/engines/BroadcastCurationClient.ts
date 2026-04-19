import { authenticatedFetch } from '../services/api';
import type { Manifest, ManifestTrack } from './BroadcastPlayer.types';
import type { SlotKey, DayOfWeek } from '../config/tonightOnOnay';

export interface FeaturedBroadcast {
  id: string;
  slot?: SlotKey;
  themeDay?: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
}

export interface PublishFeaturedRequest {
  id: string;
  slot?: SlotKey;
  themeDay?: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  tracks: ManifestTrack[];
}

export class BroadcastCurationClient {
  async listFeatured(): Promise<FeaturedBroadcast[]> {
    try {
      const res = await authenticatedFetch('/broadcast/featured');
      if (!res.ok) return [];
      const body = (await res.json()) as { broadcasts?: FeaturedBroadcast[] };
      return body.broadcasts ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Curator-only: bake a featured broadcast and register it so every user
   * sees it on the home screen. Gated on the server by CURATOR_EMAILS.
   */
  async publishFeatured(input: PublishFeaturedRequest): Promise<{ id: string; broadcastId: string }> {
    const res = await authenticatedFetch('/broadcast/featured/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : '';
      throw new Error(`publishFeatured failed: ${res.status} ${msg}`);
    }
    return (await res.json()) as { id: string; broadcastId: string };
  }
}

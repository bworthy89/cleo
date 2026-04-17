import { authenticatedFetch } from '../services/api';
import type { Manifest } from './BroadcastPlayer.types';

export interface FeaturedBroadcast {
  id: string;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
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
}

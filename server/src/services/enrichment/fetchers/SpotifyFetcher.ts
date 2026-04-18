import type { EnrichmentRecord } from '../EnrichmentCache';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

export interface SpotifyFetcherDeps {
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export class SpotifyFetcher {
  private token: CachedToken | null = null;

  constructor(private readonly deps: SpotifyFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    const id = this.deps.clientId ?? process.env.SPOTIFY_CLIENT_ID;
    const secret = this.deps.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) return null;
    const token = await this.ensureToken(id, secret);
    if (!token) return null;
    const trackId = await this.searchTrack(title, artist, token);
    if (!trackId) return null;
    const features = await this.fetchFeatures(trackId, token);
    if (!features) return null;
    return { audioFeatures: features, source: 'spotify' };
  }

  private async ensureToken(id: string, secret: string): Promise<string | null> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };
    return this.token.value;
  }

  private async searchTrack(title: string, artist: string, token: string): Promise<string | null> {
    const q = encodeURIComponent(`track:${title} artist:${artist}`);
    const res = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`,
      {
        timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
        fetchImpl: this.deps.fetchImpl,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      tracks?: { items?: Array<{ id: string }> };
    };
    return data.tracks?.items?.[0]?.id ?? null;
  }

  private async fetchFeatures(trackId: string, token: string): Promise<NonNullable<EnrichmentRecord['audioFeatures']> | null> {
    const res = await fetchWithTimeout(
      `https://api.spotify.com/v1/audio-features/${encodeURIComponent(trackId)}`,
      {
        timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
        fetchImpl: this.deps.fetchImpl,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      tempo?: number; valence?: number; energy?: number;
      danceability?: number; key?: number; mode?: number;
    };
    if (
      data.tempo === undefined || data.valence === undefined || data.energy === undefined ||
      data.danceability === undefined || data.key === undefined || data.mode === undefined
    ) return null;
    return {
      tempo: data.tempo,
      valence: data.valence,
      energy: data.energy,
      danceability: data.danceability,
      key: data.key,
      mode: data.mode,
    };
  }
}

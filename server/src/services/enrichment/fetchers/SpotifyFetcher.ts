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

interface SearchResolution {
  artistId: string;
  albumId: string;
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
    const resolved = await this.searchTrack(title, artist, token);
    if (!resolved) return null;
    const [artistInfo, albumInfo] = await Promise.all([
      this.fetchArtist(resolved.artistId, token).catch(() => null),
      this.fetchAlbum(resolved.albumId, token).catch(() => null),
    ]);
    const out: Partial<EnrichmentRecord> = {};
    if (artistInfo?.genres.length) out.genre = artistInfo.genres[0];
    if (albumInfo?.label) out.albumLabel = albumInfo.label;
    if (albumInfo?.releaseYear) out.releaseYear = albumInfo.releaseYear;
    if (Object.keys(out).length === 0) return null;
    out.source = 'spotify';
    return out;
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

  private async searchTrack(title: string, artist: string, token: string): Promise<SearchResolution | null> {
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
      tracks?: { items?: Array<{
        artists?: Array<{ id: string }>;
        album?: { id: string };
      }> };
    };
    const item = data.tracks?.items?.[0];
    const artistId = item?.artists?.[0]?.id;
    const albumId = item?.album?.id;
    if (!artistId || !albumId) return null;
    return { artistId, albumId };
  }

  private async fetchArtist(artistId: string, token: string): Promise<{ genres: string[] } | null> {
    const res = await fetchWithTimeout(
      `https://api.spotify.com/v1/artists/${encodeURIComponent(artistId)}`,
      {
        timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
        fetchImpl: this.deps.fetchImpl,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { genres?: string[] };
    const genres = (data.genres ?? []).filter(g => typeof g === 'string');
    return { genres };
  }

  private async fetchAlbum(
    albumId: string, token: string,
  ): Promise<{ label?: string; releaseYear?: string } | null> {
    const res = await fetchWithTimeout(
      `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`,
      {
        timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
        fetchImpl: this.deps.fetchImpl,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      label?: string;
      release_date?: string;
    };
    const out: { label?: string; releaseYear?: string } = {};
    if (data.label && typeof data.label === 'string') out.label = data.label;
    if (data.release_date) {
      const yearMatch = data.release_date.match(/^(\d{4})/);
      if (yearMatch) out.releaseYear = yearMatch[1];
    }
    return Object.keys(out).length > 0 ? out : null;
  }
}

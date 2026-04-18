import type { EnrichmentRecord } from '../EnrichmentCache';
import { RateLimitedFetcher } from '../rate-limiter';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const GENIUS_MIN_INTERVAL_MS = 1100;

export interface GeniusFetcherDeps {
  token?: string;
  fetchImpl?: typeof fetch;
}

export class GeniusFetcher {
  private readonly queue = new RateLimitedFetcher(GENIUS_MIN_INTERVAL_MS);

  constructor(private readonly deps: GeniusFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    const token = this.deps.token ?? process.env.GENIUS_ACCESS_TOKEN;
    if (!token) return null;
    return this.queue.schedule(async () => {
      const query = encodeURIComponent(`${title} ${artist}`);
      const searchRes = await fetchWithTimeout(
        `https://api.genius.com/search?q=${query}`,
        {
          timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
          fetchImpl: this.deps.fetchImpl,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json() as {
        response?: { hits?: Array<{ result: { id: number } }> };
      };
      const topId = searchData.response?.hits?.[0]?.result?.id;
      if (!topId) return null;
      const detailRes = await fetchWithTimeout(
        `https://api.genius.com/songs/${topId}`,
        {
          timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
          fetchImpl: this.deps.fetchImpl,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!detailRes.ok) return null;
      const detail = await detailRes.json() as {
        response?: { song?: {
          producer_artists?: Array<{ name: string }>;
          release_date_for_display?: string;
          song_relationships?: Array<{
            relationship_type: string;
            songs?: Array<{ title: string; primary_artist?: { name: string } }>;
          }>;
        } };
      };
      const song = detail.response?.song;
      if (!song) return null;
      const out: Partial<EnrichmentRecord> = {};
      if (song.producer_artists?.length) {
        out.producer = song.producer_artists.map(p => p.name).join(', ');
      }
      if (song.release_date_for_display) {
        const yearMatch = song.release_date_for_display.match(/\b(\d{4})\b/);
        if (yearMatch) out.releaseYear = yearMatch[1];
      }
      const samples = song.song_relationships?.find(r => r.relationship_type === 'samples');
      const sampled = samples?.songs?.[0];
      if (sampled) {
        out.sample = `Samples "${sampled.title}" by ${sampled.primary_artist?.name ?? 'unknown'}`;
      }
      if (Object.keys(out).length === 0) return null;
      out.source = 'genius';
      return out;
    });
  }
}

import type { EnrichmentFetcher } from './BackgroundEnricher';
import type { EnrichmentRecord } from './EnrichmentCache';

const GENIUS_MIN_INTERVAL_MS = 1100;
const MB_MIN_INTERVAL_MS = 1100;

/** Shared promise-chain serializer with minimum interval per call. */
class RateLimitedFetcher {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await new Promise(r => setTimeout(r, this.minIntervalMs));
      return fn();
    });
    this.queue = result.catch(() => {});
    return result as Promise<T>;
  }
}

const MOOD_WORDS = new Set([
  'chill', 'mellow', 'upbeat', 'melancholy', 'moody', 'energetic',
  'warm', 'bright', 'dark', 'romantic', 'aggressive', 'smooth',
  'dreamy', 'intimate', 'reflective', 'hopeful', 'sad', 'happy',
]);

export class DefaultEnrichmentFetcher implements EnrichmentFetcher {
  private geniusQueue = new RateLimitedFetcher(GENIUS_MIN_INTERVAL_MS);
  private mbQueue = new RateLimitedFetcher(MB_MIN_INTERVAL_MS);

  async fetchGenius(
    title: string, artist: string,
  ): Promise<Partial<EnrichmentRecord> | null> {
    const token = process.env.GENIUS_ACCESS_TOKEN;
    if (!token) return null;
    return this.geniusQueue.schedule(async () => {
      const query = encodeURIComponent(`${title} ${artist}`);
      const searchRes = await fetch(
        `https://api.genius.com/search?q=${query}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json() as {
        response?: { hits?: Array<{ result: { id: number } }> };
      };
      const topId = searchData.response?.hits?.[0]?.result?.id;
      if (!topId) return null;
      const detailRes = await fetch(
        `https://api.genius.com/songs/${topId}`,
        { headers: { Authorization: `Bearer ${token}` } },
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
      return Object.keys(out).length > 0 ? out : null;
    });
  }

  async fetchMusicBrainz(
    title: string, artist: string,
  ): Promise<Partial<EnrichmentRecord> | null> {
    return this.mbQueue.schedule(async () => {
      const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
      const res = await fetch(
        `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=1&fmt=json`,
        {
          headers: {
            'User-Agent': 'CleoRadioApp/1.0 (bworthy89@gmail.com)',
            Accept: 'application/json',
          },
        },
      );
      if (!res.ok) return null;
      const data = await res.json() as {
        recordings?: Array<{
          tags?: Array<{ name: string; count?: number }>;
          'first-release-date'?: string;
        }>;
      };
      const rec = data.recordings?.[0];
      if (!rec) return null;
      const sortedTags = (rec.tags ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .map(t => t.name);
      const moodTags = sortedTags.filter(t => MOOD_WORDS.has(t.toLowerCase()));
      const out: Partial<EnrichmentRecord> = {};
      if (sortedTags.length) out.genre = sortedTags[0];
      if (moodTags.length) out.moodTags = moodTags.slice(0, 5);
      if (rec['first-release-date']) {
        out.releaseYear = rec['first-release-date'].substring(0, 4);
      }
      return Object.keys(out).length > 0 ? out : null;
    });
  }
}

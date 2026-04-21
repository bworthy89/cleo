import type { EnrichmentRecord } from '../EnrichmentCache';
import { RateLimitedFetcher } from '../rate-limiter';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const MB_MIN_INTERVAL_MS = 1100;

const MOOD_WORDS = new Set([
  'chill', 'mellow', 'upbeat', 'melancholy', 'moody', 'energetic',
  'warm', 'bright', 'dark', 'romantic', 'aggressive', 'smooth',
  'dreamy', 'intimate', 'reflective', 'hopeful', 'sad', 'happy',
]);

export interface MusicBrainzFetcherDeps {
  fetchImpl?: typeof fetch;
}

export class MusicBrainzFetcher {
  private readonly queue = new RateLimitedFetcher(MB_MIN_INTERVAL_MS);

  constructor(private readonly deps: MusicBrainzFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.queue.schedule(async () => {
      const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
      const res = await fetchWithTimeout(
        `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=1&fmt=json`,
        {
          timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
          fetchImpl: this.deps.fetchImpl,
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
      if (Object.keys(out).length === 0) return null;
      out.source = 'musicbrainz';
      return out;
    });
  }
}

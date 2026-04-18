import type { EnrichmentRecord } from '../EnrichmentCache';
import { RateLimitedFetcher } from '../rate-limiter';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const LASTFM_MIN_INTERVAL_MS = 200;

const MOOD_WORDS = new Set([
  'chill', 'mellow', 'upbeat', 'melancholy', 'moody', 'energetic',
  'warm', 'bright', 'dark', 'romantic', 'aggressive', 'smooth',
  'dreamy', 'intimate', 'reflective', 'hopeful', 'sad', 'happy',
]);

/**
 * Until Task 8 extends EnrichmentRecord with artistBio and source: 'lastfm',
 * we use this local overlay to satisfy TS. Task 8 will remove it.
 */
type LastFmEnrichment = Partial<Omit<EnrichmentRecord, 'source'>> & {
  artistBio?: string;
  source?: EnrichmentRecord['source'] | 'lastfm';
};

export interface LastFmFetcherDeps {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class LastFmFetcher {
  private readonly queue = new RateLimitedFetcher(LASTFM_MIN_INTERVAL_MS);

  constructor(private readonly deps: LastFmFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<LastFmEnrichment | null> {
    const key = this.deps.apiKey ?? process.env.LASTFM_API_KEY;
    if (!key) return null;
    return this.queue.schedule(async () => {
      const [track, artistInfo] = await Promise.all([
        this.getTrackInfo(title, artist, key),
        this.getArtistInfo(artist, key),
      ]);
      const out: LastFmEnrichment = {};
      if (track?.moodTags?.length) out.moodTags = track.moodTags;
      if (artistInfo?.bio) out.artistBio = artistInfo.bio;
      if (Object.keys(out).length === 0) return null;
      out.source = 'lastfm';
      return out;
    });
  }

  private async getTrackInfo(title: string, artist: string, key: string): Promise<{ moodTags?: string[] } | null> {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${key}&format=json`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      track?: { toptags?: { tag?: Array<{ name: string }> } };
    };
    const tags = (data.track?.toptags?.tag ?? []).map(t => t.name);
    const moodTags = tags.filter(t => MOOD_WORDS.has(t.toLowerCase())).slice(0, 5);
    return moodTags.length ? { moodTags } : null;
  }

  private async getArtistInfo(artist: string, key: string): Promise<{ bio?: string } | null> {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artist)}&api_key=${key}&format=json`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      artist?: { bio?: { summary?: string } };
    };
    const raw = (data.artist?.bio?.summary ?? '').trim();
    if (!raw) return null;
    const stripped = raw
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped ? { bio: stripped.slice(0, 400) } : null;
  }
}

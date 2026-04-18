import type { EnrichmentCache, EnrichmentRecord } from './EnrichmentCache';
import type { ManifestTrack } from '../broadcast/types';

const REFRESH_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export interface EnrichmentFetcher {
  fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchWikipedia(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchLastFm(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchSpotify(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
}

/**
 * Serial background queue. enqueue() pushes tracks; drain() awaits the
 * current tail. Errors per track are swallowed so one failure does not
 * block the rest of the queue.
 */
export class BackgroundEnricher {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly cache: EnrichmentCache,
    private readonly fetcher: EnrichmentFetcher,
  ) {}

  enqueue(tracks: ManifestTrack[]): void {
    for (const track of tracks) {
      this.queue = this.queue.then(() =>
        this.enrichOne(track).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[BackgroundEnricher] "${track.title}" by ${track.artistName} failed: ${msg}`);
        }),
      );
    }
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  /**
   * Awaitable drain: enrich tracks in parallel. Returns when all tracks have
   * been processed (or skipped as already-cached). Used by the orchestrator
   * as a synchronous pre-step before segment generation. Each track runs all
   * source fetchers in parallel; across tracks, each source's rate limiter
   * bucket serializes calls within the shared batch.
   */
  async drainNow(tracks: ManifestTrack[]): Promise<void> {
    await Promise.all(
      tracks.map(track =>
        this.enrichOne(track).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[BackgroundEnricher] "${track.title}" by ${track.artistName} failed: ${msg}`);
        }),
      ),
    );
  }

  private async enrichOne(track: ManifestTrack): Promise<void> {
    const existing = this.cache.get(track.title, track.artistName);
    if (existing && Date.now() - existing.lastEnrichedAt < REFRESH_THRESHOLD_MS) {
      return;
    }
    const [genius, mb, wiki, lastfm, spotify] = await Promise.all([
      this.fetcher.fetchGenius(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchMusicBrainz(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchWikipedia(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchLastFm(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchSpotify(track.title, track.artistName).catch(() => null),
    ]);
    if (!genius && !mb && !wiki && !lastfm && !spotify) return;
    const merged: Partial<EnrichmentRecord> = {
      ...(mb ?? {}),
      ...(wiki ?? {}),
      ...(lastfm ?? {}),
      ...(spotify ?? {}),
      ...(genius ?? {}),
    };
    const sources = [genius, mb, wiki, lastfm, spotify].filter((x): x is Partial<EnrichmentRecord> => x != null);
    const source: EnrichmentRecord['source'] =
      sources.length > 1 ? 'hybrid' : (sources[0]?.source ?? 'hybrid');
    const record: EnrichmentRecord = {
      ...merged,
      lastEnrichedAt: Date.now(),
      source,
    };
    await this.cache.set(track.title, track.artistName, record);
  }
}

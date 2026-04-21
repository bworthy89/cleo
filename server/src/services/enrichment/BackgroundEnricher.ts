import type { EnrichmentCache, EnrichmentRecord } from './EnrichmentCache';
import type { ManifestTrack } from '../broadcast/types';
import type { FeatureFetchChain } from '../broadcast/FeatureFetchChain';

const REFRESH_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
const FEATURES_VERSION = 1;

export interface EnrichmentFetcher {
  fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchWikipedia(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchLastFm(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
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
    private readonly featureChain?: FeatureFetchChain,
  ) {}

  enqueue(tracks: ManifestTrack[]): void {
    for (const track of tracks) {
      this.queue = this.queue.then(() =>
        this.enrichOne(track)
          .then(() => {
            // Mirror drainNow: text enrichment then features, serialized
            // per-track through the queue. Per-track fetchBatch means one
            // ReccoBeats HTTP call per track on this path (vs batched in
            // drainNow) — acceptable because enqueue is fire-and-forget.
            if (this.featureChain) return this.fetchAndStoreFeatures([track]);
          })
          .catch(err => {
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
    if (this.featureChain) {
      await this.fetchAndStoreFeatures(tracks);
    }
  }

  private async enrichOne(track: ManifestTrack): Promise<void> {
    const existing = this.cache.get(track.title, track.artistName);
    if (existing && Date.now() - existing.lastEnrichedAt < REFRESH_THRESHOLD_MS) {
      return;
    }
    const [genius, mb, wiki, lastfm] = await Promise.all([
      this.fetcher.fetchGenius(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchMusicBrainz(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchWikipedia(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchLastFm(track.title, track.artistName).catch(() => null),
    ]);
    if (!genius && !mb && !wiki && !lastfm) return;
    const merged: Partial<EnrichmentRecord> = {
      ...(mb ?? {}),
      ...(wiki ?? {}),
      ...(lastfm ?? {}),
      ...(genius ?? {}),
    };
    const sources = [genius, mb, wiki, lastfm].filter((x): x is Partial<EnrichmentRecord> => x != null);
    const source: EnrichmentRecord['source'] =
      sources.length > 1 ? 'hybrid' : (sources[0]?.source ?? 'hybrid');
    const record: EnrichmentRecord = {
      ...merged,
      lastEnrichedAt: Date.now(),
      source,
    };
    await this.cache.set(track.title, track.artistName, record);
  }

  private async fetchAndStoreFeatures(tracks: ManifestTrack[]): Promise<void> {
    // Skip tracks whose cached record already has up-to-date features.
    const need = tracks.filter(t => {
      const rec = this.cache.get(t.title, t.artistName);
      return !rec?.features || rec.featuresVersion !== FEATURES_VERSION;
    });
    if (need.length === 0) return;

    const results = await this.featureChain!.fetchBatch(need);
    const reccobeats = [...results.values()].filter(r => r.source === 'reccobeats').length;
    const synthesized = [...results.values()].filter(r => r.source === 'synthesized').length;
    const defaults = [...results.values()].filter(r => r.source === 'defaults').length;
    console.log(
      `[BackgroundEnricher] features tiers: reccobeats=${reccobeats} ` +
      `synthesized=${synthesized} defaults=${defaults} (${need.length} tracks)`
    );

    for (const track of need) {
      const fetched = results.get(track.id);
      if (!fetched) continue;
      const existing = this.cache.get(track.title, track.artistName);
      await this.cache.set(track.title, track.artistName, {
        ...(existing ?? { lastEnrichedAt: Date.now(), source: 'hybrid' as const }),
        isrc: track.isrc ?? existing?.isrc,
        features: fetched.features,
        featuresSource: fetched.source,
        featuresAt: Date.now(),
        featuresVersion: FEATURES_VERSION,
      });
    }
  }
}

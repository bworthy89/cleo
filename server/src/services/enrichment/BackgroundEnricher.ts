import type { EnrichmentCache, EnrichmentRecord } from './EnrichmentCache';
import type { ManifestTrack } from '../broadcast/types';

const REFRESH_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export interface EnrichmentFetcher {
  fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
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
        this.enrichOne(track).catch(() => {}),
      );
    }
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  private async enrichOne(track: ManifestTrack): Promise<void> {
    const existing = this.cache.get(track.title, track.artistName);
    if (existing && Date.now() - existing.lastEnrichedAt < REFRESH_THRESHOLD_MS) {
      return;
    }
    const [genius, mb] = await Promise.all([
      this.fetcher.fetchGenius(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchMusicBrainz(track.title, track.artistName).catch(() => null),
    ]);
    if (!genius && !mb) return;
    const source: EnrichmentRecord['source'] =
      genius && mb ? 'hybrid' : genius ? 'genius' : 'musicbrainz';
    const record: EnrichmentRecord = {
      ...(mb ?? {}),
      ...(genius ?? {}),
      lastEnrichedAt: Date.now(),
      source,
    };
    await this.cache.set(track.title, track.artistName, record);
  }
}

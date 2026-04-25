import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackgroundEnricher, type EnrichmentFetcher } from '@/services/enrichment/BackgroundEnricher';
import { EnrichmentCache, type EnrichmentRecord } from '@/services/enrichment/EnrichmentCache';
import type { ManifestTrack } from '@/services/broadcast/types';
import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';

const makeTrack = (id: string): ManifestTrack => ({
  id, title: `title-${id}`, artistName: `artist-${id}`,
  albumTitle: `album-${id}`, duration: 200,
});

const geniusRecord: Partial<EnrichmentRecord> = {
  producer: 'Producer X', releaseYear: '1972', source: 'genius',
};
const mbRecord: Partial<EnrichmentRecord> = {
  genre: 'soul', moodTags: ['warm'], source: 'musicbrainz',
};

function makeFetcher(): jest.Mocked<EnrichmentFetcher> {
  return {
    fetchGenius: jest.fn<
      Promise<Partial<EnrichmentRecord> | null>,
      [string, string]
    >(async () => geniusRecord),
    fetchMusicBrainz: jest.fn<
      Promise<Partial<EnrichmentRecord> | null>,
      [string, string]
    >(async () => mbRecord),
    fetchWikipedia: jest.fn<
      Promise<Partial<EnrichmentRecord> | null>,
      [string, string]
    >(async () => null),
    fetchLastFm: jest.fn<
      Promise<Partial<EnrichmentRecord> | null>,
      [string, string]
    >(async () => null),
  };
}

async function tempCache(): Promise<EnrichmentCache> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bg-enrich-'));
  const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
  await cache.load();
  return cache;
}

describe('BackgroundEnricher', () => {
  it('enriches each track and writes to cache', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a'), makeTrack('b')]);
    await enricher.drain();

    expect(fetcher.fetchGenius).toHaveBeenCalledTimes(2);
    expect(fetcher.fetchMusicBrainz).toHaveBeenCalledTimes(2);
    const recA = cache.get('title-a', 'artist-a');
    expect(recA?.producer).toBe('Producer X');
    expect(recA?.genre).toBe('soul');
    expect(recA?.source).toBe('hybrid');
  });

  it('skips tracks enriched within 30 days', async () => {
    const cache = await tempCache();
    await cache.set('title-a', 'artist-a', {
      genre: 'old', lastEnrichedAt: Date.now(), source: 'hybrid',
    });
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(fetcher.fetchGenius).not.toHaveBeenCalled();
    expect(fetcher.fetchMusicBrainz).not.toHaveBeenCalled();
  });

  it('re-enriches after 30-day threshold', async () => {
    const cache = await tempCache();
    await cache.set('title-a', 'artist-a', {
      genre: 'old',
      lastEnrichedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      source: 'hybrid',
    });
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(fetcher.fetchGenius).toHaveBeenCalledTimes(1);
  });

  it('tolerates fetcher errors — other tracks still process', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    (fetcher.fetchGenius as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a'), makeTrack('b')]);
    await enricher.drain();

    // Track b still enriched despite track a's Genius failure.
    expect(cache.get('title-b', 'artist-b')).not.toBeNull();
    // Track a got partial (MB succeeded, Genius failed) OR nothing, either is acceptable.
  });

  it('tags source as genius-only when MB returns null', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    (fetcher.fetchMusicBrainz as jest.Mock).mockResolvedValueOnce(null);
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(cache.get('title-a', 'artist-a')?.source).toBe('genius');
  });

  it('tags source as musicbrainz-only when Genius returns null', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    (fetcher.fetchGenius as jest.Mock).mockResolvedValueOnce(null);
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(cache.get('title-a', 'artist-a')?.source).toBe('musicbrainz');
  });
});

describe('BackgroundEnricher.drainNow', () => {
  it('enriches all tracks in parallel and resolves when done', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    const tracks: ManifestTrack[] = [
      makeTrack('a'),
      makeTrack('b'),
      makeTrack('c'),
    ];
    await enricher.drainNow(tracks);

    expect(fetcher.fetchGenius).toHaveBeenCalledTimes(3);
    expect(fetcher.fetchMusicBrainz).toHaveBeenCalledTimes(3);
    expect(cache.get('title-a', 'artist-a')?.producer).toBe('Producer X');
    expect(cache.get('title-b', 'artist-b')?.producer).toBe('Producer X');
    expect(cache.get('title-c', 'artist-c')?.producer).toBe('Producer X');
  });

  it('skips already-cached tracks within the refresh window', async () => {
    const cache = await tempCache();
    await cache.set('title-a', 'artist-a', {
      genre: 'cached', lastEnrichedAt: Date.now(), source: 'hybrid',
    });
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    await enricher.drainNow([makeTrack('a')]);

    expect(fetcher.fetchGenius).not.toHaveBeenCalled();
    expect(fetcher.fetchMusicBrainz).not.toHaveBeenCalled();
  });
});

describe('BackgroundEnricher.drainNow telemetry', () => {
  let timingSpy: jest.SpyInstance;

  beforeEach(() => {
    timingSpy = jest.spyOn(bakeTelemetry, 'recordEnrichmentApiTiming').mockImplementation(() => {});
  });

  afterEach(() => {
    timingSpy.mockRestore();
  });

  it('records timing for each API call', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    await enricher.drainNow([makeTrack('a')]);

    expect(timingSpy).toHaveBeenCalledWith(
      expect.objectContaining({ api: 'genius' }),
    );
    expect(timingSpy).toHaveBeenCalledWith(
      expect.objectContaining({ api: 'musicbrainz' }),
    );
    expect(timingSpy).toHaveBeenCalledWith(
      expect.objectContaining({ api: 'wikipedia' }),
    );
    expect(timingSpy).toHaveBeenCalledWith(
      expect.objectContaining({ api: 'lastfm' }),
    );
  });

  it('records durationMs as a non-negative number for each API call', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    await enricher.drainNow([makeTrack('a')]);

    const calls = timingSpy.mock.calls as Array<[{ api: string; durationMs: number }]>;
    expect(calls.length).toBeGreaterThan(0);
    for (const [input] of calls) {
      expect(typeof input.durationMs).toBe('number');
      expect(input.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not record timing when track is already cached', async () => {
    const cache = await tempCache();
    await cache.set('title-a', 'artist-a', {
      genre: 'cached', lastEnrichedAt: Date.now(), source: 'hybrid',
    });
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    await enricher.drainNow([makeTrack('a')]);

    expect(timingSpy).not.toHaveBeenCalled();
  });
});

import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { Db } from '@/services/db/Db';

describe('BackgroundEnricher features stage', () => {
  let db: Db;
  let cache: EnrichmentCache;

  beforeEach(() => {
    db = new Db(':memory:');
    cache = new EnrichmentCache(db);
  });

  afterEach(() => { db.close(); });

  it('populates features on the cached record after drainNow', async () => {
    const fakeFetcher = {
      async fetchGenius() { return null; },
      async fetchMusicBrainz() { return { source: 'musicbrainz' as const, genre: 'soul' }; },
      async fetchWikipedia() { return null; },
      async fetchLastFm() { return null; },
    };
    const fakeFeatureChain = {
      async fetchBatch() {
        return new Map([['1', {
          features: {
            tempo: 95, energy: 0.55, valence: 0.60, danceability: 0.65,
            acousticness: 0.30, loudness: 0.55, instrumentalness: 0.05,
          },
          source: 'reccobeats' as const,
          partial: false,
        }]]);
      },
    };
    const enricher = new BackgroundEnricher(cache, fakeFetcher as any, fakeFeatureChain as any);
    const tracks = [{
      id: '1', title: 'Song', artistName: 'Artist',
      albumTitle: 'Album', duration: 200, isrc: 'USRC17607839',
    }];
    await enricher.drainNow(tracks as any);
    const rec = cache.get('Song', 'Artist');
    expect(rec?.features?.tempo).toBe(95);
    expect(rec?.featuresSource).toBe('reccobeats');
    expect(rec?.featuresVersion).toBe(1);
  });
});

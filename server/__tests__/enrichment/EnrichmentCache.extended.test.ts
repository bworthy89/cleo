import { EnrichmentCache, type EnrichmentRecord } from '../../src/services/enrichment/EnrichmentCache';
import { Db } from '../../src/services/db/Db';

describe('EnrichmentCache — extended fields', () => {
  let db: Db;
  let cache: EnrichmentCache;

  beforeEach(() => {
    db = new Db(':memory:');
    cache = new EnrichmentCache(db);
  });

  afterEach(() => {
    db.close();
  });

  it('stores and retrieves isrc / features / featuresSource', async () => {
    const rec: EnrichmentRecord = {
      lastEnrichedAt: Date.now(),
      source: 'hybrid',
      isrc: 'USRC17607839',
      features: {
        tempo: 120, energy: 0.7, valence: 0.5, danceability: 0.6,
        acousticness: 0.2, loudness: 0.6, instrumentalness: 0.05,
      },
      featuresSource: 'reccobeats',
      featuresAt: Date.now(),
      featuresVersion: 1,
    };
    await cache.set('Blinding Lights', 'The Weeknd', rec);
    const hit = cache.get('Blinding Lights', 'The Weeknd');
    expect(hit?.isrc).toBe('USRC17607839');
    expect(hit?.features?.tempo).toBe(120);
    expect(hit?.featuresSource).toBe('reccobeats');
    expect(hit?.featuresVersion).toBe(1);
  });

  it('allows records without features (back-compat)', async () => {
    const rec: EnrichmentRecord = {
      lastEnrichedAt: Date.now(),
      source: 'genius',
      producer: 'Some producer',
    };
    await cache.set('Song', 'Artist', rec);
    const hit = cache.get('Song', 'Artist');
    expect(hit?.producer).toBe('Some producer');
    expect(hit?.features).toBeUndefined();
  });
});

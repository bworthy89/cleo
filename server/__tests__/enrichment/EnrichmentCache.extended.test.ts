import { EnrichmentCache, type EnrichmentRecord } from '../../src/services/enrichment/EnrichmentCache';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('EnrichmentCache — extended fields', () => {
  let tmp: string;
  let cache: EnrichmentCache;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'enrich-test-'));
    cache = new EnrichmentCache(path.join(tmp, 'tracks.json'));
    await cache.load();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
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

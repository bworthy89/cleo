import { FeatureFetchChain } from '../../src/services/broadcast/FeatureFetchChain';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';
import type { ManifestTrack } from '../../src/services/broadcast/types';

const mkTrack = (id: string, isrc?: string): ManifestTrack => ({
  id, title: 't' + id, artistName: 'A', albumTitle: 'B',
  duration: 200, isrc,
} as ManifestTrack);

describe('FeatureFetchChain', () => {
  it('uses ReccoBeats when ISRC + ReccoBeats returns a hit', async () => {
    const chain = new FeatureFetchChain({
      recco: { fetch: async () => new Map([['USRC1', {
        tempo: 120, energy: 0.8, valence: 0.7, danceability: 0.7,
        acousticness: 0.1, loudness: 0.7, instrumentalness: 0.05,
      }]]) },
      deezer: { fetch: async () => null },
      lastFmTags: { get: async () => [] },
    } as any);
    const r = await chain.fetchOne(mkTrack('1', 'USRC1'));
    expect(r.source).toBe('reccobeats');
    expect(r.features.tempo).toBe(120);
  });

  it('falls through to Deezer on ReccoBeats miss', async () => {
    const chain = new FeatureFetchChain({
      recco: { fetch: async () => new Map() },
      deezer: { fetch: async () => ({ tempo: 130, loudness: 0.8 }) },
      lastFmTags: { get: async () => [] },
    } as any);
    const r = await chain.fetchOne(mkTrack('1', 'USRC1'));
    expect(r.source).toBe('synthesized');
    expect(r.features.tempo).toBe(130);
  });

  it('uses tier 3 synth when no ISRC', async () => {
    const chain = new FeatureFetchChain({
      recco: { fetch: async () => new Map() },
      deezer: { fetch: async () => null },
      lastFmTags: { get: async () => ['chill'] },
    } as any);
    const r = await chain.fetchOne(mkTrack('1'));
    expect(r.source).toBe('synthesized');
    expect(r.features.energy).toBeLessThan(NEUTRAL_FEATURES.energy);
  });

  it('falls through to neutrals when nothing works', async () => {
    const chain = new FeatureFetchChain({
      recco: { fetch: async () => new Map() },
      deezer: { fetch: async () => null },
      lastFmTags: { get: async () => [] },
    } as any);
    const r = await chain.fetchOne(mkTrack('1'));
    expect(r.source).toBe('defaults');
    expect(r.features).toEqual(NEUTRAL_FEATURES);
  });
});

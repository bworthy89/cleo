// server/__tests__/broadcast/deep-dives.test.ts
import { nominateDeepDives } from '../../src/services/broadcast/deep-dives';
import type { ManifestTrack } from '../../src/services/broadcast/types';
import type { EnrichmentLookup } from '../../src/services/broadcast/SegmentScriptBuilder';

const mkTrack = (id: string, title = id): ManifestTrack => ({
  id, title, artistName: 'Artist',
  albumTitle: 'Album', duration: 180,
} as ManifestTrack);

describe('nominateDeepDives', () => {
  it('returns empty array for a 1-track (no transitions) set', () => {
    const lookup: EnrichmentLookup = { get: () => null };
    expect(nominateDeepDives([mkTrack('a')], lookup)).toEqual([]);
  });

  it('caps picks at ceil((N-1) / 4) — 5 tracks → 1 deep dive', () => {
    const lookup: EnrichmentLookup = { get: () => ({
      lastEnrichedAt: 0, source: 'hybrid',
      producer: 'p', sample: 's', wikipediaSummary: 'w', notableFacts: ['f'],
    }) };
    const tracks = Array.from({ length: 5 }, (_, i) => mkTrack(`t${i}`));
    const picks = nominateDeepDives(tracks, lookup);
    expect(picks).toHaveLength(1);
    // Should be a slot index in [1, N-1] (transitions, not cold_open or sign_off).
    expect(picks[0]).toBeGreaterThanOrEqual(1);
    expect(picks[0]).toBeLessThan(5);
  });

  it('caps picks at ceil((N-1) / 4) — 15 tracks → 4 deep dives', () => {
    const lookup: EnrichmentLookup = { get: () => ({
      lastEnrichedAt: 0, source: 'hybrid',
      producer: 'p', sample: 's', wikipediaSummary: 'w', notableFacts: ['f'],
    }) };
    const tracks = Array.from({ length: 15 }, (_, i) => mkTrack(`t${i}`));
    const picks = nominateDeepDives(tracks, lookup);
    expect(picks).toHaveLength(4);
  });

  it('ranks transitions by richness of the incoming track enrichment', () => {
    // Track at index 2 (the 3rd track) has 4 rich fields; others have 0.
    const lookup: EnrichmentLookup = {
      get: (title: string) => title === 't2'
        ? { lastEnrichedAt: 0, source: 'hybrid',
            producer: 'p', sample: 's', wikipediaSummary: 'w', notableFacts: ['f'] }
        : null,
    };
    const tracks = Array.from({ length: 5 }, (_, i) => mkTrack(`t${i}`));
    const picks = nominateDeepDives(tracks, lookup);
    // ManifestBuilder layout: slot 0 = cold_open, slot 1 = transition-to-t2,
    // slot 2 = transition-to-t4, slot 3 = sign_off. The richness is on t2,
    // so the transition leading to t2 (slot 1) should be picked.
    expect(picks).toContain(1);
  });
});

import { DeterministicTrackSequencer } from '../../src/services/broadcast/DeterministicTrackSequencer';
import type { ManifestTrack } from '../../src/services/broadcast/types';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';
import type { FeatureFetchChain } from '../../src/services/broadcast/FeatureFetchChain';
import type { EnrichmentCache } from '../../src/services/enrichment/EnrichmentCache';
import { bakeTelemetry } from '../../src/services/telemetry/BakeTelemetry';

// Feature-fetch chain that returns deterministic features by track id.
function makeChain(featureMap: Record<string, Partial<import('../../src/services/broadcast/audio-features').AudioFeatures>>):
  Pick<FeatureFetchChain, 'fetchBatch'> {
  return {
    async fetchBatch(tracks: ManifestTrack[]) {
      const out = new Map();
      for (const t of tracks) {
        const overrides = featureMap[t.id] ?? {};
        out.set(t.id, { features: { ...NEUTRAL_FEATURES, ...overrides }, source: 'reccobeats', partial: false });
      }
      return out;
    },
  };
}

const mkTrack = (id: string, artist = 'A'): ManifestTrack => ({
  id, title: `t${id}`, artistName: artist, albumTitle: `alb-${id}`, duration: 200,
} as ManifestTrack);

const mockEnrich: Pick<EnrichmentCache, 'get'> = { get: () => null };

describe('DeterministicTrackSequencer', () => {
  const pool: ManifestTrack[] = Array.from({ length: 20 }, (_, i) => mkTrack(String(i)));

  // Synthetic features: half are low-energy, half are high.
  const features: Record<string, Partial<import('../../src/services/broadcast/audio-features').AudioFeatures>> = {};
  for (let i = 0; i < 20; i++) {
    features[String(i)] = i < 10
      ? { tempo: 80,  energy: 0.25, valence: 0.30, acousticness: 0.50 }
      : { tempo: 130, energy: 0.85, valence: 0.80, acousticness: 0.10 };
  }

  it('produces deterministic output for identical inputs', async () => {
    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    const r1 = await s.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'abc',
    });
    const r2 = await s.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'abc',
    });
    expect(r1.orderedTracks.map((t: ManifestTrack) => t.id)).toEqual(r2.orderedTracks.map((t: ManifestTrack) => t.id));
  });

  it('produces different orders for different vibes', async () => {
    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    const morning = await s.sequence({
      pool, vibe: 'morning', length: 'quick',
      userContext: { timeOfDay: '08:00', dayOfWeek: 'Mon' },
      broadcastId: 'abc',
    });
    const lateNight = await s.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'abc',
    });
    expect(morning.orderedTracks.map((t: ManifestTrack) => t.id)).not.toEqual(lateNight.orderedTracks.map((t: ManifestTrack) => t.id));
  });

  it('produces different orders for different broadcastIds', async () => {
    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    const a = await s.sequence({
      pool, vibe: 'lateNight', length: 'standard',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'first',
    });
    const b = await s.sequence({
      pool, vibe: 'lateNight', length: 'standard',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'second',
    });
    expect(a.orderedTracks.map((t: ManifestTrack) => t.id)).not.toEqual(b.orderedTracks.map((t: ManifestTrack) => t.id));
  });

  it('throws "insufficient tracks" when pool too small', async () => {
    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    const tiny = pool.slice(0, 3);
    await expect(s.sequence({
      pool: tiny, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'abc',
    })).rejects.toThrow(/insufficient tracks/i);
  });

  it('reports source="deterministic" in result', async () => {
    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    const r = await s.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'abc',
    });
    expect(r.source).toBe('deterministic');
  });

  it('picks from the low-energy half first when vibe is lateNight', async () => {
    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    const r = await s.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'abc',
    });
    // Ids 0-9 are low-energy; they should dominate a lateNight 5-track set.
    const lowCount = r.orderedTracks.filter((t: ManifestTrack) => Number(t.id) < 10).length;
    expect(lowCount).toBeGreaterThanOrEqual(4);
  });

  it('emits sequencer-result telemetry with meanDistance and feature-source counts', async () => {
    const resultSpy = jest.spyOn(bakeTelemetry, 'recordSequencerResult').mockImplementation();

    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    await s.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon' },
      broadcastId: 'test-abc',
    });

    expect(resultSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        vibe: 'lateNight',
        meanDistance: expect.any(Number),
        n: 5,
        poolSize: 20,
        featureSourceCounts: expect.objectContaining({
          reccobeats: expect.any(Number),
          synthesized: expect.any(Number),
          defaults: expect.any(Number),
        }),
      }),
    );

    resultSpy.mockRestore();
  });
});

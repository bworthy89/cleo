import { DeterministicTrackSequencer } from '../../src/services/broadcast/DeterministicTrackSequencer';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';

const makeChain = (forEveryTrack: any) => ({
  async fetchBatch(tracks: any[]) {
    const out = new Map();
    for (const t of tracks) out.set(t.id, {
      features: { ...NEUTRAL_FEATURES, ...forEveryTrack },
      source: 'reccobeats' as const, partial: false,
    });
    return out;
  },
});
const mkPool = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: String(i), title: 't' + i, artistName: 'A', albumTitle: 'B', duration: 200,
}) as any);

describe('DeterministicTrackSequencer telemetry', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { warnSpy.mockRestore(); logSpy.mockRestore(); });

  it('logs poor-fit warning when mean distance > 0.7 (workout on ballad pool)', async () => {
    // Every track pinned to slow/soft/acoustic extremes — maximal distance
    // from workout's high-tempo high-energy target curve.
    const chain = makeChain({ tempo: 40, energy: 0.0, valence: 0.0, danceability: 0.0, acousticness: 1.0, loudness: 0.0, instrumentalness: 1.0 });
    const s = new DeterministicTrackSequencer({ get: () => null } as any, chain as any);
    await s.sequence({
      pool: mkPool(15), vibe: 'workout', length: 'quick',
      userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon' },
      broadcastId: 'mismatch-x',
    });
    const warnings = warnSpy.mock.calls.flat().filter(c => /poor vibe fit/i.test(String(c)));
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('does NOT log poor-fit warning when the pool matches the vibe well', async () => {
    const chain = makeChain({ tempo: 130, energy: 0.85, valence: 0.75, danceability: 0.80, acousticness: 0.10, loudness: 0.80, instrumentalness: 0.03 });
    const s = new DeterministicTrackSequencer({ get: () => null } as any, chain as any);
    await s.sequence({
      pool: mkPool(15), vibe: 'workout', length: 'quick',
      userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon' },
      broadcastId: 'match-x',
    });
    const warnings = warnSpy.mock.calls.flat().filter(c => /poor vibe fit/i.test(String(c)));
    expect(warnings).toHaveLength(0);
  });
});

import { DeterministicTrackSequencer } from '../../src/services/broadcast/DeterministicTrackSequencer';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';
import type { Vibe } from '../../src/services/broadcast/types';

const ALL_VIBES: Vibe[] = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
];

const POOL = Array.from({ length: 20 }, (_, i) => ({
  id: String(i), title: `t${i}`, artistName: `artist-${i % 5}`,
  albumTitle: `album-${i % 7}`, duration: 200,
})) as any[];

// Random-ish feature distribution so different vibes prefer different tracks.
const FEATURES_BY_ID: Record<string, Partial<import('../../src/services/broadcast/audio-features').AudioFeatures>> = {};
for (let i = 0; i < 20; i++) {
  FEATURES_BY_ID[String(i)] = {
    tempo: 70 + (i * 7) % 100,
    energy: (i * 13) % 100 / 100,
    valence: (i * 17) % 100 / 100,
    danceability: (i * 11) % 100 / 100,
    acousticness: (i * 19) % 100 / 100,
    loudness: (i * 23) % 100 / 100,
    instrumentalness: (i * 29) % 100 / 100,
  };
}

const fakeChain = {
  async fetchBatch(tracks: any[]) {
    const out = new Map();
    for (const t of tracks) {
      out.set(t.id, {
        features: { ...NEUTRAL_FEATURES, ...FEATURES_BY_ID[t.id] },
        source: 'reccobeats' as const,
        partial: false,
      });
    }
    return out;
  },
};
const fakeCache = { get: () => null } as any;

describe('REGRESSION: different vibes → different orders', () => {
  it.each(
    ALL_VIBES.flatMap(v1 => ALL_VIBES.filter(v2 => v2 !== v1).map(v2 => [v1, v2]))
  )('vibe %s differs from vibe %s', async (v1, v2) => {
    const s = new DeterministicTrackSequencer(fakeCache, fakeChain as any);
    const ctx = { timeOfDay: '12:00', dayOfWeek: 'Mon' };
    const a = await s.sequence({
      pool: POOL, vibe: v1 as Vibe, length: 'standard',
      userContext: ctx, broadcastId: 'regression-abc',
    });
    const b = await s.sequence({
      pool: POOL, vibe: v2 as Vibe, length: 'standard',
      userContext: ctx, broadcastId: 'regression-abc',
    });
    expect(a.orderedTracks.map(t => t.id)).not.toEqual(b.orderedTracks.map(t => t.id));
  });
});

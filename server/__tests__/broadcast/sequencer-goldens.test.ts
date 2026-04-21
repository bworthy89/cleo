import { DeterministicTrackSequencer } from '../../src/services/broadcast/DeterministicTrackSequencer';
import * as fs from 'fs';
import * as path from 'path';
import { NEUTRAL_FEATURES, type AudioFeatures } from '../../src/services/broadcast/audio-features';

interface GoldenPoolTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  features: Partial<AudioFeatures>;
}

interface Golden {
  name: string;
  vibe: string;
  length: 'quick' | 'standard' | 'long';
  broadcastId: string;
  pool: GoldenPoolTrack[];
  expectedOrder: string[];
}

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/sequencer-goldens');

function loadGoldens(): Golden[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')) as Golden);
}

describe('Sequencer goldens', () => {
  const goldens = loadGoldens();
  if (goldens.length === 0) {
    it('loads fixtures', () => {
      expect(goldens.length).toBeGreaterThan(0);
    });
    return;
  }
  for (const g of goldens) {
    it(g.name, async () => {
      const chain = {
        async fetchBatch(tracks: Array<{ id: string }>) {
          const out = new Map();
          for (const t of tracks) {
            const overrides = g.pool.find((p) => p.id === t.id)?.features ?? {};
            out.set(t.id, {
              features: { ...NEUTRAL_FEATURES, ...overrides },
              source: 'reccobeats' as const,
              partial: false,
            });
          }
          return out;
        },
      };
      const cache = { get: () => null } as any;
      const s = new DeterministicTrackSequencer(cache, chain as any);
      const r = await s.sequence({
        pool: g.pool as any,
        vibe: g.vibe as any,
        length: g.length,
        userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon' },
        broadcastId: g.broadcastId,
      });
      expect(r.orderedTracks.map((t) => t.id)).toEqual(g.expectedOrder);
    });
  }
});

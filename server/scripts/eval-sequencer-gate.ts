/**
 * Sequencer gate-eval harness — issue #29.
 *
 * Loads every pool-*.json fixture from server/__tests__/fixtures/sequencer-goldens/,
 * runs each through the deterministic sequencer, prints per-vibe meanDistance,
 * and exits 0 if all vibes are below the GATE_THRESHOLD or 1 if any are at-or-above.
 *
 * Run from repo root: `npx tsx server/scripts/eval-sequencer-gate.ts`
 * or via npm: `cd server && npm run eval-sequencer-gate`
 */
import * as fs from 'fs';
import * as path from 'path';
import { DeterministicTrackSequencer } from '../src/services/broadcast/DeterministicTrackSequencer';
import { NEUTRAL_FEATURES, type AudioFeatures } from '../src/services/broadcast/audio-features';

const GATE_THRESHOLD = 0.5;
const FIXTURES_DIR = path.resolve(__dirname, '../__tests__/fixtures/sequencer-goldens');

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

async function main(): Promise<number> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(`[gate] fixtures directory not found: ${FIXTURES_DIR}`);
    return 2;
  }

  const fixtures: Golden[] = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.startsWith('pool-') && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')) as Golden);

  if (fixtures.length === 0) {
    console.error(`[gate] no fixtures found in ${FIXTURES_DIR}`);
    return 2;
  }

  console.log(`[gate] Running ${fixtures.length} vibe fixtures (threshold meanDistance < ${GATE_THRESHOLD})...`);

  const failures: string[] = [];

  for (const g of fixtures) {
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
    const sequencer = new DeterministicTrackSequencer(cache, chain as any);
    const result = await sequencer.sequence({
      pool: g.pool as any,
      vibe: g.vibe as any,
      length: g.length,
      userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon' },
      broadcastId: g.broadcastId,
    });

    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
    const md = result.meanDistance;
    const ok = md < GATE_THRESHOLD;
    const mark = ok ? '✓' : `✗ (>=${GATE_THRESHOLD})`;
    console.log(
      `  ${pad(g.vibe, 12)} (${pad(g.length + ',', 10)} ${String(result.orderedTracks.length).padStart(2)} tracks)  meanDistance=${md.toFixed(3)}  ${mark}`,
    );

    if (!ok) failures.push(`${g.vibe} (${g.length}) at ${md.toFixed(3)}`);
  }

  if (failures.length === 0) {
    console.log(`[gate] PASS — all ${fixtures.length} vibe(s) below threshold`);
    return 0;
  }
  console.log(`[gate] FAIL — ${failures.length} vibe(s) above threshold:`);
  for (const f of failures) console.log(`  - ${f}`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[gate] uncaught error:', err);
    process.exit(2);
  });

# Sequencer Gate-Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an on-demand harness that runs the deterministic sequencer against representative track fixtures for all 7 vibes and prints per-vibe `meanDistance` against the Phase 1 GATE threshold (`< 0.5`).

**Architecture:** Promote `meanDistance` from internal-only logging to `SequenceResult` so it can be read by callers. Author 4 new fixture pools (focus-long, workout-standard, feelGood-standard, melancholy-quick) matching the existing `sequencer-goldens` schema. Add a CLI driver (`server/scripts/eval-sequencer-gate.ts`) that loads all fixtures, runs each through the sequencer, prints results, exits non-zero if any vibe is at-or-above 0.5. The existing `sequencer-goldens.test.ts` automatically picks up the new fixtures as regression tests via its `readdirSync` loop.

**Tech Stack:** TypeScript strict mode, Jest + ts-jest (existing tests), `tsx` for the CLI driver (matches `server/package.json`'s existing script convention), JSON fixtures.

**Spec:** [`docs/superpowers/specs/2026-04-25-sequencer-gate-eval-harness-design.md`](../specs/2026-04-25-sequencer-gate-eval-harness-design.md)

**Issue:** [bworthy89/cleo#29](https://github.com/bworthy89/cleo/issues/29). Gates [#20](https://github.com/bworthy89/cleo/issues/20).

**Branch:** `phase-1-sequencer-gate-harness` (already created; spec already committed).

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/services/broadcast/DeterministicTrackSequencer.ts` (**modify**) | Promote `meanDistance` to `SequenceResult` |
| `server/__tests__/broadcast/DeterministicTrackSequencer.test.ts` (**modify**) | One assertion that `result.meanDistance` is finite and positive |
| `server/__tests__/fixtures/sequencer-goldens/pool-focus-long.json` (**new**) | 12–16 track pool exercising the focus vibe curve |
| `server/__tests__/fixtures/sequencer-goldens/pool-workout-standard.json` (**new**) | 12–16 track pool for workout |
| `server/__tests__/fixtures/sequencer-goldens/pool-feelGood-standard.json` (**new**) | 12–16 track pool for feelGood |
| `server/__tests__/fixtures/sequencer-goldens/pool-melancholy-quick.json` (**new**) | 12–16 track pool for melancholy |
| `server/scripts/eval-sequencer-gate.ts` (**new**) | CLI driver: load all fixtures, run sequencer, print results, exit code |
| `server/package.json` (**modify**) | Add `"eval-sequencer-gate"` npm script |

---

## Notes for the Implementer

- TypeScript strict mode. No `any` casts unless unavoidable; the existing test files use `as any` on the chain/cache stubs and that's the established pattern.
- Tests use `describe`/`it`/`expect` (not `test`). Run with `cd server && npx jest <pattern>`.
- The repo uses `tsx` for scripts (see `bake-featured` in `server/package.json`); do NOT use `ts-node`.
- Commit-message convention: `<type>(server): <subject>` with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.
- Don't `git add -A` — the working tree has unrelated dirty files. Stage exact paths only.
- Vibe curves live at `server/src/services/broadcast/vibe-curves.ts`. Each vibe has 4 keyframes (open=0.0, body=0.33, peak=0.67, close=1.0) plus per-feature weights. The sequencer interpolates between keyframes per slot index and scores tracks by weighted L2 distance.
- `LENGTH_TO_N` (in `DeterministicTrackSequencer.ts:16-18`): `quick=5`, `standard=9`, `long=15`. The fixture's pool MUST be larger than this — typically 12–16 tracks so the top-K scoring has room to discriminate.
- Pool IDs in existing fixtures use simple short strings (e.g. `m0..m14` for morning, `0..7` for late-night, `p0..p9` for party). Stick with that style.

---

### Task 1: Promote `meanDistance` to `SequenceResult`

**Files:**
- Modify: `server/src/services/broadcast/DeterministicTrackSequencer.ts:41-45` (interface) and the return statement around line 130
- Modify: `server/__tests__/broadcast/DeterministicTrackSequencer.test.ts` (add one new `it` near the existing tests in the main describe)

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('DeterministicTrackSequencer', () => { ... })` block in `server/__tests__/broadcast/DeterministicTrackSequencer.test.ts` (after the last `it` but inside the closing `})` of the describe). The block uses `pool`, `features`, `mockEnrich`, `makeChain` — all defined at the top of the file:

```ts
  it('exposes meanDistance on the SequenceResult', async () => {
    const s = new DeterministicTrackSequencer(mockEnrich as any, makeChain(features) as any);
    const r = await s.sequence({
      pool, vibe: 'morning', length: 'standard',
      userContext: { timeOfDay: '08:00', dayOfWeek: 'Mon' },
      broadcastId: 'mean-distance-exposure-test',
    });
    expect(typeof r.meanDistance).toBe('number');
    expect(Number.isFinite(r.meanDistance)).toBe(true);
    expect(r.meanDistance).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.test.ts -t "exposes meanDistance"`
Expected: FAIL — TypeScript will reject the `r.meanDistance` access ("Property 'meanDistance' does not exist on type 'SequenceResult'") OR the runtime assertion will fail because the field is `undefined`. Either form is the right "not yet implemented" signal.

- [ ] **Step 3: Add the field to `SequenceResult` and the return statement**

Edit `server/src/services/broadcast/DeterministicTrackSequencer.ts`. The interface around line 41 currently reads:

```ts
export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'deterministic';
}
```

Replace with:

```ts
export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'deterministic';
  /** Average weighted L2 distance from each chosen track to its slot's
   *  vibe-curve target. Lower is a better fit. The Phase 1 GATE
   *  (issue #20) closes when this is < 0.5 across all 7 vibes. */
  meanDistance: number;
}
```

Then find the return statement that includes `orderedTracks`, `featureSlots`, `source: 'deterministic'` (around line 137; you can grep for `return {` near the bottom of the `sequence` method). The local variable `meanDistance` is computed earlier in the same method (around line 127). Add it to the returned object.

Before:

```ts
    return {
      orderedTracks: result,
      featureSlots,
      source: 'deterministic',
    };
```

After:

```ts
    return {
      orderedTracks: result,
      featureSlots,
      source: 'deterministic',
      meanDistance,
    };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.test.ts`
Expected: PASS — all existing tests + the new one.

Then run TS check to confirm the interface change doesn't break callers:

Run: `cd server && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/DeterministicTrackSequencer.ts \
        server/__tests__/broadcast/DeterministicTrackSequencer.test.ts
git commit -m "$(cat <<'EOF'
feat(server): expose meanDistance on SequenceResult

The deterministic sequencer already computes meanDistance internally
and forwards it to bakeTelemetry.recordSequencerResult; this commit
promotes it from a local variable to a returned field. Foundation
for #29 gate-eval harness, which reads it to compare against the
Phase 1 GATE threshold (< 0.5).

No behavioral change. Telemetry call is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Driver script `eval-sequencer-gate.ts` + npm script

**Files:**
- Create: `server/scripts/eval-sequencer-gate.ts`
- Modify: `server/package.json` (add npm script entry)

The driver runs against the **3 existing fixtures** (morning, lateNight, party) for now. Tasks 3–6 add the missing 4. The driver should already exit 0 with the existing 3 — they're known-passing fixtures.

- [ ] **Step 1: Write the driver**

Create `server/scripts/eval-sequencer-gate.ts`:

```ts
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
```

- [ ] **Step 2: Add the npm script entry**

Edit `server/package.json`. Find the `"scripts"` block. The `bake-featured` script is the last entry; add `eval-sequencer-gate` immediately after it.

Before (the relevant lines):

```json
    "bake-featured": "tsx scripts/bake-featured.ts"
  },
```

After:

```json
    "bake-featured": "tsx scripts/bake-featured.ts",
    "eval-sequencer-gate": "tsx scripts/eval-sequencer-gate.ts"
  },
```

(Note the trailing comma added to the previous line.)

- [ ] **Step 3: Run the driver against the existing 3 fixtures**

From the repo root:

Run: `cd server && npm run eval-sequencer-gate`

Expected output (values may differ slightly; what matters is shape + a `PASS` summary):

```
[gate] Running 3 vibe fixtures (threshold meanDistance < 0.5)...
  morning      (standard,    9 tracks)  meanDistance=0.XXX  ✓
  lateNight    (quick,       5 tracks)  meanDistance=0.XXX  ✓
  party        (long,       15 tracks)  meanDistance=0.XXX  ✓
[gate] PASS — all 3 vibe(s) below threshold
```

If any of the 3 known-good fixtures FAIL the gate: stop and report. Either the existing fixtures are not-actually-passing under the current sequencer (a finding that would itself be useful) or the driver has a bug.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/eval-sequencer-gate.ts server/package.json
git commit -m "$(cat <<'EOF'
feat(server): add eval-sequencer-gate driver script

Loads all pool-*.json fixtures from sequencer-goldens, runs each
through the deterministic sequencer, prints per-vibe meanDistance
against the 0.5 GATE threshold. Exits 0 if all pass, 1 if any
fail, 2 on infrastructure error.

Verified locally against the 3 existing fixtures (morning,
lateNight, party) — all pass. Tasks 3–6 add the missing 4
vibe fixtures (focus, workout, feelGood, melancholy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Author `pool-focus-long.json`

**Files:**
- Create: `server/__tests__/fixtures/sequencer-goldens/pool-focus-long.json`

**Vibe curve reference (from `vibe-curves.ts:36-46`):**

| Position | tempo | energy | valence | danceability | acousticness | loudness | instrumentalness |
|---|---|---|---|---|---|---|---|
| open (0.00)  | 85 | 0.30 | 0.50 | 0.35 | 0.50 | 0.35 | 0.75 |
| body (0.33)  | 90 | 0.35 | 0.50 | 0.35 | 0.45 | 0.40 | 0.75 |
| peak (0.67)  | 95 | 0.40 | 0.50 | 0.40 | 0.40 | 0.45 | 0.70 |
| close (1.00) | 85 | 0.30 | 0.50 | 0.35 | 0.50 | 0.35 | 0.75 |

Weights: `{tempo: 0.10, energy: 0.20, valence: 0.05, danceability: 0.05, acousticness: 0.15, loudness: 0.15, instrumentalness: 0.30}`

**Pool design notes:** Focus is dominated by `instrumentalness` (weight 0.30) — pool tracks should mostly be high-instrumentalness (0.6–0.85) with a few outliers (vocal-heavy 0.1–0.3) that the sequencer should *avoid* picking. Tempo range 75–105. Energy 0.20–0.50. The vibe is "study session" so the pool should feel like a Brian Eno / Nils Frahm / Tycho mix.

`length=long` → 15 picked from the pool. Pool size: **15 tracks** (= cap, exercises full discrimination).

- [ ] **Step 1: Write the fixture with placeholder `expectedOrder: []`**

Create `server/__tests__/fixtures/sequencer-goldens/pool-focus-long.json`:

```json
{
  "name": "focus long — instrumentalness-heavy plateau",
  "vibe": "focus",
  "length": "long",
  "broadcastId": "golden-focus-long",
  "pool": [
    { "id": "f0",  "title": "Drift",      "artistName": "FA", "albumTitle": "F1",  "duration": 240,
      "features": { "tempo": 80, "energy": 0.30, "valence": 0.50, "danceability": 0.30, "acousticness": 0.55, "loudness": 0.35, "instrumentalness": 0.80 } },
    { "id": "f1",  "title": "Wash",       "artistName": "FB", "albumTitle": "F2",  "duration": 235,
      "features": { "tempo": 82, "energy": 0.28, "valence": 0.50, "danceability": 0.32, "acousticness": 0.52, "loudness": 0.36, "instrumentalness": 0.78 } },
    { "id": "f2",  "title": "Pad",        "artistName": "FC", "albumTitle": "F3",  "duration": 245,
      "features": { "tempo": 84, "energy": 0.32, "valence": 0.50, "danceability": 0.34, "acousticness": 0.50, "loudness": 0.38, "instrumentalness": 0.82 } },
    { "id": "f3",  "title": "Hum",        "artistName": "FD", "albumTitle": "F4",  "duration": 230,
      "features": { "tempo": 88, "energy": 0.34, "valence": 0.50, "danceability": 0.34, "acousticness": 0.48, "loudness": 0.40, "instrumentalness": 0.75 } },
    { "id": "f4",  "title": "Glow",       "artistName": "FE", "albumTitle": "F5",  "duration": 240,
      "features": { "tempo": 90, "energy": 0.35, "valence": 0.50, "danceability": 0.36, "acousticness": 0.45, "loudness": 0.42, "instrumentalness": 0.78 } },
    { "id": "f5",  "title": "Lattice",    "artistName": "FF", "albumTitle": "F6",  "duration": 235,
      "features": { "tempo": 92, "energy": 0.38, "valence": 0.50, "danceability": 0.38, "acousticness": 0.42, "loudness": 0.44, "instrumentalness": 0.72 } },
    { "id": "f6",  "title": "Loop",       "artistName": "FG", "albumTitle": "F7",  "duration": 250,
      "features": { "tempo": 94, "energy": 0.40, "valence": 0.50, "danceability": 0.40, "acousticness": 0.40, "loudness": 0.46, "instrumentalness": 0.70 } },
    { "id": "f7",  "title": "Shimmer",    "artistName": "FH", "albumTitle": "F8",  "duration": 230,
      "features": { "tempo": 96, "energy": 0.38, "valence": 0.52, "danceability": 0.40, "acousticness": 0.42, "loudness": 0.44, "instrumentalness": 0.74 } },
    { "id": "f8",  "title": "Quiet",      "artistName": "FI", "albumTitle": "F9",  "duration": 245,
      "features": { "tempo": 86, "energy": 0.30, "valence": 0.50, "danceability": 0.34, "acousticness": 0.50, "loudness": 0.36, "instrumentalness": 0.80 } },
    { "id": "f9",  "title": "Arc",        "artistName": "FJ", "albumTitle": "F10", "duration": 240,
      "features": { "tempo": 88, "energy": 0.34, "valence": 0.50, "danceability": 0.36, "acousticness": 0.48, "loudness": 0.40, "instrumentalness": 0.76 } },
    { "id": "f10", "title": "Dust",       "artistName": "FK", "albumTitle": "F11", "duration": 235,
      "features": { "tempo": 90, "energy": 0.36, "valence": 0.50, "danceability": 0.36, "acousticness": 0.45, "loudness": 0.42, "instrumentalness": 0.78 } },
    { "id": "f11", "title": "Hold",       "artistName": "FL", "albumTitle": "F12", "duration": 240,
      "features": { "tempo": 84, "energy": 0.30, "valence": 0.50, "danceability": 0.32, "acousticness": 0.52, "loudness": 0.36, "instrumentalness": 0.82 } },
    { "id": "f12", "title": "Vocal",      "artistName": "FM", "albumTitle": "F13", "duration": 220,
      "features": { "tempo": 100, "energy": 0.55, "valence": 0.65, "danceability": 0.55, "acousticness": 0.30, "loudness": 0.55, "instrumentalness": 0.15 } },
    { "id": "f13", "title": "PoppedOut",  "artistName": "FN", "albumTitle": "F14", "duration": 215,
      "features": { "tempo": 110, "energy": 0.65, "valence": 0.70, "danceability": 0.60, "acousticness": 0.20, "loudness": 0.65, "instrumentalness": 0.10 } },
    { "id": "f14", "title": "Loud",       "artistName": "FO", "albumTitle": "F15", "duration": 210,
      "features": { "tempo": 120, "energy": 0.75, "valence": 0.75, "danceability": 0.70, "acousticness": 0.15, "loudness": 0.75, "instrumentalness": 0.05 } }
  ],
  "expectedOrder": []
}
```

- [ ] **Step 2: Run the goldens test to capture the actual ordering**

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "focus long"`
Expected: FAIL — Jest will print the actual `orderedTracks` IDs. Look for the line near the bottom of the failure that says something like `Expected: []  Received: ["f3", "f8", ...]` — copy the `Received` array.

- [ ] **Step 3: Update `expectedOrder` in the fixture**

Replace `"expectedOrder": []` with the captured array (15 IDs for `length=long`). Example:

```json
  "expectedOrder": ["f3", "f8", "f9", "f4", "f10", "f7", "f5", "f6", "f0", "f1", "f11", "f2", "f12", "f13", "f14"]
```

(The actual IDs may differ; use what Jest printed.)

- [ ] **Step 4: Re-run goldens test to confirm pass**

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "focus long"`
Expected: PASS.

- [ ] **Step 5: Run the gate driver and verify meanDistance < 0.5**

Run: `cd server && npm run eval-sequencer-gate`
Expected output includes a line like:

```
  focus        (long,      15 tracks)  meanDistance=0.XXX  ✓
```

**STOP CONDITION:** If `focus` shows `✗ (>=0.5)`, do NOT tweak the fixture features to push it under threshold. That's a real finding — escalate to the user immediately. The harness exists to catch this; tuning until it passes defeats the purpose.

- [ ] **Step 6: Commit**

```bash
git add server/__tests__/fixtures/sequencer-goldens/pool-focus-long.json
git commit -m "$(cat <<'EOF'
test(server): add focus-long fixture for gate-eval harness

15-track pool with high-instrumentalness ramp + 3 vocal-heavy
outliers the sequencer must avoid. Targets the focus vibe curve
(low energy/danceability, instrumentalness ≥ 0.7 dominant).

Verified meanDistance < 0.5 via the eval-sequencer-gate driver.

Part of #29 — gate-eval harness for Phase 1 GATE (#20).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Author `pool-workout-standard.json`

**Files:**
- Create: `server/__tests__/fixtures/sequencer-goldens/pool-workout-standard.json`

**Vibe curve reference (from `vibe-curves.ts:50-60`):**

| Position | tempo | energy | valence | danceability | acousticness | loudness | instrumentalness |
|---|---|---|---|---|---|---|---|
| open (0.00)  | 125 | 0.75 | 0.65 | 0.70 | 0.15 | 0.75 | 0.05 |
| body (0.33)  | 130 | 0.80 | 0.65 | 0.75 | 0.12 | 0.80 | 0.05 |
| peak (0.67)  | 140 | 0.90 | 0.70 | 0.80 | 0.10 | 0.85 | 0.03 |
| close (1.00) | 115 | 0.65 | 0.70 | 0.65 | 0.20 | 0.70 | 0.05 |

Weights: `{tempo: 0.25, energy: 0.30, valence: 0.10, danceability: 0.15, acousticness: 0.05, loudness: 0.12, instrumentalness: 0.03}`

**Pool design notes:** Tempo and energy dominate. Pool tempo range 110–145 with most tracks 120–140. Energy mostly 0.65–0.95 with a couple low-energy outliers. Acousticness uniformly low (0.05–0.20). Length=standard → 9 picked.

Pool size: **14 tracks**.

- [ ] **Step 1: Write the fixture with `expectedOrder: []`**

Create `server/__tests__/fixtures/sequencer-goldens/pool-workout-standard.json`:

```json
{
  "name": "workout standard — peak-and-cooldown energy arc",
  "vibe": "workout",
  "length": "standard",
  "broadcastId": "golden-workout-standard",
  "pool": [
    { "id": "w0",  "title": "Warmup",   "artistName": "WA", "albumTitle": "W1",  "duration": 200,
      "features": { "tempo": 122, "energy": 0.70, "valence": 0.65, "danceability": 0.68, "acousticness": 0.18, "loudness": 0.70, "instrumentalness": 0.05 } },
    { "id": "w1",  "title": "Light",    "artistName": "WB", "albumTitle": "W2",  "duration": 195,
      "features": { "tempo": 125, "energy": 0.72, "valence": 0.65, "danceability": 0.70, "acousticness": 0.16, "loudness": 0.72, "instrumentalness": 0.05 } },
    { "id": "w2",  "title": "Stride",   "artistName": "WC", "albumTitle": "W3",  "duration": 205,
      "features": { "tempo": 128, "energy": 0.78, "valence": 0.66, "danceability": 0.74, "acousticness": 0.14, "loudness": 0.78, "instrumentalness": 0.04 } },
    { "id": "w3",  "title": "Pace",     "artistName": "WD", "albumTitle": "W4",  "duration": 210,
      "features": { "tempo": 130, "energy": 0.82, "valence": 0.66, "danceability": 0.76, "acousticness": 0.12, "loudness": 0.80, "instrumentalness": 0.05 } },
    { "id": "w4",  "title": "Push",     "artistName": "WE", "albumTitle": "W5",  "duration": 200,
      "features": { "tempo": 134, "energy": 0.85, "valence": 0.68, "danceability": 0.78, "acousticness": 0.10, "loudness": 0.82, "instrumentalness": 0.04 } },
    { "id": "w5",  "title": "Sprint",   "artistName": "WF", "albumTitle": "W6",  "duration": 195,
      "features": { "tempo": 138, "energy": 0.88, "valence": 0.70, "danceability": 0.78, "acousticness": 0.10, "loudness": 0.84, "instrumentalness": 0.03 } },
    { "id": "w6",  "title": "Hammer",   "artistName": "WG", "albumTitle": "W7",  "duration": 200,
      "features": { "tempo": 142, "energy": 0.92, "valence": 0.70, "danceability": 0.80, "acousticness": 0.08, "loudness": 0.86, "instrumentalness": 0.03 } },
    { "id": "w7",  "title": "Anthem",   "artistName": "WH", "albumTitle": "W8",  "duration": 215,
      "features": { "tempo": 140, "energy": 0.90, "valence": 0.72, "danceability": 0.82, "acousticness": 0.10, "loudness": 0.85, "instrumentalness": 0.03 } },
    { "id": "w8",  "title": "Echo",     "artistName": "WI", "albumTitle": "W9",  "duration": 205,
      "features": { "tempo": 132, "energy": 0.82, "valence": 0.68, "danceability": 0.75, "acousticness": 0.12, "loudness": 0.78, "instrumentalness": 0.05 } },
    { "id": "w9",  "title": "Cooldown", "artistName": "WJ", "albumTitle": "W10", "duration": 220,
      "features": { "tempo": 118, "energy": 0.62, "valence": 0.70, "danceability": 0.66, "acousticness": 0.20, "loudness": 0.68, "instrumentalness": 0.05 } },
    { "id": "w10", "title": "Settle",   "artistName": "WK", "albumTitle": "W11", "duration": 215,
      "features": { "tempo": 114, "energy": 0.60, "valence": 0.68, "danceability": 0.62, "acousticness": 0.22, "loudness": 0.65, "instrumentalness": 0.05 } },
    { "id": "w11", "title": "Mid",      "artistName": "WL", "albumTitle": "W12", "duration": 200,
      "features": { "tempo": 126, "energy": 0.74, "valence": 0.65, "danceability": 0.72, "acousticness": 0.16, "loudness": 0.74, "instrumentalness": 0.05 } },
    { "id": "w12", "title": "Slow",     "artistName": "WM", "albumTitle": "W13", "duration": 220,
      "features": { "tempo": 100, "energy": 0.45, "valence": 0.55, "danceability": 0.50, "acousticness": 0.40, "loudness": 0.50, "instrumentalness": 0.10 } },
    { "id": "w13", "title": "Acoustic", "artistName": "WN", "albumTitle": "W14", "duration": 215,
      "features": { "tempo": 95,  "energy": 0.40, "valence": 0.60, "danceability": 0.45, "acousticness": 0.65, "loudness": 0.42, "instrumentalness": 0.15 } }
  ],
  "expectedOrder": []
}
```

- [ ] **Step 2: Run goldens test, capture ordering, update fixture, re-run**

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "workout standard"`
Expected: FAIL with the actual `orderedTracks` IDs in the diff. Copy the `Received` array.

Update `expectedOrder` in `pool-workout-standard.json` with the captured 9-element array.

Re-run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "workout standard"`
Expected: PASS.

- [ ] **Step 3: Run the gate driver and verify meanDistance < 0.5**

Run: `cd server && npm run eval-sequencer-gate`

Expected output includes a line like:

```
  workout      (standard,   9 tracks)  meanDistance=0.XXX  ✓
```

**STOP CONDITION (same as Task 3):** If `workout` shows `✗ (>=0.5)`, escalate to the user. Do not tweak features.

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/fixtures/sequencer-goldens/pool-workout-standard.json
git commit -m "$(cat <<'EOF'
test(server): add workout-standard fixture for gate-eval harness

14-track pool with peak-and-cooldown tempo arc (122 → 142 → 114
BPM) + 2 acoustic outliers the sequencer must avoid. Targets
workout vibe curve (high tempo + energy weights, low acousticness).

Verified meanDistance < 0.5 via the eval-sequencer-gate driver.

Part of #29 — gate-eval harness for Phase 1 GATE (#20).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Author `pool-feelGood-standard.json`

**Files:**
- Create: `server/__tests__/fixtures/sequencer-goldens/pool-feelGood-standard.json`

**Vibe curve reference (from `vibe-curves.ts:64-74`):**

| Position | tempo | energy | valence | danceability | acousticness | loudness | instrumentalness |
|---|---|---|---|---|---|---|---|
| open (0.00)  | 105 | 0.60 | 0.75 | 0.70 | 0.25 | 0.60 | 0.05 |
| body (0.33)  | 110 | 0.65 | 0.80 | 0.75 | 0.20 | 0.65 | 0.05 |
| peak (0.67)  | 115 | 0.75 | 0.85 | 0.80 | 0.18 | 0.70 | 0.05 |
| close (1.00) | 100 | 0.55 | 0.78 | 0.65 | 0.25 | 0.55 | 0.05 |

Weights: `{tempo: 0.10, energy: 0.18, valence: 0.28, danceability: 0.22, acousticness: 0.07, loudness: 0.10, instrumentalness: 0.05}`

**Pool design notes:** valence and danceability dominate (combined 0.50). Pool valence range mostly 0.65–0.90 with a couple low-valence outliers. Tempo 95–125. Energy 0.50–0.80. The vibe is "Bruno Mars / Lizzo / Stevie Wonder" — major-key, hook-forward.

Pool size: **14 tracks**.

- [ ] **Step 1: Write the fixture with `expectedOrder: []`**

Create `server/__tests__/fixtures/sequencer-goldens/pool-feelGood-standard.json`:

```json
{
  "name": "feelGood standard — high-valence groove",
  "vibe": "feelGood",
  "length": "standard",
  "broadcastId": "golden-feelGood-standard",
  "pool": [
    { "id": "g0",  "title": "Open",     "artistName": "GA", "albumTitle": "G1",  "duration": 210,
      "features": { "tempo": 102, "energy": 0.58, "valence": 0.74, "danceability": 0.68, "acousticness": 0.26, "loudness": 0.58, "instrumentalness": 0.05 } },
    { "id": "g1",  "title": "Smile",    "artistName": "GB", "albumTitle": "G2",  "duration": 205,
      "features": { "tempo": 105, "energy": 0.60, "valence": 0.78, "danceability": 0.72, "acousticness": 0.24, "loudness": 0.60, "instrumentalness": 0.05 } },
    { "id": "g2",  "title": "Strut",    "artistName": "GC", "albumTitle": "G3",  "duration": 215,
      "features": { "tempo": 108, "energy": 0.64, "valence": 0.80, "danceability": 0.76, "acousticness": 0.22, "loudness": 0.62, "instrumentalness": 0.05 } },
    { "id": "g3",  "title": "Glow",     "artistName": "GD", "albumTitle": "G4",  "duration": 220,
      "features": { "tempo": 110, "energy": 0.66, "valence": 0.82, "danceability": 0.76, "acousticness": 0.20, "loudness": 0.64, "instrumentalness": 0.05 } },
    { "id": "g4",  "title": "Hook",     "artistName": "GE", "albumTitle": "G5",  "duration": 200,
      "features": { "tempo": 113, "energy": 0.70, "valence": 0.85, "danceability": 0.80, "acousticness": 0.18, "loudness": 0.68, "instrumentalness": 0.05 } },
    { "id": "g5",  "title": "Sing",     "artistName": "GF", "albumTitle": "G6",  "duration": 210,
      "features": { "tempo": 115, "energy": 0.74, "valence": 0.86, "danceability": 0.82, "acousticness": 0.18, "loudness": 0.70, "instrumentalness": 0.05 } },
    { "id": "g6",  "title": "Bright",   "artistName": "GG", "albumTitle": "G7",  "duration": 215,
      "features": { "tempo": 117, "energy": 0.75, "valence": 0.84, "danceability": 0.80, "acousticness": 0.18, "loudness": 0.70, "instrumentalness": 0.05 } },
    { "id": "g7",  "title": "Wave",     "artistName": "GH", "albumTitle": "G8",  "duration": 200,
      "features": { "tempo": 112, "energy": 0.68, "valence": 0.80, "danceability": 0.76, "acousticness": 0.22, "loudness": 0.66, "instrumentalness": 0.05 } },
    { "id": "g8",  "title": "Float",    "artistName": "GI", "albumTitle": "G9",  "duration": 215,
      "features": { "tempo": 100, "energy": 0.55, "valence": 0.76, "danceability": 0.66, "acousticness": 0.25, "loudness": 0.55, "instrumentalness": 0.05 } },
    { "id": "g9",  "title": "Easy",     "artistName": "GJ", "albumTitle": "G10", "duration": 220,
      "features": { "tempo": 98,  "energy": 0.52, "valence": 0.74, "danceability": 0.62, "acousticness": 0.28, "loudness": 0.52, "instrumentalness": 0.05 } },
    { "id": "g10", "title": "Mid",      "artistName": "GK", "albumTitle": "G11", "duration": 215,
      "features": { "tempo": 108, "energy": 0.62, "valence": 0.78, "danceability": 0.72, "acousticness": 0.22, "loudness": 0.62, "instrumentalness": 0.05 } },
    { "id": "g11", "title": "High",     "artistName": "GL", "albumTitle": "G12", "duration": 205,
      "features": { "tempo": 119, "energy": 0.76, "valence": 0.85, "danceability": 0.80, "acousticness": 0.16, "loudness": 0.72, "instrumentalness": 0.05 } },
    { "id": "g12", "title": "Sad",      "artistName": "GM", "albumTitle": "G13", "duration": 215,
      "features": { "tempo": 80,  "energy": 0.30, "valence": 0.25, "danceability": 0.35, "acousticness": 0.55, "loudness": 0.35, "instrumentalness": 0.20 } },
    { "id": "g13", "title": "Dark",     "artistName": "GN", "albumTitle": "G14", "duration": 220,
      "features": { "tempo": 75,  "energy": 0.28, "valence": 0.20, "danceability": 0.30, "acousticness": 0.65, "loudness": 0.30, "instrumentalness": 0.25 } }
  ],
  "expectedOrder": []
}
```

- [ ] **Step 2: Capture ordering and update fixture**

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "feelGood standard"`
Capture the `Received` array from the failure output. Update `expectedOrder` in the fixture.

Re-run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "feelGood standard"`
Expected: PASS.

- [ ] **Step 3: Run the gate driver**

Run: `cd server && npm run eval-sequencer-gate`
Expected output line:

```
  feelGood     (standard,   9 tracks)  meanDistance=0.XXX  ✓
```

**STOP CONDITION (same as Task 3):** If `feelGood` shows `✗`, escalate to the user.

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/fixtures/sequencer-goldens/pool-feelGood-standard.json
git commit -m "$(cat <<'EOF'
test(server): add feelGood-standard fixture for gate-eval harness

14-track high-valence groove pool + 2 sad/dark outliers the
sequencer must avoid. Targets feelGood vibe curve (valence
+ danceability are the dominant weights).

Verified meanDistance < 0.5 via the eval-sequencer-gate driver.

Part of #29 — gate-eval harness for Phase 1 GATE (#20).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Author `pool-melancholy-quick.json`

**Files:**
- Create: `server/__tests__/fixtures/sequencer-goldens/pool-melancholy-quick.json`

**Vibe curve reference (from `vibe-curves.ts:78-88`):**

| Position | tempo | energy | valence | danceability | acousticness | loudness | instrumentalness |
|---|---|---|---|---|---|---|---|
| open (0.00)  | 75 | 0.25 | 0.20 | 0.30 | 0.65 | 0.30 | 0.25 |
| body (0.33)  | 80 | 0.30 | 0.18 | 0.30 | 0.55 | 0.35 | 0.20 |
| peak (0.67)  | 85 | 0.45 | 0.15 | 0.35 | 0.45 | 0.45 | 0.15 |
| close (1.00) | 70 | 0.20 | 0.25 | 0.25 | 0.70 | 0.25 | 0.30 |

Weights: `{tempo: 0.10, energy: 0.20, valence: 0.28, danceability: 0.05, acousticness: 0.22, loudness: 0.05, instrumentalness: 0.10}`

**Pool design notes:** Low valence dominates (weight 0.28) — pool valence range 0.10–0.35 with a couple high-valence outliers (0.65+) the sequencer must reject. Tempo 65–95. Energy 0.15–0.50. Acousticness 0.40–0.80. The vibe is "Sufjan / Phoebe Bridgers / Iron & Wine" — slow-burn, low-lit, never wallowing.

`length=quick` → 5 picked. Pool size: **12 tracks** (smaller pool fine for quick).

- [ ] **Step 1: Write the fixture with `expectedOrder: []`**

Create `server/__tests__/fixtures/sequencer-goldens/pool-melancholy-quick.json`:

```json
{
  "name": "melancholy quick — low-valence emotional arc",
  "vibe": "melancholy",
  "length": "quick",
  "broadcastId": "golden-melancholy-quick",
  "pool": [
    { "id": "n0",  "title": "Hush",      "artistName": "NA", "albumTitle": "N1",  "duration": 220,
      "features": { "tempo": 70, "energy": 0.20, "valence": 0.22, "danceability": 0.28, "acousticness": 0.72, "loudness": 0.28, "instrumentalness": 0.28 } },
    { "id": "n1",  "title": "Window",    "artistName": "NB", "albumTitle": "N2",  "duration": 230,
      "features": { "tempo": 74, "energy": 0.24, "valence": 0.20, "danceability": 0.30, "acousticness": 0.66, "loudness": 0.30, "instrumentalness": 0.22 } },
    { "id": "n2",  "title": "Letter",    "artistName": "NC", "albumTitle": "N3",  "duration": 215,
      "features": { "tempo": 78, "energy": 0.28, "valence": 0.18, "danceability": 0.32, "acousticness": 0.58, "loudness": 0.34, "instrumentalness": 0.20 } },
    { "id": "n3",  "title": "Glass",     "artistName": "ND", "albumTitle": "N4",  "duration": 240,
      "features": { "tempo": 80, "energy": 0.30, "valence": 0.16, "danceability": 0.30, "acousticness": 0.55, "loudness": 0.36, "instrumentalness": 0.20 } },
    { "id": "n4",  "title": "Storm",     "artistName": "NE", "albumTitle": "N5",  "duration": 225,
      "features": { "tempo": 84, "energy": 0.40, "valence": 0.16, "danceability": 0.34, "acousticness": 0.48, "loudness": 0.42, "instrumentalness": 0.16 } },
    { "id": "n5",  "title": "Hold",      "artistName": "NF", "albumTitle": "N6",  "duration": 230,
      "features": { "tempo": 86, "energy": 0.46, "valence": 0.14, "danceability": 0.36, "acousticness": 0.44, "loudness": 0.46, "instrumentalness": 0.14 } },
    { "id": "n6",  "title": "Slow",      "artistName": "NG", "albumTitle": "N7",  "duration": 235,
      "features": { "tempo": 76, "energy": 0.26, "valence": 0.20, "danceability": 0.30, "acousticness": 0.62, "loudness": 0.32, "instrumentalness": 0.24 } },
    { "id": "n7",  "title": "Settle",    "artistName": "NH", "albumTitle": "N8",  "duration": 245,
      "features": { "tempo": 68, "energy": 0.18, "valence": 0.26, "danceability": 0.26, "acousticness": 0.74, "loudness": 0.26, "instrumentalness": 0.32 } },
    { "id": "n8",  "title": "Empty",     "artistName": "NI", "albumTitle": "N9",  "duration": 220,
      "features": { "tempo": 82, "energy": 0.34, "valence": 0.18, "danceability": 0.32, "acousticness": 0.50, "loudness": 0.40, "instrumentalness": 0.18 } },
    { "id": "n9",  "title": "Held",      "artistName": "NJ", "albumTitle": "N10", "duration": 235,
      "features": { "tempo": 72, "energy": 0.22, "valence": 0.24, "danceability": 0.28, "acousticness": 0.68, "loudness": 0.30, "instrumentalness": 0.26 } },
    { "id": "n10", "title": "Pop",       "artistName": "NK", "albumTitle": "N11", "duration": 200,
      "features": { "tempo": 115, "energy": 0.70, "valence": 0.78, "danceability": 0.74, "acousticness": 0.20, "loudness": 0.68, "instrumentalness": 0.05 } },
    { "id": "n11", "title": "Bright",    "artistName": "NL", "albumTitle": "N12", "duration": 210,
      "features": { "tempo": 120, "energy": 0.75, "valence": 0.82, "danceability": 0.78, "acousticness": 0.15, "loudness": 0.72, "instrumentalness": 0.05 } }
  ],
  "expectedOrder": []
}
```

- [ ] **Step 2: Capture ordering and update fixture**

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "melancholy quick"`
Capture the 5-element `Received` array from the failure output. Update `expectedOrder` in the fixture.

Re-run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "melancholy quick"`
Expected: PASS.

- [ ] **Step 3: Run the gate driver — final all-7-vibe check**

Run: `cd server && npm run eval-sequencer-gate`

Expected output (all 7 vibes, all `✓`):

```
[gate] Running 7 vibe fixtures (threshold meanDistance < 0.5)...
  feelGood     (standard,   9 tracks)  meanDistance=0.XXX  ✓
  focus        (long,      15 tracks)  meanDistance=0.XXX  ✓
  lateNight    (quick,      5 tracks)  meanDistance=0.XXX  ✓
  melancholy   (quick,      5 tracks)  meanDistance=0.XXX  ✓
  morning      (standard,   9 tracks)  meanDistance=0.XXX  ✓
  party        (long,      15 tracks)  meanDistance=0.XXX  ✓
  workout      (standard,   9 tracks)  meanDistance=0.XXX  ✓
[gate] PASS — all 7 vibe(s) below threshold
```

(Vibe order in the output depends on filename sort.)

**This is the Phase 1 GATE evaluation moment.** Capture the full output for the PR description.

**STOP CONDITION (same as Task 3):** If any vibe shows `✗`, escalate to the user with the full output before committing.

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/fixtures/sequencer-goldens/pool-melancholy-quick.json
git commit -m "$(cat <<'EOF'
test(server): add melancholy-quick fixture; complete #29 harness

12-track low-valence pool + 2 high-valence "Pop"/"Bright"
outliers the sequencer must avoid. Targets melancholy vibe
curve (low valence dominant, low energy, slow tempo).

With this fixture all 7 vibe pools are present and the
eval-sequencer-gate driver evaluates the full Phase 1 GATE.

Verified meanDistance < 0.5 across all 7 vibes via:
  cd server && npm run eval-sequencer-gate
  → [gate] PASS — all 7 vibe(s) below threshold

Closes #29.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Pre-PR checklist

- [ ] All 6 tasks complete
- [ ] `cd server && npm test` — full suite green (including the 4 new fixture entries automatically running in `sequencer-goldens.test.ts`)
- [ ] `cd server && npx tsc --noEmit` — clean
- [ ] `cd server && npm run eval-sequencer-gate` — PASS, 7/7 vibes below 0.5; capture output for PR description
- [ ] `coderabbit review --plain --base main --type committed` from repo root; verify each finding against current code, fix legitimate ones in new commits, re-run only if substantive
- [ ] `gh pr create --title "feat(server): sequencer gate-eval harness (#29)"` with body summarizing the harness + the gate result + a note that #20 (Phase 1 GATE) can now be closed if the gate passed

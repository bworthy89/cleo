# Playlist Algorithm Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LLM-based `TrackSequencer` with a deterministic numeric scoring algorithm driven by ReccoBeats audio features, fixing the "same playlist + different vibes → identical order" bug.

**Architecture:** Every track gets an `AudioFeatures` vector (via ReccoBeats → Deezer → Last.fm → genre defaults → neutrals). Each vibe has a 4-keyframe curve (open, body, peak, close) in `vibe-curves.ts`. For each slot, compute interpolated target, score every remaining track by weighted L2 distance + adjacency penalty, pick one from top-K candidates using a `mulberry32` PRNG seeded on `broadcastId`. No LLM in the ordering path.

**Tech Stack:** TypeScript strict, Node 20 / Express server, Jest + ts-jest, existing Apple MusicKit Swift module, ReccoBeats + Deezer + Last.fm HTTP APIs.

**Spec:** `docs/superpowers/specs/2026-04-21-playlist-algorithm-redesign-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/src/services/broadcast/audio-features.ts` | `AudioFeatures` interface, normalization helpers (`normalizeTempo`, `normalizeLoudness`), neutral defaults constant |
| `server/src/services/broadcast/prng.ts` | `mulberry32` seeded PRNG + hash-to-uint32 helper |
| `server/src/services/broadcast/scoring.ts` | `weightedDistance`, `adjacencyPenalty`, `interpolateKeyframes` — pure functions |
| `server/src/services/broadcast/vibe-curves.ts` | `VIBE_CURVES` record: keyframes + weights per vibe (hand-authored from prose) |
| `server/src/services/broadcast/feature-synth.ts` | Synthesize features from Last.fm tags + `GenreFamily` + partial external data |
| `server/src/services/enrichment/fetchers/ReccoBeatsFetcher.ts` | Tier-1 features fetcher; batched ISRC lookups |
| `server/src/services/enrichment/fetchers/DeezerFeaturesFetcher.ts` | Tier-2 features fetcher; ISRC lookup returning BPM + loudness |
| `server/src/services/broadcast/FeatureFetchChain.ts` | Orchestrates the 5-tier fallback ladder; returns a complete `AudioFeatures` + source marker |
| `server/src/services/broadcast/deep-dives.ts` | `nominateDeepDives` — rank transitions by enrichment richness, cap at `ceil((N-1)/4)` |
| `server/src/services/broadcast/DeterministicTrackSequencer.ts` | The new sequencer class; identical interface to the old `TrackSequencer` |
| `server/__tests__/fixtures/sequencer-goldens/pool-late-night-quick.json` | Golden fixture: pool + expected orderedTracks for regression |
| `server/__tests__/fixtures/sequencer-goldens/pool-morning-standard.json` | Golden fixture |
| `server/__tests__/fixtures/sequencer-goldens/pool-party-long.json` | Golden fixture |

### Modified files

| File | Change |
|------|--------|
| `server/src/services/enrichment/EnrichmentCache.ts` | Extend `EnrichmentRecord` with `isrc`, `features`, `featuresSource`, `featuresAt`, `featuresVersion` (all optional) |
| `server/src/services/enrichment/BackgroundEnricher.ts` | Add `fetchFeatures` stage invoked after existing enrichment; merged into cache writes |
| `server/src/services/broadcast/TrackSequencer.ts` | Rename class to `LLMTrackSequencer`, keep behind env flag |
| `server/src/services/broadcast/BroadcastOrchestrator.ts` | `SEQUENCER_MODE` env var selects `DeterministicTrackSequencer` vs `LLMTrackSequencer` |
| `server/src/routes/broadcast.ts` | Zod `trackSchema` gains `isrc: z.string().length(12).optional()` |
| `server/src/routes/featured.ts` | Same Zod change |
| `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` | `Song.isrc` included in serialized playlist tracks |
| `modules/expo-music-kit/index.ts` | `MusicTrack` interface gains `isrc?: string` |
| `src/engines/BroadcastManifestClient.ts` | `sanitizeTracksForBake` passes `isrc` through when present |
| `CLAUDE.md` | Document new sequencer architecture, `SEQUENCER_MODE` env, feature-source telemetry |

### Deleted (after rollout soak; tracked in final task)

- `server/src/services/broadcast/SequenceCache.ts`
- Everything LLM-era inside `TrackSequencer.ts` (now `LLMTrackSequencer.ts`): `parseResponse`, `buildPrompt`, `attemptSequence`, `SYSTEM_PROMPT`, `fixupFeatureSlots`
- The iterative swap-loop in `sequence-repair.ts` (`repairSequence` function with `MAX_PASSES`); `removeDuplicates` is retained for the fallback path

---

## Task 1: Audio features type and neutrals

**Files:**
- Create: `server/src/services/broadcast/audio-features.ts`
- Test: `server/__tests__/broadcast/audio-features.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/audio-features.test.ts
import {
  AudioFeatures,
  NEUTRAL_FEATURES,
  normalizeTempo,
  normalizeLoudness,
} from '../../src/services/broadcast/audio-features';

describe('audio-features', () => {
  describe('normalizeTempo', () => {
    it('maps 40 BPM to 0, 200 BPM to 1', () => {
      expect(normalizeTempo(40)).toBe(0);
      expect(normalizeTempo(200)).toBe(1);
    });
    it('maps 120 BPM to 0.5', () => {
      expect(normalizeTempo(120)).toBe(0.5);
    });
    it('clamps out-of-range inputs', () => {
      expect(normalizeTempo(20)).toBe(0);
      expect(normalizeTempo(400)).toBe(1);
    });
  });

  describe('normalizeLoudness', () => {
    it('maps -60 dB to 0, 0 dB to 1', () => {
      expect(normalizeLoudness(-60)).toBe(0);
      expect(normalizeLoudness(0)).toBe(1);
    });
    it('clamps below -60 dB', () => {
      expect(normalizeLoudness(-80)).toBe(0);
    });
  });

  describe('NEUTRAL_FEATURES', () => {
    it('has all required fields with mid-range values', () => {
      const n: AudioFeatures = NEUTRAL_FEATURES;
      expect(n.tempo).toBe(100);
      expect(n.energy).toBe(0.5);
      expect(n.valence).toBe(0.5);
      expect(n.danceability).toBe(0.5);
      expect(n.acousticness).toBe(0.4);
      expect(n.loudness).toBe(0.5);
      expect(n.instrumentalness).toBe(0.2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/audio-features.test.ts`
Expected: FAIL — "Cannot find module '../../src/services/broadcast/audio-features'"

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/audio-features.ts
export interface AudioFeatures {
  tempo: number;            // BPM, typically 40-200
  energy: number;           // 0-1
  valence: number;          // 0-1 (sad → happy)
  danceability: number;     // 0-1
  acousticness: number;     // 0-1
  loudness: number;         // normalized 0-1 from (dB + 60) / 60
  instrumentalness: number; // 0-1
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function normalizeTempo(bpm: number): number {
  return clamp01((bpm - 40) / 160);
}

export function normalizeLoudness(db: number): number {
  return clamp01((db + 60) / 60);
}

export const NEUTRAL_FEATURES: AudioFeatures = {
  tempo: 100,
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.4,
  loudness: 0.5,
  instrumentalness: 0.2,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/audio-features.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/audio-features.ts server/__tests__/broadcast/audio-features.test.ts
git commit -m "feat(sequencer): AudioFeatures type + normalization helpers"
```

---

## Task 2: Seeded PRNG (mulberry32)

**Files:**
- Create: `server/src/services/broadcast/prng.ts`
- Test: `server/__tests__/broadcast/prng.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/prng.test.ts
import { mulberry32, hashToUint32, seededPRNG } from '../../src/services/broadcast/prng';

describe('prng', () => {
  describe('mulberry32', () => {
    it('produces identical sequences for same seed', () => {
      const a = mulberry32(12345);
      const b = mulberry32(12345);
      const seqA = [a(), a(), a(), a(), a()];
      const seqB = [b(), b(), b(), b(), b()];
      expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
      const a = mulberry32(1);
      const b = mulberry32(2);
      expect(a()).not.toBe(b());
    });

    it('returns values in [0, 1)', () => {
      const r = mulberry32(42);
      for (let i = 0; i < 100; i++) {
        const v = r();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('hashToUint32', () => {
    it('returns stable uint32 for the same string', () => {
      expect(hashToUint32('abc')).toBe(hashToUint32('abc'));
    });

    it('returns different values for different strings', () => {
      expect(hashToUint32('abc')).not.toBe(hashToUint32('abd'));
    });
  });

  describe('seededPRNG.pickIndex', () => {
    it('returns an integer in [0, n)', () => {
      const rng = seededPRNG('broadcast-xyz');
      for (let i = 0; i < 50; i++) {
        const idx = rng.pickIndex(5);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(5);
        expect(Number.isInteger(idx)).toBe(true);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/prng.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/prng.ts
import { createHash } from 'crypto';

/**
 * mulberry32 — small, fast, deterministic PRNG.
 * https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashToUint32(s: string): number {
  const hex = createHash('sha256').update(s).digest('hex').slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

export interface SeededPRNG {
  next: () => number;        // [0, 1)
  pickIndex: (n: number) => number; // integer in [0, n)
}

export function seededPRNG(seed: string): SeededPRNG {
  const gen = mulberry32(hashToUint32(seed));
  return {
    next: gen,
    pickIndex: (n: number) => Math.floor(gen() * n),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/prng.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/prng.ts server/__tests__/broadcast/prng.test.ts
git commit -m "feat(sequencer): mulberry32 seeded PRNG for top-K sampling"
```

---

## Task 3: Scoring primitives (distance, adjacency, interpolation)

**Files:**
- Create: `server/src/services/broadcast/scoring.ts`
- Test: `server/__tests__/broadcast/scoring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/scoring.test.ts
import {
  weightedDistance,
  adjacencyPenalty,
  interpolateKeyframes,
  AudioFeatureWeights,
  Keyframe,
} from '../../src/services/broadcast/scoring';
import { AudioFeatures, NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';

const UNIFORM_WEIGHTS: AudioFeatureWeights = {
  tempo: 1/7, energy: 1/7, valence: 1/7, danceability: 1/7,
  acousticness: 1/7, loudness: 1/7, instrumentalness: 1/7,
};

describe('weightedDistance', () => {
  it('returns 0 for identical vectors', () => {
    const d = weightedDistance(NEUTRAL_FEATURES, NEUTRAL_FEATURES, UNIFORM_WEIGHTS);
    expect(d).toBe(0);
  });

  it('is symmetric', () => {
    const a: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 0.2 };
    const b: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 0.8 };
    const d1 = weightedDistance(a, b, UNIFORM_WEIGHTS);
    const d2 = weightedDistance(b, a, UNIFORM_WEIGHTS);
    expect(d1).toBeCloseTo(d2, 10);
  });

  it('respects per-feature weights', () => {
    const a: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 0.0 };
    const b: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 1.0 };
    const highEnergy: AudioFeatureWeights = {
      tempo: 0, energy: 1, valence: 0, danceability: 0,
      acousticness: 0, loudness: 0, instrumentalness: 0,
    };
    expect(weightedDistance(a, b, highEnergy)).toBe(1);
    const zeroEnergy: AudioFeatureWeights = {
      tempo: 1, energy: 0, valence: 0, danceability: 0,
      acousticness: 0, loudness: 0, instrumentalness: 0,
    };
    expect(weightedDistance(a, b, zeroEnergy)).toBe(0);
  });
});

describe('adjacencyPenalty', () => {
  const trackA = { id: '1', title: 't', artistName: 'Alice', albumTitle: 'X',
    duration: 200 } as any;
  const trackB = { id: '2', title: 'u', artistName: 'Alice', albumTitle: 'Y',
    duration: 200 } as any;
  const trackC = { id: '3', title: 'v', artistName: 'Alice', albumTitle: 'X',
    duration: 200 } as any;
  const trackD = { id: '4', title: 'w', artistName: 'Bob', albumTitle: 'Z',
    duration: 200 } as any;

  it('returns 0 when no previous track', () => {
    expect(adjacencyPenalty(trackB, undefined)).toBe(0);
  });

  it('returns 0.30 when album matches previous', () => {
    expect(adjacencyPenalty(trackC, trackA)).toBe(0.30);
  });

  it('returns 0.15 when artist matches but album differs', () => {
    expect(adjacencyPenalty(trackB, trackA)).toBe(0.15);
  });

  it('returns 0 when both differ', () => {
    expect(adjacencyPenalty(trackD, trackA)).toBe(0);
  });
});

describe('interpolateKeyframes', () => {
  const kf: Keyframe[] = [
    { position: 0.0, targets: { ...NEUTRAL_FEATURES, energy: 0.2 } },
    { position: 0.5, targets: { ...NEUTRAL_FEATURES, energy: 0.6 } },
    { position: 1.0, targets: { ...NEUTRAL_FEATURES, energy: 0.4 } },
  ];

  it('returns the keyframe target at exact positions', () => {
    expect(interpolateKeyframes(kf, 0.0).energy).toBeCloseTo(0.2);
    expect(interpolateKeyframes(kf, 0.5).energy).toBeCloseTo(0.6);
    expect(interpolateKeyframes(kf, 1.0).energy).toBeCloseTo(0.4);
  });

  it('lerps between keyframes', () => {
    expect(interpolateKeyframes(kf, 0.25).energy).toBeCloseTo(0.4);   // halfway 0.2→0.6
    expect(interpolateKeyframes(kf, 0.75).energy).toBeCloseTo(0.5);   // halfway 0.6→0.4
  });

  it('clamps out-of-range positions', () => {
    expect(interpolateKeyframes(kf, -0.5).energy).toBeCloseTo(0.2);
    expect(interpolateKeyframes(kf, 1.5).energy).toBeCloseTo(0.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/scoring.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/scoring.ts
import type { AudioFeatures } from './audio-features';
import { normalizeTempo, normalizeLoudness } from './audio-features';
import type { ManifestTrack } from './types';

export interface AudioFeatureWeights {
  tempo: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  loudness: number;
  instrumentalness: number;
}

export interface Keyframe {
  position: number;           // 0.0 → 1.0
  targets: AudioFeatures;
}

/**
 * Normalize a vector to the 0-1 space used for scoring (tempo + loudness
 * need remapping; others are already normalized).
 */
function toScoringSpace(f: AudioFeatures): AudioFeatures {
  return {
    ...f,
    tempo: normalizeTempo(f.tempo),
    loudness: f.loudness, // already normalized at ingest
  };
}

/**
 * Weighted Euclidean distance between two AudioFeatures vectors.
 * Returns 0-1; 0 means identical, 1 means maximally different.
 */
export function weightedDistance(
  a: AudioFeatures,
  b: AudioFeatures,
  weights: AudioFeatureWeights,
): number {
  const na = toScoringSpace(a);
  const nb = toScoringSpace(b);
  const keys: (keyof AudioFeatureWeights)[] = [
    'tempo', 'energy', 'valence', 'danceability',
    'acousticness', 'loudness', 'instrumentalness',
  ];
  let sum = 0;
  for (const k of keys) {
    const diff = na[k] - nb[k];
    sum += weights[k] * diff * diff;
  }
  return Math.sqrt(Math.max(0, sum));
}

/**
 * Adjacency penalty: discourage (but don't forbid) same-artist/same-album
 * transitions. Added to the distance score in TrackSequencer.
 */
export function adjacencyPenalty(
  candidate: ManifestTrack,
  previous: ManifestTrack | undefined,
): number {
  if (!previous) return 0;
  if (candidate.albumTitle && candidate.albumTitle === previous.albumTitle) {
    return 0.30;
  }
  if (candidate.artistName === previous.artistName) {
    return 0.15;
  }
  return 0;
}

function lerpAudioFeatures(
  a: AudioFeatures, b: AudioFeatures, t: number,
): AudioFeatures {
  return {
    tempo:            a.tempo + (b.tempo - a.tempo) * t,
    energy:           a.energy + (b.energy - a.energy) * t,
    valence:          a.valence + (b.valence - a.valence) * t,
    danceability:     a.danceability + (b.danceability - a.danceability) * t,
    acousticness:     a.acousticness + (b.acousticness - a.acousticness) * t,
    loudness:         a.loudness + (b.loudness - a.loudness) * t,
    instrumentalness: a.instrumentalness + (b.instrumentalness - a.instrumentalness) * t,
  };
}

/**
 * Interpolate the target AudioFeatures at fractional position `p` across
 * keyframes. Keyframes must be sorted by position.
 */
export function interpolateKeyframes(
  keyframes: Keyframe[],
  p: number,
): AudioFeatures {
  if (keyframes.length === 0) {
    throw new Error('interpolateKeyframes requires at least one keyframe');
  }
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped <= keyframes[0].position) return { ...keyframes[0].targets };
  const last = keyframes[keyframes.length - 1];
  if (clamped >= last.position) return { ...last.targets };
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (clamped >= a.position && clamped <= b.position) {
      const span = b.position - a.position;
      const t = span === 0 ? 0 : (clamped - a.position) / span;
      return lerpAudioFeatures(a.targets, b.targets, t);
    }
  }
  return { ...last.targets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/scoring.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/scoring.ts server/__tests__/broadcast/scoring.test.ts
git commit -m "feat(sequencer): weightedDistance, adjacencyPenalty, interpolateKeyframes"
```

---

## Task 4: Vibe curves data (all 7 vibes)

**Files:**
- Create: `server/src/services/broadcast/vibe-curves.ts`
- Test: `server/__tests__/broadcast/vibe-curves.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/vibe-curves.test.ts
import { VIBE_CURVES } from '../../src/services/broadcast/vibe-curves';
import type { Vibe } from '../../src/services/broadcast/types';

const ALL_VIBES: Vibe[] = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
];

describe('VIBE_CURVES', () => {
  it.each(ALL_VIBES)('has exactly 4 keyframes for %s', (vibe) => {
    expect(VIBE_CURVES[vibe].keyframes).toHaveLength(4);
  });

  it.each(ALL_VIBES)('has canonical positions 0.0 / 0.33 / 0.67 / 1.0 for %s', (vibe) => {
    const positions = VIBE_CURVES[vibe].keyframes.map(k => k.position);
    expect(positions[0]).toBe(0.0);
    expect(positions[1]).toBeCloseTo(0.33, 2);
    expect(positions[2]).toBeCloseTo(0.67, 2);
    expect(positions[3]).toBe(1.0);
  });

  it.each(ALL_VIBES)('has weights summing to approximately 1 for %s', (vibe) => {
    const w = VIBE_CURVES[vibe].weights;
    const sum = w.tempo + w.energy + w.valence + w.danceability
              + w.acousticness + w.loudness + w.instrumentalness;
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('workout has higher peak tempo than lateNight', () => {
    const workoutPeak = VIBE_CURVES.workout.keyframes[2].targets.tempo;
    const lateNightPeak = VIBE_CURVES.lateNight.keyframes[2].targets.tempo;
    expect(workoutPeak).toBeGreaterThan(lateNightPeak);
  });

  it('focus weights instrumentalness higher than workout does', () => {
    expect(VIBE_CURVES.focus.weights.instrumentalness)
      .toBeGreaterThan(VIBE_CURVES.workout.weights.instrumentalness);
  });

  it('melancholy weights valence high (valence matters to sad/happy axis)', () => {
    expect(VIBE_CURVES.melancholy.weights.valence).toBeGreaterThanOrEqual(0.20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/vibe-curves.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/vibe-curves.ts
import type { Vibe } from './types';
import type { Keyframe, AudioFeatureWeights } from './scoring';

export interface VibeCurve {
  keyframes: [Keyframe, Keyframe, Keyframe, Keyframe];
  weights: AudioFeatureWeights;
}

// Positions are standardized across all vibes: open / body / peak / close.
const P_OPEN  = 0.00;
const P_BODY  = 0.33;
const P_PEAK  = 0.67;
const P_CLOSE = 1.00;

export const VIBE_CURVES: Record<Vibe, VibeCurve> = {
  // "Opens fresh — a song that sounds like a window opening. Mid-tempo,
  //  major key. Picks up steadily but never sprints. Peak is a gently
  //  uplifting mid-tempo anthem, never club energy. Close leaves ready to move."
  morning: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 95,  energy: 0.45, valence: 0.65, danceability: 0.50, acousticness: 0.45, loudness: 0.50, instrumentalness: 0.10 } },
      { position: P_BODY,  targets: { tempo: 105, energy: 0.55, valence: 0.70, danceability: 0.55, acousticness: 0.35, loudness: 0.55, instrumentalness: 0.08 } },
      { position: P_PEAK,  targets: { tempo: 115, energy: 0.70, valence: 0.75, danceability: 0.65, acousticness: 0.25, loudness: 0.65, instrumentalness: 0.05 } },
      { position: P_CLOSE, targets: { tempo: 105, energy: 0.55, valence: 0.70, danceability: 0.55, acousticness: 0.35, loudness: 0.55, instrumentalness: 0.08 } },
    ],
    weights: {
      tempo: 0.18, energy: 0.22, valence: 0.25, danceability: 0.12,
      acousticness: 0.10, loudness: 0.08, instrumentalness: 0.05,
    },
  },

  // "Opens textural, undemanding — instrumental or near-instrumental. No
  //  vocal hooks that pull you out. Body in lane; timbral variation only.
  //  No traditional peak — a mid-session plateau. Close suggests stopping."
  focus: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 85, energy: 0.30, valence: 0.50, danceability: 0.35, acousticness: 0.50, loudness: 0.35, instrumentalness: 0.75 } },
      { position: P_BODY,  targets: { tempo: 90, energy: 0.35, valence: 0.50, danceability: 0.35, acousticness: 0.45, loudness: 0.40, instrumentalness: 0.75 } },
      { position: P_PEAK,  targets: { tempo: 95, energy: 0.40, valence: 0.50, danceability: 0.40, acousticness: 0.40, loudness: 0.45, instrumentalness: 0.70 } },
      { position: P_CLOSE, targets: { tempo: 85, energy: 0.30, valence: 0.50, danceability: 0.35, acousticness: 0.50, loudness: 0.35, instrumentalness: 0.75 } },
    ],
    weights: {
      tempo: 0.10, energy: 0.20, valence: 0.05, danceability: 0.05,
      acousticness: 0.15, loudness: 0.15, instrumentalness: 0.30,
    },
  },

  // "Arrives running — immediate energy, clear pulse, 120+ BPM. Body holds
  //  plateau. Peak is the hardest-hitting cut, late-middle. Descent minimal
  //  until last track, which comes down but keeps momentum — finish line."
  workout: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 125, energy: 0.75, valence: 0.65, danceability: 0.70, acousticness: 0.15, loudness: 0.75, instrumentalness: 0.05 } },
      { position: P_BODY,  targets: { tempo: 130, energy: 0.80, valence: 0.65, danceability: 0.75, acousticness: 0.12, loudness: 0.80, instrumentalness: 0.05 } },
      { position: P_PEAK,  targets: { tempo: 140, energy: 0.90, valence: 0.70, danceability: 0.80, acousticness: 0.10, loudness: 0.85, instrumentalness: 0.03 } },
      { position: P_CLOSE, targets: { tempo: 115, energy: 0.65, valence: 0.70, danceability: 0.65, acousticness: 0.20, loudness: 0.70, instrumentalness: 0.05 } },
    ],
    weights: {
      tempo: 0.25, energy: 0.30, valence: 0.10, danceability: 0.15,
      acousticness: 0.05, loudness: 0.12, instrumentalness: 0.03,
    },
  },

  // "Opens instantly warm — a groove you can nod to from the first bar.
  //  Major key, hook-forward. Body builds generosity. Peak is the track
  //  that makes people sing along. Descent stays warm. Leaves a smile."
  feelGood: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 105, energy: 0.60, valence: 0.75, danceability: 0.70, acousticness: 0.25, loudness: 0.60, instrumentalness: 0.05 } },
      { position: P_BODY,  targets: { tempo: 110, energy: 0.65, valence: 0.80, danceability: 0.75, acousticness: 0.20, loudness: 0.65, instrumentalness: 0.05 } },
      { position: P_PEAK,  targets: { tempo: 115, energy: 0.75, valence: 0.85, danceability: 0.80, acousticness: 0.18, loudness: 0.70, instrumentalness: 0.05 } },
      { position: P_CLOSE, targets: { tempo: 100, energy: 0.55, valence: 0.78, danceability: 0.65, acousticness: 0.25, loudness: 0.55, instrumentalness: 0.05 } },
    ],
    weights: {
      tempo: 0.10, energy: 0.18, valence: 0.28, danceability: 0.22,
      acousticness: 0.07, loudness: 0.10, instrumentalness: 0.05,
    },
  },

  // "Opens low-lit — slow-burn vocal, 75-90 BPM, single lamp on. Texture
  //  builds, volume doesn't. Peak is a groove, never a banger — 2am college
  //  radio. Descent comes way down. Close is hushed: solo piano or acoustic."
  lateNight: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 80, energy: 0.25, valence: 0.30, danceability: 0.40, acousticness: 0.50, loudness: 0.35, instrumentalness: 0.20 } },
      { position: P_BODY,  targets: { tempo: 85, energy: 0.40, valence: 0.35, danceability: 0.50, acousticness: 0.35, loudness: 0.45, instrumentalness: 0.15 } },
      { position: P_PEAK,  targets: { tempo: 90, energy: 0.50, valence: 0.40, danceability: 0.60, acousticness: 0.25, loudness: 0.50, instrumentalness: 0.10 } },
      { position: P_CLOSE, targets: { tempo: 75, energy: 0.20, valence: 0.30, danceability: 0.30, acousticness: 0.70, loudness: 0.30, instrumentalness: 0.30 } },
    ],
    weights: {
      tempo: 0.15, energy: 0.25, valence: 0.20, danceability: 0.05,
      acousticness: 0.25, loudness: 0.05, instrumentalness: 0.05,
    },
  },

  // "Opens slow without wallowing — piano, strings, or spare vocal.
  //  Body deepens. Peak is emotional, not energetic — minor key or
  //  unresolved. Descent stays in register. Close leaves held, not dropped."
  melancholy: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 75, energy: 0.25, valence: 0.20, danceability: 0.30, acousticness: 0.65, loudness: 0.30, instrumentalness: 0.25 } },
      { position: P_BODY,  targets: { tempo: 80, energy: 0.30, valence: 0.18, danceability: 0.30, acousticness: 0.55, loudness: 0.35, instrumentalness: 0.20 } },
      { position: P_PEAK,  targets: { tempo: 85, energy: 0.45, valence: 0.15, danceability: 0.35, acousticness: 0.45, loudness: 0.45, instrumentalness: 0.15 } },
      { position: P_CLOSE, targets: { tempo: 70, energy: 0.20, valence: 0.25, danceability: 0.25, acousticness: 0.70, loudness: 0.25, instrumentalness: 0.30 } },
    ],
    weights: {
      tempo: 0.10, energy: 0.20, valence: 0.28, danceability: 0.05,
      acousticness: 0.22, loudness: 0.05, instrumentalness: 0.10,
    },
  },

  // "Arrives confident but not peaked — 100-115 BPM. Body climbs steadily.
  //  Peak is mid-to-late — biggest track, most-danceable. Brief descent
  //  drops to released communal energy. Close leaves the room elevated."
  party: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 108, energy: 0.65, valence: 0.70, danceability: 0.75, acousticness: 0.15, loudness: 0.70, instrumentalness: 0.05 } },
      { position: P_BODY,  targets: { tempo: 115, energy: 0.75, valence: 0.75, danceability: 0.80, acousticness: 0.12, loudness: 0.75, instrumentalness: 0.05 } },
      { position: P_PEAK,  targets: { tempo: 122, energy: 0.85, valence: 0.80, danceability: 0.88, acousticness: 0.10, loudness: 0.82, instrumentalness: 0.03 } },
      { position: P_CLOSE, targets: { tempo: 112, energy: 0.70, valence: 0.78, danceability: 0.75, acousticness: 0.14, loudness: 0.72, instrumentalness: 0.05 } },
    ],
    weights: {
      tempo: 0.18, energy: 0.22, valence: 0.15, danceability: 0.28,
      acousticness: 0.05, loudness: 0.10, instrumentalness: 0.02,
    },
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/vibe-curves.test.ts`
Expected: PASS (24+ tests from `it.each`)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/vibe-curves.ts server/__tests__/broadcast/vibe-curves.test.ts
git commit -m "feat(sequencer): VIBE_CURVES — 4-keyframe numeric trajectories per vibe"
```

---

## Task 5: Feature synthesis from genre/tags

**Files:**
- Create: `server/src/services/broadcast/feature-synth.ts`
- Test: `server/__tests__/broadcast/feature-synth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/feature-synth.test.ts
import { synthesizeFeatures, applyTagOverrides } from '../../src/services/broadcast/feature-synth';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';

describe('feature-synth', () => {
  describe('synthesizeFeatures', () => {
    it('uses genre-family defaults when given a genre', () => {
      const f = synthesizeFeatures({ genreFamily: 'ambient' });
      expect(f.instrumentalness).toBeGreaterThan(0.5);
      expect(f.tempo).toBeLessThan(100);
    });

    it('returns neutrals when no signals present', () => {
      const f = synthesizeFeatures({});
      expect(f).toEqual(NEUTRAL_FEATURES);
    });

    it('preserves ReccoBeats partial data', () => {
      const f = synthesizeFeatures({
        partialFeatures: { tempo: 130, energy: 0.8 },
        genreFamily: 'rock',
      });
      expect(f.tempo).toBe(130);
      expect(f.energy).toBe(0.8);
    });

    it('overrides acousticness for ambient genre even with partial pop data', () => {
      const f = synthesizeFeatures({
        partialFeatures: { tempo: 85, energy: 0.3 },
        genreFamily: 'ambient',
      });
      expect(f.instrumentalness).toBeGreaterThan(0.5);
    });
  });

  describe('applyTagOverrides', () => {
    it('applies chill → lower energy + valence', () => {
      const f = applyTagOverrides(NEUTRAL_FEATURES, ['chill']);
      expect(f.energy).toBeLessThan(NEUTRAL_FEATURES.energy);
    });

    it('applies upbeat → higher valence', () => {
      const f = applyTagOverrides(NEUTRAL_FEATURES, ['upbeat']);
      expect(f.valence).toBeGreaterThan(NEUTRAL_FEATURES.valence);
    });

    it('averages overlapping tags', () => {
      const chillOnly = applyTagOverrides(NEUTRAL_FEATURES, ['chill']);
      const melancholyOnly = applyTagOverrides(NEUTRAL_FEATURES, ['melancholy']);
      const combined = applyTagOverrides(NEUTRAL_FEATURES, ['chill', 'melancholy']);
      // Both push valence down; combined should average between pure-chill
      // and pure-melancholy, not go below either.
      expect(combined.valence).toBeGreaterThanOrEqual(Math.min(chillOnly.valence, melancholyOnly.valence));
      expect(combined.valence).toBeLessThanOrEqual(Math.max(chillOnly.valence, melancholyOnly.valence));
    });

    it('ignores unknown tags', () => {
      const f = applyTagOverrides(NEUTRAL_FEATURES, ['unknownTag']);
      expect(f).toEqual(NEUTRAL_FEATURES);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/feature-synth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/feature-synth.ts
import type { AudioFeatures } from './audio-features';
import { NEUTRAL_FEATURES } from './audio-features';
import type { GenreFamily } from './GenreFamily';

/**
 * Partial ReccoBeats / Deezer response shape. Anything that arrives complete
 * bypasses synthesis; anything missing gets filled from the other sources.
 */
export interface SynthInput {
  partialFeatures?: Partial<AudioFeatures>;
  genreFamily?: GenreFamily;
  lastFmTags?: string[];
}

const GENRE_DEFAULTS: Partial<Record<GenreFamily, Partial<AudioFeatures>>> = {
  ambient:        { tempo: 75,  energy: 0.25, valence: 0.45, danceability: 0.20, acousticness: 0.60, loudness: 0.35, instrumentalness: 0.80 },
  electronic:     { tempo: 125, energy: 0.70, valence: 0.60, danceability: 0.75, acousticness: 0.10, loudness: 0.70, instrumentalness: 0.40 },
  rock:           { tempo: 120, energy: 0.75, valence: 0.60, danceability: 0.55, acousticness: 0.15, loudness: 0.75, instrumentalness: 0.05 },
  pop:            { tempo: 110, energy: 0.65, valence: 0.70, danceability: 0.70, acousticness: 0.20, loudness: 0.65, instrumentalness: 0.05 },
  hiphop:         { tempo: 90,  energy: 0.65, valence: 0.55, danceability: 0.75, acousticness: 0.12, loudness: 0.70, instrumentalness: 0.03 },
  rnb:            { tempo: 95,  energy: 0.55, valence: 0.55, danceability: 0.65, acousticness: 0.25, loudness: 0.55, instrumentalness: 0.05 },
  soul:           { tempo: 95,  energy: 0.55, valence: 0.60, danceability: 0.65, acousticness: 0.30, loudness: 0.55, instrumentalness: 0.05 },
  jazz:           { tempo: 100, energy: 0.45, valence: 0.55, danceability: 0.45, acousticness: 0.60, loudness: 0.40, instrumentalness: 0.40 },
  classical:      { tempo: 90,  energy: 0.35, valence: 0.50, danceability: 0.25, acousticness: 0.85, loudness: 0.30, instrumentalness: 0.85 },
  country:        { tempo: 110, energy: 0.60, valence: 0.65, danceability: 0.55, acousticness: 0.40, loudness: 0.55, instrumentalness: 0.05 },
  folk:           { tempo: 100, energy: 0.45, valence: 0.55, danceability: 0.40, acousticness: 0.65, loudness: 0.40, instrumentalness: 0.10 },
  latin:          { tempo: 115, energy: 0.75, valence: 0.75, danceability: 0.80, acousticness: 0.20, loudness: 0.65, instrumentalness: 0.05 },
  generic:        {},
};

interface TagEffect {
  energy?: number;
  valence?: number;
  danceability?: number;
  acousticness?: number;
}

const TAG_TABLE: Record<string, TagEffect> = {
  chill:         { energy: 0.30, valence: 0.45 },
  mellow:        { energy: 0.35, valence: 0.50 },
  energetic:     { energy: 0.80 },
  upbeat:        { energy: 0.70, valence: 0.80 },
  happy:         { valence: 0.80 },
  melancholy:    { energy: 0.35, valence: 0.20 },
  sad:           { energy: 0.30, valence: 0.15 },
  intense:       { energy: 0.85 },
  aggressive:    { energy: 0.85, valence: 0.35 },
  romantic:      { energy: 0.40, valence: 0.65, acousticness: 0.55 },
  dreamy:        { energy: 0.30, valence: 0.55, acousticness: 0.60 },
  groovy:        { danceability: 0.80, energy: 0.65 },
  danceable:     { danceability: 0.85 },
  acoustic:      { acousticness: 0.80, energy: 0.35 },
  ambient:       { energy: 0.25, acousticness: 0.70 },
};

/**
 * Merge tag-based feature adjustments into a base vector. Overlapping
 * tags average their effects on the same field.
 */
export function applyTagOverrides(
  base: AudioFeatures, tags: string[],
): AudioFeatures {
  const accum: Partial<Record<keyof AudioFeatures, number[]>> = {};
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    const effect = TAG_TABLE[tag];
    if (!effect) continue;
    for (const key of Object.keys(effect) as (keyof TagEffect)[]) {
      const v = effect[key];
      if (v === undefined) continue;
      if (!accum[key]) accum[key] = [];
      accum[key]!.push(v);
    }
  }
  const result = { ...base };
  for (const key of Object.keys(accum) as (keyof AudioFeatures)[]) {
    const values = accum[key];
    if (!values || values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    (result as Record<string, number>)[key] = avg;
  }
  return result;
}

/**
 * Produce a complete AudioFeatures vector from whatever signals are
 * available. Priority (most→least trusted): partialFeatures → tags → genre → neutrals.
 */
export function synthesizeFeatures(input: SynthInput): AudioFeatures {
  const genreBase: Partial<AudioFeatures> = input.genreFamily
    ? (GENRE_DEFAULTS[input.genreFamily] ?? {})
    : {};
  const base: AudioFeatures = {
    ...NEUTRAL_FEATURES,
    ...genreBase,
  };
  const withTags = input.lastFmTags?.length
    ? applyTagOverrides(base, input.lastFmTags)
    : base;
  const withPartial: AudioFeatures = {
    ...withTags,
    ...(input.partialFeatures ?? {}),
  };
  return withPartial;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/feature-synth.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/feature-synth.ts server/__tests__/broadcast/feature-synth.test.ts
git commit -m "feat(sequencer): synthesize AudioFeatures from genre + tags + partial data"
```

---

## Task 6: ReccoBeats fetcher

**Files:**
- Create: `server/src/services/enrichment/fetchers/ReccoBeatsFetcher.ts`
- Test: `server/__tests__/enrichment/ReccoBeatsFetcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/enrichment/ReccoBeatsFetcher.test.ts
import { ReccoBeatsFetcher } from '../../src/services/enrichment/fetchers/ReccoBeatsFetcher';

const originalFetch = global.fetch;

describe('ReccoBeatsFetcher', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns features keyed by ISRC, not by ReccoBeats id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          id: '2670c328-c40f-45f4-80df-f48b29296deb',  // UUID — NOT the ISRC
          isrc: 'USRC17607839',
          tempo: 123.4, energy: 0.72, valence: 0.55,
          danceability: 0.68, acousticness: 0.12,
          loudness: -6.2, instrumentalness: 0.02,
        }],
      }),
    } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(1);
    const rec = out.get('USRC17607839');  // ← keyed by ISRC, not UUID
    expect(rec?.tempo).toBe(123.4);
    expect(rec?.loudness).toBeCloseTo(0.897, 2); // (−6.2 + 60) / 60
    expect(out.get('2670c328-c40f-45f4-80df-f48b29296deb')).toBeUndefined();
  });

  it('returns empty map on API 500 after one retry', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'bad',
    } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('chunks more than 10 ISRCs into multiple requests', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as any);
    const f = new ReccoBeatsFetcher();
    const isrcs = Array.from({ length: 25 }, (_, i) => `USRC${String(i).padStart(8, '0')}`);
    await f.fetch(isrcs);
    expect(global.fetch).toHaveBeenCalledTimes(3); // 10 + 10 + 5
  });

  it('skips missing ISRCs gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/ReccoBeatsFetcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/enrichment/fetchers/ReccoBeatsFetcher.ts
import { normalizeLoudness } from '../../broadcast/audio-features';
import type { AudioFeatures } from '../../broadcast/audio-features';

const BATCH_SIZE = 10;
const BASE_URL = 'https://api.reccobeats.com/v1/audio-features';
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1000;
const BATCH_GAP_MS = 500;

interface ReccoResponse {
  content?: Array<{
    id: string;
    isrc?: string;       // ReccoBeats added this to the response 2025-12-13
    tempo?: number;
    energy?: number;
    valence?: number;
    danceability?: number;
    acousticness?: number;
    loudness?: number;
    instrumentalness?: number;
  }>;
}

export class ReccoBeatsFetcher {
  async fetch(isrcs: string[]): Promise<Map<string, AudioFeatures>> {
    const results = new Map<string, AudioFeatures>();
    for (let i = 0; i < isrcs.length; i += BATCH_SIZE) {
      const chunk = isrcs.slice(i, i + BATCH_SIZE);
      const batch = await this.fetchBatch(chunk);
      for (const [id, features] of batch) results.set(id, features);
      if (i + BATCH_SIZE < isrcs.length) {
        await new Promise(r => setTimeout(r, BATCH_GAP_MS));
      }
    }
    return results;
  }

  private async fetchBatch(
    isrcs: string[],
  ): Promise<Map<string, AudioFeatures>> {
    const url = `${BASE_URL}?${isrcs.map(i => `ids[]=${encodeURIComponent(i)}`).join('&')}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastErr = new Error(`ReccoBeats HTTP ${res.status}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          console.warn(`[ReccoBeats] ${lastErr}`);
          return new Map();
        }
        const json = await res.json() as ReccoResponse;
        const out = new Map<string, AudioFeatures>();
        for (const row of json.content ?? []) {
          if (!row.isrc) continue;
          const feat = this.toAudioFeatures(row);
          if (feat) out.set(row.isrc, feat);
        }
        return out;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        console.warn(`[ReccoBeats] fetch failed: ${err}`);
        return new Map();
      }
    }
    return new Map();
  }

  /** Map a ReccoBeats row to AudioFeatures. Missing fields → null (the
   *  caller treats nulls as "partial" and fills via synth). */
  private toAudioFeatures(
    row: NonNullable<ReccoResponse['content']>[number],
  ): AudioFeatures | null {
    const required = [
      row.tempo, row.energy, row.valence, row.danceability,
      row.acousticness, row.loudness, row.instrumentalness,
    ];
    if (required.some(v => v === undefined || v === null || Number.isNaN(v))) {
      return null; // skip partial rows here; FeatureFetchChain handles synth
    }
    return {
      tempo: row.tempo!,
      energy: row.energy!,
      valence: row.valence!,
      danceability: row.danceability!,
      acousticness: row.acousticness!,
      loudness: normalizeLoudness(row.loudness!),
      instrumentalness: row.instrumentalness!,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/ReccoBeatsFetcher.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/fetchers/ReccoBeatsFetcher.ts server/__tests__/enrichment/ReccoBeatsFetcher.test.ts
git commit -m "feat(sequencer): ReccoBeatsFetcher — tier-1 ISRC-keyed audio features"
```

---

## Task 7: Deezer fallback fetcher

**Files:**
- Create: `server/src/services/enrichment/fetchers/DeezerFeaturesFetcher.ts`
- Test: `server/__tests__/enrichment/DeezerFeaturesFetcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/enrichment/DeezerFeaturesFetcher.test.ts
import { DeezerFeaturesFetcher } from '../../src/services/enrichment/fetchers/DeezerFeaturesFetcher';

const originalFetch = global.fetch;

describe('DeezerFeaturesFetcher', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns BPM + loudness from /track/isrc: endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123, bpm: 128, gain: -5.2 }),
    } as any);
    const f = new DeezerFeaturesFetcher();
    const out = await f.fetch('USRC17607839');
    expect(out?.tempo).toBe(128);
    expect(out?.loudness).toBeCloseTo((-5.2 + 60) / 60, 3);
  });

  it('returns null when ISRC is unknown to Deezer', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => '',
    } as any);
    const f = new DeezerFeaturesFetcher();
    const out = await f.fetch('USRC17607839');
    expect(out).toBeNull();
  });

  it('returns null when bpm is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ id: 123 }),
    } as any);
    const f = new DeezerFeaturesFetcher();
    const out = await f.fetch('USRC17607839');
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/DeezerFeaturesFetcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/enrichment/fetchers/DeezerFeaturesFetcher.ts
import { normalizeLoudness } from '../../broadcast/audio-features';

export interface DeezerPartial {
  tempo: number;       // BPM from Deezer
  loudness: number;    // normalized to 0-1
}

export class DeezerFeaturesFetcher {
  async fetch(isrc: string): Promise<DeezerPartial | null> {
    try {
      const res = await fetch(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`);
      if (!res.ok) return null;
      const json = await res.json() as { bpm?: number; gain?: number };
      if (typeof json.bpm !== 'number' || json.bpm <= 0) return null;
      const gain = typeof json.gain === 'number' ? json.gain : -20;
      return {
        tempo: json.bpm,
        loudness: normalizeLoudness(gain),
      };
    } catch (err) {
      console.warn(`[Deezer] isrc:${isrc} fetch failed: ${err}`);
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/DeezerFeaturesFetcher.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/fetchers/DeezerFeaturesFetcher.ts server/__tests__/enrichment/DeezerFeaturesFetcher.test.ts
git commit -m "feat(sequencer): DeezerFeaturesFetcher — tier-2 BPM + loudness via ISRC"
```

---

## Task 8: FeatureFetchChain — the tier ladder

**Files:**
- Create: `server/src/services/broadcast/FeatureFetchChain.ts`
- Test: `server/__tests__/broadcast/FeatureFetchChain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/FeatureFetchChain.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/FeatureFetchChain.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/FeatureFetchChain.ts
import { synthesizeFeatures } from './feature-synth';
import type { AudioFeatures } from './audio-features';
import { NEUTRAL_FEATURES } from './audio-features';
import type { ManifestTrack } from './types';
import type { ReccoBeatsFetcher } from '../enrichment/fetchers/ReccoBeatsFetcher';
import type { DeezerFeaturesFetcher } from '../enrichment/fetchers/DeezerFeaturesFetcher';
import { normalizeGenreFamily } from './GenreFamily';

export interface LastFmTagLookup {
  get(title: string, artist: string): Promise<string[]>;
}

export type FeatureSource = 'reccobeats' | 'synthesized' | 'defaults';

export interface FetchedFeatures {
  features: AudioFeatures;
  source: FeatureSource;
  partial: boolean;  // true if ReccoBeats returned partial data filled via synth
}

interface Deps {
  recco: Pick<ReccoBeatsFetcher, 'fetch'>;
  deezer: Pick<DeezerFeaturesFetcher, 'fetch'>;
  lastFmTags: LastFmTagLookup;
}

export class FeatureFetchChain {
  constructor(private deps: Deps) {}

  /** Fetch features for a single track, trying each tier in order. */
  async fetchOne(track: ManifestTrack): Promise<FetchedFeatures> {
    // Tier 1: ReccoBeats (ISRC only)
    if (track.isrc) {
      const hit = await this.deps.recco.fetch([track.isrc]);
      const f = hit.get(track.isrc);
      if (f) return { features: f, source: 'reccobeats', partial: false };
    }

    // Tier 2: Deezer partial (ISRC only) + synth
    if (track.isrc) {
      const deezer = await this.deps.deezer.fetch(track.isrc);
      if (deezer) {
        const tags = await this.deps.lastFmTags.get(track.title, track.artistName);
        const features = synthesizeFeatures({
          partialFeatures: deezer,
          lastFmTags: tags,
          genreFamily: normalizeGenreFamily(track.genreNames),
        });
        return { features, source: 'synthesized', partial: false };
      }
    }

    // Tier 3: Last.fm + genre synth
    const tags = await this.deps.lastFmTags.get(track.title, track.artistName);
    if (tags.length > 0) {
      const features = synthesizeFeatures({
        lastFmTags: tags,
        genreFamily: normalizeGenreFamily(track.genreNames),
      });
      return { features, source: 'synthesized', partial: false };
    }

    // Tier 4: genre-only
    const family = normalizeGenreFamily(track.genreNames);
    if (family !== 'generic') {
      const features = synthesizeFeatures({ genreFamily: family });
      return { features, source: 'synthesized', partial: false };
    }

    // Tier 5: neutrals
    return { features: { ...NEUTRAL_FEATURES }, source: 'defaults', partial: false };
  }

  /** Batch version — groups ISRCs for ReccoBeats to cut HTTP overhead. */
  async fetchBatch(tracks: ManifestTrack[]): Promise<Map<string, FetchedFeatures>> {
    const withIsrc = tracks.filter(t => !!t.isrc);
    const reccoHits = withIsrc.length > 0
      ? await this.deps.recco.fetch(withIsrc.map(t => t.isrc!))
      : new Map<string, AudioFeatures>();
    const result = new Map<string, FetchedFeatures>();
    for (const t of tracks) {
      if (t.isrc && reccoHits.has(t.isrc)) {
        result.set(t.id, {
          features: reccoHits.get(t.isrc)!,
          source: 'reccobeats',
          partial: false,
        });
        continue;
      }
      // Fall back per-track for the remaining tiers
      result.set(t.id, await this.fetchOne(t));
    }
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/FeatureFetchChain.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/FeatureFetchChain.ts server/__tests__/broadcast/FeatureFetchChain.test.ts
git commit -m "feat(sequencer): FeatureFetchChain — 5-tier fallback ladder"
```

---

## Task 9: Extend EnrichmentRecord shape

**Files:**
- Modify: `server/src/services/enrichment/EnrichmentCache.ts`
- Test: `server/__tests__/enrichment/EnrichmentCache.test.ts` (check existing path; create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/enrichment/EnrichmentCache.extended.test.ts
import { EnrichmentCache, type EnrichmentRecord } from '../../src/services/enrichment/EnrichmentCache';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('EnrichmentCache — extended fields', () => {
  let tmp: string;
  let cache: EnrichmentCache;

  beforeEach(async () => {
    tmp = path.join(os.tmpdir(), `enrich-test-${Date.now()}`);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/EnrichmentCache.extended.test.ts`
Expected: FAIL — `isrc` not in `EnrichmentRecord` type

- [ ] **Step 3: Modify EnrichmentCache.ts to extend the interface**

Edit `server/src/services/enrichment/EnrichmentCache.ts` — replace the `EnrichmentRecord` interface:

```ts
import type { AudioFeatures } from '../broadcast/audio-features';

export interface EnrichmentRecord {
  // existing
  genre?: string;
  moodTags?: string[];
  releaseYear?: string;
  producer?: string;
  sample?: string;
  wikipediaSummary?: string;
  notableFacts?: string[];
  artistBio?: string;
  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'wikipedia' | 'lastfm' | 'hybrid' | 'reccobeats';

  // new
  isrc?: string;
  features?: AudioFeatures;
  featuresSource?: 'reccobeats' | 'synthesized' | 'defaults';
  featuresAt?: number;
  featuresVersion?: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/EnrichmentCache.extended.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/EnrichmentCache.ts server/__tests__/enrichment/EnrichmentCache.extended.test.ts
git commit -m "feat(enrichment): add isrc/features/featuresSource fields to EnrichmentRecord"
```

---

## Task 10: ISRC plumbing — Zod + client + native

**Files:**
- Modify: `server/src/routes/broadcast.ts`
- Modify: `server/src/routes/featured.ts`
- Modify: `server/src/services/broadcast/types.ts`
- Modify: `src/engines/BroadcastManifestClient.ts`
- Modify: `modules/expo-music-kit/index.ts`
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`
- Test: `server/__tests__/routes/broadcast-zod.test.ts`

- [ ] **Step 1: Write the failing Zod test**

```ts
// server/__tests__/routes/broadcast-zod.test.ts
import { z } from 'zod';

// Re-export trackSchema from broadcast.ts for testing by re-importing it.
// We'll move trackSchema out to a shared module in step 3 so this works.
import { trackSchema } from '../../src/routes/shared-schemas';

describe('trackSchema ISRC field', () => {
  it('accepts 12-char ISRC', () => {
    const result = trackSchema.safeParse({
      id: '1', title: 't', artistName: 'a', albumTitle: 'b',
      duration: 200, isrc: 'USRC17607839',
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing ISRC', () => {
    const result = trackSchema.safeParse({
      id: '1', title: 't', artistName: 'a', albumTitle: 'b', duration: 200,
    });
    expect(result.success).toBe(true);
  });

  it('rejects ISRC of wrong length', () => {
    const result = trackSchema.safeParse({
      id: '1', title: 't', artistName: 'a', albumTitle: 'b',
      duration: 200, isrc: 'TOO-SHORT',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/routes/broadcast-zod.test.ts`
Expected: FAIL — module `'../../src/routes/shared-schemas'` not found

- [ ] **Step 3: Extract trackSchema into a shared module and add ISRC field**

Create `server/src/routes/shared-schemas.ts`:

```ts
import { z } from 'zod';

export const vibeSchema = z.enum([
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
]);

export const lengthSchema = z.enum(['quick', 'standard', 'long']);

export const trackSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  artistName: z.string().min(1).max(200),
  albumTitle: z.string().max(200),
  duration: z.number().positive().max(7200),
  artworkUrl: z.string().url().max(2048).optional(),
  genreNames: z.array(z.string().max(100)).max(10).optional(),
  isrc: z.string().length(12).optional(),
});
```

Update `server/src/routes/broadcast.ts` to import from shared-schemas (delete the local duplicate):

```ts
// replace the local vibeSchema/lengthSchema/trackSchema definitions at top with:
import { vibeSchema, lengthSchema, trackSchema } from './shared-schemas';
```

Same for `server/src/routes/featured.ts` — replace local `trackSchema` with the shared import.

Add `isrc?: string` to `ManifestTrack` in `server/src/services/broadcast/types.ts`:

```ts
export interface ManifestTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  artworkUrl?: string;
  genreNames?: string[];
  isrc?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/routes/broadcast-zod.test.ts`
Expected: PASS (3 tests)

Run full route suite to confirm nothing broke:

Run: `cd server && npx jest __tests__/routes/`
Expected: PASS (all existing route tests still pass)

- [ ] **Step 5: Update client — MusicTrack + sanitizeTracksForBake**

Edit `modules/expo-music-kit/index.ts` — add `isrc?: string` to `MusicTrack`:

```ts
export interface MusicTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  artworkUrl?: string;
  genreNames?: string[];
  isrc?: string;
  // ...rest unchanged
}
```

Edit `src/engines/BroadcastManifestClient.ts` — extend `CreateBroadcastRequest['tracks']` element and `sanitizeTracksForBake` to carry `isrc`:

```ts
// In CreateBroadcastRequest
tracks: Array<{
  id: string; title: string; artistName: string;
  albumTitle: string; duration: number; artworkUrl?: string;
  genreNames?: string[];
  isrc?: string;
}>;

// In sanitizeTracksForBake input + .map output — add:
isrc: (t as { isrc?: string | null }).isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test((t as any).isrc)
  ? (t as any).isrc
  : undefined,
```

- [ ] **Step 6: Update Swift — Song.isrc in serialized response**

Edit `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`. Locate the playlist-tracks serialization. For each `Song`, include `isrc`:

```swift
// Inside the dictionary-building loop for each Song:
var dict: [String: Any] = [
  "id": song.id.rawValue,
  "title": song.title,
  "artistName": song.artistName,
  "albumTitle": song.albumTitle ?? "",
  "duration": song.duration ?? 0,
  // ...existing fields
]
if let isrc = song.isrc {
  dict["isrc"] = isrc
}
```

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/shared-schemas.ts server/src/routes/broadcast.ts server/src/routes/featured.ts server/src/services/broadcast/types.ts server/__tests__/routes/broadcast-zod.test.ts modules/expo-music-kit/index.ts modules/expo-music-kit/ios/ExpoMusicKitModule.swift src/engines/BroadcastManifestClient.ts
git commit -m "feat(isrc): plumb Apple Music ISRC through native → client → server"
```

---

## Task 11: nominateDeepDives

**Files:**
- Create: `server/src/services/broadcast/deep-dives.ts`
- Test: `server/__tests__/broadcast/deep-dives.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/deep-dives.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/deep-dives.ts
import type { ManifestTrack } from './types';
import type { EnrichmentLookup } from './SegmentScriptBuilder';
import type { EnrichmentRecord } from '../enrichment/EnrichmentCache';

/**
 * Count how many "rich" enrichment fields are present on a record.
 * Used to rank transitions for deep_dive nomination.
 */
function richnessScore(rec: EnrichmentRecord | null): number {
  if (!rec) return 0;
  let score = 0;
  if (rec.producer) score += 1;
  if (rec.sample) score += 1;
  if (rec.wikipediaSummary) score += 1;
  if (rec.notableFacts?.length) score += 1;
  return score;
}

/**
 * Return slot indices (within the final segmentSlots array) that should be
 * promoted to deep_dive. Ranks transitions by the richness of their
 * *incoming* track's enrichment, caps at ceil((N-1)/4).
 *
 * ManifestBuilder sparse-cadence layout for N tracks:
 *   slot 0            = cold_open (before tracks[0])
 *   slot 1..M         = transitions (before tracks[2], tracks[4], ...)
 *   slot M+1          = sign_off
 * where M = floor((N-1) / 2). Transition at sequence k (0-indexed) sits at
 * segment-slot index k+1 and leads into tracks[(k+1) * 2].
 */
export function nominateDeepDives(
  tracks: ManifestTrack[],
  lookup: EnrichmentLookup,
): number[] {
  if (tracks.length <= 1) return [];
  const N = tracks.length;
  const maxPicks = Math.ceil((N - 1) / 4);

  const candidates: Array<{ slotIndex: number; score: number }> = [];
  let transitionSeq = 0;
  for (let i = 2; i < N; i += 2) {
    const slotIndex = transitionSeq + 1;  // +1 because slot 0 = cold_open
    const rec = lookup.get(tracks[i].title, tracks[i].artistName);
    candidates.push({ slotIndex, score: richnessScore(rec) });
    transitionSeq++;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxPicks)
    .map(c => c.slotIndex)
    .sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/deep-dives.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/deep-dives.ts server/__tests__/broadcast/deep-dives.test.ts
git commit -m "feat(sequencer): nominateDeepDives — rank transitions by enrichment richness"
```

---

## Task 12: DeterministicTrackSequencer

**Files:**
- Create: `server/src/services/broadcast/DeterministicTrackSequencer.ts`
- Test: `server/__tests__/broadcast/DeterministicTrackSequencer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/DeterministicTrackSequencer.test.ts
import { DeterministicTrackSequencer } from '../../src/services/broadcast/DeterministicTrackSequencer';
import type { ManifestTrack } from '../../src/services/broadcast/types';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';
import type { FeatureFetchChain } from '../../src/services/broadcast/FeatureFetchChain';
import type { EnrichmentCache } from '../../src/services/enrichment/EnrichmentCache';

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
    expect(r1.orderedTracks.map(t => t.id)).toEqual(r2.orderedTracks.map(t => t.id));
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
    expect(morning.orderedTracks.map(t => t.id)).not.toEqual(lateNight.orderedTracks.map(t => t.id));
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
    expect(a.orderedTracks.map(t => t.id)).not.toEqual(b.orderedTracks.map(t => t.id));
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
    const lowCount = r.orderedTracks.filter(t => Number(t.id) < 10).length;
    expect(lowCount).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/broadcast/DeterministicTrackSequencer.ts
import type { ManifestTrack, Vibe, BroadcastLength } from './types';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import type { FeatureFetchChain, FetchedFeatures } from './FeatureFetchChain';
import type { AudioFeatures } from './audio-features';
import { VIBE_CURVES } from './vibe-curves';
import {
  weightedDistance,
  adjacencyPenalty,
  interpolateKeyframes,
} from './scoring';
import { seededPRNG } from './prng';
import { nominateDeepDives } from './deep-dives';

const LENGTH_TO_N: Record<BroadcastLength, number> = {
  quick: 5, standard: 9, long: 15,
};

const K_FOR_LENGTH: Record<BroadcastLength, number> = {
  quick: 2, standard: 3, long: 3,
};

const POOL_CAP = 40;

// Types declared locally (not exported) so they don't collide with the shared
// SequenceRequest/SequenceResult exported from TrackSequencer.ts in Task 13.
// TypeScript's structural typing ensures this class still satisfies the
// shared ITrackSequencer interface once Task 13 lands.
export interface SequenceRequest {
  pool: ManifestTrack[];
  vibe: Vibe;
  length: BroadcastLength;
  userContext: { timeOfDay: string; dayOfWeek: string };
  broadcastId: string;
}

export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'deterministic';
}

interface ScoredTrack {
  track: ManifestTrack;
  features: AudioFeatures;
  score: number;
}

export class DeterministicTrackSequencer {
  constructor(
    private readonly enrichmentCache: EnrichmentCache,
    private readonly fetchChain: Pick<FeatureFetchChain, 'fetchBatch'>,
  ) {}

  async sequence(req: SequenceRequest): Promise<SequenceResult> {
    const N = LENGTH_TO_N[req.length];
    if (req.pool.length < N) {
      throw new Error(`insufficient tracks: need ${N}, got ${req.pool.length}`);
    }
    const cappedPool = req.pool.slice(0, POOL_CAP);

    // Fetch features for every track in the pool.
    const featureMap = await this.fetchChain.fetchBatch(cappedPool);
    const stats = this.collectStats(featureMap);

    const curve = VIBE_CURVES[req.vibe];
    const rng = seededPRNG(req.broadcastId);
    const K = K_FOR_LENGTH[req.length];

    const remaining = cappedPool.map((t): { track: ManifestTrack; features: AudioFeatures } => ({
      track: t,
      features: featureMap.get(t.id)!.features,
    }));
    const result: ManifestTrack[] = [];

    for (let i = 0; i < N; i++) {
      const p = N === 1 ? 0 : i / (N - 1);
      const target = interpolateKeyframes(curve.keyframes, p);
      const previous = result[result.length - 1];

      const scored: ScoredTrack[] = remaining.map(({ track, features }) => ({
        track,
        features,
        score: weightedDistance(features, target, curve.weights)
             + adjacencyPenalty(track, previous),
      }));
      scored.sort((a, b) => a.score - b.score);

      const k = Math.min(K, scored.length);
      const topK = scored.slice(0, k);
      const pickedIdx = rng.pickIndex(topK.length);
      const picked = topK[pickedIdx];
      result.push(picked.track);

      const removeIdx = remaining.findIndex(x => x.track.id === picked.track.id);
      if (removeIdx >= 0) remaining.splice(removeIdx, 1);
    }

    const featureSlots = nominateDeepDives(result, this.enrichmentCache);
    this.logResult(req, result, stats);

    return {
      orderedTracks: result,
      featureSlots,
      source: 'deterministic',
    };
  }

  private collectStats(featureMap: Map<string, FetchedFeatures>): {
    reccobeats: number; synthesized: number; defaults: number;
  } {
    let r = 0, s = 0, d = 0;
    for (const f of featureMap.values()) {
      if (f.source === 'reccobeats') r++;
      else if (f.source === 'synthesized') s++;
      else d++;
    }
    return { reccobeats: r, synthesized: s, defaults: d };
  }

  private logResult(
    req: SequenceRequest,
    result: ManifestTrack[],
    stats: { reccobeats: number; synthesized: number; defaults: number },
  ): void {
    const firstId = result[0]?.id ?? '';
    const lastId = result[result.length - 1]?.id ?? '';
    console.log(
      `[Sequencer] source=deterministic vibe=${req.vibe} N=${result.length} poolSize=${req.pool.length} ` +
      `firstId=${firstId} lastId=${lastId} features: reccobeats=${stats.reccobeats} synthesized=${stats.synthesized} defaults=${stats.defaults}`
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/DeterministicTrackSequencer.ts server/__tests__/broadcast/DeterministicTrackSequencer.test.ts
git commit -m "feat(sequencer): DeterministicTrackSequencer — score-and-place with seeded top-K"
```

---

## Task 13: Wire DeterministicTrackSequencer into BroadcastOrchestrator behind a flag

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Modify: `server/src/services/broadcast/TrackSequencer.ts` (rename class)
- Modify: `server/src/index.ts` (ReccoBeatsFetcher/DeezerFeaturesFetcher injection)
- Test: `server/__tests__/broadcast/BroadcastOrchestrator.sequencer-flag.test.ts`

- [ ] **Step 1: Rename old class + unify request type**

Edit `server/src/services/broadcast/TrackSequencer.ts`:

1. Rename `export class TrackSequencer` → `export class LLMTrackSequencer`. No behavior changes inside.
2. Update `SequenceRequest` to require `broadcastId: string` (previously absent). The LLM path ignores the value:

```ts
export interface SequenceRequest {
  pool: ManifestTrack[];
  vibe: Vibe;
  length: BroadcastLength;
  userContext: { timeOfDay: string; dayOfWeek: string };
  broadcastId: string;  // NEW — required, but unused by LLM path
}
```

3. Extend `SequenceResult.source` union with `'deterministic'`:

```ts
export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'cache' | 'llm' | 'fallback' | 'deterministic';
}
```

4. Export a shared structural interface both sequencers satisfy:

```ts
export interface ITrackSequencer {
  sequence(req: SequenceRequest): Promise<SequenceResult>;
}
```

Do NOT rename the file itself — keep `TrackSequencer.ts` as the filename so imports elsewhere don't break. (The file can be renamed during the post-rollout cleanup.)

- [ ] **Step 2: Write the failing test**

```ts
// server/__tests__/broadcast/BroadcastOrchestrator.sequencer-flag.test.ts
import { BroadcastOrchestrator } from '../../src/services/broadcast/BroadcastOrchestrator';

describe('BroadcastOrchestrator sequencer selection', () => {
  const originalEnv = process.env.SEQUENCER_MODE;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SEQUENCER_MODE;
    else process.env.SEQUENCER_MODE = originalEnv;
  });

  it('defaults to DeterministicTrackSequencer when env is unset', () => {
    delete process.env.SEQUENCER_MODE;
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.sequencerMode).toBe('deterministic');
  });

  it('uses LLMTrackSequencer when SEQUENCER_MODE=llm', () => {
    process.env.SEQUENCER_MODE = 'llm';
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.sequencerMode).toBe('llm');
  });

  it('uses deterministic when SEQUENCER_MODE is any other string', () => {
    process.env.SEQUENCER_MODE = 'gibberish';
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.sequencerMode).toBe('deterministic');
  });
});
```

Note: `makeWithDefaults()` is a factory we add in step 3 for test isolation. Inline construction in production code stays in `server/src/index.ts`.

- [ ] **Step 3: Implement flag-based selection**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`:

```ts
import { DeterministicTrackSequencer } from './DeterministicTrackSequencer';
import { LLMTrackSequencer, type ITrackSequencer } from './TrackSequencer';
import type { FeatureFetchChain } from './FeatureFetchChain';

export class BroadcastOrchestrator {
  private readonly generator: SegmentGenerator;
  private readonly sequencer: ITrackSequencer;
  readonly sequencerMode: 'deterministic' | 'llm';
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    featureFetchChain: FeatureFetchChain,
    sequenceCache?: SequenceCache,  // retained for LLM path
  ) {
    this.generator = new SegmentGenerator(llm, tts, storage);

    const mode = process.env.SEQUENCER_MODE ?? 'deterministic';
    if (mode === 'llm') {
      this.sequencerMode = 'llm';
      this.sequencer = new LLMTrackSequencer(
        llm, sequenceCache ?? new (require('./SequenceCache').SequenceCache)(), enrichmentCache,
      );
    } else {
      this.sequencerMode = 'deterministic';
      this.sequencer = new DeterministicTrackSequencer(enrichmentCache, featureFetchChain);
    }
  }

  /** Test helper — constructs an orchestrator with no-op dependencies
   *  so tests can inspect sequencerMode without a real LLM / storage. */
  static makeWithDefaults(): BroadcastOrchestrator {
    const noopLLM: LLMCaller = { generate: async () => ({ text: '', tokensUsed: 0 }) };
    const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: Buffer.from('') }) } as any;
    const noopStorage: ObjectStorage = { put: async () => '' } as any;
    const store = new BroadcastStore();
    const cache = new EnrichmentCache('/tmp/noop-enrich.json');
    const enricher = { drainNow: async () => {} } as any;
    const fetchChain = { fetchBatch: async () => new Map() } as any;
    return new BroadcastOrchestrator(
      noopLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
    );
  }

  async create(
    input: BroadcastCreateRequest & { userId: string },
  ): Promise<BroadcastCreateResponse> {
    const seq = await this.sequencer.sequence({
      pool: input.tracks,
      vibe: input.vibe,
      length: input.length,
      userContext: {
        timeOfDay: input.userContext.timeOfDay,
        dayOfWeek: input.userContext.dayOfWeek,
      },
      broadcastId: input.broadcastId ?? 'pending',  // set after manifest build
    });
    // ... rest unchanged
  }
  // ... rest unchanged
}
```

Update `server/src/services/broadcast/TrackSequencer.ts` so `LLMTrackSequencer.sequence` accepts the extra `broadcastId` field — add it to the interface, ignore it in the LLM path (LLM ordering doesn't use broadcastId):

```ts
export interface SequenceRequest {
  pool: ManifestTrack[];
  vibe: Vibe;
  length: BroadcastLength;
  userContext: { timeOfDay: string; dayOfWeek: string };
  broadcastId?: string;  // used by deterministic sequencer; ignored by LLM
}
```

Edit `server/src/index.ts` to wire the fetchers + FeatureFetchChain into the orchestrator constructor:

```ts
import { ReccoBeatsFetcher } from './services/enrichment/fetchers/ReccoBeatsFetcher';
import { DeezerFeaturesFetcher } from './services/enrichment/fetchers/DeezerFeaturesFetcher';
import { FeatureFetchChain } from './services/broadcast/FeatureFetchChain';

// In bootstrap() after enrichmentCache etc:
const recco = new ReccoBeatsFetcher();
const deezer = new DeezerFeaturesFetcher();
const lastFmTags = {
  async get(title: string, artist: string): Promise<string[]> {
    // Use existing Last.fm enrichment; extract tags from cache if present.
    const rec = enrichmentCache.get(title, artist);
    return rec?.moodTags ?? [];
  },
};
const featureFetchChain = new FeatureFetchChain({ recco, deezer, lastFmTags });

const broadcastOrchestrator = new BroadcastOrchestrator(
  llmProvider, ttsProvider, broadcastStorage, broadcastStore,
  enrichmentCache, backgroundEnricher, featureFetchChain,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.sequencer-flag.test.ts`
Expected: PASS (3 tests)

Run full broadcast suite to confirm nothing broke:

Run: `cd server && npx jest __tests__/broadcast/`
Expected: PASS — all existing broadcast tests still pass (LLM path still works behind flag).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts server/src/services/broadcast/TrackSequencer.ts server/src/index.ts server/__tests__/broadcast/BroadcastOrchestrator.sequencer-flag.test.ts
git commit -m "feat(sequencer): SEQUENCER_MODE env flag selects Deterministic vs LLM path"
```

---

## Task 14: Pass broadcastId through to the sequencer

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/BroadcastOrchestrator.broadcastId-threading.test.ts
import { BroadcastOrchestrator } from '../../src/services/broadcast/BroadcastOrchestrator';
// (Use a test harness that spies on sequencer.sequence)

// This test drives the full create() flow and asserts that the
// broadcastId set in the manifest is the same one passed to sequence().

describe('BroadcastOrchestrator threads broadcastId into sequence()', () => {
  it('sequencer receives the manifest.broadcastId', async () => {
    const captured: string[] = [];
    const fakeSequencer = {
      async sequence(req: any) {
        captured.push(req.broadcastId);
        return {
          orderedTracks: req.pool.slice(0, 5),
          featureSlots: [],
          source: 'deterministic' as const,
        };
      },
    };
    // Build an orchestrator with fakeSequencer injected — requires exposing
    // a test constructor or using `new BroadcastOrchestrator(...)` and
    // monkey-patching `this.sequencer`. We do the latter for simplicity.
    const orch = BroadcastOrchestrator.makeWithDefaults();
    (orch as any).sequencer = fakeSequencer;
    // Mock generator so create() doesn't actually run LLM/TTS:
    (orch as any).generator = { generateVariants: async () => [] };
    (orch as any).backgroundEnricher = { drainNow: async () => {} };

    const pool = Array.from({ length: 5 }, (_, i) => ({
      id: String(i), title: 't' + i, artistName: 'A', albumTitle: 'B', duration: 200,
    })) as any;
    const result = await orch.create({
      userId: 'u1', playlistId: 'p', vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon', firstTimeUser: false },
      tracks: pool,
    } as any);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(result.manifest.broadcastId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.broadcastId-threading.test.ts`
Expected: FAIL — `captured[0]` will be `'pending'` or similar because current create() calls sequencer before knowing the manifest.broadcastId.

- [ ] **Step 3: Restructure `create()` to build manifest's broadcastId first**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`. Move `broadcastId` generation ahead of `sequencer.sequence`, then pass it through. The manifest builder currently generates the id inside `buildManifest`; we generate it outside and pass it in:

```ts
// Near top of file:
import { randomUUID } from 'crypto';

// In create():
async create(
  input: BroadcastCreateRequest & { userId: string },
): Promise<BroadcastCreateResponse> {
  const broadcastId = randomUUID();

  const seq = await this.sequencer.sequence({
    pool: input.tracks,
    vibe: input.vibe,
    length: input.length,
    userContext: {
      timeOfDay: input.userContext.timeOfDay,
      dayOfWeek: input.userContext.dayOfWeek,
    },
    broadcastId,
  });

  const manifest = buildManifest({
    broadcastId,  // NEW: pass the pre-generated id through
    userId: input.userId,
    playlistId: input.playlistId,
    vibe: input.vibe,
    length: input.length,
    tracks: seq.orderedTracks,
    featureSlots: seq.featureSlots,
  });
  // ... rest unchanged
}
```

Update `ManifestBuilder.buildManifest` to accept an optional pre-generated id:

```ts
// In ManifestBuilder.ts
export interface BuildManifestInput {
  broadcastId?: string;  // NEW — defaults to randomUUID() when absent
  userId: string;
  // ...rest unchanged
}

export function buildManifest(input: BuildManifestInput): Manifest {
  // ...existing guard clauses
  return {
    broadcastId: input.broadcastId ?? randomUUID(),
    // ...rest unchanged
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.broadcastId-threading.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts server/src/services/broadcast/ManifestBuilder.ts server/__tests__/broadcast/BroadcastOrchestrator.broadcastId-threading.test.ts
git commit -m "refactor(orchestrator): generate broadcastId up front, pass through to sequencer"
```

---

## Task 15: Integrate feature caching into BackgroundEnricher

**Files:**
- Modify: `server/src/services/enrichment/BackgroundEnricher.ts`
- Modify: `server/src/services/enrichment/DefaultEnrichmentFetcher.ts` (likely)
- Test: `server/__tests__/enrichment/BackgroundEnricher.features.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/enrichment/BackgroundEnricher.features.test.ts
import { BackgroundEnricher } from '../../src/services/enrichment/BackgroundEnricher';
import { EnrichmentCache } from '../../src/services/enrichment/EnrichmentCache';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('BackgroundEnricher features stage', () => {
  let tmp: string;
  let cache: EnrichmentCache;

  beforeEach(async () => {
    tmp = path.join(os.tmpdir(), `enrich-bg-${Date.now()}`);
    cache = new EnrichmentCache(path.join(tmp, 'tracks.json'));
    await cache.load();
  });

  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('populates features on the cached record after drainNow', async () => {
    const fakeFetcher = {
      async enrich() {
        return { source: 'hybrid' as const, genre: 'soul', lastEnrichedAt: Date.now() };
      },
    };
    const fakeFeatureChain = {
      async fetchBatch() {
        return new Map([['1', {
          features: {
            tempo: 95, energy: 0.55, valence: 0.60, danceability: 0.65,
            acousticness: 0.30, loudness: 0.55, instrumentalness: 0.05,
          },
          source: 'reccobeats' as const,
          partial: false,
        }]]);
      },
    };
    const enricher = new BackgroundEnricher(cache, fakeFetcher as any, fakeFeatureChain as any);
    const tracks = [{
      id: '1', title: 'Song', artistName: 'Artist',
      albumTitle: 'Album', duration: 200, isrc: 'USRC17607839',
    }];
    await enricher.drainNow(tracks as any);
    const rec = cache.get('Song', 'Artist');
    expect(rec?.features?.tempo).toBe(95);
    expect(rec?.featuresSource).toBe('reccobeats');
    expect(rec?.featuresVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/BackgroundEnricher.features.test.ts`
Expected: FAIL — constructor doesn't accept a fetchChain arg

- [ ] **Step 3: Extend BackgroundEnricher to run features stage**

Edit `server/src/services/enrichment/BackgroundEnricher.ts`. Three changes:

1. **Add import + version constant** at the top of the file (after existing imports):

```ts
import type { FeatureFetchChain } from '../broadcast/FeatureFetchChain';

const FEATURES_VERSION = 1;
```

2. **Add optional `featureChain` constructor param** — modify the existing constructor:

```ts
  constructor(
    private readonly cache: EnrichmentCache,
    private readonly fetcher: EnrichmentFetcher,
    private readonly featureChain?: FeatureFetchChain,
  ) {}
```

3. **Run the feature-fetch stage at the end of `drainNow`** — the existing `drainNow` body is a single `await Promise.all(tracks.map(track => this.enrichOne(track).catch(...)))` statement. Wrap the whole body so the new stage runs *after* text enrichment (which gives us fresh Last.fm tags that the features chain synthesizes from):

```ts
  async drainNow(tracks: ManifestTrack[]): Promise<void> {
    await Promise.all(
      tracks.map(track =>
        this.enrichOne(track).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[BackgroundEnricher] "${track.title}" by ${track.artistName} failed: ${msg}`);
        }),
      ),
    );
    if (this.featureChain) {
      await this.fetchAndStoreFeatures(tracks);
    }
  }
```

4. **Add the `fetchAndStoreFeatures` private method** after `enrichOne`:

```ts
  private async fetchAndStoreFeatures(tracks: ManifestTrack[]): Promise<void> {
    // Skip tracks whose cached record already has up-to-date features.
    const need = tracks.filter(t => {
      const rec = this.cache.get(t.title, t.artistName);
      return !rec?.features || rec.featuresVersion !== FEATURES_VERSION;
    });
    if (need.length === 0) return;

    const results = await this.featureChain!.fetchBatch(need);
    const reccobeats = [...results.values()].filter(r => r.source === 'reccobeats').length;
    const synthesized = [...results.values()].filter(r => r.source === 'synthesized').length;
    const defaults = [...results.values()].filter(r => r.source === 'defaults').length;
    console.log(
      `[BackgroundEnricher] features tiers: reccobeats=${reccobeats} ` +
      `synthesized=${synthesized} defaults=${defaults} (${need.length} tracks)`
    );

    for (const track of need) {
      const fetched = results.get(track.id);
      if (!fetched) continue;
      const existing = this.cache.get(track.title, track.artistName);
      await this.cache.set(track.title, track.artistName, {
        ...(existing ?? { lastEnrichedAt: Date.now(), source: 'hybrid' as const }),
        isrc: track.isrc ?? existing?.isrc,
        features: fetched.features,
        featuresSource: fetched.source,
        featuresAt: Date.now(),
        featuresVersion: FEATURES_VERSION,
      });
    }
  }
```

Update `server/src/index.ts` to wire featureFetchChain into BackgroundEnricher:

```ts
const backgroundEnricher = new BackgroundEnricher(
  enrichmentCache, new DefaultEnrichmentFetcher(), featureFetchChain,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/BackgroundEnricher.features.test.ts`
Expected: PASS (1 test)

Run full enrichment suite to confirm nothing broke:

Run: `cd server && npx jest __tests__/enrichment/`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/BackgroundEnricher.ts server/src/index.ts server/__tests__/enrichment/BackgroundEnricher.features.test.ts
git commit -m "feat(enrichment): feature-fetch stage in BackgroundEnricher drain"
```

---

## Task 16: Bug regression test — different vibes produce different orders

**Files:**
- Test: `server/__tests__/broadcast/sequencer-regression.test.ts`

- [ ] **Step 1: Write the regression test**

```ts
// server/__tests__/broadcast/sequencer-regression.test.ts
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/sequencer-regression.test.ts`
Expected: PASS (42 tests — 7 vibes × 6 alternates)

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/broadcast/sequencer-regression.test.ts
git commit -m "test(sequencer): regression — every vibe pair produces distinct orders"
```

---

## Task 17: Golden tests — lock in a few canonical outputs

**Files:**
- Create: `server/__tests__/fixtures/sequencer-goldens/pool-late-night-quick.json`
- Create: `server/__tests__/fixtures/sequencer-goldens/pool-morning-standard.json`
- Create: `server/__tests__/fixtures/sequencer-goldens/pool-party-long.json`
- Test: `server/__tests__/broadcast/sequencer-goldens.test.ts`

- [ ] **Step 1: Write the golden test runner**

```ts
// server/__tests__/broadcast/sequencer-goldens.test.ts
import { DeterministicTrackSequencer } from '../../src/services/broadcast/DeterministicTrackSequencer';
import * as fs from 'fs';
import * as path from 'path';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';

interface Golden {
  name: string;
  vibe: string;
  length: 'quick' | 'standard' | 'long';
  broadcastId: string;
  pool: Array<{ id: string; title: string; artistName: string; albumTitle: string; duration: number;
    features: Partial<import('../../src/services/broadcast/audio-features').AudioFeatures> }>;
  expectedOrder: string[];
}

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/sequencer-goldens');

function loadGoldens(): Golden[] {
  return fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')));
}

describe('Sequencer goldens', () => {
  for (const g of loadGoldens()) {
    it(g.name, async () => {
      const chain = {
        async fetchBatch(tracks: any[]) {
          const out = new Map();
          for (const t of tracks) {
            const overrides = g.pool.find(p => p.id === t.id)?.features ?? {};
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
      expect(r.orderedTracks.map(t => t.id)).toEqual(g.expectedOrder);
    });
  }
});
```

- [ ] **Step 2: Run test — it should pass because goldens don't exist yet (0 tests)**

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts`
Expected: PASS (0 tests — no fixtures yet, but the suite runs without errors)

- [ ] **Step 3: Create the first golden fixture (lateNight quick)**

Create `server/__tests__/fixtures/sequencer-goldens/pool-late-night-quick.json` with 10 tracks spanning both low-energy and high-energy profiles:

```json
{
  "name": "lateNight quick — low-energy tracks dominate",
  "vibe": "lateNight",
  "length": "quick",
  "broadcastId": "golden-late-night-quick",
  "pool": [
    { "id": "0", "title": "Hushed", "artistName": "A", "albumTitle": "X", "duration": 200,
      "features": { "tempo": 78, "energy": 0.20, "valence": 0.30, "danceability": 0.40, "acousticness": 0.65, "loudness": 0.30, "instrumentalness": 0.25 } },
    { "id": "1", "title": "Dim", "artistName": "B", "albumTitle": "Y", "duration": 200,
      "features": { "tempo": 82, "energy": 0.25, "valence": 0.32, "danceability": 0.45, "acousticness": 0.55, "loudness": 0.35, "instrumentalness": 0.20 } },
    { "id": "2", "title": "Lamp", "artistName": "C", "albumTitle": "Z", "duration": 200,
      "features": { "tempo": 85, "energy": 0.35, "valence": 0.40, "danceability": 0.50, "acousticness": 0.45, "loudness": 0.40, "instrumentalness": 0.15 } },
    { "id": "3", "title": "Groove", "artistName": "D", "albumTitle": "W", "duration": 200,
      "features": { "tempo": 90, "energy": 0.50, "valence": 0.45, "danceability": 0.60, "acousticness": 0.30, "loudness": 0.50, "instrumentalness": 0.10 } },
    { "id": "4", "title": "Piano", "artistName": "E", "albumTitle": "V", "duration": 200,
      "features": { "tempo": 72, "energy": 0.18, "valence": 0.28, "danceability": 0.25, "acousticness": 0.80, "loudness": 0.25, "instrumentalness": 0.35 } },
    { "id": "5", "title": "Banger", "artistName": "F", "albumTitle": "U", "duration": 200,
      "features": { "tempo": 128, "energy": 0.85, "valence": 0.75, "danceability": 0.85, "acousticness": 0.10, "loudness": 0.80, "instrumentalness": 0.03 } },
    { "id": "6", "title": "Anthem", "artistName": "G", "albumTitle": "T", "duration": 200,
      "features": { "tempo": 130, "energy": 0.88, "valence": 0.82, "danceability": 0.80, "acousticness": 0.12, "loudness": 0.82, "instrumentalness": 0.02 } },
    { "id": "7", "title": "Pulse", "artistName": "H", "albumTitle": "S", "duration": 200,
      "features": { "tempo": 120, "energy": 0.75, "valence": 0.70, "danceability": 0.80, "acousticness": 0.15, "loudness": 0.75, "instrumentalness": 0.05 } },
    { "id": "8", "title": "Fade", "artistName": "I", "albumTitle": "R", "duration": 200,
      "features": { "tempo": 80, "energy": 0.28, "valence": 0.30, "danceability": 0.42, "acousticness": 0.50, "loudness": 0.35, "instrumentalness": 0.18 } },
    { "id": "9", "title": "Rest", "artistName": "J", "albumTitle": "Q", "duration": 200,
      "features": { "tempo": 75, "energy": 0.22, "valence": 0.26, "danceability": 0.30, "acousticness": 0.68, "loudness": 0.28, "instrumentalness": 0.28 } }
  ],
  "expectedOrder": []
}
```

- [ ] **Step 4: Run sequencer once to discover the real output, then update expectedOrder**

First, run the test — it will fail with actual-vs-expected:

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts -t "lateNight quick"`
Expected: FAIL with `expected [] got ["...", "...", ...]` — copy the "got" array into `expectedOrder`.

Re-run; should pass.

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Repeat for morning-standard and party-long goldens**

Create `pool-morning-standard.json` with ~15 pool tracks spanning tempo 85-125 / energy 0.3-0.8. Add `"vibe": "morning"`, `"length": "standard"`, `"broadcastId": "golden-morning-standard"`, `"expectedOrder": []`. Follow the same run-and-copy pattern as step 4.

Create `pool-party-long.json` with ~25 pool tracks spanning tempo 90-140 / energy 0.5-0.95. Add `"vibe": "party"`, `"length": "long"`, `"broadcastId": "golden-party-long"`, `"expectedOrder": []`. Same pattern.

Run: `cd server && npx jest __tests__/broadcast/sequencer-goldens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/__tests__/fixtures/sequencer-goldens/ server/__tests__/broadcast/sequencer-goldens.test.ts
git commit -m "test(sequencer): 3 golden fixtures locking canonical outputs"
```

---

## Task 18: Poor-vibe-fit telemetry

**Files:**
- Modify: `server/src/services/broadcast/DeterministicTrackSequencer.ts`
- Test: `server/__tests__/broadcast/DeterministicTrackSequencer.telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/broadcast/DeterministicTrackSequencer.telemetry.test.ts
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
    // Every track has very low energy — workout target is high-energy.
    const chain = makeChain({ tempo: 70, energy: 0.15, valence: 0.25, danceability: 0.20, acousticness: 0.75, loudness: 0.25, instrumentalness: 0.05 });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.telemetry.test.ts`
Expected: FAIL — no poor-fit log currently emitted.

- [ ] **Step 3: Add mean-distance computation + warning log**

Edit `server/src/services/broadcast/DeterministicTrackSequencer.ts`:

```ts
const POOR_FIT_THRESHOLD = 0.7;

// Inside sequence(), after the for-loop that populates `result`:
// track mean distance of selected tracks (before adjacency penalty):
let totalDistance = 0;
for (let i = 0; i < result.length; i++) {
  const p = result.length === 1 ? 0 : i / (result.length - 1);
  const target = interpolateKeyframes(curve.keyframes, p);
  const features = featureMap.get(result[i].id)!.features;
  totalDistance += weightedDistance(features, target, curve.weights);
}
const meanDistance = totalDistance / result.length;

if (meanDistance > POOR_FIT_THRESHOLD) {
  console.warn(`[Sequencer] poor vibe fit (mean distance ${meanDistance.toFixed(2)})`);
}

// Update logResult to include meanDistance in the info log:
private logResult(
  req: SequenceRequest,
  result: ManifestTrack[],
  stats: { reccobeats: number; synthesized: number; defaults: number },
  meanDistance: number,
): void {
  const firstId = result[0]?.id ?? '';
  const lastId = result[result.length - 1]?.id ?? '';
  console.log(
    `[Sequencer] source=deterministic vibe=${req.vibe} N=${result.length} poolSize=${req.pool.length} ` +
    `firstId=${firstId} lastId=${lastId} meanDistance=${meanDistance.toFixed(2)} ` +
    `features: reccobeats=${stats.reccobeats} synthesized=${stats.synthesized} defaults=${stats.defaults}`
  );
}
```

Pass `meanDistance` when calling `this.logResult(...)` at the end of `sequence()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.telemetry.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/DeterministicTrackSequencer.ts server/__tests__/broadcast/DeterministicTrackSequencer.telemetry.test.ts
git commit -m "feat(sequencer): poor-vibe-fit warning + mean-distance telemetry"
```

---

## Task 19: Document the new architecture in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Sequencer" subsection under "The Pre-Baked Broadcast Pipeline"**

Edit `CLAUDE.md`. Near the existing "Curation sequencer (TrackSequencer)" section, replace the stale description with:

```markdown
### Curation sequencer (`DeterministicTrackSequencer`)

- Deterministic numeric sequencing replaced the LLM-based `TrackSequencer` on
  2026-04-21. The old path is preserved as `LLMTrackSequencer` behind env
  `SEQUENCER_MODE=llm` for rollback; slated for deletion after soak.
- Each track carries `AudioFeatures` (`tempo/energy/valence/danceability/
  acousticness/loudness/instrumentalness`). Features fetched by
  `FeatureFetchChain` with the ladder:
  ReccoBeats (ISRC-keyed) → Deezer (BPM+loudness) → Last.fm tags + genre
  synth → genre-only defaults → neutrals. Populated in `BackgroundEnricher`'s
  drainNow stage; persisted in `EnrichmentCache` alongside existing fields.
- Vibe curves live in `server/src/services/broadcast/vibe-curves.ts` — 4
  keyframes (open/body/peak/close at fractional positions 0.0/0.33/0.67/1.0)
  × 7 vibes × 7 features, plus per-feature weights. Hand-authored from the
  prose in `vibe-arcs.ts`; data, not code.
- For each slot, the sequencer interpolates the target vector at fractional
  position `i/(N-1)`, scores every remaining track by weighted L2 distance +
  adjacency penalty (+0.15 same artist, +0.30 same album), takes top-K
  candidates (K=2 for quick, K=3 for standard/long), and picks one via a
  `mulberry32` PRNG seeded on `broadcastId`.
- **Deterministic within a bake** (same broadcastId → byte-identical output);
  **varies across bakes** (different broadcastId → different top-K pick).
- No LLM involvement in ordering. Sequencer output always valid — fallback
  ladder guarantees every track has a complete feature vector; no `pool.slice`
  silent fallback.
- `SequenceCache` is deleted; sequencing is ~microseconds so caching is
  incompatible with per-bake seeded variation anyway.
- `nominateDeepDives` ranks transitions by incoming-track enrichment richness
  (count of non-empty fields among producer/sample/wikipediaSummary/
  notableFacts) and caps picks at `ceil((N-1)/4)`. Deterministic.

**Telemetry:** each bake logs
`[Sequencer] source=deterministic vibe=X N=Y poolSize=Z firstId=... lastId=...
meanDistance=0.XX features: reccobeats=n synthesized=m defaults=k`.
Poor-fit warning (`[Sequencer] poor vibe fit (mean distance 0.XX)`) fires
when mean distance exceeds 0.7 — indicates the pool doesn't match the vibe.
```

- [ ] **Step 2: Add `SEQUENCER_MODE` to the Environment Variables section**

Under `server/.env` section, add after `TTS_FALLBACK`:

```env
# Sequencer — default 'deterministic' (ReccoBeats-based). 'llm' keeps the
# old LLM-based path for rollback. Flag removed after 2-week soak.
SEQUENCER_MODE=deterministic
```

- [ ] **Step 3: Update the "Deprecated / stripped" section to call out SequenceCache removal path**

Add a line under "Deprecated / stripped (legacy warnings)":

```markdown
- `SequenceCache` deleted (2026-04-21) as part of the deterministic sequencer
  migration. No replacement — scoring is microseconds + per-bake seed is
  cache-incompatible.
- `LLMTrackSequencer` (formerly `TrackSequencer`) kept behind `SEQUENCER_MODE=llm`
  for rollback; slated for deletion after 2 weeks of clean deterministic
  production data. Includes `SYSTEM_PROMPT`, `parseResponse`, `buildPrompt`,
  `attemptSequence`, and the iterative repair loop in `sequence-repair.ts`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): sequencer redesign — features, curves, SEQUENCER_MODE flag"
```

---

## Task 20: Type-check + full-suite smoke

**Files:** none

- [ ] **Step 1: TypeScript check server**

Run: `cd server && npx tsc --noEmit`
Expected: No errors. If errors surface, fix before continuing.

- [ ] **Step 2: TypeScript check client**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Full Jest suite on server**

Run: `cd server && npx jest`
Expected: All green. 258 prior tests + ~50 new tests from this plan pass.

- [ ] **Step 4: Spot-check production bake locally**

Run: `cd server && npm run dev` in one terminal. In another, `curl` a test bake (use an existing test script or fresh request) and verify the response returns a manifest with `segmentSlots` populated. Check the log output for `[Sequencer] source=deterministic`.

- [ ] **Step 5: Commit (if any fixes were required)**

```bash
git add -A
git commit -m "chore(sequencer): type-check clean, full suite green after redesign"
```

If nothing changed, skip this commit.

---

## Post-rollout cleanup (separate plan, 2 weeks after production deploy)

Once production telemetry shows clean runs for 2 weeks with `SEQUENCER_MODE=deterministic` (no `poor vibe fit` warnings in high volume, no feature-chain errors, golden tests still green), do a cleanup pass:

- Delete `server/src/services/broadcast/SequenceCache.ts` and its test.
- Delete `server/src/services/broadcast/TrackSequencer.ts` (the renamed `LLMTrackSequencer`), `SYSTEM_PROMPT`, `parseResponse`, `buildPrompt`.
- Delete `repairSequence` (iterative MAX_PASSES loop) from `sequence-repair.ts`; keep `removeDuplicates` (still used by `DeterministicTrackSequencer` if a future feature re-adds LLM-shaped inputs, and the pure helper is harmless).
- Collapse `BroadcastOrchestrator`'s sequencer-selection to a single type.
- Remove `SEQUENCER_MODE` env var documentation.
- Delete `__tests__/broadcast/BroadcastOrchestrator.sequencer-flag.test.ts` (no longer meaningful).

This cleanup is intentionally deferred — don't do it inside the initial rollout plan.

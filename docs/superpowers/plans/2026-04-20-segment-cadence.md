# Segment Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halve the number of host segments per broadcast while keeping ONAY's voice personal — cuts bake time ~30-55% across all length presets.

**Architecture:** Three surgical changes: (1) `ManifestBuilder` produces fewer transition slots with alternating tiers, (2) `SegmentScriptBuilder` adds a new tighter tier and drops the outgoing-track reference, (3) `BroadcastPlayer` iterates the new sparse segment layout.

**Tech Stack:** TypeScript, Jest (server), existing test harness for `BroadcastPlayer` (uses mock deps, no RN runtime required).

**Spec:** `docs/superpowers/specs/2026-04-20-segment-cadence-design.md`

---

## File Structure

**Server:**
- Modify: `server/src/services/broadcast/types.ts` — extend `SegmentTier` union
- Modify: `server/src/services/broadcast/ManifestBuilder.ts` — new slot generation + alternation
- Modify: `server/src/services/broadcast/SegmentScriptBuilder.ts` — new tier shape + hybrid transition prompt + discipline rule
- Modify: `server/__tests__/broadcast/ManifestBuilder.test.ts` — replace old-shape expectations with new
- Modify: `server/__tests__/broadcast/SegmentScriptBuilder.test.ts` — add tight_bridge + discipline tests

**Client:**
- Modify: `src/engines/BroadcastPlayer.ts` — rewrite `start()` main loop
- Modify: any existing `BroadcastPlayer` tests that hard-code N+1 segments (inspect `__tests__` at task start)

---

## Task 1: Extend `SegmentTier` and update `ManifestBuilder`

**Files:**
- Modify: `server/src/services/broadcast/types.ts`
- Modify: `server/src/services/broadcast/ManifestBuilder.ts`
- Modify: `server/__tests__/broadcast/ManifestBuilder.test.ts`

### Step 1.1 — Add `tight_bridge` to SegmentTier union

- [ ] **Edit `server/src/services/broadcast/types.ts`:**

Find the existing `SegmentTier` union (search for `export type SegmentTier`). Add `'tight_bridge'` to the list. Resulting declaration should read:

```ts
export type SegmentTier =
  | 'cold_open'
  | 'fact_bridge'
  | 'tight_bridge'
  | 'deep_dive'
  | 'sign_off';
```

(Preserve the exact style/formatting the file already uses.)

### Step 1.2 — Rewrite existing `ManifestBuilder` tests for new shape

- [ ] **Replace the contents of `server/__tests__/broadcast/ManifestBuilder.test.ts` with:**

```ts
import { buildManifest } from '@/services/broadcast/ManifestBuilder';
import type { ManifestTrack } from '@/services/broadcast/types';

const t = (id: string): ManifestTrack => ({
  id, title: `Title ${id}`, artistName: `Artist ${id}`,
  albumTitle: `Album ${id}`, duration: 210,
});

describe('buildManifest — segment count', () => {
  it('produces cold_open + 2 transitions + sign_off (= 4 slots) for 5 tracks', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots).toHaveLength(4);
    expect(m.tracks).toHaveLength(5);
  });

  it('produces cold_open + 4 transitions + sign_off (= 6 slots) for 9 tracks', () => {
    const tracks = Array.from({ length: 9 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'standard', tracks,
    });
    expect(m.segmentSlots).toHaveLength(6);
  });

  it('produces cold_open + 7 transitions + sign_off (= 9 slots) for 15 tracks', () => {
    const tracks = Array.from({ length: 15 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'long', tracks,
    });
    expect(m.segmentSlots).toHaveLength(9);
  });

  it('produces cold_open + sign_off only (= 2 slots) for 1 track', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks: [t('only')],
    });
    expect(m.segmentSlots).toHaveLength(2);
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[1].kind).toBe('sign_off');
  });

  it('preserves input track order', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.tracks.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('throws on empty track list', () => {
    expect(() =>
      buildManifest({
        userId: 'u1', playlistId: 'p1', vibe: 'morning',
        length: 'quick', tracks: [],
      }),
    ).toThrow(/at least one track/);
  });
});

describe('buildManifest — slot targeting', () => {
  it('cold_open references first track via beforeTrackId', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[0].beforeTrackId).toBe('a');
    expect(m.segmentSlots[0].afterTrackId).toBeUndefined();
  });

  it('sign_off references last track via afterTrackId', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    const last = m.segmentSlots[m.segmentSlots.length - 1];
    expect(last.kind).toBe('sign_off');
    expect(last.afterTrackId).toBe('c');
    expect(last.beforeTrackId).toBeUndefined();
  });

  it('transitions fire before even-indexed tracks (2, 4, 6, ...)', () => {
    // 5 tracks: transitions should target indices 2 and 4 (ids '2' and '4').
    const tracks = Array.from({ length: 5 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    // slots: 0=cold_open, 1=transition(after '1', before '2'), 2=transition(after '3', before '4'), 3=sign_off
    expect(m.segmentSlots[1].kind).toBe('transition');
    expect(m.segmentSlots[1].afterTrackId).toBe('1');
    expect(m.segmentSlots[1].beforeTrackId).toBe('2');
    expect(m.segmentSlots[2].kind).toBe('transition');
    expect(m.segmentSlots[2].afterTrackId).toBe('3');
    expect(m.segmentSlots[2].beforeTrackId).toBe('4');
  });
});

describe('buildManifest — tier alternation', () => {
  it('sets cold_open and sign_off tiers correctly', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => t(String(i))),
    });
    expect(m.segmentSlots[0].tier).toBe('cold_open');
    expect(m.segmentSlots[m.segmentSlots.length - 1].tier).toBe('sign_off');
  });

  it('alternates transitions starting with fact_bridge', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'long',
      tracks: Array.from({ length: 15 }, (_, i) => t(String(i))),
    });
    // slots: 0 cold_open, 1-7 transitions, 8 sign_off
    const transitions = m.segmentSlots.slice(1, -1);
    expect(transitions).toHaveLength(7);
    expect(transitions[0].tier).toBe('fact_bridge');
    expect(transitions[1].tier).toBe('tight_bridge');
    expect(transitions[2].tier).toBe('fact_bridge');
    expect(transitions[3].tier).toBe('tight_bridge');
    expect(transitions[4].tier).toBe('fact_bridge');
    expect(transitions[5].tier).toBe('tight_bridge');
    expect(transitions[6].tier).toBe('fact_bridge');
  });

  it('marks transitions as deep_dive when index is in featureSlots', () => {
    // 5 tracks → slots 0=cold_open, 1=transition, 2=transition, 3=sign_off
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => t(String(i))),
      featureSlots: [1],
    });
    expect(m.segmentSlots[1].tier).toBe('deep_dive');
    // slot 2 should still follow the alternation (tight_bridge, since slot 1
    // would have been fact_bridge had featureSlots not overridden it)
    expect(m.segmentSlots[2].tier).toBe('tight_bridge');
  });

  it('stores featureSlots on the manifest', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => t(String(i))),
      featureSlots: [1],
    });
    expect(m.featureSlots).toEqual([1]);
  });
});
```

### Step 1.3 — Run tests to verify they fail against current ManifestBuilder

Run: `cd server && npx jest --testPathPatterns=ManifestBuilder -v`

Expected: multiple FAIL entries — segment counts wrong (5 tracks still produces 6 slots today), alternation tests fail (no `tight_bridge` tier used), targeting tests fail (transitions still fire before every track).

### Step 1.4 — Rewrite `ManifestBuilder.ts` to produce new cadence

- [ ] **Replace the body of `buildManifest` in `server/src/services/broadcast/ManifestBuilder.ts` with:**

```ts
export function buildManifest(input: BuildManifestInput): Manifest {
  if (input.tracks.length === 0) {
    throw new Error('buildManifest requires at least one track');
  }

  const tracks = input.tracks;
  const featureSlots = input.featureSlots ?? [];
  const featureSet = new Set(featureSlots);
  const segmentSlots: SegmentSlot[] = [];

  segmentSlots.push({
    index: 0,
    kind: 'cold_open',
    beforeTrackId: tracks[0].id,
    afterTrackId: undefined,
    variantCount: 1,
    status: 'pending',
    tier: 'cold_open',
  });

  // Transitions fire before tracks at indices 2, 4, 6, … (every other track
  // starting from the third). Tier alternates fact_bridge → tight_bridge,
  // starting with fact_bridge. featureSlots overrides to deep_dive but does
  // NOT consume a step in the alternation counter — the next non-deep_dive
  // transition still follows whatever the natural next tier would be.
  let alternationCounter = 0;
  for (let i = 2; i < tracks.length; i += 2) {
    const index = segmentSlots.length;
    const naturalTier: SegmentTier =
      alternationCounter % 2 === 0 ? 'fact_bridge' : 'tight_bridge';
    const tier: SegmentTier = featureSet.has(index) ? 'deep_dive' : naturalTier;
    segmentSlots.push({
      index,
      kind: 'transition',
      afterTrackId: tracks[i - 1].id,
      beforeTrackId: tracks[i].id,
      variantCount: 1,
      status: 'pending',
      tier,
    });
    alternationCounter += 1;
  }

  segmentSlots.push({
    index: segmentSlots.length,
    kind: 'sign_off',
    afterTrackId: tracks[tracks.length - 1].id,
    beforeTrackId: undefined,
    variantCount: 1,
    status: 'pending',
    tier: 'sign_off',
  });

  return {
    broadcastId: randomUUID(),
    userId: input.userId,
    playlistId: input.playlistId,
    vibe: input.vibe,
    length: input.length,
    createdAt: Date.now(),
    tracks,
    segmentSlots,
    featureSlots,
  };
}
```

Leave the `BuildManifestInput` interface above the function untouched.

### Step 1.5 — Run tests to verify they pass

Run: `cd server && npx jest --testPathPatterns=ManifestBuilder -v`

Expected: all ManifestBuilder tests pass.

### Step 1.6 — Run full server suite to catch downstream breakage

Run: `cd server && npm test`

Expected: some failures in tests that assumed the old slot count (likely `BroadcastOrchestrator.test.ts`, `SegmentGenerator.test.ts`, and/or `SegmentScriptBuilder.test.ts`). Note the failing tests — they'll be addressed in Task 2 (prompt) and Task 4 (verification).

If any unrelated test fails (not about segment counts, tier names, or transition wording), stop and investigate before moving on.

### Step 1.7 — Commit

```bash
git add server/src/services/broadcast/types.ts \
        server/src/services/broadcast/ManifestBuilder.ts \
        server/__tests__/broadcast/ManifestBuilder.test.ts
git commit -m "feat(server): halve transitions and introduce tight_bridge tier"
```

---

## Task 2: Update `SegmentScriptBuilder` for new tier + hybrid transition + discipline

**Files:**
- Modify: `server/src/services/broadcast/SegmentScriptBuilder.ts`
- Modify: `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`

### Step 2.1 — Add failing test for `tight_bridge` prompt budget

- [ ] **Append to `server/__tests__/broadcast/SegmentScriptBuilder.test.ts` (inside the existing `describe('buildSegmentPrompts — transition', ...)` block if present; otherwise add a new describe block at the bottom):**

```ts
describe('buildSegmentPrompts — tight_bridge tier', () => {
  const baseCtx = {
    timeOfDay: '21:30', dayOfWeek: 'Tuesday', firstTimeUser: false,
  };
  const tracks = [
    { id: '1', title: 'First', artistName: 'A', albumTitle: '', duration: 180 },
    { id: '2', title: 'Second', artistName: 'B', albumTitle: '', duration: 180 },
  ];
  const manifest = {
    broadcastId: 'b', userId: 'u', playlistId: null, vibe: 'lateNight' as const,
    length: 'quick' as const, createdAt: 0, tracks,
    segmentSlots: [], featureSlots: [],
  };

  it('emits a 30-40 word budget when tier is tight_bridge', () => {
    const slot = {
      index: 1, kind: 'transition' as const,
      afterTrackId: '1', beforeTrackId: '2',
      variantCount: 1, status: 'pending' as const,
      tier: 'tight_bridge' as const,
    };
    const [prompt] = buildSegmentPrompts(slot, manifest, baseCtx);
    expect(prompt.userPrompt).toMatch(/30-40 words/);
  });

  it('drops the outgoing-track line under hybrid rule', () => {
    const slot = {
      index: 1, kind: 'transition' as const,
      afterTrackId: '1', beforeTrackId: '2',
      variantCount: 1, status: 'pending' as const,
      tier: 'tight_bridge' as const,
    };
    const [prompt] = buildSegmentPrompts(slot, manifest, baseCtx);
    // Hybrid rule: no "Outgoing:" line in the user prompt.
    expect(prompt.userPrompt).not.toMatch(/^Outgoing:/m);
    // Incoming track still referenced.
    expect(prompt.userPrompt).toMatch(/^Incoming: /m);
  });
});

describe('buildSegmentPrompts — fact_bridge tier (post-hybrid)', () => {
  const baseCtx = {
    timeOfDay: '21:30', dayOfWeek: 'Tuesday', firstTimeUser: false,
  };
  const tracks = [
    { id: '1', title: 'First', artistName: 'A', albumTitle: '', duration: 180 },
    { id: '2', title: 'Second', artistName: 'B', albumTitle: '', duration: 180 },
  ];
  const manifest = {
    broadcastId: 'b', userId: 'u', playlistId: null, vibe: 'lateNight' as const,
    length: 'quick' as const, createdAt: 0, tracks,
    segmentSlots: [], featureSlots: [],
  };

  it('emits a 45-55 word budget when tier is fact_bridge', () => {
    const slot = {
      index: 1, kind: 'transition' as const,
      afterTrackId: '1', beforeTrackId: '2',
      variantCount: 1, status: 'pending' as const,
      tier: 'fact_bridge' as const,
    };
    const [prompt] = buildSegmentPrompts(slot, manifest, baseCtx);
    expect(prompt.userPrompt).toMatch(/45-55 words/);
  });

  it('drops the outgoing-track line under hybrid rule', () => {
    const slot = {
      index: 1, kind: 'transition' as const,
      afterTrackId: '1', beforeTrackId: '2',
      variantCount: 1, status: 'pending' as const,
      tier: 'fact_bridge' as const,
    };
    const [prompt] = buildSegmentPrompts(slot, manifest, baseCtx);
    expect(prompt.userPrompt).not.toMatch(/^Outgoing:/m);
    expect(prompt.userPrompt).toMatch(/^Incoming: /m);
  });
});

describe('buildSegmentPrompts — fact discipline', () => {
  const baseCtx = {
    timeOfDay: '21:30', dayOfWeek: 'Tuesday', firstTimeUser: false,
  };
  const tracks = [
    { id: '1', title: 'First', artistName: 'A', albumTitle: '', duration: 180 },
    { id: '2', title: 'Second', artistName: 'B', albumTitle: '', duration: 180 },
  ];
  const manifest = {
    broadcastId: 'b', userId: 'u', playlistId: null, vibe: 'lateNight' as const,
    length: 'quick' as const, createdAt: 0, tracks,
    segmentSlots: [], featureSlots: [],
  };

  it('includes the single-fact discipline rule in the system prompt', () => {
    const slot = {
      index: 1, kind: 'transition' as const,
      afterTrackId: '1', beforeTrackId: '2',
      variantCount: 1, status: 'pending' as const,
      tier: 'fact_bridge' as const,
    };
    const [prompt] = buildSegmentPrompts(slot, manifest, baseCtx);
    expect(prompt.systemPrompt).toMatch(/single most interesting fact/);
    expect(prompt.systemPrompt).toMatch(/Don.t try to weave multiple/);
  });
});
```

### Step 2.2 — Run tests to verify they fail

Run: `cd server && npx jest --testPathPatterns=SegmentScriptBuilder -v`

Expected: the new test cases fail. `tight_bridge` tests fail with "Cannot read properties of undefined (reading 'budget')" or similar from `TIER_SHAPES[tier]`. Hybrid rule tests fail because transition user prompt still contains the `Outgoing:` line. Discipline test fails because the system prompt doesn't mention "single most interesting fact."

### Step 2.3 — Add `tight_bridge` to `TIER_SHAPES` and tighten `fact_bridge`

- [ ] **Edit `server/src/services/broadcast/SegmentScriptBuilder.ts` — replace the entire `TIER_SHAPES` const with:**

```ts
const TIER_SHAPES: Record<SegmentTier, { budget: string; shape: string }> = {
  cold_open: {
    budget: '55-80 words',
    shape: 'Anchor the time and vibe first, then name the opening track. If a concrete detail about the track is in the enrichment, weave it in naturally. Land on the track name so the music can come in.',
  },
  fact_bridge: {
    budget: '45-55 words',
    shape: 'One concrete fact (year, producer, sample, lyric, chart, or studio) and one perceptual note (how it lands, what is about to change). End by naming the incoming track. Tight \u2014 no filler. Do not acknowledge the outgoing track \u2014 the listener just heard it and you never introduced it.',
  },
  tight_bridge: {
    budget: '30-40 words',
    shape: 'One hook \u2014 either a concrete fact OR a perceptual note, not both. Name the incoming track. Tight, no filler. Do not acknowledge the outgoing track.',
  },
  deep_dive: {
    budget: '80-120 words',
    shape: 'Lead with a hook \u2014 a detail that pulls them in. Expand one thread \u2014 the person, the moment, the sonic element. If a thread connects outgoing and incoming tracks, use it. Land on the track name.',
  },
  sign_off: {
    budget: '35-55 words',
    shape: 'Reference the closing track with one fact and one feel. Send them off with warmth. Optional: tease coming back.',
  },
};
```

### Step 2.4 — Add the fact-discipline rule to the system prompt

- [ ] **In `server/src/services/broadcast/SegmentScriptBuilder.ts`, find `buildSystemPrompt`. Locate the `FACT DISCIPLINE:` line and replace the entire existing FACT DISCIPLINE paragraph with:**

```ts
    'FACT DISCIPLINE: When you state specifics \u2014 producer credits, year, chart positions, personnel, lyrical references, sessions \u2014 use ONLY what\u2019s in the enrichment block or what you know with high confidence from your training. If you\u2019re not certain about a fact, don\u2019t invent one. Pivot to the perceptual instead: how it feels, what the sonics do, what\u2019s about to shift. Never fabricate names, dates, or credits. Pick the single most interesting fact from the enrichment. Don\u2019t try to weave multiple.',
```

The only change is the appended sentence `Pick the single most interesting fact from the enrichment. Don't try to weave multiple.` Everything before that stays identical.

### Step 2.5 — Drop the outgoing-track line from the transition user prompt

- [ ] **In `server/src/services/broadcast/SegmentScriptBuilder.ts`, find the block inside `buildSegmentPrompts` that handles `slot.kind === 'transition'`. Replace the existing `userPrompt` construction with:**

```ts
    const userPrompt =
      `${scene}\n\n` +
      `Incoming: ${trackRef(incoming)} \u2014 ${family}.` +
      buildEnrichmentBlock(incomingEnr) +
      `\n\nWrite ONAY\u2019s ${tier}. ${budget}. End by naming the incoming track.`;
```

The only changes: (a) remove the `Outgoing: …\n` line entirely, (b) all other parts unchanged. Keep the `const outgoing = findTrack(...)` line above it so we don't break the `incoming` variable's surrounding declarations — or if the outgoing variable is never referenced again, delete its declaration line too. Verify by searching the function scope for `outgoing` usages.

### Step 2.6 — Run tests to verify they pass

Run: `cd server && npx jest --testPathPatterns=SegmentScriptBuilder -v`

Expected: all SegmentScriptBuilder tests pass, including the three new describe blocks.

### Step 2.7 — Run full server suite

Run: `cd server && npm test`

Expected: all server tests pass. If `BroadcastOrchestrator` or `SegmentGenerator` tests still fail from Task 1.6, those failures must now have cleared because the manifest + prompt shapes are both updated. If any failure remains, read the message — it should point at stale tests (e.g., asserting specific transition wording that referenced "outgoing").

### Step 2.8 — Commit

```bash
git add server/src/services/broadcast/SegmentScriptBuilder.ts \
        server/__tests__/broadcast/SegmentScriptBuilder.test.ts
git commit -m "feat(server): tight_bridge tier, hybrid transition prompt, fact discipline"
```

---

## Task 3: Update `BroadcastPlayer` main loop for sparse segments

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts`
- Inspect (may modify): `__tests__/engines/BroadcastPlayer*.test.ts` or `src/engines/__tests__/BroadcastPlayer*.test.ts`

### Step 3.1 — Locate existing BroadcastPlayer tests

- [ ] **Run a search and note the paths:**

```bash
grep -rl 'BroadcastPlayer' __tests__ src 2>/dev/null | grep test
```

If any tests exist, read them to see how they construct manifests and assert playback order. If none exist, skip to Step 3.2.

### Step 3.2 — Rewrite the main loop in `start()`

- [ ] **Edit `src/engines/BroadcastPlayer.ts`. Find the block inside `start()` that reads:**

```ts
    await this.runSegmentAt(0);
    if (!this.manifest) return;
    await this.waitIfPaused();
    if (!this.manifest) return;
    for (let i = 0; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      await this.runSegmentAt(i + 1);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
    }
```

Replace it with:

```ts
    await this.runSegmentAt(0);
    if (!this.manifest) return;
    await this.waitIfPaused();
    if (!this.manifest) return;

    // Walk tracks in order. After each track, check whether the next segment
    // in the manifest targets the upcoming track (beforeTrackId match) or is
    // the sign_off. If neither, play the next track directly — adjacent
    // tracks with no transition between them play back-to-back.
    let nextSegmentIdx = 1;
    for (let i = 0; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;

      const slots = this.manifest.segmentSlots;
      const nextTrack = this.manifest.tracks[i + 1];
      const nextSlot = slots[nextSegmentIdx];

      if (!nextTrack) {
        // Last track just ended — play sign_off if present.
        if (nextSlot && nextSlot.kind === 'sign_off') {
          await this.runSegmentAt(nextSegmentIdx);
          if (!this.manifest) return;
          await this.waitIfPaused();
          if (!this.manifest) return;
        }
        break;
      }

      // Run the next segment only if it introduces the upcoming track.
      if (nextSlot && nextSlot.beforeTrackId === nextTrack.id) {
        await this.runSegmentAt(nextSegmentIdx);
        if (!this.manifest) return;
        await this.waitIfPaused();
        if (!this.manifest) return;
        nextSegmentIdx += 1;
      }
    }
```

Leave every line after this block (the `await this.music.pause()` through `clearPersistedBroadcast()`) unchanged.

### Step 3.3 — Update existing BroadcastPlayer tests if present

- [ ] **If Step 3.1 found test files:** open each and look for any test that:

- Constructs a manifest with `N+1` segments for `N` tracks
- Asserts `runSegmentAt` is called exactly `N+1` times
- Builds a manifest by calling a helper that assumes the old ratio

Update those cases to use the new shape. Concretely:
- Helper factories that synthesize segment arrays should use `buildManifest` from the server types (if imported) or generate the sparse layout: `[cold_open, transition(before=track[2]), transition(before=track[4]), …, sign_off]`.
- Call-count assertions for `runSegmentAt` drop to `1 + floor((tracks.length - 1) / 2) + 1` (cold_open + transitions + sign_off).

If the existing tests mock at a higher level (e.g., assert only that tracks played in order), they may pass unchanged.

### Step 3.4 — Add a new test for sparse-segment iteration

- [ ] **Choose the test path discovered in Step 3.1, or create `src/engines/__tests__/BroadcastPlayer.sparse.test.ts` if no home exists. Append (or write) this test, using the existing test's mock deps pattern as a template. If no existing test is there, use this minimal skeleton:**

```ts
import { BroadcastPlayer } from '../BroadcastPlayer';
import type { Manifest } from '../BroadcastPlayer.types';

function mkManifest(): Manifest {
  // 5 tracks, sparse segments: cold_open → t0 → t1 → trans(before t2) → t2 → t3 → trans(before t4) → t4 → sign_off
  return {
    broadcastId: 'b1',
    userId: 'u',
    playlistId: null,
    vibe: 'lateNight',
    length: 'quick',
    createdAt: 0,
    tracks: Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, title: `Track ${i}`, artistName: 'A',
      albumTitle: '', duration: 1,
    })),
    segmentSlots: [
      {
        index: 0, kind: 'cold_open', beforeTrackId: 't0',
        afterTrackId: undefined, variantCount: 1, status: 'ready',
        tier: 'cold_open', audioUrls: ['u0'],
      },
      {
        index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2',
        variantCount: 1, status: 'ready', tier: 'fact_bridge', audioUrls: ['u1'],
      },
      {
        index: 2, kind: 'transition', afterTrackId: 't3', beforeTrackId: 't4',
        variantCount: 1, status: 'ready', tier: 'tight_bridge', audioUrls: ['u2'],
      },
      {
        index: 3, kind: 'sign_off', afterTrackId: 't4',
        beforeTrackId: undefined, variantCount: 1, status: 'ready',
        tier: 'sign_off', audioUrls: ['u3'],
      },
    ],
    featureSlots: [],
  };
}

describe('BroadcastPlayer — sparse segments', () => {
  it('plays all 5 tracks in order interleaved with 4 segments', async () => {
    const events: string[] = [];
    const music = {
      play: jest.fn(async (ids?: string[]) => { events.push(`track:${ids?.[0]}`); }),
      pause: jest.fn(async () => {}),
      skip: jest.fn(async () => {}),
      setUpcomingQueue: jest.fn(async () => {}),
      onTrackChanged: jest.fn(() => () => {}),
      onPlaybackStateChanged: jest.fn((cb) => {
        // Immediately end each track after play() is called.
        queueMicrotask(() => cb({ status: 'playing', playbackTime: 0 }));
        queueMicrotask(() => cb({ status: 'playing', playbackTime: 0.9 }));
        queueMicrotask(() => cb({ status: 'stopped', playbackTime: 1 }));
        return () => {};
      }),
      getPlaybackStatus: jest.fn(async () => 'stopped'),
      getPlaybackTime: jest.fn(async () => 1),
    };
    const native = {
      activateDuckingSession: jest.fn(async () => {}),
      deactivateDuckingSession: jest.fn(async () => {}),
      playAudioFromBase64: jest.fn(async (b64: string) => { events.push(`seg:${b64}`); }),
      stopAudio: jest.fn(async () => {}),
      releaseAudioSession: jest.fn(async () => {}),
    };
    const manifestClient = {
      fetchSegmentAudio: jest.fn(async (url: string) => `b64-${url}`),
      fetchManifest: jest.fn(async () => mkManifest()),
    };
    const stingers = {
      getStinger: jest.fn(async () => null),
      preloadStingers: jest.fn(async () => {}),
    };
    const player = new BroadcastPlayer(music, native, manifestClient, stingers);
    const manifest = mkManifest();

    await player.start(manifest, ['u0']);

    // Expected order: cold_open, t0, t1, trans-1, t2, t3, trans-2, t4, sign_off
    expect(events).toEqual([
      'seg:b64-u0',
      'track:t0',
      'track:t1',
      'seg:b64-u1',
      'track:t2',
      'track:t3',
      'seg:b64-u2',
      'track:t4',
      'seg:b64-u3',
    ]);
  });
});
```

### Step 3.5 — Run tests to verify new + old pass

Run: `cd /Users/kari/Documents/cleo-app && npx jest BroadcastPlayer -v`

Expected: new sparse test passes. Any old BroadcastPlayer tests updated in 3.3 also pass. If an old test you updated still fails, reconcile before continuing — do not skip it.

### Step 3.6 — Commit

```bash
git add src/engines/BroadcastPlayer.ts \
        $(ls src/engines/__tests__/BroadcastPlayer*.ts __tests__/engines/BroadcastPlayer*.ts 2>/dev/null)
git commit -m "feat(client): BroadcastPlayer iterates sparse segment cadence"
```

(Adjust the `git add` paths to only the files actually modified; if you created a new test file, include it.)

---

## Task 4: Verify end-to-end and deploy

**Files:** none modified; verification only.

### Step 4.1 — Run full server test suite

Run: `cd server && npm test`

Expected: all tests pass (previous count was 249 — may be higher now with new tests).

### Step 4.2 — Run client-side TypeScript check

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`

Expected: no type errors. If `BroadcastPlayer.types.ts` needs `tight_bridge` in its `SegmentTier` (it mirrors the server type), add it.

### Step 4.3 — Check client SegmentTier type if needed

- [ ] **Read `src/engines/BroadcastPlayer.types.ts` and confirm `SegmentTier` includes all five tiers (cold_open, fact_bridge, tight_bridge, deep_dive, sign_off). If it's missing `tight_bridge`, add it to match the server-side type.**

### Step 4.4 — Build the server

Run: `cd server && npm run build`

Expected: clean `tsc` output, no errors.

### Step 4.5 — Deploy to prod VPS

Run from project root:

```bash
rsync -avz \
  --exclude='node_modules' --exclude='dist' --exclude='.env' --exclude='.env.local' \
  --exclude='.broadcast-cache' --exclude='.enrichment-cache' --exclude='.tts-cache' \
  --exclude='__tests__' --exclude='coverage' \
  --exclude='featured-broadcasts/registry.json' --exclude='logs' \
  ./server/ cleo@187.124.69.95:~/cleo-broadcast/
```

Then on the VPS:

```bash
ssh cleo@187.124.69.95 'cd ~/cleo-broadcast && npm run build && pm2 reload cleo-broadcast'
```

### Step 4.6 — Verify prod health

Run:

```bash
ssh cleo@187.124.69.95 'curl -s http://localhost:3102/health && echo && pm2 logs cleo-broadcast --lines 10 --nostream'
```

Expected: `{"status":"ok"}` and a clean "Cleo server running on 0.0.0.0:3102" line.

### Step 4.7 — Live bake smoke test

Trigger a fresh bake from the app (iOS TestFlight build):
1. Build: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device` from project root.
2. Open the app, start a 5-song broadcast.
3. Watch server logs: `ssh cleo@187.124.69.95 'pm2 logs cleo-broadcast'`

Expected signals in prod logs:
- `TrackSequencer] source=…` once
- **Four** `[LLM] Using gemini` dispatches (cold_open + 2 transitions + sign_off) rather than six
- **Four** `[TTS] Using f5tts` and four `[TTS:f5tts] Audio:` lines
- No `[TTS] f5tts failed, falling back to cartesia` entries
- Total bake wallclock roughly halved vs. earlier 5-song runs (target: ~20-25s on the VPS-routed F5 server at current tuning)

In-app playback signals:
- Cold open plays, then tracks 1 and 2 play back-to-back with no host voice between them
- Transition 1 plays before track 3 (richer feel — `fact_bridge`)
- Tracks 3 and 4 play back-to-back
- Transition 2 plays before track 5 (tighter feel — `tight_bridge`)
- Sign_off plays after track 5

If any step diverges, stop and diagnose before declaring done.

### Step 4.8 — Commit any adjustments from Task 4

If Task 4.3 required a client type update, commit it:

```bash
git add src/engines/BroadcastPlayer.types.ts
git commit -m "chore(client): align SegmentTier with server types"
```

---

## Self-Review Checklist (completed by author)

- **Spec coverage:**
  - ✓ Segment placement rule (even-indexed transitions) — Task 1.4
  - ✓ Hybrid editorial (drop outgoing) — Task 2.5
  - ✓ Two-tier alternation starting with fact_bridge — Task 1.4
  - ✓ `tight_bridge` 30-40 words, `fact_bridge` 45-55 words — Task 2.3
  - ✓ Fact discipline prompt rule — Task 2.4
  - ✓ Player loop handles sparse layout — Task 3.2
  - ✓ `featureSlots` → `deep_dive` still works — Task 1.4 test + existing behavior preserved

- **Placeholder scan:** none. All code blocks are complete.

- **Type consistency:** `SegmentTier`, `SegmentSlot`, `Manifest`, `buildSegmentPrompts` signatures match across tasks. Client `BroadcastPlayer.types.ts` check in 4.3 catches any drift.

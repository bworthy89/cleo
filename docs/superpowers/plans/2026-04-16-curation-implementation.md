# Curation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic `tracks.slice(0, N)` in `ManifestBuilder` with a `TrackSequencer` stage that selects + reorders tracks from the user's playlist against hand-written editorial arcs per vibe, caches sequences for 24h, and accumulates track enrichment in a persistent background-filled cache. Trim the vibe taxonomy from 12 to 7.

**Architecture:** New server-side `TrackSequencer` class (pure, DI-friendly, same pattern as `SegmentGenerator`) runs before `ManifestBuilder` inside `BroadcastOrchestrator.create()`. Single LLM call per bake (Ollama primary / Gemini fallback via existing factory), structured JSON output, local rule-based repair for mechanical violations (same-artist / same-album adjacency, duplicates), silent fallback to deterministic slice after one retry. Two caches: in-memory `SequenceCache` (24h LRU) and persistent file-backed `EnrichmentCache` (30-day refresh). Background enrichment worker drains the Genius + MusicBrainz APIs serially after the sync response ships.

**Tech Stack:** TypeScript strict mode, Node/Express server, Zod validation, Jest + ts-jest. No new runtime dependencies — everything rides existing providers (Ollama/Gemini LLM, Genius + MusicBrainz routes' underlying fetch patterns, filesystem atomic writes à la `FeaturedBroadcastRegistry`).

**Reference documents:**
- Spec: `docs/superpowers/specs/2026-04-16-curation-design.md`
- CLAUDE.md for project conventions

---

## Task 1: Shrink the `Vibe` union from 12 to 7

**Goal:** Remove `chill`, `general`, `sunday`, `throwback`, `elevated` from the `Vibe` type everywhere. No feature-level changes yet — this is a pure type migration that breaks compilation in all the right places so nothing compiles against a dropped vibe.

**Files:**
- Modify: `server/src/services/broadcast/types.ts:1-6`
- Modify: `server/src/routes/broadcast.ts:6-10`
- Modify: `server/src/services/broadcast/SegmentScriptBuilder.ts:18-31`
- Modify: `src/engines/BroadcastPlayer.types.ts`
- Modify: `src/tokens/design-tokens.ts:8-22`
- Modify: `src/components/broadcast/SetupSheet.tsx:13-24`
- Modify: `src/components/VibePicker.tsx`
- Modify: `src/screens/curate/AskOnayScreen.tsx`
- Modify: `src/screens/settings/ProfileScreen.tsx`
- Modify: `server/src/routes/featured.ts`
- Modify: `server/src/routes/curation.ts`

- [ ] **Step 1.1: Shrink `Vibe` type in server types**

Replace the full union in `server/src/services/broadcast/types.ts` lines 1-6:

```ts
export type Vibe =
  | 'morning' | 'focus' | 'workout' | 'feelGood'
  | 'lateNight' | 'melancholy' | 'party';
```

- [ ] **Step 1.2: Shrink the Zod enum in the broadcast route**

Replace `server/src/routes/broadcast.ts` lines 6-10:

```ts
const vibeSchema = z.enum([
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
]);
```

- [ ] **Step 1.3: Trim `VIBE_DESCRIPTIONS` in `SegmentScriptBuilder`**

Replace `server/src/services/broadcast/SegmentScriptBuilder.ts` lines 18-31:

```ts
const VIBE_DESCRIPTIONS: Record<Vibe, string> = {
  morning: 'morning, warm, bright, gently energizing',
  focus: 'focus, minimal, calm, concentration-friendly',
  workout: 'workout, pumped, driving, high-energy',
  feelGood: 'feel-good, uplifting, affirming',
  lateNight: 'late-night, intimate, moody, introspective',
  melancholy: 'melancholy, bittersweet, reflective',
  party: 'party, celebratory, high-spirited, dance-floor energy',
};
```

- [ ] **Step 1.4: Mirror the `Vibe` union in client types**

Open `src/engines/BroadcastPlayer.types.ts`. Find the `Vibe` type (it mirrors the server's). Replace with the same 7-vibe union used in Step 1.1.

- [ ] **Step 1.5: Trim `Colors.vibe` map**

Replace `src/tokens/design-tokens.ts` lines 8-22:

```ts
  vibe: {
    morning:    { accent: '#C8832A' },
    focus:      { accent: '#4A7A5B' },
    workout:    { accent: '#FF4D3D' },
    feelGood:   { accent: '#E8923A' },
    lateNight:  { accent: '#7B5EA7' },
    melancholy: { accent: '#5B6A8A' },
    party:      { accent: '#FF8C42' },
  },
```

No change needed to `getVibeAccent()` — its lookup still works against the smaller map.

- [ ] **Step 1.6: Update `SetupSheet` vibe picker to 7 entries with editorial descriptors**

Replace `src/components/broadcast/SetupSheet.tsx` lines 13-24 with:

```tsx
  { id: 'morning',    label: 'Morning',    subtitle: 'Sun\u2019s up, gentle forward motion' },
  { id: 'focus',      label: 'Focus',      subtitle: 'Head-down, unobtrusive momentum' },
  { id: 'workout',    label: 'Workout',    subtitle: 'Sustained drive, no breathers' },
  { id: 'feelGood',   label: 'Feel Good',  subtitle: 'Warm, uplifting, communal' },
  { id: 'lateNight',  label: 'Late Night', subtitle: 'Hushed, warm, drifting' },
  { id: 'melancholy', label: 'Melancholy', subtitle: 'Reflective, sad in a good way' },
  { id: 'party',      label: 'Party',      subtitle: 'Saturday night, builds and releases' },
```

- [ ] **Step 1.7: Fix compile breakage in remaining UI files**

Run the TypeScript compiler to find every remaining reference:

```bash
cd /Users/kari/Documents/cleo-app && npx tsc --noEmit
```

Expected failures in `src/components/VibePicker.tsx`, `src/screens/curate/AskOnayScreen.tsx`, `src/screens/settings/ProfileScreen.tsx`, `server/src/routes/featured.ts`, `server/src/routes/curation.ts`, and any feature test that names a dropped vibe. In each:

- Replace references to `'chill'` with `'lateNight'` (closest surviving evening vibe)
- Replace references to `'general'` with `'feelGood'` (warmth without committing to a specific arc)
- Replace references to `'sunday'` with `'morning'` (same energy band)
- Replace references to `'throwback'` with `'feelGood'` (era-warmth → warmth)
- Replace references to `'elevated'` with `'feelGood'` (near-duplicate semantics)

For vibe-keyed lookup tables (e.g. an object in `VibePicker.tsx`), delete the entries for the dropped vibes entirely rather than remap.

- [ ] **Step 1.8: Re-tag `server/featured-broadcasts/*.json` example configs**

```bash
ls /Users/kari/Documents/cleo-app/server/featured-broadcasts/*.json
```

For each JSON config file using a dropped vibe in its `"vibe"` field, update the value using the same mapping from Step 1.7. Skip `registry.json` — it's gitignored and will re-populate on next bake.

- [ ] **Step 1.9: Re-run compiler, then run server test suite**

```bash
cd /Users/kari/Documents/cleo-app && npx tsc --noEmit
cd /Users/kari/Documents/cleo-app/server && npm test
```

Expected: 0 TS errors, existing test suite passes. Any Jest failure is a test fixture that named a dropped vibe — update it the same way as the UI files.

- [ ] **Step 1.10: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add -A && git commit -m "$(cat <<'EOF'
refactor: shrink Vibe taxonomy from 12 to 7

Drops chill, general, sunday, throwback, elevated. Remaining: morning,
focus, workout, feelGood, lateNight, melancholy, party. Updates type
unions, Zod enum, color map, SegmentScriptBuilder descriptions, and UI
copy in lockstep.

Preparation for the vibe-aware sequencer.
EOF
)"
```

---

## Task 2: Create `vibe-arcs.ts` with the 7 editorial arcs

**Goal:** Add the single source of truth for vibe arc data. One file, one exported `VIBE_ARCS` record. Shape is enforced by the `Vibe` type so the compiler catches any missing vibe.

**Files:**
- Create: `server/src/services/broadcast/vibe-arcs.ts`
- Create: `server/__tests__/broadcast/vibe-arcs.test.ts`

- [ ] **Step 2.1: Write the failing shape test**

Create `server/__tests__/broadcast/vibe-arcs.test.ts`:

```ts
import { VIBE_ARCS } from '@/services/broadcast/vibe-arcs';
import type { Vibe } from '@/services/broadcast/types';

const ALL_VIBES: Vibe[] = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
];

describe('VIBE_ARCS', () => {
  it.each(ALL_VIBES)('has a complete arc for %s', (vibe) => {
    const arc = VIBE_ARCS[vibe];
    expect(arc).toBeDefined();
    expect(arc.vibe).toBe(vibe);
    expect(arc.descriptor.length).toBeGreaterThan(0);
    expect(arc.arc.length).toBeGreaterThan(50);
    expect(arc.preferred.length).toBeGreaterThan(0);
    expect(arc.avoid.length).toBeGreaterThan(0);
  });

  it('covers exactly the 7 vibes', () => {
    expect(Object.keys(VIBE_ARCS).sort()).toEqual([...ALL_VIBES].sort());
  });
});
```

- [ ] **Step 2.2: Run the test to confirm it fails**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest vibe-arcs
```

Expected: FAIL — cannot find module `@/services/broadcast/vibe-arcs`.

- [ ] **Step 2.3: Write `vibe-arcs.ts`**

Create `server/src/services/broadcast/vibe-arcs.ts`:

```ts
import type { Vibe } from './types';

export interface VibeArc {
  vibe: Vibe;
  /** One-line UI-facing descriptor (e.g. "hushed, warm, drifting") */
  descriptor: string;
  /** Full prose arc for the LLM prompt */
  arc: string;
  /** Preferred genres/qualities — soft signals, not filters */
  preferred: string[];
  /** Avoid list — soft signals, not filters */
  avoid: string[];
}

export const VIBE_ARCS: Record<Vibe, VibeArc> = {
  morning: {
    vibe: 'morning',
    descriptor: 'Sun\u2019s up, gentle forward motion',
    arc: 'Opens fresh and clear \u2014 a song that sounds like a window opening. Mid-tempo, major key. Picks up steadily but never sprints; the day is starting, not a workout. Peak is a gently uplifting mid-tempo anthem, never club energy. Close leaves the listener ready to move \u2014 not sleepy, not peaked-out.',
    preferred: ['folk-pop', 'sunny indie', 'alt-pop', 'soul-adjacent pop', 'warm acoustic'],
    avoid: ['heavy bass', 'trap', '2am vibes'],
  },
  focus: {
    vibe: 'focus',
    descriptor: 'Head-down, unobtrusive momentum',
    arc: 'Opens textural and undemanding \u2014 instrumental or near-instrumental track 1, no vocal hooks that pull you out of what you\u2019re doing. Body stays in lane; variation comes from timbral shifts, not dynamic swings. No traditional peak \u2014 a mid-session plateau at best. Close suggests a natural stopping point.',
    preferred: ['ambient', 'lo-fi', 'post-rock instrumental', 'instrumental hip-hop', 'minimal techno', 'neoclassical piano'],
    avoid: ['lyric-heavy storytelling', 'loud dynamic shifts', 'aggressive genres'],
  },
  workout: {
    vibe: 'workout',
    descriptor: 'Sustained drive',
    arc: 'Arrives running \u2014 immediate energy, clear pulse, 120+ BPM, no easing in. Body holds the plateau; every track keeps the pulse up, no mid-session breathers. Peak is the hardest-hitting cut in the pool, late-middle. Descent is minimal until the last track, which comes down but keeps momentum \u2014 a finish line, not a collapse.',
    preferred: ['hip-hop', 'hard dance', 'EDM', 'rock', 'high-energy pop', 'drum & bass'],
    avoid: ['acoustic ballads', 'downtempo', 'sub-100 BPM except the final track'],
  },
  feelGood: {
    vibe: 'feelGood',
    descriptor: 'Warm, uplifting, communal',
    arc: 'Opens instantly warm \u2014 a groove you can nod to from the first bar. Major key, hook-forward. Body builds generosity, each track slightly more engaging than the last. Peak is the track in the pool that makes people sing along \u2014 big hook, obvious joy. Descent stays warm. Close leaves a smile.',
    preferred: ['classic soul', 'Motown', 'funk', 'reggae', 'upbeat Afrobeats', 'sunshine pop', 'R&B grooves'],
    avoid: ['melancholy', 'moody', 'ironic detachment', 'trap'],
  },
  lateNight: {
    vibe: 'lateNight',
    descriptor: 'Hushed, warm, drifting',
    arc: 'Opens low-lit \u2014 slow-burn vocal or spare R&B, 75-90 BPM, feels like a single lamp on. Tracks 2-3 add texture in the same register \u2014 warmth builds, volume doesn\u2019t. Peak is a groove, never a banger \u2014 deep and restrained, 2am college radio. Descent comes way down. Close is hushed: solo piano, acoustic, or a vocal with space around it.',
    preferred: ['neo-soul', 'downtempo', 'smooth R&B', 'vocal jazz', 'quiet storm', 'ambient vocals'],
    avoid: ['four-on-the-floor', 'shouting', 'club energy'],
  },
  melancholy: {
    vibe: 'melancholy',
    descriptor: 'Reflective, sad in a good way',
    arc: 'Opens slow without wallowing \u2014 piano, strings, or spare vocal that sits with the listener. Body deepens the feeling without rushing. Peak is emotional, not energetic \u2014 the track that hits hardest, usually minor key or unresolved. Descent stays in register \u2014 no forced upswing. Close leaves the listener held, not dropped. Quiet resolve.',
    preferred: ['indie folk', 'singer-songwriter', 'chamber pop', 'slowcore', 'sad R&B', 'ambient with vocal texture'],
    avoid: ['uplifting resolutions', 'pop-positive choruses', 'energetic tempos'],
  },
  party: {
    vibe: 'party',
    descriptor: 'Saturday night, builds and releases',
    arc: 'Arrives confident but not peaked \u2014 a groove that pulls people into the room, 100-115 BPM. Body climbs steadily, each track slightly harder than the last. Peak is mid-to-late \u2014 the biggest track in the pool, most-played, most-danceable. Brief descent drops to released communal energy \u2014 everyone-singing-along. Close leaves the room elevated, not exhausted.',
    preferred: ['hip-hop', 'dance-pop', 'Afrobeats', 'house', 'funk', 'disco revivals'],
    avoid: ['slow ballads', 'introspective cuts', 'anything that kills momentum'],
  },
};
```

- [ ] **Step 2.4: Run the test to confirm it passes**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest vibe-arcs
```

Expected: PASS, all 8 assertions.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add server/src/services/broadcast/vibe-arcs.ts server/__tests__/broadcast/vibe-arcs.test.ts && git commit -m "feat: add VIBE_ARCS editorial reference for 7 vibes"
```

---

## Task 3: Create `sequence-repair.ts` pure repair module

**Goal:** Pure functions that take an LLM-produced ordered track list and repair mechanical violations: same-artist adjacency, same-album adjacency, and duplicate IDs. No I/O, no LLM, no caching.

**Files:**
- Create: `server/src/services/broadcast/sequence-repair.ts`
- Create: `server/__tests__/broadcast/sequence-repair.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `server/__tests__/broadcast/sequence-repair.test.ts`:

```ts
import { repairSequence, removeDuplicates } from '@/services/broadcast/sequence-repair';
import type { ManifestTrack } from '@/services/broadcast/types';

const track = (
  id: string, artist: string, album = `${artist}-album-${id}`
): ManifestTrack => ({
  id, title: `${id}-title`, artistName: artist, albumTitle: album, duration: 200,
});

describe('removeDuplicates', () => {
  it('keeps a unique list as-is', () => {
    const pool = [track('a', 'A'), track('b', 'B'), track('c', 'C')];
    expect(removeDuplicates(pool, pool).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a duplicate with the next unused track from the pool', () => {
    const pool = [track('a', 'A'), track('b', 'B'), track('c', 'C'), track('d', 'D')];
    const ordered = [pool[0], pool[1], pool[1]]; // b duplicated
    const result = removeDuplicates(ordered, pool);
    expect(result.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('accepts duplicates when pool is exhausted', () => {
    const pool = [track('a', 'A'), track('b', 'B')];
    const ordered = [pool[0], pool[0], pool[1]]; // a duplicated, pool has no c
    const result = removeDuplicates(ordered, pool);
    expect(result).toHaveLength(3);
    // Preserves the first unique sighting + b; accepts the duplicate
  });
});

describe('repairSequence', () => {
  it('leaves a clean sequence untouched', () => {
    const pool = [track('a', 'A'), track('b', 'B'), track('c', 'C')];
    const result = repairSequence({ ordered: pool, pool });
    expect(result.ordered.map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(result.repairCount).toBe(0);
  });

  it('swaps to resolve same-artist adjacency', () => {
    const pool = [
      track('a', 'X'), track('b', 'X'), track('c', 'Y'), track('d', 'Z'),
    ];
    // a and b are both artist X, back-to-back
    const ordered = [pool[0], pool[1], pool[2], pool[3]];
    const result = repairSequence({ ordered, pool });
    const artists = result.ordered.map(t => t.artistName);
    expect(artists[0]).not.toBe(artists[1]);
    expect(result.repairCount).toBeGreaterThan(0);
  });

  it('swaps to resolve same-album adjacency', () => {
    const pool = [
      track('a', 'X', 'Album1'), track('b', 'Y', 'Album1'),
      track('c', 'Z', 'Album2'), track('d', 'W', 'Album3'),
    ];
    const ordered = [pool[0], pool[1], pool[2], pool[3]];
    const result = repairSequence({ ordered, pool });
    const albums = result.ordered.map(t => t.albumTitle);
    expect(albums[0]).not.toBe(albums[1]);
    expect(result.repairCount).toBeGreaterThan(0);
  });

  it('caps at 5 passes and accepts unrepairable input', () => {
    // Every track is artist X — no valid ordering exists.
    const pool = Array.from({ length: 4 }, (_, i) => track(`t${i}`, 'X'));
    const result = repairSequence({ ordered: pool, pool });
    expect(result.ordered).toHaveLength(4);
    expect(result.passes).toBeLessThanOrEqual(5);
  });

  it('does not introduce new violations', () => {
    const pool = [
      track('a', 'X'), track('b', 'X'), track('c', 'Y'), track('d', 'Y'), track('e', 'Z'),
    ];
    const ordered = [pool[0], pool[1], pool[2], pool[3], pool[4]];
    const result = repairSequence({ ordered, pool });
    const ids = result.ordered.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length); // still unique
  });
});
```

- [ ] **Step 3.2: Run to confirm failure**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest sequence-repair
```

Expected: FAIL, cannot find `@/services/broadcast/sequence-repair`.

- [ ] **Step 3.3: Implement `sequence-repair.ts`**

Create `server/src/services/broadcast/sequence-repair.ts`:

```ts
import type { ManifestTrack } from './types';

const MAX_PASSES = 5;

export interface RepairInput {
  ordered: ManifestTrack[];
  pool: ManifestTrack[];
}

export interface RepairResult {
  ordered: ManifestTrack[];
  repairCount: number;
  passes: number;
}

/**
 * Replace duplicate track IDs with unused tracks from the pool.
 * Walks the ordered list; on first duplicate sighting, picks the next
 * pool track not already present. If pool is exhausted, accepts the dup.
 */
export function removeDuplicates(
  ordered: ManifestTrack[],
  pool: ManifestTrack[],
): ManifestTrack[] {
  const seen = new Set<string>();
  const result: ManifestTrack[] = [];
  const used = new Set<string>();
  for (const t of ordered) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      used.add(t.id);
      result.push(t);
      continue;
    }
    const replacement = pool.find(p => !used.has(p.id));
    if (replacement) {
      used.add(replacement.id);
      seen.add(replacement.id);
      result.push(replacement);
    } else {
      result.push(t); // accept duplicate; pool exhausted
    }
  }
  return result;
}

function firstViolationIndex(ordered: ManifestTrack[]): number {
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].artistName === ordered[i - 1].artistName) return i;
    if (ordered[i].albumTitle === ordered[i - 1].albumTitle) return i;
  }
  return -1;
}

function tryResolveAt(
  ordered: ManifestTrack[],
  idx: number,
): ManifestTrack[] | null {
  // Look forward for a track that, if swapped in at idx, removes the violation
  const moving = ordered[idx];
  for (let j = idx + 1; j < ordered.length; j++) {
    const a = ordered[j];
    const prev = ordered[idx - 1];
    // After swap, ordered[idx+1] is `moving` when j === idx+1 (adjacent swap),
    // otherwise the original ordered[idx+1] is unchanged by the swap.
    const nextAfter = j === idx + 1 ? moving : ordered[idx + 1];
    const viol1 = a.artistName === prev.artistName || a.albumTitle === prev.albumTitle;
    const viol2 = nextAfter
      ? a.artistName === nextAfter.artistName || a.albumTitle === nextAfter.albumTitle
      : false;
    if (viol1 || viol2) continue;
    // Check that moving ordered[idx] into j's position doesn't create violation there
    const jPrev = j - 1 === idx ? a : ordered[j - 1]; // after swap, j-1 is a when adjacent
    const jNext = ordered[j + 1];
    const violAtJ1 = moving.artistName === jPrev.artistName || moving.albumTitle === jPrev.albumTitle;
    const violAtJ2 = jNext
      ? moving.artistName === jNext.artistName || moving.albumTitle === jNext.albumTitle
      : false;
    if (violAtJ1 || violAtJ2) continue;
    const next_ = [...ordered];
    [next_[idx], next_[j]] = [next_[j], next_[idx]];
    return next_;
  }
  return null;
}

/**
 * Iteratively repairs same-artist and same-album adjacency violations by
 * swapping positions. Up to MAX_PASSES iterations. Accepts whatever's left
 * if unrepairable (does not throw).
 */
export function repairSequence(input: RepairInput): RepairResult {
  let current = [...input.ordered];
  let repairCount = 0;
  let passes = 0;
  for (; passes < MAX_PASSES; passes++) {
    const idx = firstViolationIndex(current);
    if (idx === -1) break;
    const next = tryResolveAt(current, idx);
    if (!next) break; // unresolvable — accept and exit
    current = next;
    repairCount++;
  }
  return { ordered: current, repairCount, passes };
}
```

- [ ] **Step 3.4: Run to confirm pass**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest sequence-repair
```

Expected: PASS, all 7 tests.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add server/src/services/broadcast/sequence-repair.ts server/__tests__/broadcast/sequence-repair.test.ts && git commit -m "feat: add sequence-repair module for adjacency + duplicate cleanup"
```

---

## Task 4: Create `SequenceCache` in-memory LRU

**Goal:** 24h TTL, max 500 entries, keyed on `{sha256(sorted trackIds)}|{vibe}|{length}`. Same-day re-bakes return the cached order instantly.

**Files:**
- Create: `server/src/services/broadcast/SequenceCache.ts`
- Create: `server/__tests__/broadcast/SequenceCache.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `server/__tests__/broadcast/SequenceCache.test.ts`:

```ts
import { SequenceCache } from '@/services/broadcast/SequenceCache';

describe('SequenceCache', () => {
  let cache: SequenceCache;
  beforeEach(() => {
    cache = new SequenceCache();
  });

  it('returns null on miss', () => {
    expect(cache.get(['a', 'b', 'c'], 'morning', 'quick')).toBeNull();
  });

  it('returns the cached order on hit', () => {
    cache.set(['a', 'b', 'c'], 'morning', 'quick', ['b', 'a', 'c']);
    expect(cache.get(['a', 'b', 'c'], 'morning', 'quick')).toEqual(['b', 'a', 'c']);
  });

  it('key is stable under trackId reorder', () => {
    cache.set(['a', 'b', 'c'], 'morning', 'quick', ['b', 'a', 'c']);
    expect(cache.get(['c', 'a', 'b'], 'morning', 'quick')).toEqual(['b', 'a', 'c']);
  });

  it('key distinguishes vibe', () => {
    cache.set(['a', 'b'], 'morning', 'quick', ['a', 'b']);
    expect(cache.get(['a', 'b'], 'lateNight', 'quick')).toBeNull();
  });

  it('key distinguishes length', () => {
    cache.set(['a', 'b'], 'morning', 'quick', ['a', 'b']);
    expect(cache.get(['a', 'b'], 'morning', 'standard')).toBeNull();
  });

  it('expires entries after 24h', () => {
    jest.useFakeTimers();
    cache.set(['a', 'b'], 'morning', 'quick', ['a', 'b']);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(cache.get(['a', 'b'], 'morning', 'quick')).toBeNull();
    jest.useRealTimers();
  });

  it('evicts oldest entry when at capacity', () => {
    const c = new SequenceCache({ maxEntries: 2 });
    c.set(['a'], 'morning', 'quick', ['a']);
    c.set(['b'], 'morning', 'quick', ['b']);
    c.set(['c'], 'morning', 'quick', ['c']); // evicts a
    expect(c.get(['a'], 'morning', 'quick')).toBeNull();
    expect(c.get(['b'], 'morning', 'quick')).toEqual(['b']);
    expect(c.get(['c'], 'morning', 'quick')).toEqual(['c']);
  });
});
```

- [ ] **Step 4.2: Run to confirm failure**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest SequenceCache
```

Expected: FAIL, cannot find module.

- [ ] **Step 4.3: Implement `SequenceCache.ts`**

Create `server/src/services/broadcast/SequenceCache.ts`:

```ts
import { createHash } from 'crypto';
import type { Vibe, BroadcastLength } from './types';

interface CacheEntry {
  ordered: string[];
  expiresAt: number;
}

interface Options {
  ttlMs?: number;
  maxEntries?: number;
}

export class SequenceCache {
  private entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts: Options = {}) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 500;
  }

  private makeKey(trackIds: string[], vibe: Vibe, length: BroadcastLength): string {
    const sorted = [...trackIds].sort().join('|');
    const hash = createHash('sha256').update(sorted).digest('hex');
    return `${hash}|${vibe}|${length}`;
  }

  get(trackIds: string[], vibe: Vibe, length: BroadcastLength): string[] | null {
    const key = this.makeKey(trackIds, vibe, length);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    // LRU: re-insert to mark recently used
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.ordered;
  }

  set(
    trackIds: string[], vibe: Vibe, length: BroadcastLength, ordered: string[],
  ): void {
    const key = this.makeKey(trackIds, vibe, length);
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, {
      ordered,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 4.4: Run to confirm pass**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest SequenceCache
```

Expected: PASS, all 7 tests.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add server/src/services/broadcast/SequenceCache.ts server/__tests__/broadcast/SequenceCache.test.ts && git commit -m "feat: add SequenceCache (in-memory LRU, 24h TTL)"
```

---

## Task 5: Create `EnrichmentCache` persistent JSON store

**Goal:** File-backed cache at `server/.enrichment-cache/tracks.json`. Atomic writes via tmp+rename, malformed-JSON tolerant, keyed on normalized `title|artist` (strips `(feat. X)` / `(Remastered YYYY)` / `- Deluxe` suffixes). Values are `EnrichmentRecord`s.

**Files:**
- Create: `server/src/services/enrichment/EnrichmentCache.ts`
- Create: `server/__tests__/enrichment/EnrichmentCache.test.ts`

- [ ] **Step 5.1: Write the failing tests**

Create `server/__tests__/enrichment/EnrichmentCache.test.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnrichmentCache, type EnrichmentRecord } from '@/services/enrichment/EnrichmentCache';

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enrich-cache-test-'));
  return dir;
}

const record: EnrichmentRecord = {
  genre: 'soul', moodTags: ['warm', 'smooth'], releaseYear: '1972',
  producer: 'Quincy Jones', lastEnrichedAt: Date.now(), source: 'hybrid',
};

describe('EnrichmentCache', () => {
  let dir: string;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns null for missing key before load', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    expect(cache.get('Song', 'Artist')).toBeNull();
  });

  it('writes and reads back a record', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song', 'Artist')).toMatchObject(record);
  });

  it('persists across reload', async () => {
    const file = path.join(dir, 'tracks.json');
    const first = new EnrichmentCache(file);
    await first.load();
    await first.set('Song', 'Artist', record);

    const second = new EnrichmentCache(file);
    await second.load();
    expect(second.get('Song', 'Artist')).toMatchObject(record);
  });

  it('normalizes keys: (feat. X) collides with base title', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song (feat. Nobody)', 'Artist')).toMatchObject(record);
  });

  it('normalizes keys: (Remastered YYYY) collides', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song (Remastered 2020)', 'Artist')).toMatchObject(record);
  });

  it('normalizes keys: - Deluxe Edition collides', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song - Deluxe Edition', 'Artist')).toMatchObject(record);
  });

  it('is case-insensitive on normalization', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('SONG', 'ARTIST')).toMatchObject(record);
  });

  it('tolerates malformed JSON — starts with empty state', async () => {
    const file = path.join(dir, 'tracks.json');
    await fs.writeFile(file, '{ not valid json', 'utf8');
    const cache = new EnrichmentCache(file);
    await cache.load();
    expect(cache.get('Song', 'Artist')).toBeNull();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song', 'Artist')).toMatchObject(record);
  });

  it('writes atomically (tmp file then rename)', async () => {
    const file = path.join(dir, 'tracks.json');
    const cache = new EnrichmentCache(file);
    await cache.load();
    await cache.set('Song', 'Artist', record);
    // No leftover .tmp file
    const files = await fs.readdir(dir);
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0);
    expect(files).toContain('tracks.json');
  });
});
```

- [ ] **Step 5.2: Run to confirm failure**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest EnrichmentCache
```

Expected: FAIL, module not found.

- [ ] **Step 5.3: Implement `EnrichmentCache.ts`**

Create `server/src/services/enrichment/EnrichmentCache.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';

export interface EnrichmentRecord {
  genre?: string;
  moodTags?: string[];
  releaseYear?: string;
  producer?: string;
  sample?: string;
  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'hybrid';
}

interface CacheFile {
  version: number;
  tracks: Record<string, EnrichmentRecord>;
}

function normalizeKey(title: string, artist: string): string {
  const clean = (s: string): string => s
    .toLowerCase()
    .replace(/\(feat\.[^)]*\)/gi, '')
    .replace(/\(remastered[^)]*\)/gi, '')
    .replace(/-\s*deluxe[^|]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${clean(title)}|${clean(artist)}`;
}

export class EnrichmentCache {
  private data: Record<string, EnrichmentRecord> = {};
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const raw = await fs.readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as CacheFile;
        this.data = parsed.tracks ?? {};
      } catch {
        this.data = {};
      }
    })();
    return this.loadPromise;
  }

  get(title: string, artist: string): EnrichmentRecord | null {
    const key = normalizeKey(title, artist);
    return this.data[key] ?? null;
  }

  async set(title: string, artist: string, record: EnrichmentRecord): Promise<void> {
    const key = normalizeKey(title, artist);
    this.data[key] = record;
    await this.flush();
  }

  private async flush(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: CacheFile = { version: 1, tracks: this.data };
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}
```

- [ ] **Step 5.4: Run to confirm pass**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest EnrichmentCache
```

Expected: PASS, all 9 tests.

- [ ] **Step 5.5: Add `.enrichment-cache/` to gitignore**

Append to `/Users/kari/Documents/cleo-app/server/.gitignore` (or root `.gitignore` if that's where server paths are):

```
.enrichment-cache/
```

Verify with:

```bash
cd /Users/kari/Documents/cleo-app && git check-ignore server/.enrichment-cache/tracks.json
```

Expected output: `server/.enrichment-cache/tracks.json`.

- [ ] **Step 5.6: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add server/src/services/enrichment/EnrichmentCache.ts server/__tests__/enrichment/EnrichmentCache.test.ts server/.gitignore && git commit -m "feat: add EnrichmentCache (persistent JSON, atomic writes, normalized keys)"
```

---

## Task 6: Create `BackgroundEnricher` + default Genius/MusicBrainz fetcher

**Goal:** Serial queue worker that enriches tracks in the background after a bake ships. Uses a new `DefaultEnrichmentFetcher` that calls Genius and MusicBrainz directly with its own 1.1s rate limiter. Skips tracks already enriched within 30 days.

**Files:**
- Create: `server/src/services/enrichment/BackgroundEnricher.ts`
- Create: `server/src/services/enrichment/DefaultEnrichmentFetcher.ts`
- Create: `server/__tests__/enrichment/BackgroundEnricher.test.ts`

- [ ] **Step 6.1: Write the failing tests for `BackgroundEnricher`**

Create `server/__tests__/enrichment/BackgroundEnricher.test.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackgroundEnricher, type EnrichmentFetcher } from '@/services/enrichment/BackgroundEnricher';
import { EnrichmentCache, type EnrichmentRecord } from '@/services/enrichment/EnrichmentCache';
import type { ManifestTrack } from '@/services/broadcast/types';

const makeTrack = (id: string): ManifestTrack => ({
  id, title: `title-${id}`, artistName: `artist-${id}`,
  albumTitle: `album-${id}`, duration: 200,
});

const geniusRecord: Partial<EnrichmentRecord> = {
  producer: 'Producer X', releaseYear: '1972',
};
const mbRecord: Partial<EnrichmentRecord> = {
  genre: 'soul', moodTags: ['warm'],
};

function makeFetcher(): jest.Mocked<EnrichmentFetcher> {
  return {
    fetchGenius: jest.fn(async () => geniusRecord),
    fetchMusicBrainz: jest.fn(async () => mbRecord),
  };
}

async function tempCache(): Promise<EnrichmentCache> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bg-enrich-'));
  const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
  await cache.load();
  return cache;
}

describe('BackgroundEnricher', () => {
  it('enriches each track and writes to cache', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a'), makeTrack('b')]);
    await enricher.drain();

    expect(fetcher.fetchGenius).toHaveBeenCalledTimes(2);
    expect(fetcher.fetchMusicBrainz).toHaveBeenCalledTimes(2);
    const recA = cache.get('title-a', 'artist-a');
    expect(recA?.producer).toBe('Producer X');
    expect(recA?.genre).toBe('soul');
    expect(recA?.source).toBe('hybrid');
  });

  it('skips tracks enriched within 30 days', async () => {
    const cache = await tempCache();
    await cache.set('title-a', 'artist-a', {
      genre: 'old', lastEnrichedAt: Date.now(), source: 'hybrid',
    });
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(fetcher.fetchGenius).not.toHaveBeenCalled();
    expect(fetcher.fetchMusicBrainz).not.toHaveBeenCalled();
  });

  it('re-enriches after 30-day threshold', async () => {
    const cache = await tempCache();
    await cache.set('title-a', 'artist-a', {
      genre: 'old',
      lastEnrichedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      source: 'hybrid',
    });
    const fetcher = makeFetcher();
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(fetcher.fetchGenius).toHaveBeenCalledTimes(1);
  });

  it('tolerates fetcher errors — other tracks still process', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    (fetcher.fetchGenius as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a'), makeTrack('b')]);
    await enricher.drain();

    // Track b still enriched despite track a's Genius failure.
    expect(cache.get('title-b', 'artist-b')).not.toBeNull();
    // Track a got partial (MB succeeded, Genius failed) OR nothing, either is acceptable.
  });

  it('tags source as genius-only when MB returns null', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    (fetcher.fetchMusicBrainz as jest.Mock).mockResolvedValueOnce(null);
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(cache.get('title-a', 'artist-a')?.source).toBe('genius');
  });

  it('tags source as musicbrainz-only when Genius returns null', async () => {
    const cache = await tempCache();
    const fetcher = makeFetcher();
    (fetcher.fetchGenius as jest.Mock).mockResolvedValueOnce(null);
    const enricher = new BackgroundEnricher(cache, fetcher);

    enricher.enqueue([makeTrack('a')]);
    await enricher.drain();

    expect(cache.get('title-a', 'artist-a')?.source).toBe('musicbrainz');
  });
});
```

- [ ] **Step 6.2: Run to confirm failure**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest BackgroundEnricher
```

Expected: FAIL, module not found.

- [ ] **Step 6.3: Implement `BackgroundEnricher.ts`**

Create `server/src/services/enrichment/BackgroundEnricher.ts`:

```ts
import type { EnrichmentCache, EnrichmentRecord } from './EnrichmentCache';
import type { ManifestTrack } from '../broadcast/types';

const REFRESH_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export interface EnrichmentFetcher {
  fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
}

/**
 * Serial background queue. enqueue() pushes tracks; drain() awaits the
 * current tail. Errors per track are swallowed so one failure does not
 * block the rest of the queue.
 */
export class BackgroundEnricher {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly cache: EnrichmentCache,
    private readonly fetcher: EnrichmentFetcher,
  ) {}

  enqueue(tracks: ManifestTrack[]): void {
    for (const track of tracks) {
      this.queue = this.queue.then(() =>
        this.enrichOne(track).catch(() => {}),
      );
    }
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  private async enrichOne(track: ManifestTrack): Promise<void> {
    const existing = this.cache.get(track.title, track.artistName);
    if (existing && Date.now() - existing.lastEnrichedAt < REFRESH_THRESHOLD_MS) {
      return;
    }
    const [genius, mb] = await Promise.all([
      this.fetcher.fetchGenius(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchMusicBrainz(track.title, track.artistName).catch(() => null),
    ]);
    if (!genius && !mb) return;
    const source: EnrichmentRecord['source'] =
      genius && mb ? 'hybrid' : genius ? 'genius' : 'musicbrainz';
    const record: EnrichmentRecord = {
      ...(mb ?? {}),
      ...(genius ?? {}),
      lastEnrichedAt: Date.now(),
      source,
    };
    await this.cache.set(track.title, track.artistName, record);
  }
}
```

- [ ] **Step 6.4: Run to confirm pass**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest BackgroundEnricher
```

Expected: PASS, all 6 tests.

- [ ] **Step 6.5: Implement `DefaultEnrichmentFetcher.ts`**

Create `server/src/services/enrichment/DefaultEnrichmentFetcher.ts`:

```ts
import type { EnrichmentFetcher } from './BackgroundEnricher';
import type { EnrichmentRecord } from './EnrichmentCache';

const GENIUS_MIN_INTERVAL_MS = 1100;
const MB_MIN_INTERVAL_MS = 1100;

/** Shared promise-chain serializer with minimum interval per call. */
class RateLimitedFetcher {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await new Promise(r => setTimeout(r, this.minIntervalMs));
      return fn();
    });
    this.queue = result.catch(() => {});
    return result as Promise<T>;
  }
}

const MOOD_WORDS = new Set([
  'chill', 'mellow', 'upbeat', 'melancholy', 'moody', 'energetic',
  'warm', 'bright', 'dark', 'romantic', 'aggressive', 'smooth',
  'dreamy', 'intimate', 'reflective', 'hopeful', 'sad', 'happy',
]);

export class DefaultEnrichmentFetcher implements EnrichmentFetcher {
  private geniusQueue = new RateLimitedFetcher(GENIUS_MIN_INTERVAL_MS);
  private mbQueue = new RateLimitedFetcher(MB_MIN_INTERVAL_MS);

  async fetchGenius(
    title: string, artist: string,
  ): Promise<Partial<EnrichmentRecord> | null> {
    const token = process.env.GENIUS_ACCESS_TOKEN;
    if (!token) return null;
    return this.geniusQueue.schedule(async () => {
      const query = encodeURIComponent(`${title} ${artist}`);
      const searchRes = await fetch(
        `https://api.genius.com/search?q=${query}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json() as {
        response?: { hits?: Array<{ result: { id: number } }> };
      };
      const topId = searchData.response?.hits?.[0]?.result?.id;
      if (!topId) return null;
      const detailRes = await fetch(
        `https://api.genius.com/songs/${topId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!detailRes.ok) return null;
      const detail = await detailRes.json() as {
        response?: { song?: {
          producer_artists?: Array<{ name: string }>;
          release_date_for_display?: string;
          song_relationships?: Array<{
            relationship_type: string;
            songs?: Array<{ title: string; primary_artist?: { name: string } }>;
          }>;
        } };
      };
      const song = detail.response?.song;
      if (!song) return null;
      const out: Partial<EnrichmentRecord> = {};
      if (song.producer_artists?.length) {
        out.producer = song.producer_artists.map(p => p.name).join(', ');
      }
      if (song.release_date_for_display) {
        out.releaseYear = song.release_date_for_display;
      }
      const samples = song.song_relationships?.find(r => r.relationship_type === 'samples');
      const sampled = samples?.songs?.[0];
      if (sampled) {
        out.sample = `Samples "${sampled.title}" by ${sampled.primary_artist?.name ?? 'unknown'}`;
      }
      return Object.keys(out).length > 0 ? out : null;
    });
  }

  async fetchMusicBrainz(
    title: string, artist: string,
  ): Promise<Partial<EnrichmentRecord> | null> {
    return this.mbQueue.schedule(async () => {
      const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
      const res = await fetch(
        `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=1&fmt=json`,
        {
          headers: {
            'User-Agent': 'CleoRadioApp/1.0 (bworthy89@gmail.com)',
            Accept: 'application/json',
          },
        },
      );
      if (!res.ok) return null;
      const data = await res.json() as {
        recordings?: Array<{
          tags?: Array<{ name: string; count?: number }>;
          'first-release-date'?: string;
        }>;
      };
      const rec = data.recordings?.[0];
      if (!rec) return null;
      const sortedTags = (rec.tags ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .map(t => t.name);
      const moodTags = sortedTags.filter(t => MOOD_WORDS.has(t.toLowerCase()));
      const out: Partial<EnrichmentRecord> = {};
      if (sortedTags.length) out.genre = sortedTags[0];
      if (moodTags.length) out.moodTags = moodTags.slice(0, 5);
      if (rec['first-release-date']) {
        out.releaseYear = rec['first-release-date'].substring(0, 4);
      }
      return Object.keys(out).length > 0 ? out : null;
    });
  }
}
```

- [ ] **Step 6.6: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add server/src/services/enrichment/BackgroundEnricher.ts server/src/services/enrichment/DefaultEnrichmentFetcher.ts server/__tests__/enrichment/BackgroundEnricher.test.ts && git commit -m "feat: add BackgroundEnricher + DefaultEnrichmentFetcher"
```

---

## Task 7: Create `TrackSequencer`

**Goal:** Pure class that takes pool + vibe + length + context → ordered subset of tracks. Reads sequence cache, calls LLM on miss, validates structure, invokes repair, writes cache. One retry on failure, silent fallback to deterministic slice.

**Files:**
- Create: `server/src/services/broadcast/TrackSequencer.ts`
- Create: `server/__tests__/broadcast/TrackSequencer.test.ts`

- [ ] **Step 7.1: Write the failing tests**

Create `server/__tests__/broadcast/TrackSequencer.test.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TrackSequencer } from '@/services/broadcast/TrackSequencer';
import { SequenceCache } from '@/services/broadcast/SequenceCache';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import type { ManifestTrack } from '@/services/broadcast/types';
import type { LLMCaller } from '@/services/broadcast/SegmentGenerator';

const track = (id: string, artist = `A-${id}`): ManifestTrack => ({
  id, title: `t-${id}`, artistName: artist, albumTitle: `al-${id}`, duration: 200,
});

function mockLLM(responses: string[]): jest.Mocked<LLMCaller> {
  let i = 0;
  return {
    generate: jest.fn(async () => ({ text: responses[Math.min(i++, responses.length - 1)] })),
  };
}

async function emptyEnrichmentCache(): Promise<EnrichmentCache> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seq-test-'));
  const c = new EnrichmentCache(path.join(dir, 'tracks.json'));
  await c.load();
  return c;
}

describe('TrackSequencer.sequence', () => {
  const pool = Array.from({ length: 10 }, (_, i) => track(String(i), `Artist${i}`));
  const ctx = { timeOfDay: '20:00', dayOfWeek: 'Thursday' };

  it('returns cached order on cache hit', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new TrackSequencer(llm, cache, enrich);

    const first = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });
    expect(first.source).toBe('llm');

    const second = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });
    expect(second.source).toBe('cache');
    expect(second.orderedTracks.map(t => t.id)).toEqual(first.orderedTracks.map(t => t.id));
    expect(llm.generate).toHaveBeenCalledTimes(1); // cache hit avoided LLM
  });

  it('calls LLM on cache miss and returns ordered tracks', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["2","4","0","6","8"]}']);
    const seq = new TrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });
    expect(result.source).toBe('llm');
    expect(result.orderedTracks.map(t => t.id)).toEqual(['2', '4', '0', '6', '8']);
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('retries once on invalid JSON, then falls back', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['not json', 'also not json']);
    const seq = new TrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });
    expect(result.source).toBe('fallback');
    expect(result.orderedTracks).toHaveLength(5);
    expect(llm.generate).toHaveBeenCalledTimes(2);
  });

  it('retries once on hallucinated IDs', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      '{"ordered":["99","88","77","66","55"]}', // all hallucinated
      '{"ordered":["0","1","2","3","4"]}',       // valid on retry
    ]);
    const seq = new TrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });
    expect(result.source).toBe('llm');
    expect(result.orderedTracks.map(t => t.id)).toEqual(['0', '1', '2', '3', '4']);
    expect(llm.generate).toHaveBeenCalledTimes(2);
  });

  it('retries on wrong-length output', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      '{"ordered":["0","1","2"]}',              // too short
      '{"ordered":["0","1","2","3","4"]}',       // correct length
    ]);
    const seq = new TrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });
    expect(result.source).toBe('llm');
    expect(result.orderedTracks).toHaveLength(5);
    expect(llm.generate).toHaveBeenCalledTimes(2);
  });

  it('caps pool at 40 tracks when input is larger', async () => {
    const largePool = Array.from({ length: 100 }, (_, i) => track(String(i), `Artist${i}`));
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new TrackSequencer(llm, cache, enrich);

    await seq.sequence({
      pool: largePool, vibe: 'morning', length: 'quick', userContext: ctx,
    });

    const userPrompt = (llm.generate as jest.Mock).mock.calls[0][0].userPrompt as string;
    // Track 50 should not appear (beyond cap), track 0 should
    expect(userPrompt).toContain('t-0');
    expect(userPrompt).not.toContain('t-50');
  });

  it('throws fast when pool < N', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":[]}']);
    const seq = new TrackSequencer(llm, cache, enrich);

    await expect(seq.sequence({
      pool: pool.slice(0, 3), vibe: 'morning', length: 'quick', userContext: ctx,
    })).rejects.toThrow(/insufficient tracks/);
  });

  it('includes arc prose, preferred, avoid, and soft-signal framing in prompt', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new TrackSequencer(llm, cache, enrich);

    await seq.sequence({
      pool, vibe: 'lateNight', length: 'quick', userContext: ctx,
    });

    const call = (llm.generate as jest.Mock).mock.calls[0][0];
    expect(call.systemPrompt).toContain('Preferred and avoid');
    expect(call.systemPrompt).toContain('aesthetic hints');
    expect(call.systemPrompt).toContain('Never refuse');
    expect(call.userPrompt).toContain('lateNight');
    expect(call.userPrompt).toContain('neo-soul');
    expect(call.userPrompt).toContain('four-on-the-floor');
  });

  it('runs repair after LLM (duplicate removed)', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    // LLM duplicates track "0"
    const llm = mockLLM(['{"ordered":["0","0","1","2","3"]}']);
    const seq = new TrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });
    expect(result.source).toBe('llm');
    const ids = result.orderedTracks.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it('passes enrichment to the LLM when cache has records', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    await enrich.set('t-0', 'Artist0', {
      genre: 'soul', producer: 'Stevie Wonder',
      lastEnrichedAt: Date.now(), source: 'hybrid',
    });
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new TrackSequencer(llm, cache, enrich);

    await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
    });

    const call = (llm.generate as jest.Mock).mock.calls[0][0];
    expect(call.userPrompt).toContain('Stevie Wonder');
    expect(call.userPrompt).toContain('soul');
  });
});
```

- [ ] **Step 7.2: Run to confirm failure**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest TrackSequencer
```

Expected: FAIL, module not found.

- [ ] **Step 7.3: Implement `TrackSequencer.ts`**

Create `server/src/services/broadcast/TrackSequencer.ts`:

```ts
import type { Vibe, BroadcastLength, ManifestTrack } from './types';
import type { LLMCaller } from './SegmentGenerator';
import { VIBE_ARCS } from './vibe-arcs';
import { SequenceCache } from './SequenceCache';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import { repairSequence, removeDuplicates } from './sequence-repair';

const POOL_CAP = 40;
const MAX_LLM_ATTEMPTS = 2;

const LENGTH_TO_N: Record<BroadcastLength, number> = {
  quick: 5, standard: 9, long: 15,
};

export interface SequenceRequest {
  pool: ManifestTrack[];
  vibe: Vibe;
  length: BroadcastLength;
  userContext: { timeOfDay: string; dayOfWeek: string };
}

export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  source: 'cache' | 'llm' | 'fallback';
}

const SYSTEM_PROMPT = `You are a radio programmer arranging a broadcast. You receive a pool of tracks and a target arc. Return a JSON array of N track IDs in the order they should play, chosen to best fit the arc using the pool provided.

Preferred and avoid lists are aesthetic hints, not rules. If the pool has few tracks matching preferred, adapt \u2014 find tracks closest to the arc's feel. Never refuse. Your job is to make the best broadcast possible from THESE tracks, whatever they are.

Hard constraints:
- Output is valid JSON, exactly { "ordered": ["trackId", ...] }
- Every ID must exist in the pool (no hallucination)
- Length is exactly N
- No track appears twice
- Return ONLY the JSON object, no prose before or after`;

export class TrackSequencer {
  constructor(
    private readonly llm: LLMCaller,
    private readonly cache: SequenceCache,
    private readonly enrichmentCache: EnrichmentCache,
  ) {}

  async sequence(req: SequenceRequest): Promise<SequenceResult> {
    const N = LENGTH_TO_N[req.length];
    if (req.pool.length < N) {
      throw new Error(`insufficient tracks: need ${N}, got ${req.pool.length}`);
    }
    const cappedPool = req.pool.slice(0, POOL_CAP);
    const trackIds = cappedPool.map(t => t.id);

    const cachedIds = this.cache.get(trackIds, req.vibe, req.length);
    if (cachedIds) {
      const byId = new Map(cappedPool.map(t => [t.id, t]));
      const ordered = cachedIds
        .map(id => byId.get(id))
        .filter((t): t is ManifestTrack => t !== undefined);
      if (ordered.length === N) {
        return { orderedTracks: ordered, source: 'cache' };
      }
    }

    for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
      try {
        const ordered = await this.attemptSequence(cappedPool, req, N);
        this.cache.set(trackIds, req.vibe, req.length, ordered.map(t => t.id));
        return { orderedTracks: ordered, source: 'llm' };
      } catch {
        // retry or fall through
      }
    }

    return { orderedTracks: cappedPool.slice(0, N), source: 'fallback' };
  }

  private async attemptSequence(
    pool: ManifestTrack[], req: SequenceRequest, N: number,
  ): Promise<ManifestTrack[]> {
    const { systemPrompt, userPrompt } = this.buildPrompt(pool, req, N);
    const response = await this.llm.generate({
      systemPrompt, userPrompt, maxTokens: 2048, temperature: 0.6,
    });
    const parsed = this.parseOrdered(response.text);
    if (parsed.length !== N) {
      throw new Error(`wrong length: got ${parsed.length}, expected ${N}`);
    }
    const byId = new Map(pool.map(t => [t.id, t]));
    const hydrated = parsed.map(id => {
      const t = byId.get(id);
      if (!t) throw new Error(`hallucinated id: ${id}`);
      return t;
    });
    const deduped = removeDuplicates(hydrated, pool);
    const repaired = repairSequence({ ordered: deduped, pool });
    return repaired.ordered.slice(0, N);
  }

  private parseOrdered(raw: string): string[] {
    // LLMs sometimes wrap JSON in ```json ... ``` or add preamble. Extract.
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('no JSON object found');
    }
    const jsonStr = raw.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonStr) as { ordered?: unknown };
    if (!Array.isArray(parsed.ordered)) {
      throw new Error('ordered is not an array');
    }
    if (!parsed.ordered.every((x): x is string => typeof x === 'string')) {
      throw new Error('ordered contains non-string');
    }
    return parsed.ordered;
  }

  private buildPrompt(
    pool: ManifestTrack[], req: SequenceRequest, N: number,
  ): { systemPrompt: string; userPrompt: string } {
    const arc = VIBE_ARCS[req.vibe];
    const enrichedPool = pool.map(t => {
      const enrichment = this.enrichmentCache.get(t.title, t.artistName);
      const enrichmentStr = enrichment
        ? ` [${[
            enrichment.genre,
            enrichment.releaseYear,
            enrichment.producer ? `prod: ${enrichment.producer}` : null,
            enrichment.moodTags?.length ? `mood: ${enrichment.moodTags.join(',')}` : null,
          ].filter(Boolean).join(' | ')}]`
        : '';
      return `  { "id": "${t.id}", "title": ${JSON.stringify(t.title)}, "artist": ${JSON.stringify(t.artistName)}${enrichmentStr ? `,${enrichmentStr}` : ''} }`;
    }).join(',\n');

    const userPrompt = [
      `Vibe: ${req.vibe}`,
      `Arc: ${arc.arc}`,
      `Preferred: ${arc.preferred.join(', ')}`,
      `Avoid: ${arc.avoid.join(', ')}`,
      `Session length: ${N} tracks`,
      `Time: ${req.userContext.timeOfDay} on ${req.userContext.dayOfWeek}`,
      '',
      `Pool (${pool.length} tracks):`,
      '[',
      enrichedPool,
      ']',
      '',
      `Return exactly ${N} track IDs in play order as { "ordered": [...] }. JSON only.`,
    ].join('\n');

    return { systemPrompt: SYSTEM_PROMPT, userPrompt };
  }
}
```

- [ ] **Step 7.4: Run to confirm pass**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest TrackSequencer
```

Expected: PASS, all 10 tests.

- [ ] **Step 7.5: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add server/src/services/broadcast/TrackSequencer.ts server/__tests__/broadcast/TrackSequencer.test.ts && git commit -m "feat: add TrackSequencer with cache + repair + fallback"
```

---

## Task 8: Integrate `TrackSequencer` into `BroadcastOrchestrator`, simplify `ManifestBuilder`

**Goal:** `BroadcastOrchestrator.create()` calls sequencer before `ManifestBuilder`, passes the sequenced tracks forward. `ManifestBuilder.buildManifest` no longer slices — expects an already-sized track list. Background enrichment fires after the sync response.

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Modify: `server/src/services/broadcast/ManifestBuilder.ts`
- Modify: `server/src/index.ts` (wire up the new instances)
- Modify: `server/__tests__/broadcast/BroadcastOrchestrator.test.ts` (DI changes)
- Modify: `server/__tests__/broadcast/ManifestBuilder.test.ts` (new semantics)

- [ ] **Step 8.1: Update `ManifestBuilder.buildManifest` to expect pre-sized tracks**

Replace `server/src/services/broadcast/ManifestBuilder.ts` in full:

```ts
import { randomUUID } from 'crypto';
import type {
  Manifest, ManifestTrack, SegmentSlot, Vibe, BroadcastLength,
} from './types';

export function buildManifest(input: {
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  tracks: ManifestTrack[];
}): Manifest {
  if (input.tracks.length === 0) {
    throw new Error('buildManifest requires at least one track');
  }

  const tracks = input.tracks;
  const segmentSlots: SegmentSlot[] = [];

  segmentSlots.push({
    index: 0,
    kind: 'cold_open',
    beforeTrackId: tracks[0].id,
    afterTrackId: undefined,
    variantCount: 1,
    status: 'pending',
  });

  for (let i = 0; i < tracks.length - 1; i++) {
    segmentSlots.push({
      index: segmentSlots.length,
      kind: 'transition',
      afterTrackId: tracks[i].id,
      beforeTrackId: tracks[i + 1].id,
      variantCount: 1,
      status: 'pending',
    });
  }

  segmentSlots.push({
    index: segmentSlots.length,
    kind: 'sign_off',
    afterTrackId: tracks[tracks.length - 1].id,
    beforeTrackId: undefined,
    variantCount: 1,
    status: 'pending',
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
  };
}
```

- [ ] **Step 8.2: Update `ManifestBuilder` tests — now receives pre-sized tracks**

Rewrite `server/__tests__/broadcast/ManifestBuilder.test.ts`:

```ts
import { buildManifest } from '@/services/broadcast/ManifestBuilder';
import type { ManifestTrack } from '@/services/broadcast/types';

const t = (id: string): ManifestTrack => ({
  id, title: `Title ${id}`, artistName: `Artist ${id}`,
  albumTitle: `Album ${id}`, duration: 210,
});

describe('buildManifest', () => {
  it('produces N+1 slots for N tracks', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    // cold_open + 4 transitions + sign_off = 6
    expect(m.segmentSlots).toHaveLength(6);
    expect(m.tracks).toHaveLength(5);
  });

  it('preserves input track order', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.tracks.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('cold_open references first track', () => {
    const tracks = [t('a'), t('b')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[0].beforeTrackId).toBe('a');
  });

  it('sign_off references last track', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    const last = m.segmentSlots[m.segmentSlots.length - 1];
    expect(last.kind).toBe('sign_off');
    expect(last.afterTrackId).toBe('c');
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
```

- [ ] **Step 8.3: Update `BroadcastOrchestrator` to inject and call sequencer + enricher**

Replace `server/src/services/broadcast/BroadcastOrchestrator.ts` in full:

```ts
import type { ObjectStorage } from '../storage/ObjectStorage';
import { buildManifest } from './ManifestBuilder';
import { buildSegmentPrompts, type SegmentContext } from './SegmentScriptBuilder';
import { SegmentGenerator, type LLMCaller, type TTSCaller } from './SegmentGenerator';
import type {
  BroadcastCreateRequest, BroadcastCreateResponse, Manifest,
} from './types';
import { BroadcastStore } from './BroadcastStore';
import { TrackSequencer } from './TrackSequencer';
import { SequenceCache } from './SequenceCache';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import type { BackgroundEnricher } from '../enrichment/BackgroundEnricher';

export class BroadcastOrchestrator {
  private readonly generator: SegmentGenerator;
  private readonly sequencer: TrackSequencer;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    sequenceCache?: SequenceCache,
  ) {
    this.generator = new SegmentGenerator(llm, tts, storage);
    this.sequencer = new TrackSequencer(
      llm, sequenceCache ?? new SequenceCache(), enrichmentCache,
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
    });

    const manifest = buildManifest({
      userId: input.userId,
      playlistId: input.playlistId,
      vibe: input.vibe,
      length: input.length,
      tracks: seq.orderedTracks,
    });
    this.store.put(manifest);

    const firstUrls = await this.generateSlot(manifest, 0, input.userContext);

    const remaining = Promise.allSettled(
      manifest.segmentSlots.slice(1).map(slot =>
        this.generateSlot(manifest, slot.index, input.userContext),
      ),
    )
      .then(() => undefined)
      .finally(() => this.inFlight.delete(manifest.broadcastId));

    this.inFlight.set(manifest.broadcastId, remaining);

    // Fire-and-forget enrichment; does not delay the sync response.
    this.backgroundEnricher.enqueue(seq.orderedTracks);

    return {
      manifest: this.store.get(manifest.broadcastId)!,
      firstSegmentUrls: firstUrls,
    };
  }

  async waitForCompletion(broadcastId: string): Promise<void> {
    const p = this.inFlight.get(broadcastId);
    if (p) await p;
  }

  isInFlight(broadcastId: string): boolean {
    return this.inFlight.has(broadcastId);
  }

  getManifest(broadcastId: string): Manifest | undefined {
    return this.store.get(broadcastId);
  }

  private async generateSlot(
    manifest: Manifest,
    slotIndex: number,
    ctx: SegmentContext,
  ): Promise<string[]> {
    const slot = manifest.segmentSlots[slotIndex];
    try {
      const prompts = buildSegmentPrompts(slot, manifest, ctx);
      const urls = await this.generator.generateVariants({
        broadcastId: manifest.broadcastId,
        slotIndex,
        prompts,
      });
      this.store.updateSlot(manifest.broadcastId, slotIndex, {
        status: 'ready',
        audioUrls: urls,
      });
      return urls;
    } catch (err) {
      this.store.updateSlot(manifest.broadcastId, slotIndex, { status: 'failed' });
      if (slotIndex === 0) throw err;
      return [];
    }
  }
}
```

Note: `buildSegmentPrompts` is still called with 3 args here (unchanged signature). The enrichment-aware 4th arg lands in Task 9, where we also update this `generateSlot` call site.

- [ ] **Step 8.4: Update `BroadcastOrchestrator` tests for new DI shape**

Replace the `makeStorage` + constructor calls in `server/__tests__/broadcast/BroadcastOrchestrator.test.ts` to include the new dependencies. Add at the top of the file (after the existing helpers):

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';

async function makeDeps() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-test-'));
  const enrichCache = new EnrichmentCache(path.join(dir, 'tracks.json'));
  await enrichCache.load();
  const enricher = new BackgroundEnricher(enrichCache, {
    fetchGenius: jest.fn(async () => null),
    fetchMusicBrainz: jest.fn(async () => null),
  });
  return { enrichCache, enricher };
}
```

Replace every `new BroadcastOrchestrator(makeMockLLM(), makeMockTTS(), makeStorage(), new BroadcastStore())` (and similar) call with:

```ts
const { enrichCache, enricher } = await makeDeps();
const orch = new BroadcastOrchestrator(
  makeMockLLM(JSON.stringify({ ordered: ['t0','t1','t2','t3','t4'] })),
  makeMockTTS(), makeStorage(), new BroadcastStore(), enrichCache, enricher,
);
```

Mock LLM is now called twice per bake: once by the sequencer (expects JSON response), once per segment slot (expects text response). Tests that count LLM calls must account for the sequencer call:

- Tests asserting `llm.generate.toHaveBeenCalledTimes(6)` (was: 6 segments) become `.toHaveBeenCalledTimes(7)` (1 sequencer + 6 segments).

For tests that need to differentiate LLM responses per call, use `mockImplementation` with call count:

```ts
const llm = makeMockLLM();
let call = 0;
(llm.generate as jest.Mock).mockImplementation(async () => {
  call++;
  if (call === 1) return { text: JSON.stringify({ ordered: ['t0','t1','t2','t3','t4'] }) };
  return { text: 'segment script' };
});
```

- [ ] **Step 8.5: Wire the new dependencies in `server/src/index.ts`**

Open `server/src/index.ts` and find the `new BroadcastOrchestrator(...)` call. Insert before that call:

```ts
import { EnrichmentCache } from './services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from './services/enrichment/BackgroundEnricher';
import { DefaultEnrichmentFetcher } from './services/enrichment/DefaultEnrichmentFetcher';

const enrichmentCache = new EnrichmentCache('./.enrichment-cache/tracks.json');
await enrichmentCache.load();
const backgroundEnricher = new BackgroundEnricher(
  enrichmentCache, new DefaultEnrichmentFetcher(),
);
```

(If `server/src/index.ts` is not in an async context, wrap the `enrichmentCache.load()` in an `.then(...)` block around orchestrator construction, or use top-level await if the server's TS config allows it. Most Express bootstraps already use async startup.)

Update the `new BroadcastOrchestrator(llm, tts, storage, store)` line to:

```ts
const orchestrator = new BroadcastOrchestrator(
  llm, tts, storage, store, enrichmentCache, backgroundEnricher,
);
```

- [ ] **Step 8.6: Run all server tests**

```bash
cd /Users/kari/Documents/cleo-app/server && npm test
```

Expected: all tests pass. If tests that existed before this refactor still reference the old constructor signature, update them in place.

- [ ] **Step 8.7: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add -A && git commit -m "$(cat <<'EOF'
feat: wire TrackSequencer into BroadcastOrchestrator

ManifestBuilder.buildManifest no longer slices — it expects pre-sized
input. BroadcastOrchestrator.create now runs TrackSequencer first, then
builds the manifest from the sequenced tracks, then fires background
enrichment for next time.

Tests updated for new DI (enrichment cache + background enricher) and
for the additional LLM call per bake (1 sequencer + N segments).
EOF
)"
```

---

## Task 9: Surface producer/sample from `EnrichmentCache` in `SegmentScriptBuilder`

**Goal:** When a track has `producer` or `sample` in the cache, inject it into the transition prompt so ONAY's commentary gets texture on repeat listens.

**Files:**
- Modify: `server/src/services/broadcast/SegmentScriptBuilder.ts`
- Modify: `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`

- [ ] **Step 9.1: Write the failing test**

Open `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`. Add these tests at the end of the main `describe` block:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';

async function enrichCacheWith(entries: Array<{
  title: string; artist: string; producer?: string; sample?: string;
}>): Promise<EnrichmentCache> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssb-test-'));
  const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
  await cache.load();
  for (const e of entries) {
    await cache.set(e.title, e.artist, {
      producer: e.producer,
      sample: e.sample,
      lastEnrichedAt: Date.now(),
      source: 'genius',
    });
  }
  return cache;
}

describe('buildSegmentPrompts with enrichment', () => {
  // Assumes existing `manifest` and `ctx` fixtures in scope. Reuse them.
  it('injects producer name into transition prompts when available', async () => {
    const enrichCache = await enrichCacheWith([
      { title: manifest.tracks[1].title, artist: manifest.tracks[1].artistName, producer: 'Madlib' },
    ]);
    const transitionSlot = manifest.segmentSlots.find(s => s.kind === 'transition')!;
    const prompts = buildSegmentPrompts(transitionSlot, manifest, ctx, enrichCache);
    const prompt = prompts[0].userPrompt;
    expect(prompt).toContain('Madlib');
  });

  it('injects sample line into transition prompts when available', async () => {
    const enrichCache = await enrichCacheWith([
      { title: manifest.tracks[1].title, artist: manifest.tracks[1].artistName,
        sample: 'Samples "Across 110th Street" by Bobby Womack' },
    ]);
    const transitionSlot = manifest.segmentSlots.find(s => s.kind === 'transition')!;
    const prompts = buildSegmentPrompts(transitionSlot, manifest, ctx, enrichCache);
    expect(prompts[0].userPrompt).toContain('Bobby Womack');
  });

  it('omits enrichment lines when cache has no record', async () => {
    const enrichCache = await enrichCacheWith([]);
    const transitionSlot = manifest.segmentSlots.find(s => s.kind === 'transition')!;
    const prompts = buildSegmentPrompts(transitionSlot, manifest, ctx, enrichCache);
    expect(prompts[0].userPrompt).not.toContain('Produced by');
    expect(prompts[0].userPrompt).not.toContain('Samples');
  });

  it('works without an enrichment cache argument (backwards compat)', () => {
    const transitionSlot = manifest.segmentSlots.find(s => s.kind === 'transition')!;
    const prompts = buildSegmentPrompts(transitionSlot, manifest, ctx);
    expect(prompts[0].userPrompt.length).toBeGreaterThan(0);
  });
});
```

Note: you'll need to inspect the existing test file to confirm the `manifest` and `ctx` fixtures' names and scope — they're referenced but not redefined here.

- [ ] **Step 9.2: Run to confirm failure**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest SegmentScriptBuilder
```

Expected: FAIL — `buildSegmentPrompts` currently takes 3 args, not 4.

- [ ] **Step 9.3: Update `buildSegmentPrompts` signature + transition prompt**

Modify `server/src/services/broadcast/SegmentScriptBuilder.ts`. Change the `buildSegmentPrompts` export signature and the transition body. Replace lines 72-136 with:

```ts
export function buildSegmentPrompts(
  slot: SegmentSlot,
  manifest: Manifest,
  ctx: SegmentContext,
  enrichmentCache?: { get(title: string, artist: string): { producer?: string; sample?: string } | null },
): PromptSet[] {
  const vibe = manifest.vibe;
  const sys = systemPrompt(vibe);

  if (slot.kind === 'cold_open') {
    const first = findTrack(manifest, slot.beforeTrackId)!;
    const variants: string[] = [];

    const timeLine =
      ctx.dayOfWeek && ctx.timeOfDay
        ? `It's ${ctx.dayOfWeek}, ${ctx.timeOfDay}.`
        : ctx.timeOfDay
          ? `It's ${ctx.timeOfDay}.`
          : ctx.dayOfWeek
            ? `It's ${ctx.dayOfWeek}.`
            : '';
    const base = [
      timeLine,
      ctx.listenerName ? `Your listener's name is ${ctx.listenerName}.` : '',
      ctx.firstTimeUser
        ? 'This is their very first broadcast \u2014 welcome them without being saccharine.'
        : ctx.lastSessionSummary
          ? `They're coming back \u2014 last time: ${ctx.lastSessionSummary}.`
          : 'They are a returning listener.',
      `Opening the broadcast with ${trackRef(first)}.`,
    ].filter(Boolean).join(' ');

    const angles = [
      'Lead with the time \u2014 paint the vibe, then name the track.',
      'Lead with a question or observation about the mood \u2014 then slide into the first track.',
      'Lead with a story fragment or a line you just couldn\'t shake today \u2014 then hand to the track.',
    ];

    for (const angle of angles.slice(0, slot.variantCount)) {
      variants.push(`${base}\n\nAngle: ${angle}\n\nWrite ONAY's cold open. 40-55 words. Land on the track name so the music can come in.`);
    }

    return variants.map(userPrompt => ({
      systemPrompt: sys,
      userPrompt,
      maxTokens: 512,
    }));
  }

  if (slot.kind === 'transition') {
    const outgoing = findTrack(manifest, slot.afterTrackId)!;
    const incoming = findTrack(manifest, slot.beforeTrackId)!;

    const enrichmentLines: string[] = [];
    if (enrichmentCache) {
      const incomingEnr = enrichmentCache.get(incoming.title, incoming.artistName);
      if (incomingEnr?.producer) {
        enrichmentLines.push(`Produced by ${sanitizeForPrompt(incomingEnr.producer, 80)}.`);
      }
      if (incomingEnr?.sample) {
        enrichmentLines.push(sanitizeForPrompt(incomingEnr.sample, 160) + '.');
      }
    }
    const enrichmentBlock = enrichmentLines.length
      ? `\n\nFlavor you may use (don't have to): ${enrichmentLines.join(' ')}`
      : '';

    const userPrompt =
      `Transitioning out of ${trackRef(outgoing)} into ${trackRef(incoming)}. ` +
      `Write ONAY's bridge. 25-40 words. A connection \u2014 a musical reference, a mood link, a memory, a counterpoint. ` +
      `End by naming the incoming track so the music can come in.` +
      enrichmentBlock;
    return [{ systemPrompt: sys, userPrompt, maxTokens: 384 }];
  }

  const closing = findTrack(manifest, slot.afterTrackId)!;
  const userPrompt =
    `Closing the broadcast. The final track was ${trackRef(closing)}. ` +
    `Write ONAY's sign-off. 30-45 words. Reference the closer. Send the listener off with warmth. ` +
    `Optional: tease the idea of coming back for another broadcast.`;
  return [{ systemPrompt: sys, userPrompt, maxTokens: 384 }];
}
```

- [ ] **Step 9.4: Run to confirm pass**

```bash
cd /Users/kari/Documents/cleo-app/server && npx jest SegmentScriptBuilder
```

Expected: PASS, new and existing tests.

- [ ] **Step 9.5: Pass the enrichment cache through from the Orchestrator**

The `buildSegmentPrompts` 4th arg is optional but only fills commentary when present. Open `server/src/services/broadcast/BroadcastOrchestrator.ts` and update the `generateSlot` method — change:

```ts
const prompts = buildSegmentPrompts(slot, manifest, ctx);
```

to:

```ts
const prompts = buildSegmentPrompts(slot, manifest, ctx, this.enrichmentCache);
```

- [ ] **Step 9.6: Re-run full server test suite**

```bash
cd /Users/kari/Documents/cleo-app/server && npm test
```

Expected: all tests pass.

- [ ] **Step 9.7: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add server/src/services/broadcast/SegmentScriptBuilder.ts server/__tests__/broadcast/SegmentScriptBuilder.test.ts && git commit -m "feat: inject producer/sample enrichment into transition prompts"
```

---

## Task 10: Manual device validation

**Goal:** Confirm the feature feels right end-to-end on a real iOS device with real Apple Music playlists.

**No new files. Checklist-only task.** Run the dev server (`cd server && npm run dev`) and the dev client on device (`SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`).

- [ ] **Step 10.1: Each vibe with a real playlist**

For each of the 7 vibes, pick one real Apple Music playlist and bake a quick broadcast. Verify:

- The picker shows 7 vibes (not 12), each with a descriptor line below the label
- The broadcast plays through without errors
- Listening to slot 0 → track 0 → slot 1 transition, the arrangement feels intentional for the chosen vibe, not random

Record subjective impressions in a comment on the feature branch's PR (if any). If any vibe feels wrong, open an issue tagged `vibe-arc-tuning` and note which arc needs refinement.

- [ ] **Step 10.2: Cache hit verification**

Bake a broadcast with playlist A + vibe X. Wait 30 seconds. Bake the same playlist + same vibe. Verify:

- Server logs show no second LLM sequencer call
- Track order is identical between the two bakes
- Second bake ships the sync response in under ~1 second

- [ ] **Step 10.3: Background enrichment verification**

After Step 10.2, tail the server log: `cd server && tail -f dev.log` (or whatever log path the dev server uses). Verify the background enricher fires Genius + MusicBrainz calls for each track in the bake. Wait for completion.

Inspect `server/.enrichment-cache/tracks.json` — it should contain records for the tracks just baked.

Bake a third time with the same playlist + different vibe (to avoid the sequence cache). Check the sequencer's user prompt (log it temporarily at DEBUG level if needed) — it should now include `[soul | 1972 | prod: ...]` fragments for tracks that got enriched.

Listen to a transition where the incoming track has a cached `producer` field. ONAY's commentary should have a chance of name-dropping the producer.

- [ ] **Step 10.4: Bad-pair pressure test**

Pick a deliberately-mismatched pairing (e.g. `workout` with a jazz-only playlist, or `party` with an ambient playlist). Verify:

- The bake completes without error
- The sequencer adapts (picks the most energetic jazz for workout, most rhythmic ambient for party)
- No "broadcast unavailable" surface to the user

If the result feels genuinely bad, that's expected behavior — the design says we don't preflight-warn on pool mismatch.

- [ ] **Step 10.5: LLM-failure fallback**

Temporarily break Ollama by stopping its systemd unit / docker container, then break the Gemini fallback by setting `GEMINI_API_KEY=invalid` in `server/.env` and restarting the dev server. Bake a broadcast. Verify:

- No client-facing error appears
- Broadcast ships with tracks in playlist input order (deterministic fallback path)
- Server log shows `source: 'fallback'` on the sequencer's return

Restore the env vars afterward.

- [ ] **Step 10.6: Performance sanity check**

On a fresh server (no caches warm), bake a standard-length broadcast. Measure:

- Time from `POST /broadcast/create` → response: should be under ~10 seconds on Ollama (5-8s for sequencer + slot 0 gen)
- Total time to first audio on device: within a few seconds of the HTTP response

Expected: p50 ≤ 8s, p95 ≤ 12s end-to-end. If significantly worse, check whether the background enricher is accidentally awaited somewhere (it should be fire-and-forget and never block the sync path).

- [ ] **Step 10.7: Final commit (docs update)**

Update `CLAUDE.md`'s "What's Left" section to remove "Server-side AI track reordering" as a pending item, and add a brief note under "Conventions" or "Gotchas" about the sequence + enrichment cache locations and TTLs.

```bash
cd /Users/kari/Documents/cleo-app && git add CLAUDE.md && git commit -m "docs: CLAUDE.md reflects curation redesign ship"
```

---

## Done

All tasks complete when:
- Server test suite green: `cd server && npm test`
- Client TS compiles: `npx tsc --noEmit`
- Manual device checklist in Task 10 passed
- `docs/superpowers/plans/2026-04-16-curation-implementation.md` has every checkbox ticked

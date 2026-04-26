# Up Next Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a read-only "UP NEXT" section on the broadcast player screen showing upcoming manifest tracks with markers for ONAY's transitions and sign-off.

**Architecture:** Engine-derived. Extract a pure `computeUpcoming` function (new module) that walks the manifest from the current track + segment cursor and returns an `UpcomingItem[]`. `BroadcastPlayer.getStatus()` calls it and exposes the result on `PlayerStatus.upcoming`. The player screen renders a new `UpNextList` component below the volume dial. The existing 500ms `getStatus` poll drives re-renders; no new state, no new effects, no audio routing changes.

**Tech Stack:** TypeScript strict, React Native 0.83 + Expo SDK 55, Jest + ts-jest. Crate Digger design tokens (`AM`, `Fonts`, `Space`, `TypeScale`) and existing `SectionMarker` from `src/components/crate/`.

**Spec:** [`docs/superpowers/specs/2026-04-26-up-next-display-design.md`](../specs/2026-04-26-up-next-display-design.md)

**Issue:** [#35](https://github.com/bworthy89/cleo/issues/35) (Quick-add scope deliberately removed — see spec)

---

## File Structure

| File | Status | Purpose |
|---|---|---|
| `src/engines/BroadcastPlayer.types.ts` | modify | Add `UpcomingItemKind`, `UpcomingItem`; extend `PlayerStatus` with `upcoming` field. |
| `src/engines/BroadcastPlayer.upcoming.ts` | create | Pure `computeUpcoming` function — sole owner of the manifest-walking algorithm. |
| `__tests__/engines/BroadcastPlayer.upcoming.test.ts` | create | Unit tests for the pure function. |
| `src/engines/BroadcastPlayer.ts` | modify | Promote `nextSegmentIdx` to instance field; call `computeUpcoming` from `getStatus`. |
| `src/components/broadcast/UpNextList.tsx` | create | Renders the section header, rows, and empty state. |
| `app/(main)/(broadcast)/player.tsx` | modify | Mount `<UpNextList items={status.upcoming} />` between the volume block and trailing spacer. |

---

## Task 1: Add types

**Files:**
- Modify: `src/engines/BroadcastPlayer.types.ts`

- [ ] **Step 1: Add `UpcomingItemKind` and `UpcomingItem`**

Append the new types at the end of the existing exports, after the `PlayerStatus` interface. Keep the file's existing exports untouched.

```ts
export type UpcomingItemKind = 'track' | 'transition' | 'sign_off';

export interface UpcomingItem {
  kind: UpcomingItemKind;
  /** Stable React key. For tracks: trackId. For segments: `slot-${slotIndex}`. */
  key: string;
  /** 0-indexed position in `manifest.tracks`. Only set for kind === 'track'. */
  trackIndex?: number;
  /** Track display fields. Only set for kind === 'track'. */
  title?: string;
  artistName?: string;
  duration?: number;
}
```

- [ ] **Step 2: Extend `PlayerStatus` with `upcoming`**

Modify the existing `PlayerStatus` interface to add the field. Insert after `progress`:

```ts
export interface PlayerStatus {
  state: PlayerState;
  currentTrackIndex: number;
  currentSegmentIndex: number;
  broadcastId: string | null;
  vibe: Vibe | null;
  totalTracks: number;
  currentTrack: ManifestTrack | null;
  nowPlaying:
    | { segmentKind: SegmentSlotKind }
    | { trackId: string }
    | null;
  progress: number;
  upcoming: UpcomingItem[];
}
```

- [ ] **Step 3: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: TS errors specifically in `BroadcastPlayer.ts` because `getStatus()` doesn't return `upcoming` yet (we'll fix in Task 4). No other errors.

- [ ] **Step 4: Commit**

```bash
git add src/engines/BroadcastPlayer.types.ts
git commit -m "feat(player): add UpcomingItem types and PlayerStatus.upcoming field (#35)"
```

---

## Task 2: Create the pure `computeUpcoming` module

**Files:**
- Create: `src/engines/BroadcastPlayer.upcoming.ts`

This is the only place the manifest-walking algorithm lives. The class method on `BroadcastPlayer` will just delegate. Pure function — easy to unit-test in isolation without driving engine state.

- [ ] **Step 1: Write the function**

```ts
import type {
  Manifest,
  PlayerState,
  UpcomingItem,
} from './BroadcastPlayer.types';

/**
 * Compute the upcoming-items list for the player's UP NEXT section.
 *
 * Pure function: takes a snapshot of the engine's externally-relevant state
 * and returns the list. The engine's `getStatus` calls this with `this`
 * fields so the UI sees a consistent, immediately-renderable list on every
 * 500ms poll.
 *
 * Algorithm:
 *   - Returns [] when manifest is null or state is 'ended' / 'idle' / 'error'.
 *   - Walks `tracks` from currentTrackIndex+1 to the end (current track is
 *     not "upcoming" — it's playing).
 *   - Maintains a local segment cursor seeded from `nextSegmentIdx` and
 *     consumes a slot whenever its `beforeTrackId` matches the next walked
 *     track.
 *   - After the track loop, considers the slot at the current cursor for a
 *     trailing sign_off entry.
 *   - A considered segment is SKIPPED (not added to output) when:
 *       1. cursor === currentSegmentIndex — the slot is currently playing,
 *          so it isn't "upcoming." `runMainLoop` increments its loop-local
 *          `nextSegmentIdx` only after `runSegmentAt` returns; while a
 *          segment is in flight, the engine's `nextSegmentIdx` field still
 *          points at it. This filter prevents the in-flight transition
 *          from being rendered as upcoming.
 *       2. status === 'failed' or 'aborted' — the runtime skips these
 *          silently, so the upcoming list should match.
 */
export function computeUpcoming(args: {
  manifest: Manifest | null;
  state: PlayerState;
  currentTrackIndex: number;
  currentSegmentIndex: number;
  nextSegmentIdx: number;
}): UpcomingItem[] {
  const { manifest, state, currentTrackIndex, currentSegmentIndex, nextSegmentIdx } = args;
  if (!manifest) return [];
  if (state === 'ended' || state === 'idle' || state === 'error') return [];

  const items: UpcomingItem[] = [];
  let cursor = nextSegmentIdx;

  const isLiveOrSkipped = (slotIndex: number, status: string): boolean =>
    slotIndex === currentSegmentIndex || status === 'failed' || status === 'aborted';

  for (let i = currentTrackIndex + 1; i < manifest.tracks.length; i++) {
    const track = manifest.tracks[i];

    const slot = manifest.segmentSlots[cursor];
    // Consume any slot whose beforeTrackId matches this track. Only TRANSITION
    // slots produce a row — cold_open is part of the broadcast frame and isn't
    // "upcoming" in the editorial sense; it lives in slot 0 with beforeTrackId
    // pointing at the first track, which would otherwise sneak in as a row on
    // a fresh-start cursor of 0.
    if (slot && slot.beforeTrackId === track.id) {
      if (slot.kind === 'transition' && !isLiveOrSkipped(cursor, slot.status)) {
        items.push({ kind: 'transition', key: `slot-${cursor}` });
      }
      cursor += 1;
    }

    items.push({
      kind: 'track',
      key: track.id,
      trackIndex: i,
      title: track.title,
      artistName: track.artistName,
      duration: track.duration,
    });
  }

  const trailing = manifest.segmentSlots[cursor];
  if (trailing && trailing.kind === 'sign_off' && !isLiveOrSkipped(cursor, trailing.status)) {
    items.push({ kind: 'sign_off', key: `slot-${cursor}` });
  }

  return items;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: same `BroadcastPlayer.ts` error from Task 1 (about `getStatus` not returning `upcoming`). No new errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/engines/BroadcastPlayer.upcoming.ts
git commit -m "feat(player): pure computeUpcoming function for UP NEXT section (#35)"
```

---

## Task 3: Write failing unit tests for `computeUpcoming`

**Files:**
- Create: `__tests__/engines/BroadcastPlayer.upcoming.test.ts`

Pure-function tests — no engine driving needed.

- [ ] **Step 1: Write all 9 test cases**

```ts
import { computeUpcoming } from '../../src/engines/BroadcastPlayer.upcoming';
import type { Manifest, PlayerState } from '../../src/engines/BroadcastPlayer.types';

// 5-track standard fixture under sparse cadence:
//   slot 0 = cold_open (before t0)
//   slot 1 = transition (after t1, before t2)
//   slot 2 = transition (after t3, before t4)
//   slot 3 = sign_off (after t4)
const make5Track = (): Manifest => ({
  broadcastId: 'b1',
  userId: 'u1',
  playlistId: 'p1',
  vibe: 'morning',
  length: 'standard',
  createdAt: 0,
  tracks: [
    { id: 't0', title: 'T0', artistName: 'A0', albumTitle: 'AL', duration: 180 },
    { id: 't1', title: 'T1', artistName: 'A1', albumTitle: 'AL', duration: 200 },
    { id: 't2', title: 'T2', artistName: 'A2', albumTitle: 'AL', duration: 220 },
    { id: 't3', title: 'T3', artistName: 'A3', albumTitle: 'AL', duration: 240 },
    { id: 't4', title: 'T4', artistName: 'A4', albumTitle: 'AL', duration: 260 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 2, kind: 'transition', afterTrackId: 't3', beforeTrackId: 't4', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 3, kind: 'sign_off', afterTrackId: 't4', variantCount: 1, status: 'ready', audioUrls: ['u'] },
  ],
});

// 3-track quick fixture: cold_open + sign_off only — no middle transitions.
const make3TrackNoTransitions = (): Manifest => ({
  broadcastId: 'b1',
  userId: 'u1',
  playlistId: 'p1',
  vibe: 'morning',
  length: 'quick',
  createdAt: 0,
  tracks: [
    { id: 't0', title: 'T0', artistName: 'A0', albumTitle: 'AL', duration: 180 },
    { id: 't1', title: 'T1', artistName: 'A1', albumTitle: 'AL', duration: 200 },
    { id: 't2', title: 'T2', artistName: 'A2', albumTitle: 'AL', duration: 220 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 1, kind: 'sign_off', afterTrackId: 't2', variantCount: 1, status: 'ready', audioUrls: ['u'] },
  ],
});

const FRESH: { state: PlayerState; currentTrackIndex: number; currentSegmentIndex: number; nextSegmentIdx: number } = {
  state: 'loading',
  currentTrackIndex: -1,
  currentSegmentIndex: -1,
  nextSegmentIdx: 0,
};

describe('computeUpcoming', () => {
  it('case 1 — fresh start, before slot 0 plays: returns all tracks + transitions + sign_off', () => {
    const items = computeUpcoming({ manifest: make5Track(), ...FRESH });
    expect(items.map(i => i.kind)).toEqual([
      'track', 'track', 'transition', 'track', 'track', 'transition', 'track', 'sign_off',
    ]);
    expect(items.filter(i => i.kind === 'track').map(i => i.trackIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('case 2 — mid-cold-open: same as case 1 (cold_open is current, not upcoming)', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_segment',
      currentTrackIndex: -1,
      currentSegmentIndex: 0,
      nextSegmentIdx: 0, // cursor stays at 0 during cold_open; runMainLoop sets it to 1 after
    });
    expect(items.map(i => i.kind)).toEqual([
      'track', 'track', 'transition', 'track', 'track', 'transition', 'track', 'sign_off',
    ]);
  });

  it('case 3 — mid-track at index 2: returns t3, t4, transition before t4, sign_off', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_track',
      currentTrackIndex: 2,
      currentSegmentIndex: -1,
      nextSegmentIdx: 2,
    });
    expect(items.map(i => i.kind)).toEqual(['track', 'transition', 'track', 'sign_off']);
    expect(items.filter(i => i.kind === 'track').map(i => i.trackIndex)).toEqual([3, 4]);
  });

  it('case 4 — in-flight transition between t1 and t2: filtered out, next transition + remaining tracks shown', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_segment',
      currentTrackIndex: 1, // last completed track
      currentSegmentIndex: 1, // transition slot 1 is in flight
      nextSegmentIdx: 1, // engine cursor still at the in-flight slot
    });
    // Walk starts at track 2. cursor=1 (in-flight), slot 1.beforeTrackId='t2'
    //   matches t2 — but cursor === currentSegmentIndex, so SKIP. cursor → 2.
    // Track 2, 3 added. Slot 2.beforeTrackId='t4' matches t4. cursor !== current,
    //   add transition. cursor → 3. Track 4 added. Slot 3 = sign_off.
    expect(items.map(i => i.kind)).toEqual(['track', 'track', 'transition', 'track', 'sign_off']);
    expect(items.filter(i => i.kind === 'track').map(i => i.trackIndex)).toEqual([2, 3, 4]);
  });

  it('case 5 — last track playing: returns just sign_off', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_track',
      currentTrackIndex: 4,
      currentSegmentIndex: -1,
      nextSegmentIdx: 3,
    });
    expect(items.map(i => i.kind)).toEqual(['sign_off']);
  });

  it('case 6 — mid-sign-off: returns []', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_segment',
      currentTrackIndex: 4,
      currentSegmentIndex: 3, // sign_off in flight
      nextSegmentIdx: 3,
    });
    expect(items).toEqual([]);
  });

  it('case 7 — failed transition in the middle: filtered, adjacent tracks render back-to-back', () => {
    const m = make5Track();
    m.segmentSlots[1].status = 'failed';
    const items = computeUpcoming({ manifest: m, ...FRESH });
    // Slot 1 (before t2) is failed → skipped. Slot 2 (before t4) still shown.
    expect(items.map(i => i.kind)).toEqual([
      'track', 'track', 'track', 'track', 'transition', 'track', 'sign_off',
    ]);
  });

  it('case 8 — manifest with no middle transitions: tracks + sign_off only', () => {
    const items = computeUpcoming({ manifest: make3TrackNoTransitions(), ...FRESH });
    expect(items.map(i => i.kind)).toEqual(['track', 'track', 'track', 'sign_off']);
  });

  it('case 9 — null manifest or ended state returns []', () => {
    expect(computeUpcoming({ manifest: null, ...FRESH })).toEqual([]);
    expect(computeUpcoming({ manifest: make5Track(), ...FRESH, state: 'ended' })).toEqual([]);
    expect(computeUpcoming({ manifest: make5Track(), ...FRESH, state: 'idle' })).toEqual([]);
    expect(computeUpcoming({ manifest: make5Track(), ...FRESH, state: 'error' })).toEqual([]);
  });

  it('produces stable React keys', () => {
    const items = computeUpcoming({ manifest: make5Track(), ...FRESH });
    const keys = items.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length); // unique
    // Track keys are track ids; segment keys are slot-<idx>.
    expect(keys[0]).toBe('t0');
    expect(keys.find(k => k.startsWith('slot-'))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests — verify they all pass**

Run: `npm test -- BroadcastPlayer.upcoming`
Expected: all 10 tests pass (the 9 cases plus the keys test). The pure function from Task 2 already implements the algorithm.

If any fail, fix `computeUpcoming` in `BroadcastPlayer.upcoming.ts` until they pass. Re-run.

- [ ] **Step 3: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.upcoming.test.ts
git commit -m "test(player): unit tests for computeUpcoming (#35)"
```

---

## Task 4: Wire `computeUpcoming` into `BroadcastPlayer`

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts`

Two changes: promote `nextSegmentIdx` to an instance field so `computeUpcoming` can read the loop's actual cursor, and have `getStatus` populate the new `upcoming` field.

- [ ] **Step 1: Add the instance field**

Find the existing field declarations near the top of the class (after `private maxPlaybackTimeSeen = 0;` and before `private pollTimer`). Insert:

```ts
  /** Next segment-slot index the main loop will consider. Promoted from a
   *  local in `runMainLoop` so `getStatus().upcoming` can match the loop's
   *  actual cursor between iterations. Reset to 0 on `start`, computed via
   *  `computeNextSegmentIdxAfter` on `resume`. */
  private nextSegmentIdx = 0;
```

- [ ] **Step 2: Reset the cursor on `start`**

In `start(manifest, firstSegmentUrls)`, before the first `await this.runSegmentAt(0)`, add:

```ts
    this.nextSegmentIdx = 0;
```

The order in `start` should be: `await this.initPlayback(...)` → `if (!this.manifest) return;` → **`this.nextSegmentIdx = 0;`** → `await this.runSegmentAt(0);` → ...

- [ ] **Step 3: Set the cursor on `resume`**

In `resume(manifest, trackCursor)`, the existing logic finds an `introSlotIdx` for the resume target. After `await this.initPlayback(...)` and `if (!this.manifest) return;`, but before the `if (trackCursor < 0)` branch, add:

```ts
    this.nextSegmentIdx = this.computeNextSegmentIdxAfter(trackCursor, manifest);
```

Note: `computeNextSegmentIdxAfter` already exists. We're caching its result on the instance instead of recomputing in line.

Then in the existing branches:
- The `trackCursor < 0` branch already calls `runMainLoop(0, 1)`. Replace `1` with `this.nextSegmentIdx` only if cleaner — actually just leave that branch intact, it sets the cursor implicitly via the next step.
- The `introSlotIdx >= 0` branch calls `runMainLoop(trackCursor, introSlotIdx + 1)`.
- The else branch calls `runMainLoop(trackCursor, nextSegmentIdx)` (a local).

Replace the local `nextSegmentIdx` reads inside `resume` with `this.nextSegmentIdx`:

Original:
```ts
    } else {
      // No preceding segment — start directly at the track.
      const nextSegmentIdx = this.computeNextSegmentIdxAfter(trackCursor, manifest);
      await this.runMainLoop(trackCursor, nextSegmentIdx);
    }
```

Becomes:
```ts
    } else {
      // No preceding segment — start directly at the track. Cursor was set
      // above via computeNextSegmentIdxAfter.
      await this.runMainLoop(trackCursor, this.nextSegmentIdx);
    }
```

The `introSlotIdx >= 0` branch becomes:
```ts
      this.nextSegmentIdx = introSlotIdx + 1;
      await this.runMainLoop(trackCursor, introSlotIdx + 1);
```

The `trackCursor < 0` branch becomes:
```ts
      this.nextSegmentIdx = 0;
      await this.runSegmentAt(0);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      await this.runMainLoop(0, 1);
      return;
```

- [ ] **Step 4: Have `runMainLoop` use the field**

In `private async runMainLoop(startTrack: number, startSegIdx: number)`, replace the local cursor with the field. Original:

```ts
  private async runMainLoop(startTrack: number, startSegIdx: number): Promise<void> {
    if (!this.manifest) return;
    let nextSegmentIdx = startSegIdx;
    for (let i = startTrack; i < this.manifest.tracks.length; i++) {
      ...
      const slots = this.manifest.segmentSlots;
      const nextTrack = this.manifest.tracks[i + 1];
      const nextSlot = slots[nextSegmentIdx];

      if (!nextTrack) {
        if (nextSlot && nextSlot.kind === 'sign_off') {
          await this.runSegmentAt(nextSegmentIdx);
          ...
        }
        break;
      }

      if (nextSlot && nextSlot.beforeTrackId === nextTrack.id) {
        await this.runSegmentAt(nextSegmentIdx);
        ...
        nextSegmentIdx += 1;
      }
    }
    ...
  }
```

Becomes:

```ts
  private async runMainLoop(startTrack: number, startSegIdx: number): Promise<void> {
    if (!this.manifest) return;
    this.nextSegmentIdx = startSegIdx;
    for (let i = startTrack; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;

      const slots = this.manifest.segmentSlots;
      const nextTrack = this.manifest.tracks[i + 1];
      const nextSlot = slots[this.nextSegmentIdx];

      if (!nextTrack) {
        if (nextSlot && nextSlot.kind === 'sign_off') {
          await this.runSegmentAt(this.nextSegmentIdx);
          if (!this.manifest) return;
          await this.waitIfPaused();
          if (!this.manifest) return;
        }
        break;
      }

      if (nextSlot && nextSlot.beforeTrackId === nextTrack.id) {
        await this.runSegmentAt(this.nextSegmentIdx);
        if (!this.manifest) return;
        await this.waitIfPaused();
        if (!this.manifest) return;
        this.nextSegmentIdx += 1;
      }
    }
    await this.music.pause().catch(() => {});
    await this.music.clearNowPlaying().catch(() => {});
    await this.music.endBroadcastLiveActivity().catch(() => {});
    this.state = 'ended';
    clearPersistedBroadcast();
  }
```

- [ ] **Step 5: Reset the cursor in `end`**

In `end()`, the existing teardown sets `currentTrackIndex = -1; currentSegmentIndex = -1;`. Add the cursor reset alongside:

```ts
    this.currentTrackIndex = -1;
    this.currentSegmentIndex = -1;
    this.nextSegmentIdx = 0;
```

- [ ] **Step 6: Add the import and call `computeUpcoming` from `getStatus`**

At the top of the file, add to the existing imports:

```ts
import { computeUpcoming } from './BroadcastPlayer.upcoming';
```

Then update `getStatus`:

```ts
  getStatus(): PlayerStatus {
    const track =
      this.manifest && this.currentTrackIndex >= 0
        ? this.manifest.tracks[this.currentTrackIndex]
        : null;
    return {
      state: this.state,
      currentTrackIndex: this.currentTrackIndex,
      currentSegmentIndex: this.currentSegmentIndex,
      broadcastId: this.manifest?.broadcastId ?? null,
      vibe: this.manifest?.vibe ?? null,
      totalTracks: this.manifest?.tracks.length ?? 0,
      currentTrack: track ?? null,
      nowPlaying: this.describeNowPlaying(),
      progress: this.computeProgress(),
      upcoming: computeUpcoming({
        manifest: this.manifest,
        state: this.state,
        currentTrackIndex: this.currentTrackIndex,
        currentSegmentIndex: this.currentSegmentIndex,
        nextSegmentIdx: this.nextSegmentIdx,
      }),
    };
  }
```

- [ ] **Step 7: Run the existing player tests — verify no regressions**

Run: `npm test -- BroadcastPlayer.test`
Expected: all existing tests pass (the cursor promotion is a refactor without behavior change).

If any fail, debug. The most likely cause is missing the cursor reset in one of the lifecycle paths (`start`, `resume`, `end`).

- [ ] **Step 8: Run the upcoming tests again — confirm still green**

Run: `npm test -- BroadcastPlayer.upcoming`
Expected: 10 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/engines/BroadcastPlayer.ts
git commit -m "feat(player): wire computeUpcoming into getStatus, promote nextSegmentIdx (#35)"
```

---

## Task 5: Build the `UpNextList` component

**Files:**
- Create: `src/components/broadcast/UpNextList.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { SectionMarker } from '../crate';
import type { UpcomingItem } from '../../engines/BroadcastPlayer.types';

interface Props {
  items: UpcomingItem[];
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

export function UpNextList({ items }: Props) {
  const trackCount = items.filter(i => i.kind === 'track').length;
  const sideLabel = `${pad2(trackCount)} REMAINING`;

  return (
    <View style={styles.wrap}>
      <SectionMarker num="B·02" title="UP NEXT" side={sideLabel} />
      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>THIS IS THE LAST ONE</Text>
        </View>
      ) : (
        items.map(item => {
          if (item.kind === 'track') {
            const duration = formatDuration(item.duration);
            const trackNum = pad2((item.trackIndex ?? 0) + 1);
            return (
              <View
                key={item.key}
                style={styles.trackRow}
                accessibilityRole="text"
                accessibilityLabel={`Up next, track ${trackNum}, ${item.title} by ${item.artistName}`}
              >
                <Text style={styles.trackIdx}>TRK {trackNum}</Text>
                <View style={styles.trackBody}>
                  <Text style={styles.trackTitle} numberOfLines={1}>
                    {(item.title ?? '').toUpperCase()}
                  </Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>
                    {item.artistName}
                  </Text>
                </View>
                {duration ? <Text style={styles.trackMeta}>{duration}</Text> : null}
              </View>
            );
          }
          const text = item.kind === 'sign_off' ? '↘ ONAY · SIGN-OFF' : '↘ ONAY · TRANSITION';
          const a11y = item.kind === 'sign_off' ? 'ONAY sign-off' : 'ONAY transition between tracks';
          return (
            <View
              key={item.key}
              style={styles.segRow}
              accessibilityRole="text"
              accessibilityLabel={a11y}
            >
              <Text style={styles.segText}>{text}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Space.s30,
  },
  emptyWrap: {
    paddingVertical: Space.s12,
    alignItems: 'center',
  },
  empty: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.s8,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
    gap: Space.s10,
  },
  trackIdx: {
    width: 36,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  trackBody: {
    flex: 1,
  },
  trackTitle: {
    fontFamily: Fonts.display,
    fontSize: 14,
    letterSpacing: 0.5,
    color: AM.ink,
    lineHeight: 17,
  },
  trackArtist: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: 12,
    color: AM.inkMid,
    marginTop: 2,
  },
  trackMeta: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  segRow: {
    paddingVertical: Space.s6,
    alignItems: 'center',
  },
  segText: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: AM.inkDim,
  },
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/broadcast/UpNextList.tsx
git commit -m "feat(player): UpNextList component for UP NEXT section (#35)"
```

---

## Task 6: Mount `UpNextList` on the player screen

**Files:**
- Modify: `app/(main)/(broadcast)/player.tsx`

- [ ] **Step 1: Add the import**

Near the top of the file, add to the existing imports (group with the other broadcast component imports):

```tsx
import { UpNextList } from '../../../src/components/broadcast/UpNextList';
```

- [ ] **Step 2: Render `<UpNextList />` between volume block and trailing spacer**

Find the closing `</View>` of the volume block (the `<View style={styles.volumeBlock}>` block, ending after `</View>` for `volumeScale`), then the existing `<View style={{ height: Space.s22 }} />` spacer right after.

Insert the UpNextList between them:

```tsx
        <View style={styles.volumeBlock}>
          {/* ...existing volume block content unchanged... */}
        </View>

        <UpNextList items={status.upcoming} />

        <View style={{ height: Space.s22 }} />
      </ScrollView>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 'app/(main)/(broadcast)/player.tsx'
git commit -m "feat(player): mount UpNextList on the broadcast player screen (#35)"
```

---

## Task 7: Manual smoke verification

This is a UI feature — type-checking and unit tests can't verify visual fidelity. Run on a real device before opening the PR.

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: all tests pass, including the new 10 in `BroadcastPlayer.upcoming.test.ts`.

- [ ] **Step 3: Build & install on a real device**

Run: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`

Wait for the build to finish and the app to launch.

- [ ] **Step 4: Smoke-test the UP NEXT section**

Drive a fresh standard-length bake (any playlist, any vibe). On the player screen:

- Verify the "B·02 · UP NEXT" section appears below the host volume dial.
- Verify the right-side label shows the remaining-track count, decreasing as tracks complete.
- Verify "↘ ONAY · TRANSITION" rows appear between the right tracks (sparse cadence: before tracks at indices 2, 4, ...).
- Verify the "↘ ONAY · SIGN-OFF" row appears at the bottom of the list throughout the broadcast.
- During a transition segment, verify that segment's row disappears from the list (in-flight filter).
- On the last track, verify the empty state line "THIS IS THE LAST ONE" replaces the rows.

- [ ] **Step 5: Smoke-test edge interactions**

- Background the app mid-broadcast for 30 seconds, foreground it. UP NEXT should still be correct on return (poll-driven).
- Pause mid-track, wait 10 seconds, resume. UP NEXT should remain stable.
- Tap "End broadcast." Confirm the section disappears with the rest of the player chrome.

- [ ] **Step 6: VoiceOver pass**

Settings → Accessibility → VoiceOver ON. Navigate the player screen. Confirm:

- "Up next, track 4, [Title] by [Artist]" reads sensibly.
- "ONAY transition between tracks" reads on transition rows.
- "ONAY sign-off" reads on the trailing row.

- [ ] **Step 7: Capture the smoke result**

If everything passes, the implementation is done. If a step fails, debug, fix, and re-run from Step 1.

No commit on this task — verification only.

---

## Final task: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: CodeRabbit pre-PR review**

Per project convention: run CodeRabbit locally before opening the PR.

```bash
coderabbit review --agent --base main --type committed
```

Address any findings. Re-commit + push as needed.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat(player): UP NEXT display on the broadcast player (#35)" --body "$(cat <<'EOF'
## Summary

- Renders a read-only UP NEXT section on the player screen showing upcoming manifest tracks with markers for ONAY's transitions and sign-off.
- Engine-derived: pure `computeUpcoming` function called from `BroadcastPlayer.getStatus()`. Existing 500ms `getStatus` poll drives re-renders.
- **Quick-add deliberately removed from scope** — see [`docs/superpowers/specs/2026-04-26-up-next-display-design.md`](../docs/superpowers/specs/2026-04-26-up-next-display-design.md) for the rationale (tension with the "NO SKIPS · SIT WITH IT" radio frame). The user impulse it solved is better served by #36 thumbs-up save-to-list.

Closes #35.

## Test plan

- [ ] `npm test` — all green, including the new 10 cases in `BroadcastPlayer.upcoming.test.ts`
- [ ] `npx tsc --noEmit` — no errors
- [ ] Real-device smoke (per plan Task 7): standard bake, watch UP NEXT shrink track by track, transition rows disappear when their slot completes, sign-off row stays to the end, empty state on the last track
- [ ] Background/foreground mid-broadcast — list remains correct
- [ ] VoiceOver — track / transition / sign-off rows read sensibly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

Before handing off, three things to call out for the implementer:

1. **The cursor promotion in Task 4 is a refactor with no behavior change.** The existing `BroadcastPlayer.test.ts` is the safety net — if it stays green, the refactor is safe. Do not skip Step 7 of Task 4.
2. **The empty-state line "THIS IS THE LAST ONE" is editorial copy.** If the writer/designer wants different wording, change in `UpNextList.tsx` only — no other files reference the string.
3. **No new design tokens were added.** All sizes / colors come from existing `AM`, `Fonts`, `Space`, `TypeScale`. Do not introduce literal hex colors or pixel sizes — the project convention rejects inline values.

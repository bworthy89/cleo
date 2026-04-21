# Broadcast Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the intrusive, value-less "Resume broadcast?" alert with a
tri-state home-screen CTA (Fresh / Resume / Now Playing) that actually picks
up mid-session at the track the user left.

**Architecture:** Persist a `{ manifest, trackCursor, updatedAt }` record to
MMKV; write `trackCursor` at the top of `runTrackAt(i)`. Add
`BroadcastPlayer.resume(manifest, trackCursor)` that shares setup with
`start()` but branches on the resume index to replay the preceding
transition segment (if any) then enter the main loop at the cursor.
Swap `HomeBroadcastScreen`'s native `Alert.alert` for a mode state that
drives the existing `StampButton` label/sub and the "ROLL YOUR OWN" block
visibility.

**Tech Stack:** TypeScript, React Native + Expo, Jest + ts-jest, MMKV,
Expo Router, existing `BroadcastPlayer` class, existing `StampButton`
crate component.

**Spec:** `docs/superpowers/specs/2026-04-20-broadcast-resume-design.md`.

---

## File map

### Modify

- `src/services/Storage.ts` — introduce `PersistedBroadcast` type, change
  `setPersistedBroadcast` / `getPersistedBroadcast` signatures, add
  `updatePersistedCursor`, add legacy-shape migration guard.
- `src/engines/BroadcastPlayer.ts` — call `updatePersistedCursor` at the
  top of `runTrackAt`; extract `initPlayback` helper; add `resume` method.
- `src/engines/BroadcastResumer.ts` — return
  `{ manifest: freshFromServer, trackCursor } | null`.
- `src/screens/home/HomeBroadcastScreen.tsx` — delete `Alert.alert`
  block, introduce `mode` state (fresh / resume / now-playing), swap
  `StampButton` label/sub, hide the catalog rows in non-fresh modes,
  filter the resumable entry out of "Earlier Tonight".

### Test

- `__tests__/services/Storage.test.ts` — update existing
  `setPersistedBroadcast` call sites, add cursor + migration tests.
- `__tests__/engines/BroadcastResumer.test.ts` — update return-shape
  expectations, add freshness + legacy-migration tests.
- `__tests__/engines/BroadcastPlayer.test.ts` — add cursor-write
  assertions and `resume` tests (including adjacent-track and
  out-of-bounds paths).

### Do not touch

- Server code — zero server changes. `GET /broadcast/:id/manifest`
  already returns the current slot state.
- `BroadcastPlayer.types.ts` — cursor lives in storage shape, not player
  types.

---

## Task 1: New `PersistedBroadcast` type + setter/getter shape change

**Files:**
- Modify: `src/services/Storage.ts`

- [ ] **Step 1.1: Write failing tests for new shape**

Open `__tests__/services/Storage.test.ts`. In the `describe('broadcast
storage', …)` block, replace the existing manifest-only tests with the
new shape. Full replacement:

```ts
describe('broadcast storage', () => {
  it('stores and retrieves a persisted broadcast record', () => {
    setPersistedBroadcast({
      manifest: makeManifest('b1'),
      trackCursor: -1,
      updatedAt: Date.now(),
    });
    const rec = getPersistedBroadcast();
    expect(rec?.manifest.broadcastId).toBe('b1');
    expect(rec?.trackCursor).toBe(-1);
    expect(typeof rec?.updatedAt).toBe('number');
  });

  it('returns undefined when no broadcast is persisted', () => {
    expect(getPersistedBroadcast()).toBeUndefined();
  });

  it('clears the persisted broadcast', () => {
    setPersistedBroadcast({
      manifest: makeManifest('b2'),
      trackCursor: 0,
      updatedAt: Date.now(),
    });
    clearPersistedBroadcast();
    expect(getPersistedBroadcast()).toBeUndefined();
  });
});
```

Also update the `clearUserData` test (around line 79-90) to use the new
shape:

```ts
  it('clears playlist cache and persisted broadcast but preserves USER', () => {
    const user = makeUser({ name: 'Kari' });
    setUser(user);
    setCachedPlaylists([makePlaylist('p1')]);
    setPersistedBroadcast({
      manifest: {
        broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
        vibe: 'morning', length: 'quick', createdAt: Date.now(),
        tracks: [], segmentSlots: [],
      },
      trackCursor: -1,
      updatedAt: Date.now(),
    });

    clearUserData();

    expect(getUser()).toEqual(user);
    expect(getCachedPlaylists()).toBeUndefined();
    expect(getPersistedBroadcast()).toBeUndefined();
  });
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx jest __tests__/services/Storage.test.ts --no-coverage`
Expected: type / shape errors or runtime failures — the new tests
reference a shape `setPersistedBroadcast` does not yet accept.

- [ ] **Step 1.3: Update `Storage.ts` with the new type and signatures**

In `src/services/Storage.ts`, around the broadcast-persistence block,
replace the existing `setPersistedBroadcast` / `getPersistedBroadcast`
definitions with:

```ts
export interface PersistedBroadcast {
  manifest: Manifest;
  /** -1 = no track started yet; 0..N-1 = last track the player entered. */
  trackCursor: number;
  /** ms since epoch — debugging / future freshness heuristics. */
  updatedAt: number;
}

function isPersistedBroadcast(v: unknown): v is PersistedBroadcast {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.manifest === 'object' && o.manifest !== null &&
    typeof o.trackCursor === 'number' &&
    typeof o.updatedAt === 'number'
  );
}

/** Persisted broadcast cursor — used for mid-session resume within the
 *  in-memory 2h TTL on the server. Cleared on session end. */
export function setPersistedBroadcast(rec: PersistedBroadcast): void {
  setObject(StorageKeys.CURRENT_BROADCAST, rec);
}

/** Returns the persisted record, or undefined if missing / corrupt /
 *  legacy shape. Clears the MMKV key on shape mismatch so the user
 *  doesn't see a stale "resume" offer after an upgrade. */
export function getPersistedBroadcast(): PersistedBroadcast | undefined {
  const raw = getObject<unknown>(StorageKeys.CURRENT_BROADCAST);
  if (raw === undefined) return undefined;
  if (!isPersistedBroadcast(raw)) {
    console.warn('[Storage] persisted broadcast has legacy/corrupt shape, clearing');
    clearPersistedBroadcast();
    return undefined;
  }
  return raw;
}

export function clearPersistedBroadcast(): void {
  storage.remove(StorageKeys.CURRENT_BROADCAST);
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx jest __tests__/services/Storage.test.ts --no-coverage`
Expected: all Storage tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/services/Storage.ts __tests__/services/Storage.test.ts
git commit -m "feat(storage): PersistedBroadcast type with trackCursor"
```

---

## Task 2: `updatePersistedCursor` helper

**Files:**
- Modify: `src/services/Storage.ts`
- Test: `__tests__/services/Storage.test.ts`

- [ ] **Step 2.1: Write failing cursor-update tests**

Add to `__tests__/services/Storage.test.ts`, inside or just after the
`describe('broadcast storage', …)` block:

```ts
describe('updatePersistedCursor', () => {
  it('overwrites only the trackCursor while preserving manifest + updatedAt', () => {
    const originalUpdatedAt = 1000;
    setPersistedBroadcast({
      manifest: makeManifest('b1'),
      trackCursor: -1,
      updatedAt: originalUpdatedAt,
    });

    updatePersistedCursor(3);

    const rec = getPersistedBroadcast();
    expect(rec?.manifest.broadcastId).toBe('b1');
    expect(rec?.trackCursor).toBe(3);
    expect(rec?.updatedAt).toBe(originalUpdatedAt);
  });

  it('is a no-op when no broadcast is persisted', () => {
    expect(() => updatePersistedCursor(0)).not.toThrow();
    expect(getPersistedBroadcast()).toBeUndefined();
  });
});
```

Add `updatePersistedCursor` to the import list at the top of the file:

```ts
import {
  getUser,
  setUser,
  getCachedPlaylists,
  setCachedPlaylists,
  clearUserData,
  setPersistedBroadcast,
  getPersistedBroadcast,
  clearPersistedBroadcast,
  updatePersistedCursor,
  addBroadcastToHistory,
  getBroadcastHistory,
  BROADCAST_HISTORY_RETENTION_MS,
  BROADCAST_HISTORY_MAX_ENTRIES,
  type UserData,
} from '../../src/services/Storage';
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx jest __tests__/services/Storage.test.ts -t updatePersistedCursor --no-coverage`
Expected: FAIL — `updatePersistedCursor` is not exported.

- [ ] **Step 2.3: Implement `updatePersistedCursor`**

In `src/services/Storage.ts`, add immediately after `clearPersistedBroadcast`:

```ts
/** Read-modify-write: updates only the cursor, preserves manifest and
 *  updatedAt. No-op when no record exists — defensive, should not be
 *  called before setPersistedBroadcast has seeded the record. */
export function updatePersistedCursor(trackIndex: number): void {
  const rec = getPersistedBroadcast();
  if (!rec) return;
  setPersistedBroadcast({ ...rec, trackCursor: trackIndex });
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx jest __tests__/services/Storage.test.ts -t updatePersistedCursor --no-coverage`
Expected: both new tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/services/Storage.ts __tests__/services/Storage.test.ts
git commit -m "feat(storage): updatePersistedCursor for track-boundary writes"
```

---

## Task 3: Legacy-shape migration test

**Files:**
- Test: `__tests__/services/Storage.test.ts`
- (No code change — this only verifies the migration guard added in Task 1.)

- [ ] **Step 3.1: Write failing migration test**

Add to `__tests__/services/Storage.test.ts` inside the
`describe('broadcast storage', …)` block:

```ts
  it('returns undefined and clears MMKV when legacy raw-Manifest shape is stored', () => {
    // Simulate an install-upgrade where the old shape is still on disk.
    // Write the raw manifest directly under CURRENT_BROADCAST via the
    // low-level JSON helper — bypassing setPersistedBroadcast, which now
    // enforces the new shape.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setObject, StorageKeys } = require('../../src/services/Storage');
    setObject(StorageKeys.CURRENT_BROADCAST, makeManifest('legacy'));

    const result = getPersistedBroadcast();
    expect(result).toBeUndefined();
    // MMKV key should have been wiped as a side effect.
    expect(getPersistedBroadcast()).toBeUndefined();
  });
```

For that test to compile, `setObject` and `StorageKeys` need to be
exported from `src/services/Storage.ts`. Check whether they already are;
if not, adjust the existing declarations:

- `StorageKeys` is already exported (line 7 of the current file).
- `setObject` is declared `export function setObject`, already exported.

If both are already exported, no code change needed for this test.

- [ ] **Step 3.2: Run the test to verify it passes**

(This test exercises the migration guard added in Task 1's
`isPersistedBroadcast` check, so it should pass without further code
changes.)

Run: `npx jest __tests__/services/Storage.test.ts -t "legacy" --no-coverage`
Expected: PASS.

- [ ] **Step 3.3: Commit**

```bash
git add __tests__/services/Storage.test.ts
git commit -m "test(storage): verify legacy raw-Manifest shape is migrated"
```

---

## Task 4: `BroadcastPlayer` writes cursor at the top of `runTrackAt`

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts`
- Test: `__tests__/engines/BroadcastPlayer.test.ts`

- [ ] **Step 4.1: Write failing cursor-write test**

Append to `__tests__/engines/BroadcastPlayer.test.ts`, inside the
existing outer `describe('BroadcastPlayer', …)` block, below the
`describe('sparse segments', …)` block:

```ts
  describe('cursor persistence', () => {
    // We read back the persisted record via MMKV (mocked).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getPersistedBroadcast } = require('../../src/services/Storage');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { __resetAllStores } = require('../../__mocks__/react-native-mmkv');

    beforeEach(() => { __resetAllStores(); });

    it('seeds trackCursor=-1 at start() and advances to N as runTrackAt(N) fires', async () => {
      const deps = makeDeps();
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const manifest: Manifest = {
        broadcastId: 'bC', userId: 'u1', playlistId: 'p1',
        vibe: 'morning', length: 'quick', createdAt: Date.now(),
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: '', duration: 1 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: '', duration: 1 },
        ],
        segmentSlots: [
          { index: 0, kind: 'cold_open', beforeTrackId: 't0',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg0-v0.mp3'] },
          { index: 1, kind: 'sign_off', afterTrackId: 't1',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg1-v0.mp3'] },
        ],
      };

      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(manifest, ['https://cdn/seg0-v0.mp3']);

      // Immediately after start(), record is seeded with cursor -1.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(getPersistedBroadcast()?.trackCursor).toBe(-1);

      // Drive t0 to completion.
      for (let i = 0; i < 80; i++) await Promise.resolve();
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      for (let i = 0; i < 80; i++) await Promise.resolve();
      // Cursor should now be at 1 (runTrackAt(1) entered).
      expect(getPersistedBroadcast()?.trackCursor).toBe(1);

      // Drive t1 to completion; after sign_off the record should be cleared.
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      for (let i = 0; i < 80; i++) await Promise.resolve();
      expect(getPersistedBroadcast()).toBeUndefined();

      await player.end();
    });
  });
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "cursor persistence" --no-coverage`
Expected: FAIL — `trackCursor` never advances past -1 because the cursor
write hook doesn't exist yet.

- [ ] **Step 4.3: Update `start()` to seed the new record shape**

Open `src/engines/BroadcastPlayer.ts`. The `start` method currently
calls `setPersistedBroadcast(manifest)` around line 94. Update the
import list at the top of the file:

```ts
import {
  setPersistedBroadcast, clearPersistedBroadcast, addBroadcastToHistory,
  updatePersistedCursor,
} from '../services/Storage';
```

Replace the existing `setPersistedBroadcast(manifest);` call in `start`
with:

```ts
    setPersistedBroadcast({
      manifest,
      trackCursor: -1,
      updatedAt: Date.now(),
    });
```

- [ ] **Step 4.4: Add the cursor write in `runTrackAt`**

`runTrackAt` currently begins:

```ts
  private async runTrackAt(trackIndex: number): Promise<void> {
    if (!this.manifest) return;
    const track = this.manifest.tracks[trackIndex];
    this.currentTrackIndex = trackIndex;
    ...
```

Insert `updatePersistedCursor(trackIndex);` immediately after the
`this.currentTrackIndex = trackIndex;` line. The full prefix becomes:

```ts
  private async runTrackAt(trackIndex: number): Promise<void> {
    if (!this.manifest) return;
    const track = this.manifest.tracks[trackIndex];
    this.currentTrackIndex = trackIndex;
    updatePersistedCursor(trackIndex);
    this.state = 'playing_track';
```

- [ ] **Step 4.5: Run tests to verify they pass**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts --no-coverage`
Expected: all existing tests still pass, plus the new cursor-persistence
test.

- [ ] **Step 4.6: Commit**

```bash
git add src/engines/BroadcastPlayer.ts __tests__/engines/BroadcastPlayer.test.ts
git commit -m "feat(player): persist track cursor at runTrackAt boundary"
```

---

## Task 5: Extract `initPlayback` helper + add `resume` method

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts`

This task is a refactor that separates the shared setup from the
playback branching in `start()`, so `resume()` can reuse it. No new
tests in this task — existing tests must continue to pass. Tests for
`resume` come in Task 6.

- [ ] **Step 5.1: Extract shared setup into `initPlayback`**

The current `start(manifest, firstSegmentUrls)` body (lines ~92-172 in
`src/engines/BroadcastPlayer.ts`) runs:

1. manifest/persistence/history seeding + cache clear + state='loading'
2. `setBroadcastActive(true)`
3. `preloadStingers`
4. Fetch slot 0 variants into cache
5. `kickBackgroundFetch` + `schedulePolling`
6. subscribe to music events
7. `runSegmentAt(0)` for cold_open
8. Main loop over tracks
9. Final `music.pause()`, `state='ended'`, `clearPersistedBroadcast()`

Refactor the body so that steps 1-6 are in a new private helper
`initPlayback`, steps 7-8 stay inline in `start` and the new `resume`,
and step 9 stays in a shared tail. Concrete plan:

Replace the existing `start` method with the following two methods +
one shared helper. Keep all other methods untouched:

```ts
  async start(manifest: Manifest, firstSegmentUrls: string[]): Promise<void> {
    await this.initPlayback(manifest, { resumeFromIndex: -1, firstSegmentUrls });
    if (!this.manifest) return;

    // Fresh start: play cold_open (slot 0), then enter the main loop at track 0.
    await this.runSegmentAt(0);
    if (!this.manifest) return;
    await this.waitIfPaused();
    if (!this.manifest) return;

    await this.runMainLoop(0, 1);
  }

  async resume(manifest: Manifest, trackCursor: number): Promise<void> {
    // Out-of-bounds cursor — nothing meaningful to resume into. Clear and bail.
    if (trackCursor >= manifest.tracks.length) {
      console.warn(`[BroadcastPlayer] resume called with cursor ${trackCursor} >= tracks.length ${manifest.tracks.length}; clearing`);
      clearPersistedBroadcast();
      return;
    }

    await this.initPlayback(manifest, { resumeFromIndex: trackCursor });
    if (!this.manifest) return;

    if (trackCursor < 0) {
      // Never reached a track — behave exactly like a fresh start.
      await this.runSegmentAt(0);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      await this.runMainLoop(0, 1);
      return;
    }

    // Find the transition segment that introduces tracks[trackCursor], if any.
    const resumeTrack = manifest.tracks[trackCursor];
    const introSlotIdx = manifest.segmentSlots.findIndex(
      s => s.beforeTrackId === resumeTrack.id && s.kind !== 'cold_open',
    );

    if (introSlotIdx >= 0) {
      // Ensure the intro segment audio is cached, then play it.
      const slot = manifest.segmentSlots[introSlotIdx];
      if (slot.status === 'ready' && slot.audioUrls) {
        for (let v = 0; v < slot.audioUrls.length; v++) {
          try {
            const b64 = await this.manifestClient.fetchSegmentAudio(slot.audioUrls[v]);
            this.cache.put(introSlotIdx, v, b64);
          } catch { /* one variant failure is not fatal */ }
        }
      }
      await this.runSegmentAt(introSlotIdx);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      await this.runMainLoop(trackCursor, introSlotIdx + 1);
    } else {
      // No preceding segment — start directly at the track.
      const nextSegmentIdx = this.computeNextSegmentIdxAfter(trackCursor, manifest);
      await this.runMainLoop(trackCursor, nextSegmentIdx);
    }
  }

  /** Shared prelude: manifest + persistence + history + cache clear +
   *  stingers + background fetch + polling + music subscriptions. After
   *  this runs, the player is ready for the first `runSegmentAt` or
   *  `runTrackAt` call. */
  private async initPlayback(
    manifest: Manifest,
    opts: { resumeFromIndex: number; firstSegmentUrls?: string[] },
  ): Promise<void> {
    this.manifest = manifest;
    setPersistedBroadcast({
      manifest,
      trackCursor: opts.resumeFromIndex,
      updatedAt: Date.now(),
    });
    addBroadcastToHistory(manifest, opts.firstSegmentUrls ?? this.inferFirstSegmentUrls(manifest));
    this.cache.clear();
    this.state = 'loading';
    if (this.native.setBroadcastActive) {
      await this.native.setBroadcastActive(true).catch(() => {});
    }
    await this.stingers.preloadStingers();

    // Prime slot 0's variants only on a fresh start — on resume we
    // either skip cold_open entirely or load the intro slot on demand.
    if (opts.resumeFromIndex < 0 && opts.firstSegmentUrls) {
      for (let v = 0; v < opts.firstSegmentUrls.length; v++) {
        try {
          const b64 = await this.manifestClient.fetchSegmentAudio(opts.firstSegmentUrls[v]);
          this.cache.put(0, v, b64);
        } catch { /* one variant failure is not fatal */ }
      }
    }

    this.kickBackgroundFetch();
    this.schedulePolling();

    this.subscriptions.push(
      this.music.onPlaybackStateChanged(this.handlePlaybackState),
      this.music.onTrackChanged(this.handleTrackChanged),
    );
  }

  /** Shared main loop + natural end-of-broadcast teardown. Walks tracks
   *  in order starting at `startTrack`, firing the dual-cursor
   *  `beforeTrackId` check against `nextSegmentIdx` to decide whether to
   *  play a transition between consecutive tracks. */
  private async runMainLoop(startTrack: number, startSegIdx: number): Promise<void> {
    if (!this.manifest) return;
    let nextSegmentIdx = startSegIdx;
    for (let i = startTrack; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;

      const slots = this.manifest.segmentSlots;
      const nextTrack = this.manifest.tracks[i + 1];
      const nextSlot = slots[nextSegmentIdx];

      if (!nextTrack) {
        if (nextSlot && nextSlot.kind === 'sign_off') {
          await this.runSegmentAt(nextSegmentIdx);
          if (!this.manifest) return;
          await this.waitIfPaused();
          if (!this.manifest) return;
        }
        break;
      }

      if (nextSlot && nextSlot.beforeTrackId === nextTrack.id) {
        await this.runSegmentAt(nextSegmentIdx);
        if (!this.manifest) return;
        await this.waitIfPaused();
        if (!this.manifest) return;
        nextSegmentIdx += 1;
      }
    }
    await this.music.pause().catch(() => {});
    this.state = 'ended';
    clearPersistedBroadcast();
  }

  /** Resume fallback: no segment precedes `startTrack`, so we need to
   *  find the earliest slot index we'd still need to run. That's the
   *  lowest i where segmentSlots[i].beforeTrackId maps to a track at
   *  position > startTrack, or where kind === 'sign_off'. Returns
   *  segmentSlots.length as a defensive fallback (nothing left to
   *  play). */
  private computeNextSegmentIdxAfter(startTrack: number, manifest: Manifest): number {
    const trackIndexById = new Map(
      manifest.tracks.map((t, idx) => [t.id, idx]),
    );
    for (let i = 0; i < manifest.segmentSlots.length; i++) {
      const slot = manifest.segmentSlots[i];
      if (slot.kind === 'sign_off') return i;
      if (slot.beforeTrackId) {
        const tIdx = trackIndexById.get(slot.beforeTrackId);
        if (tIdx !== undefined && tIdx > startTrack) return i;
      }
    }
    return manifest.segmentSlots.length;
  }

  /** When resuming, we don't have firstSegmentUrls handy from the
   *  server response — infer them from the manifest's slot 0 so history
   *  still gets a useful record. Returns [] if slot 0 isn't ready. */
  private inferFirstSegmentUrls(manifest: Manifest): string[] {
    const slot0 = manifest.segmentSlots[0];
    if (slot0?.status === 'ready' && slot0.audioUrls) return slot0.audioUrls;
    return [];
  }
```

Also delete the now-duplicated body of the original `start()` method —
the refactor above replaces it in full. After the refactor, the only
things in `BroadcastPlayer` that touch the main playback flow are
`start`, `resume`, `initPlayback`, `runMainLoop`,
`computeNextSegmentIdxAfter`, `inferFirstSegmentUrls`, plus the existing
private helpers (`runSegmentAt`, `runTrackAt`, `pollManifestOnce`, etc).

- [ ] **Step 5.2: Run existing tests to verify the refactor is green**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts --no-coverage`
Expected: every existing test passes. If any fail, the refactor changed
observable behavior — check the diff.

- [ ] **Step 5.3: Commit**

```bash
git add src/engines/BroadcastPlayer.ts
git commit -m "refactor(player): extract initPlayback + runMainLoop for resume reuse"
```

---

## Task 6: `resume()` tests — cursor -1, cursor on transition-preceded track, cursor on adjacent track, out-of-bounds

**Files:**
- Test: `__tests__/engines/BroadcastPlayer.test.ts`

- [ ] **Step 6.1: Write failing resume tests**

Append a new `describe('resume', …)` block inside the outer
`describe('BroadcastPlayer', …)` block in
`__tests__/engines/BroadcastPlayer.test.ts`:

```ts
  describe('resume', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { __resetAllStores } = require('../../__mocks__/react-native-mmkv');

    beforeEach(() => { __resetAllStores(); });

    // 5-track sparse manifest: cold_open → t0 → t1 → trans(before t2) → t2 → t3 → trans(before t4) → t4 → sign_off
    const make5Manifest = (): Manifest => ({
      broadcastId: 'bR', userId: 'u1', playlistId: 'p1',
      vibe: 'lateNight', length: 'quick', createdAt: Date.now(),
      tracks: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`, title: `T${i}`, artistName: 'A', albumTitle: '', duration: 1,
      })),
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg0-v0.mp3'] },
        { index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg1-v0.mp3'] },
        { index: 2, kind: 'transition', afterTrackId: 't3', beforeTrackId: 't4',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg2-v0.mp3'] },
        { index: 3, kind: 'sign_off', afterTrackId: 't4',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg3-v0.mp3'] },
      ],
    });

    const makeDriver = () => {
      const deps = makeDeps();
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const driveTrackEnd = async () => {
        for (let i = 0; i < 80; i++) await Promise.resolve();
        deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
        deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      };
      return { deps, music, driveTrackEnd };
    };

    it('cursor === -1 behaves identically to start (plays cold_open then all 5 tracks)', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), -1);
      for (let t = 0; t < 5; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'tts:BASE64_seg0-v0.m',
        'play:t0',
        'play:t1',
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      await player.end();
    });

    it('cursor=2 (transition precedes t2) replays seg1 then plays t2 onward — cold_open NOT replayed', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), 2);
      // Remaining flow: seg1 → t2 → t3 → seg2 → t4 → seg3
      for (let t = 0; t < 3; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      expect(order).not.toContain('tts:BASE64_seg0-v0.m');
      expect(order).not.toContain('play:t0');
      expect(order).not.toContain('play:t1');

      await player.end();
    });

    it('cursor=3 (no transition precedes t3) starts at t3 without any intro segment', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), 3);
      // Remaining flow: t3 → seg2 → t4 → seg3
      for (let t = 0; t < 2; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      await player.end();
    });

    it('cursor=1 (no transition precedes t1) starts at t1 — nextSegmentIdx skips past the cold_open slot', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), 1);
      // Remaining: t1 → seg1 → t2 → t3 → seg2 → t4 → seg3
      for (let t = 0; t < 4; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'play:t1',
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      await player.end();
    });

    it('cursor out of bounds clears persistence and does nothing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { setPersistedBroadcast, getPersistedBroadcast } =
        require('../../src/services/Storage');
      const manifest = make5Manifest();
      setPersistedBroadcast({ manifest, trackCursor: 99, updatedAt: Date.now() });

      const { deps, music } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      await player.resume(manifest, 99);

      expect(getPersistedBroadcast()).toBeUndefined();
      expect(player.getStatus().state).toBe('idle');
      expect(deps.logs.some(l => l.startsWith('play:'))).toBe(false);
    });
  });
```

- [ ] **Step 6.2: Run tests to verify they pass**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t resume --no-coverage`
Expected: all five resume tests pass. The `resume()` method introduced
in Task 5 should satisfy them directly; if any fail, check the
`computeNextSegmentIdxAfter` fallback in particular for cursor=1 and
cursor=3.

- [ ] **Step 6.3: Run the full player test suite to confirm no regressions**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts --no-coverage`
Expected: all tests pass.

- [ ] **Step 6.4: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.test.ts
git commit -m "test(player): resume() cursor branches and out-of-bounds guard"
```

---

## Task 7: `BroadcastResumer` returns `{ manifest: fresh, trackCursor }`

**Files:**
- Modify: `src/engines/BroadcastResumer.ts`

- [ ] **Step 7.1: Update `BroadcastResumer.ts`**

Replace the full contents of `src/engines/BroadcastResumer.ts` with:

```ts
import { getPersistedBroadcast, clearPersistedBroadcast } from '../services/Storage';
import type { Manifest } from './BroadcastPlayer.types';
import { BroadcastManifestClient } from './BroadcastManifestClient';

const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface ResumeCheckResult {
  /** Freshest manifest from the server — slots may have flipped
   *  pending→ready since the manifest was persisted. Always prefer
   *  this over the locally persisted one. */
  manifest: Manifest;
  trackCursor: number;
}

export class BroadcastResumer {
  private readonly client: Pick<BroadcastManifestClient, 'fetchManifest'>;

  constructor(client?: Pick<BroadcastManifestClient, 'fetchManifest'>) {
    this.client = client ?? new BroadcastManifestClient();
  }

  /** Returns { fresh manifest, cursor } when: the local resume window
   *  is alive AND the server still has the broadcast (non-404). Returns
   *  null otherwise. Network / 5xx errors keep the persisted record
   *  intact and return the persisted manifest optimistically so flaky
   *  connections don't destroy a legit resume. */
  async check(): Promise<ResumeCheckResult | null> {
    const rec = getPersistedBroadcast();
    if (!rec) return null;
    if (Date.now() - rec.manifest.createdAt > RESUME_WINDOW_MS) {
      clearPersistedBroadcast();
      return null;
    }
    try {
      const fresh = await this.client.fetchManifest(rec.manifest.broadcastId);
      return { manifest: fresh, trackCursor: rec.trackCursor };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404')) {
        clearPersistedBroadcast();
        return null;
      }
      // Transient — fall back to the persisted manifest so the user
      // still gets a resume card. The player will surface any real
      // failure on tap.
      console.warn('[BroadcastResumer] manifest verify failed (keeping cached):', msg);
      return { manifest: rec.manifest, trackCursor: rec.trackCursor };
    }
  }

  async decline(): Promise<void> {
    clearPersistedBroadcast();
  }
}
```

- [ ] **Step 7.2: Run existing resumer tests to see them fail**

Run: `npx jest __tests__/engines/BroadcastResumer.test.ts --no-coverage`
Expected: FAIL — the existing tests call `expect((await resumer.check())?.broadcastId)`,
but `check` now returns `{ manifest, trackCursor }`, not a raw
manifest.

- [ ] **Step 7.3: Commit the resumer change (tests updated in Task 8)**

```bash
git add src/engines/BroadcastResumer.ts
git commit -m "refactor(resumer): return { manifest: fresh, trackCursor } from check()"
```

---

## Task 8: Update `BroadcastResumer` tests for new shape + freshness

**Files:**
- Test: `__tests__/engines/BroadcastResumer.test.ts`

- [ ] **Step 8.1: Replace the test file**

Replace the full contents of `__tests__/engines/BroadcastResumer.test.ts`
with:

```ts
import { BroadcastResumer } from '../../src/engines/BroadcastResumer';
import * as Storage from '../../src/services/Storage';
import type { Manifest } from '../../src/engines/BroadcastPlayer.types';
import type { PersistedBroadcast } from '../../src/services/Storage';

jest.mock('../../src/services/Storage');
// Stub BroadcastManifestClient so importing BroadcastResumer doesn't
// transitively pull in Firebase (not worth transforming for unit tests).
jest.mock('../../src/engines/BroadcastManifestClient', () => ({
  BroadcastManifestClient: jest.fn().mockImplementation(() => ({
    fetchManifest: jest.fn().mockResolvedValue(null),
  })),
}));

const ok = (m: Manifest) => ({ fetchManifest: jest.fn().mockResolvedValue(m) });
const notFound = () => ({ fetchManifest: jest.fn().mockRejectedValue(new Error('fetchManifest failed: 404 ')) });
const flaky = () => ({ fetchManifest: jest.fn().mockRejectedValue(new Error('Network request failed')) });

const baseManifest: Manifest = {
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [], segmentSlots: [],
};

const rec = (overrides: Partial<PersistedBroadcast> = {}): PersistedBroadcast => ({
  manifest: baseManifest,
  trackCursor: 2,
  updatedAt: Date.now(),
  ...overrides,
});

describe('BroadcastResumer', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns null when nothing is persisted', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(undefined);
    const resumer = new BroadcastResumer(ok(baseManifest));
    expect(await resumer.check()).toBeNull();
  });

  it('returns null and clears storage when persisted is older than 2h', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(
      rec({ manifest: { ...baseManifest, createdAt: Date.now() - (2 * 60 * 60 * 1000 + 1000) } }),
    );
    const resumer = new BroadcastResumer(ok(baseManifest));
    expect(await resumer.check()).toBeNull();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });

  it('returns { fresh manifest, cursor } when persisted is fresh and server still has it', async () => {
    const fresh = { ...baseManifest, createdAt: Date.now() - 60 * 1000 };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(rec({ manifest: fresh, trackCursor: 3 }));
    const resumer = new BroadcastResumer(ok(fresh));
    const result = await resumer.check();
    expect(result?.manifest.broadcastId).toBe('b1');
    expect(result?.trackCursor).toBe(3);
  });

  it('uses the server-fetched manifest, not the persisted one (slot updates)', async () => {
    const persisted: Manifest = {
      ...baseManifest, createdAt: Date.now() - 60 * 1000,
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'pending' },
      ],
    };
    const fresh: Manifest = {
      ...persisted,
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u'] },
      ],
    };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(rec({ manifest: persisted }));
    const resumer = new BroadcastResumer(ok(fresh));
    const result = await resumer.check();
    expect(result?.manifest.segmentSlots[0].status).toBe('ready');
  });

  it('clears persisted + returns null when server returns 404', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(
      rec({ manifest: { ...baseManifest, createdAt: Date.now() - 60 * 1000 } }),
    );
    const resumer = new BroadcastResumer(notFound());
    expect(await resumer.check()).toBeNull();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });

  it('falls back to persisted manifest when server fetch fails for non-404 reasons', async () => {
    const persisted = { ...baseManifest, createdAt: Date.now() - 60 * 1000 };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(rec({ manifest: persisted, trackCursor: 4 }));
    const resumer = new BroadcastResumer(flaky());
    const result = await resumer.check();
    expect(result?.manifest.broadcastId).toBe('b1');
    expect(result?.trackCursor).toBe(4);
    expect(Storage.clearPersistedBroadcast).not.toHaveBeenCalled();
  });

  it('decline() clears persisted state', async () => {
    const resumer = new BroadcastResumer(ok(baseManifest));
    await resumer.decline();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8.2: Run tests to verify they pass**

Run: `npx jest __tests__/engines/BroadcastResumer.test.ts --no-coverage`
Expected: all 7 tests pass.

- [ ] **Step 8.3: Commit**

```bash
git add __tests__/engines/BroadcastResumer.test.ts
git commit -m "test(resumer): new check() shape + server-freshness assertion"
```

---

## Task 9: Home screen — replace Alert with mode state

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 9.1: Introduce the mode type and effect**

Near the top of `src/screens/home/HomeBroadcastScreen.tsx`, below the
existing `LENGTH_LABEL` constant, add:

```ts
type HomeCtaMode =
  | { kind: 'fresh' }
  | { kind: 'resume'; manifest: Manifest; trackCursor: number }
  | { kind: 'now-playing'; manifest: Manifest; trackIndex: number };
```

Inside `HomeBroadcastScreen`, add mode state right after the existing
`const [broadcastActive, setBroadcastActive] = useState(false);` block:

```ts
  const [mode, setMode] = useState<HomeCtaMode>({ kind: 'fresh' });
```

Then replace the existing useEffect that calls
`new BroadcastResumer()` + `Alert.alert` (currently lines ~174-211)
with a combined mode-derivation effect:

```ts
  // Derive the primary-CTA mode from two signals:
  //  (a) is the BroadcastPlayer singleton currently active in memory, and
  //  (b) is there a resumable persisted record that passes freshness.
  // Alert.alert is gone — mode changes the StampButton copy instead.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const feats = await new BroadcastCurationClient().listFeatured();
        if (!mounted) return;
        setFeatured(feats);
      } catch (err) {
        console.warn('[HomeBroadcast] listFeatured failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
      await loadPlaylists();

      // If a broadcast is already active in memory, show Now Playing and
      // skip the resume check — the persisted record is still there but
      // the live player is authoritative.
      const status = broadcastPlayer.getStatus();
      if (ACTIVE_STATES.has(status.state) && status.broadcastId) {
        // The status has the bare ids, not the full manifest. Ask the
        // manifest client once so we can render the playlist label +
        // track count. Fire-and-forget; if it fails we fall through to
        // fresh mode.
        try {
          const m = await new BroadcastManifestClient().fetchManifest(status.broadcastId);
          if (!mounted) return;
          setMode({
            kind: 'now-playing',
            manifest: m,
            trackIndex: Math.max(0, status.currentTrackIndex),
          });
          return;
        } catch (err) {
          console.warn('[HomeBroadcast] live-manifest fetch failed', err);
        }
      }

      try {
        const resumer = new BroadcastResumer();
        const result = await resumer.check();
        if (!mounted) return;
        if (result) {
          setMode({
            kind: 'resume',
            manifest: result.manifest,
            trackCursor: result.trackCursor,
          });
        }
      } catch (err) {
        console.warn('[HomeBroadcast] resumer.check failed', err);
      }
    })();
    return () => { mounted = false; };
  }, [loadPlaylists]);
```

Also update the `broadcastActive` poll to refresh the mode when the
player transitions between idle and active during the session. The
current effect around line 122:

```ts
  useEffect(() => {
    if (!appActive) return;
    const tick = () => setBroadcastActive(ACTIVE_STATES.has(broadcastPlayer.getStatus().state));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [appActive]);
```

Replace with:

```ts
  useEffect(() => {
    if (!appActive) return;
    const tick = () => {
      const status = broadcastPlayer.getStatus();
      const active = ACTIVE_STATES.has(status.state);
      setBroadcastActive(active);
      // Keep mode.now-playing track index in sync with the live player.
      setMode(prev => {
        if (prev.kind !== 'now-playing') return prev;
        if (!active) return { kind: 'fresh' };
        if (status.currentTrackIndex === prev.trackIndex) return prev;
        return { ...prev, trackIndex: Math.max(0, status.currentTrackIndex) };
      });
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [appActive]);
```

- [ ] **Step 9.2: Wire the resume tap and the start-fresh decline**

Add two `useCallback`s near the other callbacks in the component:

```ts
  const onResume = useCallback(() => {
    if (mode.kind !== 'resume') return;
    const { manifest: m, trackCursor } = mode;
    router.push('/(main)/(broadcast)/player');
    broadcastPlayer.resume(m, trackCursor).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    });
  }, [mode, router]);

  const onStartFresh = useCallback(() => {
    clearPersistedBroadcast();
    setMode({ kind: 'fresh' });
  }, []);

  const onOpenNowPlaying = useCallback(() => {
    router.push('/(main)/(broadcast)/player');
  }, [router]);
```

`clearPersistedBroadcast` needs to be added to the existing Storage
import block:

```ts
import {
  getBroadcastHistory,
  getCachedPlaylists,
  removeBroadcastFromHistory,
  clearPersistedBroadcast,
  type BroadcastHistoryEntry,
} from '../../services/Storage';
```

- [ ] **Step 9.3: Run type check to verify everything compiles**

Run: `npx tsc --noEmit`
Expected: no type errors relating to `mode`, `onResume`, or the mode
effect. (Unrelated project-wide errors not caused by this task are OK.)

- [ ] **Step 9.4: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx
git commit -m "feat(home): tri-state CTA mode state replaces resume Alert"
```

---

## Task 10: Home screen — tri-state rendering

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 10.1: Swap the ROLL YOUR OWN block + StampButton based on mode**

Find the "Roll your own" JSX block in
`src/screens/home/HomeBroadcastScreen.tsx` (currently around lines
~388-421, starting at `<SectionMarker num="B·01" title="ROLL YOUR OWN"`
and ending after the `<StampButton label="BEGIN BROADCAST" …>` block).

Replace that entire block with:

```tsx
        {mode.kind === 'resume' && (
          <>
            <SectionMarker num="B·01" title="RESUME TONIGHT" side="PICK UP WHERE YOU LEFT" />
            <View style={{ marginTop: 4 }}>
              <CatalogRow
                label="FROM"
                placeholder=""
                value={
                  playlists.find(p => p.id === mode.manifest.playlistId)?.name?.toUpperCase()
                  ?? `${VIBE_LABEL[mode.manifest.vibe]} · ${mode.manifest.tracks.length} TRACKS`
                }
                onPress={onResume}
              />
              <CatalogRow
                label="VIBE"
                placeholder=""
                value={VIBE_LABEL[mode.manifest.vibe]}
                onPress={onResume}
              />
              <CatalogRow
                label="TRACK"
                placeholder=""
                value={`${Math.max(0, mode.trackCursor) + 1} OF ${mode.manifest.tracks.length}`}
                onPress={onResume}
              />
            </View>

            <View style={{ height: Space.s22 }} />
            <StampButton
              label="RESUME"
              sub={`TRACK ${Math.max(0, mode.trackCursor) + 1} OF ${mode.manifest.tracks.length}`}
              onPress={onResume}
              accessibilityHint="Resume the broadcast where you left off"
            />
            <Pressable
              onPress={onStartFresh}
              accessibilityRole="button"
              accessibilityLabel="Start a fresh broadcast"
              style={({ pressed }) => [styles.startFresh, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.startFreshText}>START FRESH</Text>
            </Pressable>
          </>
        )}

        {mode.kind === 'now-playing' && (
          <>
            <SectionMarker num="B·01" title="NOW PLAYING" side="ON AIR" />
            <View style={{ marginTop: 4 }}>
              <CatalogRow
                label="FROM"
                placeholder=""
                value={
                  playlists.find(p => p.id === mode.manifest.playlistId)?.name?.toUpperCase()
                  ?? `${VIBE_LABEL[mode.manifest.vibe]} · ${mode.manifest.tracks.length} TRACKS`
                }
                onPress={onOpenNowPlaying}
              />
              <CatalogRow
                label="VIBE"
                placeholder=""
                value={VIBE_LABEL[mode.manifest.vibe]}
                onPress={onOpenNowPlaying}
              />
              <CatalogRow
                label="TRACK"
                placeholder=""
                value={`${Math.max(0, mode.trackIndex) + 1} OF ${mode.manifest.tracks.length}`}
                onPress={onOpenNowPlaying}
              />
            </View>

            <View style={{ height: Space.s22 }} />
            <StampButton
              label="OPEN PLAYER"
              sub={`TRACK ${Math.max(0, mode.trackIndex) + 1} OF ${mode.manifest.tracks.length}`}
              onPress={onOpenNowPlaying}
              accessibilityHint="Opens the Now Playing screen"
            />
          </>
        )}

        {mode.kind === 'fresh' && (
          <>
            <SectionMarker num="B·01" title="ROLL YOUR OWN" side="FROM YOUR LIBRARY" />
            <View style={{ marginTop: 4 }}>
              <CatalogRow
                label="FROM"
                placeholder="pick a playlist"
                value={playlistName}
                onPress={() => openSheetAt(0)}
              />
              <CatalogRow
                label="VIBE"
                placeholder="pick a vibe"
                value={vibe ? VIBE_LABEL[vibe] : null}
                onPress={() => openSheetAt(1)}
              />
              <CatalogRow
                label="LENGTH"
                placeholder="pick a length"
                value={length ? LENGTH_LABEL[length] : null}
                onPress={() => openSheetAt(2)}
              />
            </View>

            <View style={{ height: Space.s22 }} />
            <StampButton
              label="BEGIN BROADCAST"
              sub="NO SKIPS · SIT WITH IT"
              onPress={onBegin}
              accessibilityHint={
                playlistId && vibe && length
                  ? 'Starts your broadcast'
                  : 'Opens the setup sheet to finish choosing'
              }
            />
          </>
        )}
```

- [ ] **Step 10.2: Add the START FRESH link styles**

In the `StyleSheet.create` block at the bottom of the file, add two new
entries alongside the existing styles (place them near the `colophon`
entry):

```ts
  startFresh: {
    marginTop: 8,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  startFreshText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 2.5,
    color: AM.amber,
    opacity: 0.6,
  },
```

`Fonts` and `TypeScale` are already imported at the top of the file.
`AM` is too.

- [ ] **Step 10.3: Verify the screen still type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10.4: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx
git commit -m "feat(home): tri-state primary CTA rendering"
```

---

## Task 11: Filter the resumable broadcast out of "Earlier Tonight"

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 11.1: Compute the visible history**

In `src/screens/home/HomeBroadcastScreen.tsx`, just before the
`return (<BroadcastBackdrop>…</BroadcastBackdrop>)` JSX, add:

```ts
  // Hide the resumable broadcast from "Earlier Tonight" — it's already
  // surfaced at the top as the Resume CTA, so showing it twice is
  // confusing.
  const hiddenBroadcastId =
    mode.kind === 'resume' ? mode.manifest.broadcastId
    : mode.kind === 'now-playing' ? mode.manifest.broadcastId
    : null;
  const visibleRecent = hiddenBroadcastId
    ? recent.filter(e => e.manifest.broadcastId !== hiddenBroadcastId)
    : recent;
```

- [ ] **Step 11.2: Render `visibleRecent` instead of `recent`**

Find the "Earlier tonight" block (currently around lines ~438-460)
starting with `{recent.length > 0 && (` and change both references to
`recent` → `visibleRecent`:

```tsx
        {visibleRecent.length > 0 && (
          <>
            <SectionMarker num="B·03" title="EARLIER TONIGHT" side="24 HOURS" />
            {visibleRecent.map((entry, i) => (
              <Pressable
                key={entry.manifest.broadcastId}
                onPress={() => playRecent(entry)}
                accessibilityRole="button"
                accessibilityLabel={`Replay ${titleFor(entry, playlists)}`}
                style={({ pressed }) => [styles.recentRow, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.recentNum}>{padIndex(visibleRecent.length - i)}</Text>
                <View style={styles.recentBody}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {titleFor(entry, playlists)}
                  </Text>
                  <Text style={styles.recentDate}>{dateLabel(entry)}</Text>
                </View>
                <Text style={styles.recentDuration}>{durationFor(entry)}</Text>
              </Pressable>
            ))}
          </>
        )}
```

- [ ] **Step 11.3: Run type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 11.4: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx
git commit -m "feat(home): hide resumable broadcast from Earlier Tonight list"
```

---

## Task 12: Full-suite sanity pass + manual smoke plan

**Files:**
- None modified in this task.

- [ ] **Step 12.1: Run the full Jest suite**

Run: `npm test -- --no-coverage`
Expected: all tests pass. Pay attention in particular to:

- `__tests__/services/Storage.test.ts`
- `__tests__/engines/BroadcastResumer.test.ts`
- `__tests__/engines/BroadcastPlayer.test.ts`

If any unrelated test was already failing on `main`, confirm it's not
something this branch broke (run `git stash && npm test && git stash pop`
to compare). Do not commit fixes for pre-existing failures unless they
trace directly back to this change.

- [ ] **Step 12.2: Type-check the full tree**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this branch.

- [ ] **Step 12.3: Manual device smoke test**

Build + run on device:

```bash
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device
```

Perform the following matrix. Mark each box once confirmed working.

- [ ] Kill the app during cold_open (before any track starts) → reopen →
      home shows `RESUME · TRACK 1 OF …` → tap Resume → cold_open plays
      then t0 begins.
- [ ] Kill during t0 → reopen → Resume shows `TRACK 1 OF …` → tap →
      t0 plays from the top, no segment first.
- [ ] Kill during t2 (which is preceded by a `fact_bridge` transition)
      → reopen → Resume shows `TRACK 3 OF …` → tap → `fact_bridge`
      replays, then t2.
- [ ] Kill during t3 (no preceding transition under sparse cadence) →
      reopen → Resume shows `TRACK 4 OF …` → tap → t3 plays from the
      top, no segment.
- [ ] While a broadcast is actively playing: tab to home → CTA shows
      `NOW PLAYING · TRACK N OF M` → tap → navigates to player
      screen, playback uninterrupted.
- [ ] With a Resume CTA up: tap the "START FRESH" link → CTA reverts to
      the ROLL YOUR OWN / BEGIN BROADCAST layout; resumable broadcast
      reappears in "Earlier Tonight" list.
- [ ] Server-evicted broadcast: wait ≥2h (or restart the server) →
      reopen → home does NOT offer Resume (freshness ping got 404,
      persistence cleared).

- [ ] **Step 12.4: Commit the plan as complete (no code changes)**

Nothing to commit here — this task is the verification gate before the
feature ships.

---

## Self-review summary

- **Spec coverage:** every section of
  `docs/superpowers/specs/2026-04-20-broadcast-resume-design.md` is
  implemented:
  - §1 tri-state CTA → Tasks 9-11.
  - §2 segment replay semantics → Tasks 5 + 6 (resume branching +
    tests for cursor=2, cursor=3, cursor=-1).
  - §3 persistence shape + migration → Tasks 1-3.
  - §4 resume playback path → Tasks 4-6.
  - §5 UX surface changes → Tasks 9-11.
  - §6 testing → Tasks 3, 6, 8 and the final smoke matrix.
- **Placeholder scan:** every step contains the actual code/command to
  run; no TBDs or "handle edge cases" hand-waves.
- **Type consistency:** `PersistedBroadcast` shape, `resume` signature,
  and `ResumeCheckResult` are defined once and reused.

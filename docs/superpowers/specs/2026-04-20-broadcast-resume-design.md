# Broadcast Resume Design

**Date:** 2026-04-20
**Status:** Approved for planning
**Related:** `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md`,
`docs/superpowers/specs/2026-04-20-segment-cadence-design.md`

## Problem

The broadcast resume feature exists but offers no real value. Two defects:

1. **No mid-session resume.** `BroadcastPlayer.start(manifest, urls)` always begins
   at slot 0 / track 0. The persisted MMKV manifest carries no cursor, so
   tapping "Resume" on the modal restarts the broadcast from the beginning —
   effectively identical to replaying from the "Earlier Tonight" history list.
2. **Modal UX is wrong.** A native `Alert.alert('Resume broadcast?', …)`
   interrupts the user on home-screen mount. It says "N tracks left in your
   session" but N is the total track count, not remaining. The home screen
   already shows the same broadcast in the history list, so the alert is
   redundant and intrusive.

## Goals

- True mid-session resume: kill the app mid-track N, reopen → pick up at
  track N (from the top), with ONAY's intro segment for that track replayed.
- Non-modal affordance: replace the primary "Your Broadcast" card with a
  tri-state CTA (Fresh / Resume / Now Playing) driven by the player's live
  state and the persisted cursor.
- No new server code. The server's `GET /broadcast/:id/manifest` is already
  the source of truth for slot readiness; we just fetch it on resume.

## Non-goals

- Time-level (seek-to-offset) resume. Track-level is the product's natural
  granularity; per-second accuracy is overkill for 3-minute tracks and would
  cost ~12 MMKV writes/minute plus segment-boundary edge cases.
- Resume across different devices. MMKV is device-local; this is
  single-device resume only.
- Background bake completion notifications. Separate feature.

---

## 1. Behavioral model — three states of the primary CTA

The home-screen "Your Broadcast" card becomes a tri-state driven by two
signals: (a) is the singleton `BroadcastPlayer` currently active in memory,
(b) is there a persisted `PersistedBroadcast` record on disk that passes
the freshness ping.

| State | Condition | CTA behavior |
|---|---|---|
| **Now Playing** | `player.state ∈ {playing_segment, playing_track, paused}` | Label: `NOW PLAYING — {playlist or vibe} · Track n of m`. Tap → navigates to `/player`. Does not touch playback. |
| **Resume** | `player.state === 'idle'` AND persisted record exists AND freshness ping passes | Label: `RESUME — {playlist or vibe} · Track n of m`. Tap → calls `broadcastPlayer.resume(freshManifest, trackCursor)` then navigates to `/player`. Small "Start fresh" link underneath. |
| **Fresh** | `player.state === 'idle'` AND no persisted record | Current "Build your broadcast" gradient CTA, opens `SetupSheet`. |

The existing `Alert.alert('Resume broadcast?', …)` in `HomeBroadcastScreen`
is removed entirely. `BroadcastResumer` stays as the freshness-verification
layer (the server 404 gate is still useful) but is consumed differently:
the screen calls it on focus, stores the result in local state, renders the
appropriate CTA mode.

The existing `broadcastActive` interval-poll in `HomeBroadcastScreen`
(already checks `ACTIVE_STATES.has(getStatus().state)`) is extended to also
read `currentTrackIndex` and `totalTracks` for the label.

## 2. Segment replay semantics

The transition segment that immediately introduces the resume track DOES
replay. Cold_open does not, unless the cursor is `-1` (no track ever
started).

Example — 5-track broadcast with sparse cadence
`cold_open → t0 → t1 → fact_bridge(→t2) → t2 → t3 → tight_bridge(→t4) → t4 → sign_off`:

| Where the app died | Persisted cursor | Resume plays |
|---|---|---|
| During cold_open, no track started | `-1` | cold_open → t0 → t1 → fact_bridge → t2 → … |
| During t0 or t1 | `0` or `1` | t0 (or t1) from top, no segment |
| During `fact_bridge` or t2 | `2` | **fact_bridge** from start → t2 → … |
| During t3 | `3` | t3 from top, no segment |
| During `tight_bridge` or t4 | `4` | **tight_bridge** from start → t4 → sign_off |

Rules:

1. Persist `currentTrackIndex` at the top of `runTrackAt(i)`, not at the
   bottom — so if the app dies mid-track N, cursor is already N.
2. On resume, fast-forward the existing dual-cursor walk to the earliest
   position that reaches track N: the preceding transition segment (if one
   exists) replays from the start, then track N plays from the top.
3. Cold_open only replays when cursor is `-1`. Users don't re-hear the
   episode intro after hearing half of it.
4. Mid-segment TTS cannot be resumed (AVAudioPlayer-from-base64 has no
   offset), so the whole segment replays — but segments are 10-25s, so this
   reads as a natural "picking up where I left off" feeling, not a nuisance.

## 3. Data and persistence changes

### MMKV shape

Replace the current `CURRENT_BROADCAST: Manifest` with:

```ts
interface PersistedBroadcast {
  manifest: Manifest;        // as today
  trackCursor: number;       // -1 = no track started yet, 0..N-1 = last track reached
  updatedAt: number;         // ms since epoch — debugging + future freshness heuristics
}
```

### Write points

- `BroadcastPlayer.start()` seeds
  `{ manifest, trackCursor: -1, updatedAt: now }` as its first persistence
  write.
- `runTrackAt(i)` calls `updatePersistedCursor(i)` as its first action.
  One MMKV write per track boundary: 5 writes for a quick broadcast, 9
  for standard, 15 for long.
- `BroadcastPlayer.resume()` re-seeds the record with the fresh manifest
  and the supplied cursor, so the persisted manifest stays in sync with
  the server's current view of slot readiness.

### Clear points (unchanged behavior)

- Natural `sign_off` completion at the end of `start()` → clear.
- `end()` (user tapped End / exited player) → clear.
- User picks "Start fresh" on the Resume card → clear.
- `BroadcastResumer.check()` gets 404 on freshness ping → clear.

App-killed / backgrounded-to-death → record stays. That is the resume case.

### Storage API delta (`src/services/Storage.ts`)

- `setPersistedBroadcast(rec: PersistedBroadcast)` — shape change.
- New `updatePersistedCursor(trackIndex: number)` — cheap read-modify-write.
  No-op if no record exists (defensive; shouldn't happen in practice).
- `getPersistedBroadcast(): PersistedBroadcast | undefined` — shape change.
- `clearPersistedBroadcast()` — unchanged.

### Migration

Old shape (raw `Manifest`) still in MMKV from a previous session lacks
`trackCursor`. Add a shape sniff in `getPersistedBroadcast`:
`typeof obj.manifest === 'object' && typeof obj.trackCursor === 'number'`.
If it fails, call `clearPersistedBroadcast()` and return undefined. One-time
"no resume offered" on upgrade, no crash. The existing `getObject`
JSON-corrupt guard already handles parse failures.

## 4. Resume playback path

### New method

```ts
BroadcastPlayer.resume(manifest: Manifest, trackCursor: number): Promise<void>
```

Sits beside `start()`. Both delegate to a shared private
`initPlayback({ resumeFromIndex })` helper so setup (stingers, music
subscriptions, polling, history, cache clear, `state = 'loading'`,
`setBroadcastActive(true)`) is not duplicated. The helper branches on
`resumeFromIndex` to decide what to play first, then enters the same main
loop.

### Playback branching pseudocode

```
if resumeFromIndex < 0:
    # fresh start or cursor === -1
    load slot 0 (cold_open) into cache
    runSegmentAt(0)
    startTrack = 0
    nextSegmentIdx = 1
else:
    startTrack = resumeFromIndex
    introSlot = index i where segmentSlots[i].beforeTrackId === tracks[startTrack].id
    if introSlot exists:
        fetch and cache its audio (may already be cached)
        runSegmentAt(introSlot)
        nextSegmentIdx = introSlot + 1
    else:
        # startTrack is adjacent to the previous track (no transition between).
        # Advance nextSegmentIdx to the first slot we still need to run:
        #   - the lowest i where segmentSlots[i].beforeTrackId matches a track
        #     at position > startTrack, OR
        #   - the sign_off slot index, OR
        #   - segmentSlots.length  (if neither exists — defensive fallback)
        nextSegmentIdx = computeNextSegmentIdxAfter(startTrack, manifest)

# shared main loop — unchanged from current start()
for i = startTrack; i < tracks.length; i++:
    runTrackAt(i)                   # first action inside: updatePersistedCursor(i)
    ... existing dual-cursor walk ...
```

### Manifest freshness

`BroadcastResumer.check()` changes its return shape:

```ts
async check(): Promise<{ manifest: Manifest; trackCursor: number } | null>
```

On the 200 ping it returns `{ manifest: freshFromServer, trackCursor }` —
not the locally persisted manifest. This matters because slots may have
flipped `pending → ready` while the user was away, and the bake may have
finished. The client always resumes against the server's current truth.

### Partially-baked broadcast on resume

`schedulePolling()` and `kickBackgroundFetch()` are in the shared init
path, so a resume into a half-baked broadcast behaves identically to
today's "slot 1..N still generating" flow — polls every 3s, upgrades
slots as they ready.

### Edge cases

- `introSlot.status === 'failed'` → `runSegmentAt` already silently skips
  failed slots. Resume drops straight into `runTrackAt(startTrack)`.
- `trackCursor >= tracks.length` (shouldn't happen, defensive) → resume
  calls `clearPersistedBroadcast()`, logs, and returns. Home screen stays
  in Fresh state. No crash, no orphan player.
- Freshness ping network timeout (non-404) → keep persistence,
  optimistically render Resume CTA; the tap itself will surface any real
  failure via the standard `Alert.alert('Broadcast error', …)` path.

## 5. UX surface changes

### Primary CTA component

Extend `YourBroadcastSetup.tsx` (currently `src/components/broadcast/`) to
accept a `mode: 'fresh' | 'resume' | 'now-playing'` prop plus payload
(`playlistLabel`, `trackIndex`, `totalTracks`, `vibeLabel`). The gradient
pill + border treatment stays identical across modes so the card does not
visually jump when state flips; only copy + subtitle change.

Copy:

| Mode | Eyebrow (DM Mono, caps, gold) | Title (Playfair) | Subtitle (Inter 14) | Secondary |
|---|---|---|---|---|
| `fresh` | `YOUR BROADCAST` | Build your broadcast | Pick a playlist, a vibe, a length. | — |
| `resume` | `RESUME` | {playlistName or vibe label} | Track {n} of {m} · {vibe} | "Start fresh" link beneath, DM Mono 11, gold 60% |
| `now-playing` | `NOW PLAYING` | {playlistName or vibe label} | Track {n} of {m} · {vibe} | — |

Interaction:

- `resume` tap → `broadcastPlayer.resume(fresh, cursor)` then
  `router.push('/(main)/(broadcast)/player')`.
- `now-playing` tap → navigate only. Does not touch the player.
- "Start fresh" tap → `clearPersistedBroadcast()`, flip local state, card
  becomes `fresh`. No confirm sheet.

### Freshness spinner

Render the Resume card immediately from persisted state on mount; swap to
Fresh only if the freshness ping returns 404. No visible spinner — the
optimistic render is correct >99% of the time. If the user taps before the
ping returns, the player's own error path handles a 404 with the standard
`Alert.alert('Broadcast error', …)`.

### "Earlier Tonight" list interaction

The resumable broadcast is by definition the most recent history entry
(same session). While it lives in `resume` mode up top, **hide it from
the Earlier Tonight list** so it does not appear in two places. Once the
user resumes or starts fresh, it returns to the list in its appropriate
completed-or-active state.

### Native alert removal

Delete the `Alert.alert('Resume broadcast?', …)` block in
`HomeBroadcastScreen` (currently lines ~188-209). The freshness-ping
result drives the CTA mode instead.

### Accessibility

Per-mode `accessibilityLabel`:

- `fresh` → "Build your broadcast"
- `resume` → "Resume broadcast, track 3 of 9"
- `now-playing` → "Open now playing, track 3 of 9"

`accessibilityRole="button"` unchanged.

## 6. Testing

Focus on state-machine and cursor semantics. UI tests stay light — tri-state
CTA is a pure function of two props.

### Unit (Jest, pure `BroadcastPlayer` class)

1. `resume(manifest, -1)` plays cold_open (slot 0) then enters the main
   loop at track 0. Regression guard for the "never reached a track" path.
2. `resume(manifest, 2)` with a preceding transition → plays the correct
   intro segment first, then track 2. Assert `runSegmentAt(introSlotIdx)`
   then `runTrackAt(2)`.
3. `resume(manifest, 3)` where no segment precedes track 3 → no intro
   segment run, `runTrackAt(3)` called directly, `nextSegmentIdx` set to
   the next matching slot so the loop does not miss a later transition.
4. `resume(manifest, trackCursor >= tracks.length)` → no crash,
   `clearPersistedBroadcast` called, player returns to idle.
5. `start()` + `runTrackAt` updates cursor — mock
   `updatePersistedCursor`; for a 5-track broadcast observe the sequence
   `[0, 1, 2, 3, 4]`. Confirms the MMKV write hook fires on track entry,
   not exit.
6. Sign-off clears persistence (existing test; ensure it still passes).
7. Pause during a track does not overwrite the cursor with a stale value.

### `BroadcastResumer`

8. Return-shape change: `check()` now returns
   `{ manifest, trackCursor } | null`. Update the 4 existing tests.
9. Freshness ping uses the **fetched** manifest, not the persisted one —
   fetch returns a manifest with `segmentSlots[4].status === 'ready'`,
   persisted had `'pending'`; resume receives the ready version.
10. Malformed persisted record (missing `trackCursor`) → treated as
    corrupt, cleared, returns null.

### `Storage.ts`

11. `updatePersistedCursor(i)` writes only the `trackCursor` field
    without clobbering `manifest` or `updatedAt`.
12. `getPersistedBroadcast` returns undefined for legacy shape (missing
    `trackCursor`), and clears the MMKV key as a side effect.

### Integration-ish (still Jest, with mocks)

13. End-to-end: seed MMKV with `{ manifest, trackCursor: 2 }`, mock
    manifest fetch to return same manifest, call
    `broadcastPlayer.resume(...)`, assert call order
    `runSegmentAt(introSlotForT2) → runTrackAt(2) → runTrackAt(3) → …`.

### Manual / TestFlight

- Kill app during cold_open, during track 0, during track 2 (with
  preceding fact_bridge), during track 3 (no preceding segment), during
  sign_off. Reopen; verify each lands on the correct resume point.
- Verify "Earlier Tonight" hides the resumable entry while Resume card
  is up, and restores it after Start Fresh.
- Verify Now Playing mode renders on home while broadcast is actively
  running (tab back from player → home → CTA shows NOW PLAYING).

### Not tested

- Server code — no server changes.
- Tri-state CTA snapshot — manual QA sufficient given tiny copy-only delta.

---

## Files touched

- `src/services/Storage.ts` — `PersistedBroadcast` type, shape change,
  `updatePersistedCursor`, migration guard.
- `src/engines/BroadcastResumer.ts` — return type, freshness ping returns
  fetched manifest + cursor.
- `src/engines/BroadcastPlayer.ts` — new `resume` method, shared
  `initPlayback` helper, `updatePersistedCursor` call in `runTrackAt`.
- `src/engines/BroadcastPlayer.types.ts` — no change (cursor lives in
  storage shape, not player types).
- `src/screens/home/HomeBroadcastScreen.tsx` — remove `Alert.alert`
  block, add tri-state CTA wiring, hide resumable entry from "Earlier
  Tonight" list.
- `src/components/broadcast/YourBroadcastSetup.tsx` — `mode` prop,
  copy variants, accessibility labels.
- `__tests__/engines/BroadcastResumer.test.ts` — update return-shape
  expectations + new tests.
- `__tests__/engines/BroadcastPlayer.test.ts` (or equivalent) — new
  `resume` tests.
- `__tests__/services/Storage.test.ts` — new cursor / migration tests.

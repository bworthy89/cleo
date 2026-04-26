# Up Next display — design

**Status:** approved
**Date:** 2026-04-26
**Issue:** [#35 — Phase 2 — Up Next view + Quick-add](https://github.com/bworthy89/cleo/issues/35)

## Summary

Show listeners what's coming next on the broadcast player screen. Read-only inline list of upcoming manifest tracks with subtle markers for the points where ONAY will speak between them. No insertion, no controls, no audio routing changes.

## Decision: Quick-add removed from scope

The original issue bundled an "Up Next view" with a "Quick-add" affordance — tap a button, search Apple Music catalog, queue a single track to play after the current one without mutating the manifest.

Brainstorming surfaced a hard tension: the player screen carries a `NO SKIPS · SIT WITH IT` commitment line, and the brand promise is *give up control, trust ONAY's curation.* Quick-add — even threaded as a playback-layer insertion that preserves the bake-once invariant — turns the listener into a DJ. An inserted track has no commentary slot, sits orphaned between editorial beats, and softens the radio frame the product is differentiated on.

The "I want this song right now" user impulse Quick-add was solving has a less destructive home: **#36 Thumbs-up save-to-list**, already on the Phase 2 list, captures the same energy by saving a track to a personal Liked list without disrupting playback. That feature is the right channel for that impulse.

This issue ships only the Up Next *display.* If post-Phase-2 retention data shows users churning because they can't insert tracks, revisit — but Phase 2's gate is observational anyway, and Up Next display alone is pure win for the radio frame ("coming up next…" is what real DJs do).

The original issue's title becomes a misnomer; the closing PR will note the Quick-add scope was deliberately removed and reference this spec.

## Scope

### In scope

- Inline UP NEXT section in `app/(main)/(broadcast)/player.tsx`, below the host volume dial.
- Lists upcoming manifest tracks in order with mono catalog index, title (Anton), artist (Fraunces italic), duration.
- Subtle `↘ ONAY · TRANSITION` rows between tracks where a transition segment will play.
- Trailing `↘ ONAY · SIGN-OFF` row when the sign_off slot is still ahead.
- Empty-state line on the last track ("THIS IS THE LAST ONE", mono editorial copy in `AM.inkDim`).

### Explicitly dropped

- Quick-add affordance, picker UI, track insertion, audio routing changes (see Decision above).

### Deliberately deferred

- Tap-a-row interactions (skip, save, info). Read-only list.
- Past-tracks / "earlier in this broadcast" view. Forward-only matches the no-skip frame.
- Per-row artwork thumbnails. Hero already shows current artwork; row thumbs would crowd the small rows and compete with the hero.
- Live Activity / lock-screen "next track" surfaces. Player-screen-only.

## Architecture

Engine-derived. The `BroadcastPlayer` already owns the dual-cursor walk that decides which transition plays before which manifest track (`runMainLoop`); the same logic produces the upcoming list. Keeping it in the engine means there's one source of truth for "what's coming."

### Data model

New types in `src/engines/BroadcastPlayer.types.ts`:

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

`PlayerStatus` gains:

```ts
upcoming: UpcomingItem[];
```

### Engine changes

1. **Promote `nextSegmentIdx` to an instance field.** Currently a local variable inside `runMainLoop`. Promoting to `private nextSegmentIdx = 0` (reset to 0 in `start`, computed via `computeNextSegmentIdxAfter` in `resume`, advanced in place of the local mutations) lets `getStatus()` consult the same cursor `runMainLoop` is using. Behavioral change: `getStatus()` now reflects the loop's cursor between iterations instead of recomputing it — desired.
2. **Add `private computeUpcoming(): UpcomingItem[]`** called from `getStatus()`.

Algorithm:

- Return `[]` when `manifest === null` or `state` is `'ended'` / `'idle'` / `'error'`.
- Walk `manifest.tracks` from `currentTrackIndex + 1` (so the current track isn't in the upcoming list).
- Maintain a local segment cursor seeded from `this.nextSegmentIdx`. For each upcoming track, check if `segmentSlots[cursor]?.beforeTrackId === track.id`; if so, **always advance the cursor**, but only consider that segment for inclusion as a row if it's a `'transition'`. (Cold_open also matches `beforeTrackId === firstTrack.id`; it must consume the cursor without producing a row, since cold_open is part of the broadcast frame, not an upcoming editorial beat.)
- After the track loop, if a `'sign_off'` slot remains ahead at the cursor, consider it for inclusion under the same skip rules.
- A considered segment (transition or sign_off) is **skipped** (not added to the output) when any of:
  - `cursor === currentSegmentIndex` — the slot is currently playing, so it isn't *upcoming.* `runMainLoop` increments the loop-local `nextSegmentIdx` only after `runSegmentAt` returns, so when a segment is in flight, both `this.nextSegmentIdx` and `currentSegmentIndex` point at the same slot. This filter prevents the in-flight transition from being rendered in the upcoming list.
  - `status === 'failed'` or `'aborted'` — the runtime skips these silently, so the upcoming list should match.

### UI

**New component:** `src/components/broadcast/UpNextList.tsx`

Props: `{ items: UpcomingItem[] }`. Renders:

1. **Header** — existing `SectionMarker` from `src/components/crate/`, with `num="B·02"`, title `"UP NEXT"`, right-side mono label `"<N> REMAINING"` where N is the count of `kind === 'track'` items.
2. **Rows** — mapped from `items`:
   - **Track row.** Mono `TRK NN` index in a 36px-wide column · `title` Anton 14px · `artistName` Fraunces italic 12px · mono duration `mm:ss` right-aligned. Hairline bottom border (`AM.rule` 0.5px). Static — no `Pressable`.
   - **Transition row.** Mono 8px in `AM.inkDim`, centered, 6px vertical padding, no border. Text: `↘ ONAY · TRANSITION`.
   - **Sign-off row.** Same shape as transition row. Text: `↘ ONAY · SIGN-OFF`.
3. **Empty state** — when `items.length === 0`, render a single mono 9px line `"THIS IS THE LAST ONE"` in `AM.inkDim`, centered, 12px vertical padding. Replaces the rows; the section header still shows but with `"0 REMAINING"`.

**Player screen integration:** in `app/(main)/(broadcast)/player.tsx`, add the section between the volume block and the trailing 22pt spacer. Pass `status.upcoming` straight through. No new state, no new effects — the existing 500ms poll already drives re-renders.

**Tokens only.** No inline literal sizes or colors — all from `AM`, `Fonts`, `Space`, `TypeScale`. No new tokens needed.

**Accessibility:**

- Section announced via the `SectionMarker`'s existing label.
- Track rows: `accessibilityRole="text"`, `accessibilityLabel="Up next, track 4, Ribs by Lorde, 3 minutes 58 seconds"`.
- Transition rows: `accessibilityLabel="ONAY transition between tracks"`.
- Sign-off row: `accessibilityLabel="ONAY sign-off"`.

## Edge cases

| Player state | `upcoming` returns |
|---|---|
| `idle` (engine torn down) | `[]` |
| `loading` before any segment runs | All manifest tracks + their transitions + sign-off |
| `playing_segment` (cold_open, `currentTrackIndex === -1`) | All manifest tracks + their transitions + sign-off |
| `playing_track i` (mid-track) | Tracks `i+1..N-1` + their transitions + sign-off |
| `playing_segment` between i and i+1 (transition in flight) | Tracks `i+1..N-1` + transitions starting from the next unplayed segment + sign-off (in-flight transition filtered out via the promoted `nextSegmentIdx` cursor) |
| `paused` | Whatever was returned for the underlying state at pause time |
| `ended` | `[]` |
| `error` | `[]` (defensive — manifest may be null) |

**Pending segment slots** (`status === 'pending'`) render normally — the slot exists in the editorial flow regardless of audio readiness. If a slot later flips to `failed` and the player skips it at runtime, the next 500ms poll re-renders without it (since `computeUpcoming` filters `failed`/`aborted`).

**Mid-broadcast manifest poll updates.** When `pollManifestOnce` swaps in a fresher manifest (segment statuses flipping `pending → ready`), `getStatus()` recomputes `upcoming` from the new manifest on the next 500ms tick. No special handling needed.

**Resume from a saved broadcast.** `BroadcastPlayer.resume()` rehydrates `manifest`, `currentTrackIndex`, and (per this spec) `nextSegmentIdx` before the player screen foregrounds; the first `getStatus()` poll renders correctly.

**Live Activity / NowPlaying / lock-screen.** Untouched. Up Next is player-screen-only.

## Testing

### Unit tests — `src/engines/__tests__/BroadcastPlayer.upcoming.test.ts` (new file)

Targets `BroadcastPlayer.computeUpcoming()`. Same harness as `BroadcastPlayer.test.ts`: mock `MusicDeps` / `NativeDeps` / `ManifestDeps` / `StingerDeps`, build a fixture manifest, drive the engine through states, assert on `getStatus().upcoming`.

Cases:

1. Fresh start, before slot 0 plays. All tracks + transitions + sign-off upcoming.
2. Mid-cold-open (`currentTrackIndex === -1`, `currentSegmentIndex === 0`). Same as case 1.
3. Mid-track at index 2 (5-track standard with sparse cadence: transitions before tracks 2 and 4 + sign-off). Returns tracks 3, 4 + transition before track 4 + sign-off.
4. Mid-transition between tracks 1 and 2 (segment in flight). Returns tracks 2, 3, 4 + the *next* transition (before track 4) + sign-off. In-flight transition filtered out.
5. Last track playing. Returns just sign-off.
6. Mid-sign-off. Returns `[]`.
7. Failed segment in the middle. Filtered — adjacent tracks render back-to-back without a transition row.
8. Manifest with no middle transitions (3-track quick — just cold_open + sign_off). Returns remaining tracks + sign-off, no transition rows.
9. `manifest === null` / state `ended`. Returns `[]`.

### Component tests

None. List rendering is straight JSX over the engine's output; engine unit tests pin the data, visual fidelity is verified manually on TestFlight.

### Manual smoke before merging

- Full standard bake on a real device. Verify Up Next shrinks track by track, transition rows disappear when their slot completes, sign-off row stays visible to the very end, empty state shows on the last track.
- Background / foreground the app mid-broadcast. List still correct on return.
- VoiceOver pass — row labels read sensibly.

## Files touched

- `src/engines/BroadcastPlayer.types.ts` — new `UpcomingItemKind`, `UpcomingItem`; `PlayerStatus.upcoming` field.
- `src/engines/BroadcastPlayer.ts` — promote `nextSegmentIdx` to an instance field; add `computeUpcoming`; surface from `getStatus`.
- `src/engines/__tests__/BroadcastPlayer.upcoming.test.ts` — new unit-test file.
- `src/components/broadcast/UpNextList.tsx` — new component.
- `app/(main)/(broadcast)/player.tsx` — render `<UpNextList items={status.upcoming} />` between volume block and trailing spacer.

## Acceptance

- Up Next section renders on player screen below host volume.
- Section header shows "B·02 · UP NEXT · <N> REMAINING".
- Track rows show TRK index, title, artist, duration, hairline divider.
- Transition rows show "↘ ONAY · TRANSITION" between the right tracks.
- Sign-off row shows "↘ ONAY · SIGN-OFF" at the end while the sign_off slot is ahead.
- Empty state shows "THIS IS THE LAST ONE" on the final track.
- All 9 unit-test cases pass.
- Manual smoke (full bake, background/foreground, VoiceOver) clean.

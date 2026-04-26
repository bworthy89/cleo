# Thumbs-up save-to-list — design

**Status:** approved
**Date:** 2026-04-26
**Issue:** [#36 — Phase 2 — Thumbs-up save-to-list](https://github.com/bworthy89/cleo/issues/36)

## Summary

Single-direction feedback on the broadcast player: tap a heart on the currently-playing
track to save it to a personal Liked list. Persisted in Firestore per user, capped at
200 entries with FIFO eviction. List renders on the Profile screen with per-row
unsave. No thumbs-down, no playback, no sharing.

## Scope

### In scope

- Heart `Pressable` on the broadcast player, right of the title block.
- Toggle interaction: tap an outlined heart to save (filled + amber); tap a filled
  heart to unsave.
- Firestore subcollection `users/{uid}/likes/{trackId}` storing `{id, title,
  artistName, albumTitle, artworkUrl, savedAt}`.
- Firestore Security Rules for the new subcollection.
- New `D·04 LIKED` section on the Profile screen with one row per saved track,
  ordered `savedAt desc`, capped at 200.
- Per-row filled-heart Pressable to unsave from Profile.
- 200-entry FIFO eviction on save (oldest by `savedAt` is dropped via a Firestore
  transaction).

### Explicitly dropped

- Thumbs-down or any negative feedback path. Sequencer is deterministic per bake;
  introducing mid-bake mutation breaks the contract.
- Replaying the Liked list as a playlist. Phase 5 / future per the roadmap.
- Sharing or exporting the Liked list.
- Server-side `/likes` endpoint. Direct client-to-Firestore; security rules enforce
  ownership.
- Likes on segments (cold_open / transition / sign_off). Heart hides when
  `status.currentTrack` is null.
- Backfilling existing broadcast history with a save action. Likes are forward-only
  from feature ship.
- Server-side Firestore (no `firebase-admin/firestore`). Server is untouched by this
  issue.

## Architecture

```
[Player heart Pressable] ──tap──┐
                                ├──► LikedTracksService.toggle(track)
[Profile row heart] ────tap─────┘                │
                                                  ▼
                              users/{uid}/likes/{trackId}  ←── Firestore
                                                  ▲
[Profile screen] ──onSnapshot──► useLikedTracks() hook ──renders list

[Player screen] ──useLikedTrack(trackId)──► single-doc subscription for current track
```

Direct device-to-Firestore reads/writes. No server changes. New client-only
dependency: `@react-native-firebase/firestore`.

### Data model

**Firestore document at `users/{uid}/likes/{trackId}`:**

```ts
interface LikedTrackDoc {
  id: string;                                 // Apple Music trackId; doc id mirrors this for client convenience.
  title: string;
  artistName: string;
  albumTitle: string;                         // empty string when unknown — Firestore strips undefined.
  artworkUrl: string | null;
  savedAt: FirebaseFirestoreTypes.Timestamp;  // serverTimestamp() on write.
}
```

**TypeScript types in `src/services/LikedTracksService.types.ts`:**

```ts
export interface LikedTrackInput {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  artworkUrl: string | null;
}

export interface LikedTrack extends LikedTrackInput {
  savedAt: Date;  // Timestamp converted on read.
}

export class AuthRequiredError extends Error {}
```

### Firestore Security Rules

New file `firestore.rules` at repo root:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/likes/{trackId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Deploy via `firebase deploy --only firestore:rules`. Spec flags this for the user to
run — the implementation plan will not run it automatically.

### LikedTracksService API

```ts
// src/services/LikedTracksService.ts

export async function toggle(input: LikedTrackInput): Promise<'liked' | 'unliked'>;

export function subscribeToOne(
  trackId: string,
  callback: (state: { exists: boolean; track: LikedTrack | null }) => void
): () => void;

export function subscribeToList(
  callback: (tracks: LikedTrack[]) => void
): () => void;
```

- Both subscribe functions resolve `auth().currentUser?.uid` internally; if null,
  they invoke the callback with the empty state and return a no-op unsubscribe.
- `toggle` reads `auth().currentUser?.uid`; throws `AuthRequiredError` if null.
- `toggle` is a two-phase operation. `getCountFromServer` and ordered `getDocs`
  queries cannot run inside a Firestore transaction (transactions only support
  per-document `transaction.get()`), so cap-enforcement reads happen first,
  outside the transaction:
  1. Read the parent collection's count via `getCountFromServer`.
  2. If `count >= 200`, fetch the oldest doc id via
     `getDocs(query(likesCol, orderBy('savedAt', 'asc'), limit(1)))`.
- Then run the transaction:
  - `transaction.get(targetDocRef)` to check existence.
  - If exists → `transaction.delete(targetDocRef)`; return `'unliked'` (no
    eviction — toggling off frees a slot).
  - Else (new save) → if `count >= 200 && oldestDocId`,
    `transaction.delete(doc(likesCol, oldestDocId))`; then
    `transaction.set(targetDocRef, newDoc)`; return `'liked'`.
- Race semantics:
  - Between the count read and the transaction commit, another device may add or
    delete a doc. The cap is therefore *soft* — it may transiently sit at 201 or
    199. Acceptable; the next write self-corrects.
  - If the oldest doc is deleted by another device before our transaction runs,
    `transaction.delete` on a non-existent doc is a no-op in Firestore. No error,
    no orphan state.
  - If the target doc itself is modified mid-transaction, Firestore's built-in
    contention retry re-runs the transaction body. The pre-transaction count and
    oldestDocId reads are *not* re-run, so a worst-case stale eviction is
    bounded to one over/under by one.

### Hooks

```ts
// src/hooks/useLikedTrack.ts
export function useLikedTrack(trackId: string | null): {
  isLiked: boolean;
  toggle: () => Promise<void>;
};
```

Returns `{ isLiked: false, toggle: noop }` when `trackId` is null. Otherwise
subscribes to the single doc and exposes `toggle` that wraps
`LikedTracksService.toggle` with the player's current track metadata.

```ts
// src/hooks/useLikedTracks.ts
export function useLikedTracks(): {
  tracks: LikedTrack[];
  loading: boolean;
};
```

Returns `loading: true` until the first snapshot arrives. After that, `tracks` is
the full ordered list.

## UI

### Player screen heart

Right of the title block, vertically aligned with the artist line. Hidden when
`status.currentTrack` is null (loading / cold_open / transition / sign_off / ended).

```
TITLE OF SONG                           [♥]
Artist Name
03:58 · ALBUM TITLE
```

- Glyph: `♥` (U+2665) when liked, `♡` (U+2661) when not.
- Color: `AM.amber` when liked, `AM.inkDim` when not.
- Glyph size: `TypeScale.s24`.
- Touch target: 44×44 (`Space.s11` × 2 padding around the glyph).
- Haptics on tap: `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)`.
- Accessibility:
  - `accessibilityRole="button"`.
  - `accessibilityLabel`: `"Save 'TITLE' to Liked"` when not liked,
    `"Remove 'TITLE' from Liked"` when liked.
  - `accessibilityState={{ selected: isLiked }}`.

The Pressable wraps `useLikedTrack(status.currentTrack?.id ?? null)`. The hook
returns `{ isLiked: false, toggle: noop }` when the trackId is null, and the
Pressable's parent View hides the entire heart in that case (so VoiceOver doesn't
announce a noop control).

### Profile screen Liked section

New section below `D·03 WEATHER CONTEXT`.

```
D·04 · LIKED                                 N / 200

[artwork] TITLE OF SONG                       ♥
          Artist Name · ALBUM
          MMM D

[artwork] TITLE OF SONG                       ♥
          Artist Name · ALBUM
          MMM D
```

- Header: `SectionMarker num="D·04" title="LIKED" side="<count> / 200"`.
- Body: one `<LikedRow>` per saved track from `useLikedTracks()`.
- Empty state (no saves): single mono 9px line in `AM.inkDim`, centered, 12px
  vertical padding: `"NOTHING SAVED YET — TAP A HEART ON THE PLAYER"`.
- Loading state (initial subscription): same mono-style line: `"LOADING…"`.

**`src/components/profile/LikedRow.tsx`:**

Props: `{ track: LikedTrack }`. Renders:

- 40×40 artwork thumb on the left (`AM.bgDeep` fallback box with `ONAY` text when
  `artworkUrl === null`, matching the player hero's fallback treatment).
- Title (Anton 14px, uppercase, `AM.ink`).
- Artist + album (Fraunces italic 12px, `AM.inkMid`): `Artist Name · ALBUM`.
  Album omitted when empty string.
- Saved date (mono 9px, `AM.inkDim`, right-aligned under the heart): `MMM D`
  via `toLocaleDateString(undefined, { month: 'short', day: 'numeric' })`.
- Filled heart on the right (Pressable, 20px glyph, `AM.amber`, 44×44 touch target).
- Hairline bottom border (`AM.rule`, 0.5px).

Accessibility on each row:

- `accessibilityRole="text"` on the row container.
- `accessibilityLabel="Liked: <Title> by <Artist>, saved <Date>"`.
- The heart Pressable has its own `accessibilityRole="button"` +
  `accessibilityLabel="Remove '<Title>' from Liked"`.

**Tokens only.** No new tokens. No inline literal sizes or colors.

## Edge cases

| Scenario | Behavior |
|---|---|
| User taps heart while signed out | Should not happen — every player/profile route is behind `requireAuth` route gate. Defensive: `LikedTracksService.toggle` throws `AuthRequiredError` if `auth().currentUser` is null. The player heart's `toggle` wrapper catches and silently ignores. |
| Network offline at tap | Firestore SDK queues the write to local persistence; the `onSnapshot` fires from the local cache so the UI updates instantly. Sync replays when online. |
| Network offline on Profile open | Firestore offline persistence (default-on for `@react-native-firebase/firestore`) serves cached docs. Last-known list renders. |
| Fresh device, never opened the app before | First subscription returns `empty: true`. Empty state renders. Existing likes from another device sync in once Firestore connects. |
| Track has no `artworkUrl` on the manifest | Stored as `null`. `LikedRow` renders the `ONAY` fallback box. |
| Track plays during a transition slot (`currentTrack === null`) | Heart hidden — title block shows segment status text (existing behavior). |
| User rapid-taps the heart | Doc id is `trackId`, so writes are idempotent. The transaction serializes; last tap wins. No duplicate docs. |
| User reaches 200 saved, taps to save the 201st | Transaction queries oldest by `savedAt asc limit(1)`, deletes it, writes new doc atomically. Profile subscription animates oldest row out and new row in. |
| Same trackId played in two broadcasts | Second save updates `savedAt` (refreshes recency); no duplicate row. |
| User uninstalls then reinstalls | List restored from Firestore on next sign-in. Satisfies the roadmap's "persists across sessions" criterion. |
| Two devices unsave simultaneously | Both transactions check existence; one succeeds, the other no-ops. No errors, no orphaned state. |
| Eviction race (oldest doc deleted by another device between the pre-transaction read and the transaction) | `transaction.delete` on a non-existent doc is a no-op. Cap may briefly sit at 199 instead of 200; the next write self-corrects. |

## Testing

### Unit tests — `__tests__/services/LikedTracksService.test.ts` (new file)

Targets `toggle` / FIFO / read-side transformations. `@react-native-firebase/firestore`
mocked at module level via `jest.mock`, exposing `set`, `delete`, `runTransaction`,
`onSnapshot`, `getCountFromServer`, `collection`, `doc`, `query`, `orderBy`, `limit`,
`serverTimestamp` as jest spies.

Cases:

1. `toggle` on an unsaved track: writes a doc with `serverTimestamp`, returns
   `'liked'`. No eviction query when count < 200.
2. `toggle` on a saved track: deletes the doc, returns `'unliked'`. No eviction
   logic runs.
3. `toggle` at exactly the cap (count === 200): deletes oldest by
   `orderBy(savedAt asc).limit(1)` THEN writes new doc, both inside the same
   transaction.
4. `toggle` below cap (count === 199): writes new doc, no deletion.
5. `toggle` at cap + the new track is already saved (re-toggle to unsave): plain
   delete, no eviction logic runs.
6. `subscribeToList` callback: receives `LikedTrack[]` with `savedAt` as `Date`,
   ordered `savedAt desc`.
7. `subscribeToOne` callback: receives `{ exists: false, track: null }` for a
   missing doc, `{ exists: true, track }` for a present doc.
8. Auth-required guard: calling `toggle` when `auth().currentUser` is null throws
   `AuthRequiredError`.
9. Stale-eviction tolerance: oldest doc has been deleted by another device
   between the pre-transaction read and the transaction. The transaction
   proceeds; `transaction.delete` on a non-existent doc is a Firestore no-op.
   Final state: new doc present, no error thrown.

`subscribeToOne` and `subscribeToList` cases each split into multiple tests
covering missing-doc, present-doc, and signed-out paths. The plan delivers
~13 test cases across these clusters. (Contention-retry semantics are SDK
behavior and not exercised in our suite.)

### Hook tests — `__tests__/hooks/useLikedTrack.test.ts` (new file)

- Subscribe/unsubscribe lifecycle: mount → subscribe call; unmount → unsubscribe
  call; trackId change → old unsubscribe + new subscribe.
- `isLiked` state transitions on snapshot updates.
- `toggle` callback dispatches to `LikedTracksService.toggle` with the track
  metadata.

### Component tests

None. Same rationale as Up Next: rendering is straight JSX over service output;
visuals verified manually.

### Manual smoke before merging

- Save 3 tracks during a real broadcast on TestFlight; verify they appear on
  Profile in reverse-chron order.
- Unsave one from the player heart; verify it disappears from Profile within
  ~500ms.
- Unsave one from the Profile row; verify the player heart reflects the change if
  the same track is currently playing.
- Airplane-mode mid-tap; verify the heart updates instantly and Firestore syncs
  when reconnected.
- Reach 200 saved (test fixture script that floods saves); verify the oldest is
  evicted and the count holds at 200.
- VoiceOver pass — heart announces correct state and label on both player and
  Profile rows.

## Files touched

- `src/services/LikedTracksService.ts` — new module owning Firestore reads/writes.
- `src/services/LikedTracksService.types.ts` — new types module.
- `src/hooks/useLikedTrack.ts` — new hook (single-doc subscription) for the player
  heart.
- `src/hooks/useLikedTracks.ts` — new hook (collection subscription) for Profile.
- `src/components/profile/LikedRow.tsx` — new row component for Profile.
- `app/(main)/(broadcast)/player.tsx` — add heart Pressable in title block.
- `src/screens/settings/ProfileScreen.tsx` — add `D·04 LIKED` section + rows.
- `firestore.rules` — new file at repo root with the security rules block.
- `package.json` + `package-lock.json` — add `@react-native-firebase/firestore`.
- `__tests__/services/LikedTracksService.test.ts` — new unit-test file.
- `__tests__/hooks/useLikedTrack.test.ts` — new unit-test file.

## Operations

After merging, the user must run:

```
firebase deploy --only firestore:rules
```

This is not part of the implementation plan — the rules file is committed to the
repo, but applying it to the live Firestore instance is a separate manual step
flagged here.

## Acceptance

- Heart appears on the player screen right of the title block, hidden during
  segments.
- Tapping a heart saves the current track to Firestore at
  `users/{uid}/likes/{trackId}` with `serverTimestamp`.
- Tapping a saved heart unsaves the track.
- Profile screen shows a `D·04 LIKED` section with `<count> / 200` in the side
  label.
- Each row shows artwork thumb, title, artist + album, saved date, and a filled
  heart Pressable to unsave.
- Empty state shows when no saves yet.
- 200-entry cap holds with FIFO eviction (oldest by `savedAt`).
- All ~13 service unit-test cases pass (across `toggle`, `subscribeToOne`,
  `subscribeToList`, and the auth guard).
- All 3 hook unit-test cases pass.
- Manual smoke (save / unsave / offline / cap / VoiceOver) clean.
- `firestore.rules` deployed to production Firebase project after merge.

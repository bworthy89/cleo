# First-Listen Onboarding Bake — Design

**Date:** 2026-04-25
**Status:** Brainstorm-approved; awaiting user spec review
**Roadmap link:** [`2026-04-24-onay-roadmap-design.md`](2026-04-24-onay-roadmap-design.md) → Phase 2 → MVP-7
**Issue:** [bworthy89/cleo#33](https://github.com/bworthy89/cleo/issues/33)
**Closes:** [bworthy89/cleo#40](https://github.com/bworthy89/cleo/issues/40) (folded — `fetchPlaylists` already returns `lastPlayedDate`-sorted; no separate bridge needed)

---

## Why

Phase 2's parity-sprint pitch is "ONAY does everything Yoodio/Radiant do that genuinely matters." The Radiant onboarding is sticky because the user opens the app, authorizes their library, and the host *immediately* introduces themselves and plays a song from the user's listening history. That moment is the magic — a stranger has shown up, they know who you are, and they're playing something you actually like.

Today the ONAY onboarding ends abruptly: `welcome → music-auth → /(main)`. The user lands on a home screen with no audio playing and no orientation toward what ONAY is. They have to discover "Build your broadcast" themselves and wait through a fresh bake. The first impression is "configuration UI", not "AI radio host."

This issue inserts a `first-listen` screen between `music-auth` and `/(main)` that captures the user's name, kicks off a personalized bake from their most-recently-played Apple Music playlist, and ends with a single press-play CTA. When the user taps it, ONAY's voice — addressing them by name — is already there, ready.

## Scope

**In scope:**
- New screen `app/(onboarding)/first-listen.tsx` that runs between music-auth and `/(main)`.
- Three sequential states on the screen: name capture (when needed), bake-in-flight progress, ready-to-press-play.
- Personalized bake using the first `fetchPlaylists()` entry with ≥5 sanitize-passing tracks; falls back to a pre-baked featured broadcast when no qualifying playlist is available.
- Cold open uses the user's submitted name (or Firebase `displayName` when present).
- Press-play CTA on the ready state — no auto-play. The user's tap is the user-initiated event that activates the audio session.
- Documentation in CLAUDE.md noting that `fetchPlaylists()` returns playlists ordered by Apple's `lastPlayedDate` (already true; just not advertised).

**Out of scope:**
- Re-baking slot-0 with the user's name *after* the bake started (would be cleaner but adds significant complexity; deferred to v2 if name personalization on the first cold open turns out to matter less than expected).
- Smarter playlist selection — frequency-based "most-played", genre-aware, mood-aware. Recency-via-`lastPlayedDate` is the v1 honest signal; expanding requires more native MusicKit research.
- Skip-button on the first-listen screen ("not now"). Add only if user research shows a meaningful share of users want it.
- New telemetry events. The existing `bake.start` / `bake.end` cover the bake leg; perceived first-listen latency can be derived from those + the screen-mount timestamp client-side. Phase 2's GATE (#38) will need a per-user retention signal but that's out of scope here.
- Re-prompting for the name on subsequent app launches. First-listen is gated on "no broadcast history yet" — a returning user (with at least one prior broadcast) skips the screen entirely.
- Folding featured fallback into a fresh bake. Featured broadcasts are already pre-baked; we use them as-is.

## Approach

### Three-state prep screen

The screen mounts on `music-auth.tsx`'s `finish()` and walks through up to three states:

1. **State A — Name capture** (skipped if Firebase `displayName` is populated). Inline input "What should ONAY call you?" plus a "JUST CALL ME LISTENER" skip option. Submitting the name persists it to `getUser().name` MMKV so future bakes pre-fill. Skip uses the existing `'tonight’s listener'` placeholder; user explicitly accepts that the first cold open is generic.
2. **State B — Bake in flight**. The bake (or featured fallback resolution) runs while the screen shows a spinning vinyl plus subtle status copy: "Putting your first set together, <Name>...". After 20s of waiting, a quiet "Just a moment more..." reassurance appears. No time-based auto-advance — see press-play below.
3. **State C — Ready, press play**. A `StampButton` labeled "DROP THE NEEDLE" (matches the existing player idiom). Tapping it `router.replace`s to `/player` and `broadcastPlayer.start(manifest, firstSegmentUrls)` fires on mount.

State transitions are linear; the user cannot back out of State B once a bake is in flight (a back-swipe lands them on `/(main)`; the bake continues server-side and surfaces in their history).

### Why press-play, not auto-play

Auto-play after the navigation chain `music-auth → first-listen → /player` is technically allowed (the user-initiated tap on `CONNECT APPLE MUSIC` activates the audio session), but it forces audio onto a user who may have just walked into a meeting or pulled out their phone with the volume up. Press-play preserves agency and makes the audio session activation event unambiguous (the tap on `DROP THE NEEDLE` itself).

### Why gate the bake on name input

The cold open audio is pre-rendered TTS. We can't inject the name at playback time — the audio bytes are committed once the segment is generated. To get the user's name into the *first* cold open, the bake must start with `userContext.listenerName` populated. This means:

- Firebase `displayName` users: name resolves at mount; bake starts immediately and runs while the user reads the State B copy.
- Non-Firebase users: name input → submit → bake starts → ~15s wait → ready. The user is in an attended sequence (input → progress → ready), not staring at dead time.

**The roadmap's literal "<5s perceived first listen" success criterion stops being the right yardstick.** It was written assuming auto-play. With press-play, the user is always >5s from setup-finish to audio because they're in the middle of an attended UI sequence — the metric is undefined. The right reframing: **the bake should be ready by the time the user is ready to press play**, so the press-play moment feels instant rather than gated. That's measurable as `time(slot-0 ready) ≤ time(user reaches State C)` — bake completes during attended UI rather than during dead waiting. Phase 2 GATE (#38) measures retention directly; that's the metric we actually care about.

If data later shows the name-input cost outweighs the personalization benefit, v2 can re-bake slot-0 with the name once submitted (server has a slot-rebake path via the abort-and-create primitive).

### Playlist selection

```ts
async function pickFirstListenSource(): Promise<
  | { kind: 'user'; playlistId: string; playlistName: string; tracks: MusicTrack[] }
  | { kind: 'featured'; broadcastId: string }
  | { kind: 'none' }
> {
  let playlists: MusicPlaylist[] = [];
  try {
    playlists = await musicKitPlayer.fetchPlaylists();   // already lastPlayedDate-sorted
  } catch {
    // fall through to featured
  }
  for (const p of playlists) {
    const raw = await musicKitPlayer.fetchPlaylistTracks(p.id);
    const sanitized = sanitizeTracksForBake(raw);
    if (sanitized.length >= 5) {
      return { kind: 'user', playlistId: p.id, playlistName: p.name, tracks: sanitized };
    }
  }
  const featured = await fetchFeaturedRegistry();
  if (featured.length > 0) return { kind: 'featured', broadcastId: featured[0].id };
  return { kind: 'none' };
}
```

`fetchPlaylists()` already calls `MusicLibraryRequest<Playlist>().sort(by: \.lastPlayedDate, ascending: false)` (per `ExpoMusicKitModule.swift:64`). The first qualifying playlist is the most-recently-played one with enough valid tracks. The honest framing: "ONAY plays a quick set from the playlist you were just listening to."

For users who skipped Apple Music auth, `fetchPlaylists()` returns an empty array and we fall straight to `kind: 'featured'`.

### Bake parameters

`length: 'quick'` (= 5 tracks per `LENGTH_TO_N`). The roadmap spec text says "3-track" but our `quick` length is 5; treating that wording as colloquial-not-literal — no new length primitive is added.

```ts
const userContext = {
  timeOfDay: localTimeHHMM(),
  dayOfWeek: localDayOfWeekShort(),
  firstTimeUser: true,
  listenerName: name ?? 'tonight’s listener',
};
```

`firstTimeUser: true` already exists in the segment-prompt context per CLAUDE.md; the cold open template uses it to choose first-time-user phrasing. Detect "first time" via empty `BROADCAST_HISTORY` MMKV — for the first-listen screen specifically, this is always true (the screen is gated on empty history).

For `kind: 'user'`, the bake POST passes the sanitized track list. For `kind: 'featured'`, no fresh bake — the featured manifest is already in the registry; we just resolve it via `GET /broadcast/featured` and stash the result for State C.

### Gating on subsequent launches

```ts
if (hasCompletedFirstListen() || hasRecentBroadcastHistory()) {
  router.replace('/(main)');     // skip first-listen entirely
} else {
  // mount first-listen
}
```

A returning user who has completed first-listen (durable flag) or who has recent broadcast history (24h window) skips the screen. The durable flag is the primary gate — `hasRecentBroadcastHistory()` is a defensive fallback for users who onboarded before the flag was introduced.

### Failure-mode matrix

| Failure | Behavior |
|---|---|
| `fetchPlaylists` throws | Featured fallback. State B copy: "Picking tonight's set..." |
| No playlist with ≥5 valid tracks | Featured fallback. Same State B copy. |
| Featured registry empty | Skip first-listen entirely; route to `/(main)`. The user has no first-listen moment but the rest of the app works. Edge case — registry shouldn't be empty in production. |
| `POST /broadcast/create` fails or times out (30s) | State B transitions to error variant: "Hmm, can't put a set together right now. [TAKE ME HOME]". Tap → `/(main)`. The 30s timeout is on the create POST itself; the server returns synchronously once slot-0 + enrichment drain complete, so a successful response means slot-0 is ready. |
| Bake takes longer than 20s but under the 30s timeout | State B persists; "Just a moment more..." reassurance copy appears at 20s. State C activates the instant the create POST resolves. |
| User backgrounds the app during State B | Bake continues server-side. State B persists when the user foregrounds. State C button-enable fires when slot-0 lands regardless of foreground state. |
| User force-quits during State B | First-listen retries on next launch (history is still empty). The mid-flight bake on the server eventually completes and lands in history. |

## Files touched

- **Create** `app/(onboarding)/first-listen.tsx` — the prep screen; states A/B/C, name input, bake orchestration, press-play CTA.
- **Modify** `app/(onboarding)/music-auth.tsx` — `finish()` navigates to `/(onboarding)/first-listen` instead of `/(main)`.
- **Modify** `app/index.tsx` — extend the auth-redirect logic so users with empty broadcast history land on `first-listen`; users with history skip directly to `/(main)`.
- **Add** `src/services/Storage.ts` — new typed accessor `hasRecentBroadcastHistory()` (alongside the existing `getBroadcastHistory()` from `BroadcastResumer`) plus durable `markFirstListenCompleted()` / `hasCompletedFirstListen()` for the onboarding gate.
- **Document** `modules/expo-music-kit/index.ts` — JSDoc on `fetchPlaylists()` capturing the `lastPlayedDate` ordering semantic so callers can rely on it.
- **Update** `CLAUDE.md` — note `fetchPlaylists` ordering + the first-listen onboarding flow in the project structure / onboarding section.

## Test strategy

- **Native module documentation**: no test code change. The JSDoc on `fetchPlaylists` is documentation, not behavior.
- **Playlist selection helper** (`pickFirstListenSource`): pure-ish function that takes mocked `fetchPlaylists` / `fetchPlaylistTracks` / `fetchFeaturedRegistry` results; covers the user-playlist-found, no-qualifying-playlist, fetchPlaylists-throws, and all-fail-to-featured paths. Lives at a new file `src/onboarding/firstListenSource.ts` with tests at `__tests__/onboarding/firstListenSource.test.ts`.
- **Screen states**: Jest + React Native Testing Library. Three unit tests for States A/B/C (rendering correctness given props/state). One integration test for the State A → B transition on name submit (mocked bake call, verifies `userContext.listenerName` is in the request body). Auto-advance into State C is testable via mock-resolving the bake promise.
- **Press-play handoff**: assert that tapping `DROP THE NEEDLE` calls `router.replace('/player')` and that `broadcastPlayer.start` is called with the resolved manifest. Mock both.
- **TestFlight verification**: this is the only place we get real-device confirmation that `lastPlayedDate` returns sensible order for fresh-auth users. Add a manual checklist item to the PR test plan: "On a fresh sign-in to a real device, the playlist used by first-listen matches what I was last listening to in the iOS Music app."

## Failure modes considered

- **Cold open committed without name**: by design — see "Why gate the bake on name input." V2 can address by re-baking slot-0 once name is submitted, using the existing abort + create primitive.
- **First-listen runs twice on the same user**: gated on `hasCompletedFirstListen()` (durable) with `hasRecentBroadcastHistory()` as a fallback for users who onboarded before the flag landed. A returning user who somehow clears both (device reset) gets the screen again — acceptable.
- **Name persists but cold open audio doesn't**: `getUser().name` is updated synchronously when the user submits, *before* the bake POST. The bake's request body uses the just-stored name. No race — submit handler awaits the storage write before triggering the bake.
- **`fetchPlaylists` returns no playlists for an authorized user**: shouldn't happen but does for some accounts (rare). Featured fallback handles it.
- **Server unreachable during onboarding**: bake POST fails fast (the existing `withRetry` chain bails on AbortError; first-listen sets a 30s timeout on the create call). User sees the State B error variant; cleanup is graceful.

## Open questions

None at design time. The latency-vs-name-personalization tradeoff and the press-play vs auto-play call are both decided.

# Last.fm Scrobble — Design

**Issue:** [#37 — Phase 2 — LT-7 User-facing Last.fm scrobble](https://github.com/bworthy89/cleo/issues/37)
**Status:** Approved 2026-04-26 (brainstorm) → ready for implementation plan
**Phase:** 2 — Parity Sprint
**Roadmap:** [`2026-04-24-onay-roadmap-design.md`](./2026-04-24-onay-roadmap-design.md) → Phase 2 item 2

## Problem

ONAY plays Apple Music tracks but doesn't report listens to Last.fm, leaving users
who scrobble from every other music app with a hole in their listening history. The
existing server-side `LastFmFetcher` uses an app-level API key for genre-tag
enrichment — this is a separate per-user flow that requires OAuth, per-user tokens,
and live writes to the user's Last.fm account.

**Phase 2 success criterion:** scrobbles visible in the user's Last.fm account
within 30s of a track passing the scrobble threshold (Last.fm's official rule:
`min(50% × duration, 240s)`, tracks <30s never scrobble).

## Goals

- Connect/disconnect a personal Last.fm account from ProfileScreen
- Per-user OAuth session keys stored in Firestore (not MMKV — sensitive)
- "Now playing" reported to Last.fm immediately when a track starts
- "Scrobble" reported when the user has listened past the threshold, even if they
  background or kill the app afterward
- Sticky reconnect prompt when the user has revoked the app on last.fm.com — silent
  failures for transient errors only

## Non-goals

- **No offline queue.** Best-effort only. If the device is offline or Last.fm 5xx's,
  the scrobble is dropped (logged server-side, no retry). Re-evaluate if users
  complain in Phase 2 weeks 5+.
- **No "love" / unlove integration with #36 (thumbs-up save).** Track ↔ liked-track
  ↔ Last.fm `track.love` is a follow-up, not part of LT-7.
- **No bulk import** of pre-ONAY Apple Music history.
- **No multi-account** support (one Last.fm account per ONAY account).
- **No edits to the existing enrichment-flow `LastFmFetcher`.** New code lives
  in a sibling directory; only the `LASTFM_API_KEY` env var is shared.

## Architecture

```
┌────────────────────────────┐         ┌──────────────────────┐
│ ProfileScreen              │         │ Firestore            │
│  • Connect / Disconnect    │◀───────▶│ users/{uid}/         │
│  • Status row (subscribe)  │   live  │   integrations/      │
└──────────┬─────────────────┘         │     lastfm           │
           │                            │  { sessionKey,       │
           │ openAuthSessionAsync       │    username,         │
           │  (in-app Safari)           │    needsReconnect,   │
           ▼                            │    connectedAt }     │
┌────────────────────────────┐         └──────────┬───────────┘
│ Last.fm web auth page      │                    │
│ user logs in + grants      │                    │ server reads
└──────────┬─────────────────┘                    │ sessionKey
           │ redirect → cleo://lastfm-callback     │ by uid
           ▼                                        │
┌────────────────────────────┐                    │
│ ProfileScreen handler      │                    │
│  POST /lastfm/connect      │───────────────────▶│ writes
│   { token }                │                    │
└────────────────────────────┘                    │
                                                  │
┌────────────────────────────┐                    │
│ BroadcastPlayer            │                    │
│  runTrackAt() → music.play │                    │
│   ─▶ POST /lastfm/now-     │───┐                │
│      playing                │  │                │
│  elapsed-pump tick:         │  │                │
│   threshold crossed ─▶      │  │                │
│   POST /lastfm/scrobble     │──┤                │
└────────────────────────────┘  │                 │
                                ▼                 │
                       ┌─────────────────────┐    │
                       │ Server (Express)    │    │
                       │  /lastfm/auth-url   │    │
                       │  /lastfm/connect    │    │
                       │  /lastfm/now-       │    │
                       │     playing         │    │
                       │  /lastfm/scrobble   │    │
                       │  /lastfm/disconnect │    │
                       │                     │◀───┘
                       │  LastFmClient       │
                       │   • signRequest()   │     ┌────────────┐
                       │   ─ on err code 9 ─┼────▶│  Firestore │
                       │     write needsRe- │      │  flips     │
                       │     connect: true  │      │  needsRe-  │
                       └──────────┬─────────┘      │  connect   │
                                  │                └────────────┘
                                  ▼
                       ┌─────────────────────┐
                       │ ws.audioscrobbler   │
                       │   .com/2.0          │
                       └─────────────────────┘
```

**Key properties:**
- All five new routes live in `server/src/routes/lastfm.ts` behind `requireAuth`.
  User context = `req.uid` (Firebase JWT).
- Firestore doc at `users/{uid}/integrations/lastfm` — single doc, not a
  subcollection. Mirrors the `LikedTracksService` per-user collection layout.
- No queue, no worker process, no retries. Best-effort sync POST.
- `needsReconnect` is the only stateful flag the server writes back. Client
  subscribes via `firestore().doc(...).onSnapshot` and re-renders.

### Server prerequisite — Firebase Admin SDK

The server currently verifies Firebase JWTs via raw JWKS + `jsonwebtoken`
(`server/src/middleware/auth.ts`). It does **not** have `firebase-admin` wired in.
This design requires server-side Firestore writes (sessionKey storage,
`needsReconnect` flag), which means adding the Admin SDK is a hard prerequisite:

- Add `firebase-admin` to `server/package.json` dependencies
- Initialize once in `server/src/firebase.ts` (new file) — singleton pattern,
  exports `db()` returning the Firestore Admin instance
- Provision a service account JSON file out-of-band: download from Firebase
  console (`cleo-app-840c8` → Project Settings → Service accounts → Generate
  new private key), store on the VPS at `/home/cleo/cleo-broadcast/firebase-service-account.json`,
  reference via `GOOGLE_APPLICATION_CREDENTIALS=/home/cleo/.../firebase-service-account.json`
  in the PM2 ecosystem env file
- Local dev: same env var pointing at a developer-checked-out copy of the JSON
  (gitignored), or `gcloud auth application-default login` for the same effect

This is non-trivial setup but unavoidable for any future server-side Firestore
writes (next likely consumer: scheduled featured-broadcast bakes per "What's
left" in CLAUDE.md). Doing it here lays the groundwork.

## OAuth flow (Last.fm desktop-style web auth)

Last.fm doesn't do OAuth 2.0 — they have their own three-leg flow. Session keys
never expire (until the user revokes them on last.fm.com).

```
1. CLIENT  → server   POST /lastfm/auth-url
2. SERVER  → returns  { url: "https://www.last.fm/api/auth?api_key=K&cb=cleo://lastfm-callback" }

3. CLIENT  WebBrowser.openAuthSessionAsync(url, "cleo://lastfm-callback")
   user logs in on last.fm + clicks "Yes, allow access"
   last.fm → cleo://lastfm-callback?token=ABC123
   openAuthSessionAsync resolves with { type: "success", url: "cleo://...?token=ABC123" }

4. CLIENT  parses token, POST /lastfm/connect { token: "ABC123" }

5. SERVER  signs auth.getSession call:
             GET /2.0?method=auth.getSession&api_key=K&token=ABC123&api_sig=MD5(...)
           response: { session: { name: "kari_w", key: "SESSION_KEY_XYZ" } }
           writes Firestore doc, returns 204
```

**Why this shape:**
- Step 1's "ask the server for the auth URL" indirection keeps `LASTFM_API_KEY`
  server-only. The key isn't a true secret in Last.fm's model, but keeping it
  out of the client bundle avoids accidental rotation pain.
- `WebBrowser.openAuthSessionAsync` is the only Expo API that shares cookies
  with Safari, so users already logged into last.fm.com don't have to log in
  again.
- `cb=cleo://...` reuses the existing app scheme already in `app.json`. No new
  URL scheme registration needed.

### Disconnect

`POST /lastfm/disconnect` deletes the Firestore doc. We don't call a Last.fm
revoke endpoint because Last.fm doesn't expose one for desktop-flow apps; the
user has to revoke at `last.fm/settings/applications` to fully kill it. Doc
deletion stops our app from scrobbling, which is what "disconnect" means in
our context. One-tap (no confirm dialog) — symmetric with the Connect button,
re-connecting is two taps.

## Firestore schema

```ts
// users/{uid}/integrations/lastfm
{
  sessionKey: string;        // permanent until revoked
  username: string;          // display name, used for "connected as @x"
  needsReconnect: boolean;   // server flips to true on Last.fm error code 9
  connectedAt: Timestamp;    // initial connect
  reconnectedAt?: Timestamp; // most-recent successful re-auth
}
```

`sessionKey` is a long-lived bearer token for the user's Last.fm account. Treat
as a secret:

```
// firestore.rules — additive
match /users/{userId}/integrations/{integrationId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if false;  // server-only via Admin SDK
}
```

Stricter than the existing `likes/` rule (which permits client writes for the
optimistic toggle UX). Server-only writes mean a compromised client can't replace
the sessionKey with garbage. Client-side disconnect = client calls
`POST /lastfm/disconnect` and lets the server delete; never write directly.

## Client emission

### Hook points in `BroadcastPlayer.ts`

```ts
// runTrackAt, around L640
await this.music.play([track.id]);
console.log(`[BroadcastPlayer] music.play resolved for ${track.id}`);
this.scrobbler.onTrackStarted(track);                          // NEW
await this.waitForTrackEnd();
```

```ts
// inside startElapsedPump's 1-second tick (already runs)
const elapsed = await this.music.getPlaybackTime();
this.music.setNowPlayingElapsed(elapsed, true);
this.scrobbler.onElapsedTick(track, elapsed);                  // NEW
```

```ts
// end()
this.currentTrackIndex = -1;
this.scrobbler.reset();                                        // NEW
```

### `Scrobbler` class (`src/engines/Scrobbler.ts`)

Pure (no Firebase / native imports), like `BroadcastPlayer` itself, so it can
be unit-tested without the singleton.

```ts
class Scrobbler {
  private currentId: string | null = null;
  private startedAt = 0;       // ms epoch — sent as scrobble timestamp
  private threshold = 0;       // seconds at which to fire scrobble
  private scrobbledThisTrack = false;

  constructor(private api: ScrobblerApi) {}

  onTrackStarted(track: ManifestTrack) {
    this.currentId = track.id;
    this.startedAt = Date.now();
    this.scrobbledThisTrack = false;

    const dur = track.duration ?? 180;
    if (dur < 30) {
      // Last.fm: tracks under 30s never scrobble.
      this.scrobbledThisTrack = true;
      return;
    }
    this.threshold = Math.min(dur * 0.5, 240);

    this.api.nowPlaying({
      trackId: track.id,
      title: track.title,
      artistName: track.artistName,
      albumTitle: track.albumTitle,
      duration: dur,
    }).catch(() => {});
  }

  onElapsedTick(track: ManifestTrack, elapsedSec: number) {
    if (this.scrobbledThisTrack) return;
    if (track.id !== this.currentId) return;
    if (elapsedSec < this.threshold) return;

    this.scrobbledThisTrack = true;
    this.api.scrobble({
      trackId: track.id,
      title: track.title,
      artistName: track.artistName,
      albumTitle: track.albumTitle,
      duration: track.duration ?? 180,
      startedAt: Math.floor(this.startedAt / 1000),  // Last.fm wants unix seconds
    }).catch(() => {});
  }

  reset() {
    this.currentId = null;
    this.scrobbledThisTrack = false;
  }
}

interface ScrobblerApi {
  nowPlaying(t: ScrobblePayload): Promise<void>;
  scrobble(t: ScrobblePayload & { startedAt: number }): Promise<void>;
}
```

### Threshold-on-tick rather than threshold-at-track-end

1. **App-kill resilience.** If the user backgrounds + Force-Quits at minute 4
   of a 5-minute track, they listened past 50%. Firing on threshold-crossing
   means the event is in transit before we lose the runtime. Track-end firing
   would lose it.
2. **Pause behavior.** `getPlaybackTime` reports actual MusicKit position, which
   freezes during a pause and resumes from the same point. Threshold = "cumulative
   time the track has been on the speakers", which is what Last.fm's rule means.
   No extra accounting needed.

If the user pauses forever and never crosses the threshold, no scrobble. Correct.

### Skip / end-broadcast

Users can't skip individual tracks (broadcast is locked). The only ways a track
ends early are: end-of-track (scrobble already fired), broadcast end via "stop"
button (drop), or app crash (drop). `end()` calls `scrobbler.reset()`. Consistent
with Last.fm's own client behavior.

### Wiring

`BroadcastPlayer` constructor takes a `scrobbler` dep — same pattern as the
existing `BroadcastPlayer.singleton.ts`. Tests pass a mock. Production singleton
wires the real one with an `authenticatedFetch`-backed `ScrobblerApi`.

### What about segments?

Segments duck MusicKit (no track playing) and are pure TTS. Nothing to scrobble.
`Scrobbler` only ever sees `onTrackStarted` from `runTrackAt`, never from
`runSegmentAt`. No filtering needed.

### Featured / curator broadcasts

Use the same player path. The playing user gets the scrobble credit, not the
curator. No per-broadcast logic needed.

## Server

### Routes (`server/src/routes/lastfm.ts`)

All five behind `requireAuth`. Bodies validated by Zod. Sanitize `title` /
`artistName` / `albumTitle` before forwarding (per CLAUDE.md — they're
user-supplied).

| Route | Body | Behavior |
|---|---|---|
| `POST /lastfm/auth-url` | — | Returns `{ url }` to last.fm authorize page |
| `POST /lastfm/connect` | `{ token }` | Calls `auth.getSession`, writes Firestore doc, returns 204 |
| `POST /lastfm/disconnect` | — | Deletes Firestore doc, returns 204 |
| `POST /lastfm/now-playing` | `{ trackId, title, artistName, albumTitle?, duration }` | Reads sessionKey, calls `track.updateNowPlaying`, returns 204. On error code 9 → flip `needsReconnect: true`, return 401 |
| `POST /lastfm/scrobble` | `{ trackId, title, artistName, albumTitle?, duration, startedAt }` | Reads sessionKey, calls `track.scrobble`, returns 204. Same error-code-9 handling |

`/lastfm/now-playing` and `/lastfm/scrobble` opt out of `generationLimiter`
(not generation requests). Add a separate lightweight `scrobbleLimiter` keyed
on uid: 60 req/min (single broadcast emits ~9 now-playings + ~9 scrobbles spread
over 30+ minutes — well under).

### `LastFmClient` (`server/src/services/lastfm/LastFmClient.ts`)

Single class that owns API key + secret + signed-request construction. Lives in
a sibling directory to the enrichment `LastFmFetcher` so the two never share
state.

```ts
class LastFmClient {
  signRequest(params: Record<string, string>): string {
    // sorted keys, concat k+v, append secret, MD5
  }
  async getSession(token: string): Promise<{ key: string; name: string }>
  async updateNowPlaying(sessionKey: string, t: ScrobbleTrack): Promise<LastFmResult>
  async scrobble(sessionKey: string, t: ScrobbleTrack): Promise<LastFmResult>
}

type LastFmResult =
  | { ok: true }
  | { ok: false; errorCode: number; errorMessage: string };
```

Constructor throws on missing `LASTFM_API_KEY` / `LASTFM_API_SECRET` so misconfig
fails loud at boot — same pattern as the rest of the providers.

### Error code → state mapping

| Last.fm code | Meaning | Action |
|---|---|---|
| 9 | Invalid session key (revoked or rotated) | Set `needsReconnect: true`, return 401 |
| 4 | Authentication failed (also a sticky condition) | Same as 9 |
| 11, 16 | Service offline, temporarily unavailable | Log, return 502, no state change |
| any other | Unknown | Log, return 502, no state change |

## ProfileScreen UI

New component `LastFmRow.tsx` in `src/components/profile/`. Sits above `LikedRow`
in the body. Three visual states, all in the existing Crate Digger language —
no new tokens, no new motion:

- **Disconnected:** Hairline row, mono kicker `LAST.FM`, Anton label `CONNECT`,
  tap → CTA-style press feedback. Tap opens the auth flow.
- **Connected:** Hairline row, mono kicker `LAST.FM`, Fraunces-italic body
  `connected as @username`, mono trailing label `DISCONNECT` in `inkDim`. Tap
  on the right side disconnects.
- **Needs reconnect:** Same as Connected but trailing label is `RECONNECT` in
  `amber`, plus a tiny amber dot left of the `LAST.FM` kicker. Tap re-runs the
  auth flow (the new sessionKey overwrites the old doc).

State subscription via `firestore().doc(\`users/${uid}/integrations/lastfm\`).onSnapshot(...)`
in a new `useLastFmIntegration()` hook — mirrors the `useLikedTracks` shape next
door.

## New env vars (`server/.env`)

```env
LASTFM_API_KEY            # already exists for enrichment — reused
LASTFM_API_SECRET         # NEW — required for signed requests (auth.getSession,
                          # track.scrobble, track.updateNowPlaying)
```

Both come from the same Last.fm API account at `last.fm/api/account`. No new
third-party signup. Provision on Hostinger VPS via the PM2 ecosystem env file
before merging server.

## Testing

### Server (`server/__tests__/lastfm/`)

- `LastFmClient.test.ts` — sign-request golden values from Last.fm's docs;
  response parsing for happy path, error 9, error 4, unknown error
- `routes-lastfm.test.ts` — auth gate, Zod validation, error-9 → Firestore flag
  write, happy path round-trip with a stub `LastFmClient`
- Reuse the Firestore-mock pattern from `LikedTracksService` tests

### Client (`src/engines/__tests__/Scrobbler.test.ts`)

- `onTrackStarted` fires `nowPlaying` with correct payload
- Track <30s → no scrobble ever
- Threshold = `min(0.5×duration, 240)` — table-driven for 60s, 180s, 600s, 4000s
- Multiple ticks past threshold → exactly one scrobble
- Track switch resets `scrobbledThisTrack`
- `reset()` mid-track stops scrobble
- Pure class — no `BroadcastPlayer` involvement

### Manual

1. Connect with a real Last.fm account, run a broadcast, verify scrobbles appear
   at `last.fm/user/<name>` within 30s of each track's threshold crossing
2. Revoke the app at `last.fm/settings/applications`, run a broadcast, verify
   the row flips to "RECONNECT" within seconds (Firestore subscription) and no
   garbage scrobbles
3. Re-connect with the row's RECONNECT button — verify subsequent tracks scrobble
   again

## Rollout

1. **Firebase Admin SDK prep** (one-time):
   - Generate service account JSON from Firebase console for `cleo-app-840c8`
   - Upload to VPS at `/home/cleo/cleo-broadcast/firebase-service-account.json`
     (mode 600, owned by `cleo`)
   - Set `GOOGLE_APPLICATION_CREDENTIALS` in PM2 ecosystem env
   - Add to `.gitignore`
2. **Server env**: provision `LASTFM_API_SECRET` on Hostinger VPS via `pm2
   ecosystem` env file before merging server
3. **Firestore rules**: deploy via `firebase deploy --only firestore:rules`
   *before* the client ships, so the strict `allow write: if false` is live
   before any client tries to write
4. **Server deploy** with the new routes + Admin SDK
5. **TestFlight build** separately from any other Phase 2 work so the
   manual-revoke test is a clean signal

## Files touched

**New (client):**
- `src/engines/Scrobbler.ts`
- `src/engines/Scrobbler.types.ts`
- `src/engines/__tests__/Scrobbler.test.ts`
- `src/services/LastFmService.ts` — wraps `authenticatedFetch` for the four
  user-facing routes (connect / disconnect / nowPlaying / scrobble)
- `src/hooks/useLastFmIntegration.ts`
- `src/components/profile/LastFmRow.tsx`

**Modified (client):**
- `src/engines/BroadcastPlayer.ts` — three hook points (runTrackAt, elapsed-pump,
  end)
- `src/engines/BroadcastPlayer.singleton.ts` — wire production `Scrobbler`
- `src/screens/settings/ProfileScreen.tsx` — render `LastFmRow` above `LikedRow`
- `app.json` — confirm `cleo://` scheme already covers the OAuth callback (it does)

**New (server):**
- `server/src/firebase.ts` — Admin SDK singleton, exports `db()`
- `server/src/routes/lastfm.ts`
- `server/src/services/lastfm/LastFmClient.ts`
- `server/__tests__/lastfm/LastFmClient.test.ts`
- `server/__tests__/lastfm/routes-lastfm.test.ts`

**Modified (server):**
- `server/package.json` — add `firebase-admin`
- `server/src/index.ts` — mount `lastfm` router, add `scrobbleLimiter`
- `server/.env.example` — add `LASTFM_API_SECRET` + `GOOGLE_APPLICATION_CREDENTIALS`
- `server/.gitignore` — exclude `firebase-service-account.json`

**Modified (Firebase):**
- `firestore.rules` — add `users/{uid}/integrations/{id}` rule

**Modified (docs):**
- `CLAUDE.md` — add scrobble flow under "The Pre-Baked Broadcast Pipeline" or
  a new "Integrations" subsection

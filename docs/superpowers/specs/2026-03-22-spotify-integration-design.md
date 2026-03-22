# Spotify Integration Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Add Spotify as an alternative music provider to ONAY, alongside Apple Music. Users choose their provider at onboarding (exclusive choice). The architecture introduces a `MusicProvider` protocol that both Apple Music and Spotify implement, allowing all consumers (AudioCoordinator, TransitionPreloader, BroadcastScreen) to depend on an abstract interface rather than a concrete player.

## Decisions

- **Provider model:** Exclusive choice at onboarding. One provider per user, switchable in settings.
- **Spotify tier:** Premium only. On-demand playback, queue control, skip, and seek are required for ONAY's radio experience.
- **Playlist sourcing:** User's own Spotify playlists + ONAY-curated editorial Spotify playlists as stations.
- **Eject transitions:** TTS overlay approach. ONAY's voice plays via AVAudioPlayer over Spotify's audio (no ducking). Skip to next track via SPTAppRemote playerAPI at eject point. Two-layer instead of Apple Music's three-layer crossfade.
- **Architecture:** Provider abstraction layer (Approach 1). Clean protocol with two honest implementations.

## Provider Protocol

```typescript
// src/providers/MusicProvider.ts
interface MusicProvider {
  // Auth
  authorize(): Promise<AuthResult>
  getAuthorizationStatus(): Promise<AuthStatus>

  // Library
  fetchPlaylists(): Promise<MusicPlaylist[]>
  fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]>

  // Playback
  play(trackIds?: string[], playlistId?: string): Promise<void>
  pause(): Promise<void>
  skip(): Promise<void>
  skipToPrevious(): Promise<void>
  seekTo(time: number): Promise<void>
  setUpcomingQueue(trackIds: string[]): Promise<void>
  clearQueueCache(): Promise<void>

  // State
  getNowPlaying(): Promise<NowPlaying | null>
  getNextInQueue(): Promise<NextTrack | null>
  getPlaybackTime(): Promise<number>
  getPlaybackStatus(): Promise<PlaybackStatus>
  getUpcomingQueue(count: number): Promise<UpcomingTrack[]>

  // TTS (provider-specific audio coordination)
  activateDuckingSession(): Promise<void>
  deactivateDuckingSession(): Promise<void>
  playAudioFromBase64(base64: string): Promise<void>
  stopAudio(): Promise<void>
  setTTSVolume(volume: number): Promise<void>

  // Eject (each provider encapsulates its own eject behavior)
  playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void>
  cancelEjectTransition(): Promise<void>

  // Events
  onTrackChanged(cb: TrackChangedCallback): () => void
  onPlaybackStateChanged(cb: PlaybackStateCallback): () => void
  onEjectTrackChanged(cb: EjectTrackChangedCallback): () => void

  // Connection status (relevant for Spotify IPC; always 'connected' for Apple Music)
  readonly connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error'
  onConnectionStatusChanged(cb: (status: string) => void): () => void

  // Provider info
  readonly providerType: 'apple-music' | 'spotify'
  readonly supportsDucking: boolean
  readonly supportsThreeLayerCrossfade: boolean
}
```

**Singleton pattern (not factory-per-call):**
```typescript
// src/providers/index.ts
let _provider: MusicProvider | null = null

function getMusicProvider(): MusicProvider {
  if (!_provider) {
    const type = Storage.getString('musicProvider')
    _provider = type === 'spotify' ? new SpotifyProvider() : new AppleMusicProvider()
  }
  return _provider
}

function resetMusicProvider(): void {
  _provider = null  // Called when switching providers in settings
}
```

Consumers check capability flags (`supportsDucking`, `supportsThreeLayerCrossfade`) instead of provider names.

### Provider Method Behavior by Implementation

| Method | AppleMusicProvider | SpotifyProvider |
|--------|-------------------|-----------------|
| `activateDuckingSession()` | Sets AVAudioSession with `.duckOthers` | No-op (cannot duck cross-process) |
| `deactivateDuckingSession()` | Removes `.duckOthers` from session | No-op |
| `playAudioFromBase64(base64)` | Plays via AVAudioPlayer at current volume | Plays via AVAudioPlayer at 0.85 volume, `.mixWithOthers` only |
| `playEjectTransition(base64, delay)` | Native three-layer crossfade (old out + TTS + new in) | Plays TTS overlay + schedules `skipToNext()` at delay |
| `getNextInQueue()` | Reads MusicKit's `ApplicationMusicPlayer.Queue` | Returns local queue plan entry (verified at pre-gen via Web API) |
| `getUpcomingQueue(count)` | Reads MusicKit queue | Returns next N entries from local queue plan |
| `clearQueueCache()` | Clears native `cachedTracks`/`cachedSongs` | No-op (no server-side queue to clear) |
| `setTTSVolume(volume)` | Sets AVAudioPlayer volume | Sets AVAudioPlayer volume (capped at 0.85 default) |
| `connectionStatus` | Always `'connected'` | Reflects `SPTAppRemote` connection state |

## Spotify Native Module (`expo-spotify`)

### Structure

```
modules/
├── expo-music-kit/          (unchanged)
└── expo-spotify/
    ├── expo-module.config.json
    ├── index.ts
    ├── src/ExpoSpotifyModule.ts
    └── ios/
        ├── ExpoSpotifyModule.swift
        └── ExpoSpotify.podspec
```

### Responsibilities

1. **Auth & Connection** — `SPTConfiguration` + `SPTSessionManager` for OAuth. `SPTAppRemote` for app-to-app IPC. Token swap/refresh via Fastify server routes. Scopes: `app-remote-control`, `playlist-read-private`, `user-library-read`.

2. **Playback Control** — Thin wrappers around `appRemote.playerAPI`: `play(uri)`, `pause()`, `resume()`, `skipToNext()`, `seekToPosition(ms)`, `enqueueTrackUri(uri)`.

3. **Player State Subscription** — `SPTAppRemotePlayerStateDelegate`. On each `playerStateDidChange`, emit JS event with normalized data (track name, artist, album, duration, playbackPosition, isPaused). Push-based, not polled.

4. **Track Change Detection** — Compare `playerState.track.uri` on each delegate callback. Emit `onTrackChanged` when track URI changes. The module must track the previous track URI internally to emit `previousTrackId` in the event (Spotify's delegate only provides current state, not previous).

5. **TTS Playback (standalone AVAudioPlayer):**
   - Audio session: `.playback` with `.mixWithOthers` only (no `.duckOthers`)
   - TTS volume: 0.85 over Spotify's full-volume music
   - Crossfade timer still fires 1s before TTS end for overlay dismiss timing

6. **Eject Transition (two-layer):**
   - Play TTS audio (overlays Spotify music)
   - At fadeInDelay: call `skipToNext()` via playerAPI
   - Emit `onEjectTrackChanged` when `playerStateDidChange` reports new track

7. **Connection Lifecycle:**
   - `isSpotifyInstalled()` via `canOpenURL` for `spotify:` scheme
   - Auto-reconnect on `didDisconnectWithError` — emit `connectionStatus` changes to JS
   - If Spotify killed during eject: detect skip failure, suppress `onEjectTrackChanged`, let normal `onTrackChanged` fallback path handle recovery
   - If disconnected mid-session: BroadcastScreen shows "Reconnecting to Spotify..." state, engines defer operations until reconnected

8. **Spotify Connect Guard:**
   - On connection, check if active device is the local iPhone (via Web API `GET /me/player/devices`)
   - If playback is on a remote device (desktop, speaker), show "Transfer playback to this device?" prompt
   - Do not start broadcast while playback target is a remote device

### What It Does NOT Handle

- Playlist/track fetching (via Spotify Web API through server)
- Volume ducking (not possible across process boundaries)
- Three-layer crossfade (Spotify controls its own fade)

## Server-Side Changes

### New Routes (`server/src/routes/spotify.ts`)

All protected by `requireAuth` middleware.

1. **`POST /spotify/token-swap`** — Receives auth code, exchanges for access + refresh tokens via Spotify token endpoint. Client secret stays server-side.

2. **`POST /spotify/token-refresh`** — Takes refresh token, returns fresh access token.

3. **`POST /spotify/playlists`** — Proxies `GET /me/playlists` via Spotify Web API. Normalizes to `MusicPlaylist[]`. Handles pagination.

4. **`POST /spotify/playlist-tracks`** — Proxies `GET /playlists/{id}/tracks`. Normalizes to `MusicTrack[]`. Maps `duration_ms` to seconds. Fetches genres from artist objects via batch `GET /artists` call.

5. **`POST /spotify/curated-stations`** — Returns ONAY editorial Spotify playlist URIs from server config.

### Token Swap Architecture

`SPTSessionManager` is configured with `tokenSwapURL` and `tokenRefreshURL` pointing to the Fastify server routes. The native module does NOT handle token exchange — `SPTSessionManager` calls the server directly via these URLs (this is the pattern Spotify recommends). The JS layer receives the access token after OAuth completes and passes it to Web API calls for playlist fetching.

Token expiry handling: `SpotifyProvider` stores token expiry time. Before any Web API call (playlist fetch, queue verification at pre-gen), check expiry and call token refresh if needed. On 401 from any Web API call, trigger refresh and retry once.

### New Environment Variables

```
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
```

### Rate Limit Handling

Spotify Web API has undocumented rate limits (~100 req/30s). The `/spotify/playlist-tracks` route batches artist genre lookups (max 50 artists per `GET /artists` call). For large playlists (200+ tracks), space batch calls with 500ms delays. Return tracks immediately with genres populated asynchronously if needed.

### Unchanged Routes

- `/generate-segment`, `/synthesize-voice`, `/enrich-track` — provider-agnostic (take track metadata, not provider IDs)
- Enrichment pipeline (MusicBrainz, Genius) works off artist/track names

## Onboarding Flow

### `music-auth.tsx` — Provider Choice

1. New screen before authorization: "Choose Your Music" with Apple Music and Spotify cards
2. Selection stored: `Storage.set('musicProvider', 'apple-music' | 'spotify')`
3. Apple Music path: existing `MusicKit.authorize()` (unchanged)
4. Spotify path:
   - Check `isSpotifyInstalled()` → show "Spotify app required" + App Store link if missing
   - Initiate `SPTSessionManager` OAuth flow
   - On success: connect `SPTAppRemote`, then `userAPI.fetchCapabilities()` → check `canPlayOnDemand` (requires active connection, not just OAuth session)
   - If not Premium: show "ONAY requires Spotify Premium" message, block progress

### Existing User Migration

Existing Apple Music users who update the app will NOT see the provider choice screen. If `Storage.getString('musicProvider')` is undefined, default to `'apple-music'` (preserves current behavior). The provider choice is only shown to new users during onboarding. Existing users can switch to Spotify via ProfileScreen's "Switch Music Service" option.

### `HomeScreenRedesign.tsx`

- Reads `musicProvider` from storage
- Calls `provider.fetchPlaylists()` (routes to correct backend)
- Shows curated stations section (Spotify editorial playlists or Apple Music equivalents)
- Playlist cards identical regardless of provider (same `StationCard`, same gold-edge styling)

### Provider Indicator

- Small provider icon badge on station cards and broadcast screen header
- Provider name in ProfileScreen under "CONNECTED ECOSYSTEM"

### Switching Providers (`ProfileScreen.tsx`)

- "Switch Music Service" option
- Clears session memory (station/queue is provider-specific)
- Triggers re-auth for new provider
- Does not re-run full onboarding

## AudioCoordinator Adaptations

Capability-based branching:

- **`pre_song` with ducking (Apple Music):** `activateDuckingSession()` → `playAudioFromBase64()` → `deactivateDuckingSession()` (unchanged)
- **`pre_song` without ducking (Spotify):** `activateDuckingSession()` is a no-op → `playAudioFromBase64()` plays TTS at 0.85 vol over Spotify → `deactivateDuckingSession()` is a no-op. AudioCoordinator code path is identical — the provider absorbs the difference.
- **`post_song` path:** Both providers follow the same code path. `playAudioFromBase64()` handles audio session internally within each provider's native module. Apple Music ducks; Spotify overlays.
- Crossfade timer (1s before TTS end) still fires for overlay dismiss timing on both providers.
- Mid-song drops work identically on both providers.
- If `provider.connectionStatus === 'disconnected'`, skip commentary generation entirely (same as existing offline guard).

## TransitionPreloader Adaptations

- Pre-generation flow identical: poll → 25s generate → cache → wait for eject point
- `tryFireEject()` calls `provider.playEjectTransition(base64, fadeInDelay)` on both providers — each provider encapsulates its own eject behavior internally:
  - Apple Music: native three-layer crossfade (old out + TTS + new in)
  - Spotify: TTS overlay + scheduled `skipToNext()` at fadeInDelay
  - Both emit `onEjectTrackChanged` when the new track lands
- TransitionPreloader does NOT branch on provider — it calls the same method. The abstraction is clean here.

### `getNextInQueue()` for Spotify

Spotify's `SPTAppRemote` has no "peek at queue" API.

- **Primary:** Local queue plan (QueuePlanner's ordered list) — instant, no network
- **Verification at pre-gen time:** Spotify Web API `GET /me/player/queue` confirms actual next track. Note: this endpoint can lag behind `enqueueTrackUri` calls by several seconds. Add a 2s delay after enqueue before verifying, or accept occasional mismatches.
- **On mismatch:** Regenerate eject script with correct track name
- **User-added queue items:** If the user adds songs via the Spotify app, they interleave with ONAY's enqueued tracks. This is a known limitation — ONAY's eject script may name the wrong next track. The safety net in `tryFireEject` (re-verify at fire time) catches most cases.

## Queue Management for Spotify

### Track-by-Track Enqueue Strategy

Spotify's `SPTAppRemote` doesn't support bulk queue building like MusicKit.

1. `play("spotify:track:{firstTrackUri}")` starts the first track
2. `enqueueTrackUri("spotify:track:{nextTrackUri}")` queues the next one
3. On each `onTrackChanged`, enqueue the next 1-2 tracks from the queue plan
4. `setUpcomingQueue()` implementation: enqueue next planned tracks sequentially

### Limitations

- No "clear queue" API — maintain local pointer into QueuePlanner's list
- AI queue upgrade may enqueue a track that's already queued (edge case, acceptable — still a good song)
- No bulk reorder — tracks enqueued one at a time

### Track URI Mapping

- Spotify: `spotify:track:{id}` URIs
- Apple Music: catalog IDs
- `MusicTrack.id` stores provider-native ID
- Server enrichment routes receive title + artist (provider-agnostic)

## File Impact Summary

### New Files

| File | Purpose |
|------|---------|
| `modules/expo-spotify/` | Native module for SPTAppRemote |
| `src/providers/MusicProvider.ts` | Interface + shared types |
| `src/providers/AppleMusicProvider.ts` | Wraps MusicKitPlayer + expo-music-kit |
| `src/providers/SpotifyProvider.ts` | Wraps expo-spotify + Web API |
| `src/providers/index.ts` | Factory function |
| `server/src/routes/spotify.ts` | Token swap, playlists, curated stations |

### Modified Files

| File | Change |
|------|--------|
| `music-auth.tsx` | Provider choice screen before auth |
| `HomeScreenRedesign.tsx` | Provider-aware playlists + curated stations |
| `BroadcastScreen.tsx` | Replace all direct `expo-music-kit` imports (`getNextInQueue`, `skipToPrevious`) with provider methods |
| `AudioCoordinator.ts` | Replace direct `expo-music-kit` imports (`getPlaybackStatus`, `activateDuckingSession`, `deactivateDuckingSession`, `setTTSVolume`) with provider methods |
| `TransitionPreloader.ts` | Consume provider for eject + queue inspection |
| `QueueManager.ts` | Provider-aware queue building (enqueue strategy) |
| `CleoVoiceEngine.ts` | **Critical.** Currently imports `playAudioFromBase64` and `stopAudio` directly from `expo-music-kit`. Must receive provider reference and call `provider.playAudioFromBase64()` instead. This is the primary TTS playback path. |
| `SessionArcScreen.tsx` | Replace direct `getUpcomingQueue` import from `expo-music-kit` with provider method |
| `ProfileScreen.tsx` | Replace direct `setTTSVolume`/`authorize` imports; add provider display + switch option |
| `server/src/index.ts` | Register Spotify routes |

### Direct `expo-music-kit` Import Migration

Every direct import from `expo-music-kit` or `MusicKitPlayer` must be routed through the `MusicProvider` interface. No file outside `AppleMusicProvider.ts` should import from `expo-music-kit` after migration. The implementation plan must include an audit step to grep for remaining direct imports.

### Untouched

- `SegmentController.ts`, `CleoScriptGenerator.ts` — provider-agnostic (consume provider indirectly via AudioCoordinator)
- `static-core.ts`, `cold-opens.ts`, `fallbacks.ts` — ONAY personality unchanged
- `SessionMemory.ts`, `Storage.ts` — stores provider key, rest same shape
- All design tokens, UI components
- Enrichment pipeline (MusicBrainz, Genius)

## Known Compromises with Spotify

1. **No audio ducking** — TTS overlays at 0.85 volume (radio DJ style)
2. **No three-layer crossfade** — two-layer overlay + skip
3. **Queue less controllable** — track-by-track enqueue, no bulk reorder
4. **`getNextInQueue()` relies on local plan** + Web API verification at pre-gen time
5. **Requires Spotify app installed** + Premium subscription
6. **Spotify app connection can drop** — auto-reconnect with graceful fallback
7. **User-added queue items from Spotify app** may interleave with ONAY's planned order
8. **Web API queue endpoint** can lag behind enqueue calls by several seconds
9. **Spotify Connect** — must verify playback device is local before starting broadcast
10. **Token expiry** — Spotify access tokens expire after 1 hour, auto-refresh required mid-session

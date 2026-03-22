# Android Support via Spotify Integration Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Replaces:** `2026-03-22-spotify-integration-design.md` (iOS Spotify, now cancelled)

## Overview

Add Android support to ONAY using Spotify as the Android music provider. Platform determines provider automatically: iOS uses Apple Music (existing), Android uses Spotify. No user choice, no provider switching. The architecture introduces a `MusicProvider` interface that both platforms implement, allowing all consumers (AudioCoordinator, TransitionPreloader, BroadcastScreen, etc.) to depend on an abstract interface rather than a concrete player.

## Decisions

- **Platform split:** iOS = Apple Music (MusicKit, already built). Android = Spotify (Spotify Android SDK).
- **No provider choice:** `Platform.OS` determines provider automatically. No onboarding picker, no settings toggle.
- **Spotify tier:** Premium only. On-demand playback, queue control, skip, and seek required.
- **Ducking on Android:** Yes. `AudioFocusRequest` with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` — Spotify ducks when ONAY speaks, same semantic as iOS.
- **Eject transitions:** Two-layer. TTS plays over ducked Spotify audio, `skipNext()` at transition point. No three-layer crossfade (can't independently control Spotify track volume).
- **Spotify app required:** Block at onboarding if not installed. Play Store link provided.
- **Same production server:** Spotify token swap/refresh and playlist routes added to existing Fastify server at `api.worthymedia.tech`.
- **Architecture:** Full provider abstraction layer. Clean interface with two honest implementations.

## Provider Protocol

```typescript
// src/providers/MusicProvider.ts

export type AuthStatus = 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unknown'

export interface AuthResult {
  status: AuthStatus
  canPlayCatalog: boolean
}

export type NextTrack = { id?: string; title: string; artistName: string } | null

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export type TrackChangedCallback = (event: { trackId?: string; previousTrackId?: string }) => void
export type PlaybackStateCallback = (event: { status: PlaybackStatus; playbackTime: number }) => void
export type EjectTrackChangedCallback = (event: { trackId?: string; previousTrackId?: string }) => void

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
  setTTSVolume(volume: number): void

  // Eject (each provider encapsulates its own eject behavior)
  playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void>
  cancelEjectTransition(): Promise<void>

  // Events
  onTrackChanged(cb: TrackChangedCallback): () => void
  onPlaybackStateChanged(cb: PlaybackStateCallback): () => void
  onEjectTrackChanged(cb: EjectTrackChangedCallback): () => void

  // Connection (always 'connected' for Apple Music; reflects App Remote state for Spotify)
  readonly connectionStatus: ConnectionStatus
  onConnectionStatusChanged(cb: (status: ConnectionStatus) => void): () => void

  // Capabilities
  readonly providerType: 'apple-music' | 'spotify'
  readonly supportsDucking: boolean  // true for both
  readonly supportsThreeLayerCrossfade: boolean  // true Apple Music, false Spotify
}
```

**Singleton factory (platform-based):**
```typescript
// src/providers/index.ts
import { Platform } from 'react-native'

let _provider: MusicProvider | null = null

export function getMusicProvider(): MusicProvider {
  if (!_provider) {
    _provider = Platform.OS === 'ios'
      ? new AppleMusicProvider()
      : new SpotifyProvider()
  }
  return _provider
}
```

No `resetMusicProvider()` needed — users can't switch providers.

### Provider Method Behavior by Implementation

| Method | AppleMusicProvider (iOS) | SpotifyProvider (Android) |
|--------|--------------------------|--------------------------|
| `activateDuckingSession()` | AVAudioSession with `.duckOthers` | `AudioFocusRequest` with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` |
| `deactivateDuckingSession()` | Removes `.duckOthers` from session | Abandons audio focus |
| `playAudioFromBase64(base64)` | AVAudioPlayer | MediaPlayer/ExoPlayer |
| `playEjectTransition(base64, delay)` | Native three-layer crossfade (old out + TTS + new in) | TTS over ducked music + `skipNext()` at delay |
| `getNextInQueue()` | Reads MusicKit's `ApplicationMusicPlayer.Queue` | Local queue plan + Web API verification |
| `getUpcomingQueue(count)` | Reads MusicKit queue | Returns next N from local queue plan |
| `clearQueueCache()` | Clears native `cachedTracks`/`cachedSongs` | No-op (no server-side queue to clear) |
| `setTTSVolume(volume)` | Sets AVAudioPlayer volume | Sets MediaPlayer volume |
| `connectionStatus` | Always `'connected'` | Reflects `SpotifyAppRemote` connection state |

Types (`MusicTrack`, `MusicPlaylist`, `NowPlaying`, `PlaybackStatus`, `UpcomingTrack`) are defined in `MusicProvider.ts` and re-exported. Consumers import types from `src/providers/`, not `expo-music-kit`.

## Spotify Native Module (`expo-spotify`, Android/Kotlin)

### Structure

```
modules/
├── expo-music-kit/          (unchanged, iOS only)
└── expo-spotify/
    ├── expo-module.config.json
    ├── index.ts
    ├── src/ExpoSpotifyModule.ts
    └── android/
        ├── build.gradle.kts
        └── src/main/java/expo/modules/spotify/
            └── ExpoSpotifyModule.kt
```

No `ios/` directory — Android only.

### Responsibilities

1. **Auth & Connection** — `SpotifyAppRemote.connect()` for playback IPC. OAuth via `AuthorizationClient` for Web API token. Token swap/refresh through server routes. Scopes: `app-remote-control`, `playlist-read-private`, `user-library-read`.

2. **Playback Control** — Wrappers around `SpotifyAppRemote.playerApi`: `play(uri)`, `pause()`, `resume()`, `skipNext()`, `seekTo(ms)`. Track-by-track enqueue via `playerApi.queue(uri)`.

3. **Ducking** — `AudioFocusRequest` with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`. `activateDuckingSession()` requests focus (Spotify ducks). `deactivateDuckingSession()` abandons focus (Spotify restores volume). Same semantic as iOS AVAudioSession pattern.

4. **TTS Playback** — `MediaPlayer` or `ExoPlayer` for base64 audio. Plays over ducked Spotify audio. Crossfade timer fires 1s before TTS end for overlay dismiss timing.

5. **Track Change Detection** — `PlayerApi.subscribeToPlayerState()`. Compare `PlayerState.track.uri` on each callback. Emit `onTrackChanged` with previous/current track IDs. Module tracks previous URI internally (Spotify's callback only provides current state).

6. **Eject Transition (two-layer)** — Request audio focus (duck Spotify) -> play TTS -> at `fadeInDelay`: call `skipNext()` -> emit `onEjectTrackChanged` when player state reports new track -> abandon audio focus.

7. **Connection Lifecycle** — Auto-reconnect on disconnect. Emit `connectionStatus` changes to JS. If Spotify killed during eject, suppress `onEjectTrackChanged`, let fallback `onTrackChanged` path handle it.

8. **Spotify App Check** — `packageManager.getLaunchIntentForPackage("com.spotify.music")` to verify installed. Block at onboarding if missing.

### What It Does NOT Handle

- Playlist/track fetching (via Spotify Web API through server)
- Independent music track volume control (no API)
- Three-layer crossfade (Spotify controls its own fade)

## Consumer Migration

Every direct import from `expo-music-kit` or `MusicKitPlayer` must be routed through the `MusicProvider` interface. After migration, only `AppleMusicProvider.ts` imports from `expo-music-kit`.

### Files to Migrate

| File | Current Imports from `expo-music-kit` | Change |
|------|---------------------------------------|--------|
| `AudioCoordinator.ts` | `activateDuckingSession`, `deactivateDuckingSession`, `getPlaybackStatus`, `setTTSVolume` | Use provider via constructor or `getMusicProvider()` |
| `TransitionPreloader.ts` | `getNextInQueue`, `playEjectTransition`, `cancelEjectTransition` | Use provider |
| `CleoVoiceEngine.ts` | `playAudioFromBase64`, `stopAudio` | Use provider |
| `QueueManager.ts` | `clearQueueCache`, `MusicKitPlayer` | Use provider |
| `BroadcastScreen.tsx` | `addTrackChangedListener`, `addPlaybackStateListener`, `addEjectTrackChangedListener`, `skip`, `skipToPrevious`, `getNowPlaying`, `getPlaybackTime`, `getPlaybackStatus`, `pause` | Use provider event registration + methods |
| `HomeScreenRedesign.tsx` | `MusicKitPlayer` | Use provider |
| `SessionArcScreen.tsx` | `getUpcomingQueue` | Use provider |
| `ProfileScreen.tsx` | `setTTSVolume`, `authorize` | Use provider |
| `music-auth.tsx` | `authorize` | Use provider (platform-conditional UI) |

### Engine Behavior — Identical Code Paths

- **AudioCoordinator:** `activateDuckingSession()` -> `playAudioFromBase64()` -> crossfade timer -> `deactivateDuckingSession()`. Both providers duck, both play TTS, both un-duck. No branching.
- **TransitionPreloader:** Poll -> generate at 25s -> cache TTS -> `playEjectTransition()` at eject point. Provider encapsulates the difference internally.
- **SegmentController, CleoScriptGenerator:** Untouched. Provider-agnostic.

### Post-Migration Verification

Grep for `from.*expo-music-kit` — only `AppleMusicProvider.ts` should match.
Grep for `MusicKitPlayer` — only `AppleMusicProvider.ts` should match.

## Server-Side Changes

### New Routes (`server/src/routes/spotify.ts`)

All protected by `requireAuth` middleware.

1. **`POST /spotify/token-swap`** — Receives OAuth auth code from Android client, exchanges for access + refresh tokens via Spotify's token endpoint. Client secret stays server-side.

2. **`POST /spotify/token-refresh`** — Takes refresh token, returns fresh access token. Spotify tokens expire after 1 hour.

3. **`POST /spotify/playlists`** — Proxies `GET /me/playlists` via Spotify Web API. Normalizes response to `MusicPlaylist[]` (same shape as Apple Music playlists). Handles pagination.

4. **`POST /spotify/playlist-tracks`** — Proxies `GET /playlists/{id}/tracks`. Normalizes to `MusicTrack[]`. Maps `duration_ms` to seconds. Batch-fetches genres via `GET /artists` (up to 50 per call, 500ms between batches for large playlists).

### New Environment Variables

```
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
```

### Unchanged Routes

- `/generate-segment`, `/synthesize-voice`, `/enrich-track` — take track metadata (title, artist), not provider IDs. Provider-agnostic.
- Enrichment pipeline (MusicBrainz, Genius) works off artist/track names.

### Rate Limiting

Same global limiter (200 req/min per IP). Spotify Web API has its own limits (~100 req/30s) — the playlist-tracks route handles batching internally.

## Onboarding Flow

### Android (`music-auth.tsx`)

1. Check if Spotify app is installed via native `isSpotifyInstalled()`
2. If not installed: "ONAY requires Spotify" screen with Play Store link. Blocks progress.
3. If installed: Initiate OAuth -> connect App Remote -> check Premium via `playerApi` capabilities
4. If not Premium: "ONAY requires Spotify Premium" message. Blocks progress.
5. On success: persist auth state, proceed to `cleo-setup.tsx`

### iOS (`music-auth.tsx`)

Completely unchanged. Same Apple Music authorization flow.

### Platform-Conditional Rendering

```typescript
if (Platform.OS === 'ios') {
  // Existing Apple Music authorization UI
} else {
  // Spotify install check + OAuth + Premium gate
}
```

### Existing User Migration

Not applicable — Android is a new platform with no existing users.

## UI

No changes to any screen's visual design. Gold edition editorial layout, station cards, broadcast screen, speaking overlay — all identical on both platforms. The provider is invisible after onboarding.

**ProfileScreen:** "CONNECTED ECOSYSTEM" section shows "Apple Music" on iOS, "Spotify" on Android.

## Queue Management on Android

### Track-by-Track Enqueue

Spotify SDK limitation — no bulk queue API.

1. `play("spotify:track:{firstUri}")` starts first track
2. On each `onTrackChanged`, enqueue next 1-2 tracks from queue plan via `playerApi.queue(uri)`
3. `setUpcomingQueue()` enqueues next planned tracks sequentially

### `getNextInQueue()` for Spotify

- **Primary:** Local queue plan (QueuePlanner's ordered list) — instant, no network
- **Verification at pre-gen time (~25s):** Spotify Web API `GET /me/player/queue` confirms actual next track. 2s delay after enqueue before verifying.
- **On mismatch:** Regenerate eject script with correct track name
- **Re-verify at fire time:** Safety net in `tryFireEject`

### AI Queue Upgrade

`QueueManager.upgradeQueueInBackground` enqueues new tracks via `playerApi.queue()`. Calls `transitionPreloader.revalidateNextTrack()` after. No bulk reorder — tracks enqueue one at a time.

### Limitations

- No "clear queue" API — maintain local pointer into plan
- User-added tracks via Spotify app may interleave with ONAY's planned order
- AI queue upgrade may double-enqueue a track (acceptable edge case)

## Known Compromises (Android vs iOS)

| Area | iOS (Apple Music) | Android (Spotify) |
|------|-------------------|-------------------|
| Ducking | Native AVAudioSession `.duckOthers` | AudioFocus `MAY_DUCK` (equivalent) |
| Eject crossfade | Three-layer (old out + TTS + new in) | Two-layer (TTS over ducked music + skip) |
| Queue control | Full MusicKit queue API | Track-by-track enqueue, no reorder |
| Next track peek | Direct queue read | Local plan + Web API verify |
| App requirement | None (MusicKit built-in) | Spotify app must be installed |
| Subscription | Apple Music | Spotify Premium |
| Connection | Always connected | App Remote can disconnect, auto-reconnect |
| Background playback | MusicKit handles it | Spotify app handles it |

## File Impact Summary

### New Files

| File | Purpose |
|------|---------|
| `modules/expo-spotify/` (Android only) | Native module for SpotifyAppRemote |
| `src/providers/MusicProvider.ts` | Interface + shared types |
| `src/providers/AppleMusicProvider.ts` | Wraps MusicKitPlayer + expo-music-kit |
| `src/providers/SpotifyProvider.ts` | Wraps expo-spotify + Web API |
| `src/providers/index.ts` | Platform-based factory |
| `server/src/routes/spotify.ts` | Token swap, playlists |

### Modified Files

| File | Change |
|------|--------|
| `AudioCoordinator.ts` | Replace direct `expo-music-kit` imports with provider |
| `TransitionPreloader.ts` | Replace direct imports with provider |
| `CleoVoiceEngine.ts` | Replace `playAudioFromBase64`/`stopAudio` with provider |
| `QueueManager.ts` | Replace `clearQueueCache`/`MusicKitPlayer` with provider |
| `BroadcastScreen.tsx` | Replace all `expo-music-kit` imports with provider |
| `HomeScreenRedesign.tsx` | Replace `MusicKitPlayer` with provider |
| `SessionArcScreen.tsx` | Replace `getUpcomingQueue` with provider |
| `ProfileScreen.tsx` | Replace imports, show provider name |
| `music-auth.tsx` | Platform-conditional auth UI |
| `server/src/index.ts` | Register Spotify routes |

### Untouched

- `SegmentController.ts`, `CleoScriptGenerator.ts` — provider-agnostic
- `static-core.ts`, `cold-opens.ts`, `fallbacks.ts` — ONAY personality unchanged
- `SessionMemory.ts`, `Storage.ts` — same shape
- All design tokens, UI components
- Enrichment pipeline (MusicBrainz, Genius)

## Superseded Spec

The original `2026-03-22-spotify-integration-design.md` spec proposed Spotify on iOS alongside Apple Music with user choice at onboarding. That approach is cancelled. Spotify is Android-only. The `MusicProvider` interface from that spec is carried forward with modifications (platform-based factory, no provider switching, ducking enabled on both platforms).

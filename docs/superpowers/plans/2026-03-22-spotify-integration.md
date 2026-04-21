# Spotify Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Spotify as an alternative music provider alongside Apple Music, with exclusive choice at onboarding.

**Architecture:** Provider abstraction protocol (`MusicProvider` interface) with two implementations: `AppleMusicProvider` (wraps existing `expo-music-kit` + `MusicKitPlayer`) and `SpotifyProvider` (wraps new `expo-spotify` native module + Spotify Web API). Singleton pattern. Consumers check capability flags, not provider names.

**Tech Stack:** React Native / Expo SDK 55, TypeScript, Swift (SPTAppRemote / SpotifyiOS framework), Fastify (server), Spotify Web API, Spotify iOS SDK

**Spec:** `docs/superpowers/specs/2026-03-22-spotify-integration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/providers/MusicProvider.ts` | Interface definition, shared types, capability flags |
| `src/providers/AppleMusicProvider.ts` | Wraps `MusicKitPlayer` + direct `expo-music-kit` imports into `MusicProvider` |
| `src/providers/SpotifyProvider.ts` | Wraps `expo-spotify` + Spotify Web API calls into `MusicProvider` |
| `src/providers/index.ts` | Singleton factory: `getMusicProvider()`, `resetMusicProvider()` |
| `modules/expo-spotify/expo-module.config.json` | Expo module config |
| `modules/expo-spotify/index.ts` | TypeScript API for Spotify native module |
| `modules/expo-spotify/src/ExpoSpotifyModule.ts` | Expo module bridge |
| `modules/expo-spotify/ios/ExpoSpotifyModule.swift` | SPTAppRemote, auth, playback, TTS, eject |
| `modules/expo-spotify/ios/ExpoSpotify.podspec` | CocoaPods spec (SpotifyiOS dependency) |
| `server/src/routes/spotify.ts` | Token swap/refresh, playlists, curated stations |

### Modified Files

| File | Change |
|------|--------|
| `src/services/CleoVoiceEngine.ts` | Replace `expo-music-kit` import with provider dependency injection |
| `src/engines/AudioCoordinator.ts` | Replace 4 direct `expo-music-kit` imports with provider methods |
| `src/engines/TransitionPreloader.ts` | Replace 2 direct `expo-music-kit` imports + `musicKitPlayer` with provider |
| `src/engines/QueueManager.ts` | Replace `clearQueueCache` import + `musicKitPlayer` with provider |
| `src/screens/player/BroadcastScreen.tsx` | Replace `expo-music-kit` + `musicKitPlayer` with provider |
| `src/screens/home/HomeScreenRedesign.tsx` | Replace `musicKitPlayer` with provider, add curated stations |
| `src/screens/arc/SessionArcScreen.tsx` | Replace `expo-music-kit` + `musicKitPlayer` with provider |
| `src/screens/settings/ProfileScreen.tsx` | Replace `expo-music-kit` + `musicKitPlayer` with provider, add switch option |
| `app/(onboarding)/music-auth.tsx` | Add provider choice screen before auth |
| `server/src/index.ts` | Register Spotify routes |
| `server/.env` | Add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` |

---

## Task 1: Provider Interface & Types

**Files:**
- Create: `src/providers/MusicProvider.ts`
- Create: `src/providers/index.ts`

- [ ] **Step 1: Create the MusicProvider interface**

```typescript
// src/providers/MusicProvider.ts
import type {
  MusicTrack,
  MusicPlaylist,
  NowPlaying,
  PlaybackStatus,
  TrackChangedEvent,
  PlaybackStateEvent,
  EjectTrackChangedEvent,
  UpcomingTrack,
} from '../../modules/expo-music-kit';

export type { MusicTrack, MusicPlaylist, NowPlaying, PlaybackStatus, UpcomingTrack };

export interface AuthResult {
  status: 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unknown';
  canPlayCatalog: boolean;
}

export type NextTrack = { id?: string; title: string; artistName: string } | null;

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface MusicProvider {
  // Auth
  authorize(): Promise<AuthResult>;
  getAuthorizationStatus(): Promise<AuthResult['status']>;

  // Library
  fetchPlaylists(): Promise<MusicPlaylist[]>;
  fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]>;

  // Playback
  play(trackIds?: string[], playlistId?: string): Promise<void>;
  pause(): Promise<void>;
  skip(): Promise<void>;
  skipToPrevious(): Promise<void>;
  seekTo(time: number): Promise<void>;
  setUpcomingQueue(trackIds: string[]): Promise<void>;
  clearQueueCache(): Promise<void>;

  // State
  getNowPlaying(): Promise<NowPlaying | null>;
  getNextInQueue(): Promise<NextTrack>;
  getPlaybackTime(): Promise<number>;
  getPlaybackStatus(): Promise<PlaybackStatus>;
  getUpcomingQueue(count: number): Promise<UpcomingTrack[]>;

  // TTS audio coordination
  activateDuckingSession(): Promise<void>;
  deactivateDuckingSession(): Promise<void>;
  playAudioFromBase64(base64: string): Promise<void>;
  stopAudio(): Promise<void>;
  setTTSVolume(volume: number): void;

  // Eject
  playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void>;
  cancelEjectTransition(): Promise<void>;

  // Events
  onTrackChanged(cb: (event: TrackChangedEvent) => void): () => void;
  onPlaybackStateChanged(cb: (event: PlaybackStateEvent) => void): () => void;
  onEjectTrackChanged(cb: (event: EjectTrackChangedEvent) => void): () => void;

  // Connection
  readonly connectionStatus: ConnectionStatus;
  onConnectionStatusChanged(cb: (status: ConnectionStatus) => void): () => void;

  // Capabilities
  readonly providerType: 'apple-music' | 'spotify';
  readonly supportsDucking: boolean;
  readonly supportsThreeLayerCrossfade: boolean;

  // Lifecycle
  destroy(): void;
}
```

- [ ] **Step 2: Create the singleton factory**

```typescript
// src/providers/index.ts
import { Storage } from '../services/Storage';
import type { MusicProvider } from './MusicProvider';

let _provider: MusicProvider | null = null;

export function getMusicProvider(): MusicProvider {
  if (!_provider) {
    const type = Storage.getString('musicProvider');
    if (type === 'spotify') {
      const { SpotifyProvider } = require('./SpotifyProvider');
      _provider = new SpotifyProvider();
    } else {
      const { AppleMusicProvider } = require('./AppleMusicProvider');
      _provider = new AppleMusicProvider();
    }
  }
  return _provider;
}

export function resetMusicProvider(): void {
  if (_provider) {
    _provider.destroy();
    _provider = null;
  }
}

export type { MusicProvider } from './MusicProvider';
export type {
  MusicTrack,
  MusicPlaylist,
  NowPlaying,
  PlaybackStatus,
  NextTrack,
  ConnectionStatus,
  UpcomingTrack,
} from './MusicProvider';
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit src/providers/MusicProvider.ts src/providers/index.ts`
Expected: No errors (or only errors from missing implementations, not type issues)

- [ ] **Step 4: Commit**

```bash
git add src/providers/MusicProvider.ts src/providers/index.ts
git commit -m "feat: add MusicProvider interface and singleton factory"
```

---

## Task 2: AppleMusicProvider Implementation

**Files:**
- Create: `src/providers/AppleMusicProvider.ts`
- Reference: `src/services/MusicKitPlayer.ts` (read-only, wrapping its API)

This wraps the existing `MusicKitPlayer` singleton and the direct `expo-music-kit` functions that screens/engines currently import separately.

- [ ] **Step 1: Create AppleMusicProvider**

```typescript
// src/providers/AppleMusicProvider.ts
import { musicKitPlayer } from '../services/MusicKitPlayer';
import {
  authorize,
  getAuthorizationStatus,
  getPlaybackStatus as getPlaybackStatusNative,
  activateDuckingSession as activateDuckingNative,
  deactivateDuckingSession as deactivateDuckingNative,
  playAudioFromBase64 as playAudioNative,
  stopAudio as stopAudioNative,
  setTTSVolume as setTTSVolumeNative,
  playEjectTransition as playEjectNative,
  cancelEjectTransition as cancelEjectNative,
  getNextInQueue as getNextInQueueNative,
  getUpcomingQueue as getUpcomingQueueNative,
  skipToPrevious as skipToPreviousNative,
  clearQueueCache as clearQueueCacheNative,
} from '../../modules/expo-music-kit';
import type { MusicProvider, ConnectionStatus, AuthResult, NextTrack } from './MusicProvider';
import type {
  MusicPlaylist,
  MusicTrack,
  NowPlaying,
  PlaybackStatus,
  TrackChangedEvent,
  PlaybackStateEvent,
  EjectTrackChangedEvent,
  UpcomingTrack,
} from '../../modules/expo-music-kit';

export class AppleMusicProvider implements MusicProvider {
  readonly providerType = 'apple-music' as const;
  readonly supportsDucking = true;
  readonly supportsThreeLayerCrossfade = true;
  readonly connectionStatus: ConnectionStatus = 'connected'; // Always connected (in-process)

  // Auth
  async authorize(): Promise<AuthResult> {
    return authorize();
  }

  async getAuthorizationStatus(): Promise<AuthResult['status']> {
    return getAuthorizationStatus();
  }

  // Library
  async fetchPlaylists(): Promise<MusicPlaylist[]> {
    return musicKitPlayer.fetchPlaylists();
  }

  async fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
    return musicKitPlayer.fetchPlaylistTracks(playlistId);
  }

  // Playback
  async play(trackIds?: string[], playlistId?: string): Promise<void> {
    return musicKitPlayer.play(trackIds, playlistId);
  }

  async pause(): Promise<void> {
    return musicKitPlayer.pause();
  }

  async skip(): Promise<void> {
    return musicKitPlayer.skip();
  }

  async skipToPrevious(): Promise<void> {
    return skipToPreviousNative();
  }

  async seekTo(time: number): Promise<void> {
    return musicKitPlayer.seekTo(time);
  }

  async setUpcomingQueue(trackIds: string[]): Promise<void> {
    return musicKitPlayer.setUpcomingQueue(trackIds);
  }

  async clearQueueCache(): Promise<void> {
    return clearQueueCacheNative();
  }

  // State
  async getNowPlaying(): Promise<NowPlaying | null> {
    return musicKitPlayer.getNowPlaying();
  }

  async getNextInQueue(): Promise<NextTrack> {
    return getNextInQueueNative();
  }

  async getPlaybackTime(): Promise<number> {
    return musicKitPlayer.getPlaybackTime();
  }

  async getPlaybackStatus(): Promise<PlaybackStatus> {
    return getPlaybackStatusNative();
  }

  async getUpcomingQueue(count: number): Promise<UpcomingTrack[]> {
    return getUpcomingQueueNative(count);
  }

  // TTS
  async activateDuckingSession(): Promise<void> {
    return activateDuckingNative();
  }

  async deactivateDuckingSession(): Promise<void> {
    return deactivateDuckingNative();
  }

  async playAudioFromBase64(base64: string): Promise<void> {
    return playAudioNative(base64);
  }

  async stopAudio(): Promise<void> {
    return stopAudioNative();
  }

  setTTSVolume(volume: number): void {
    setTTSVolumeNative(volume);
  }

  // Eject
  async playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void> {
    return playEjectNative(ttsBase64, fadeInDelayMs);
  }

  async cancelEjectTransition(): Promise<void> {
    return cancelEjectNative();
  }

  // Events
  onTrackChanged(cb: (event: TrackChangedEvent) => void): () => void {
    return musicKitPlayer.onTrackChanged(cb);
  }

  onPlaybackStateChanged(cb: (event: PlaybackStateEvent) => void): () => void {
    return musicKitPlayer.onPlaybackStateChanged(cb);
  }

  onEjectTrackChanged(cb: (event: EjectTrackChangedEvent) => void): () => void {
    return musicKitPlayer.onEjectTrackChanged(cb);
  }

  // Connection (always connected for Apple Music)
  onConnectionStatusChanged(_cb: (status: ConnectionStatus) => void): () => void {
    return () => {}; // No-op, never disconnects
  }

  destroy(): void {
    musicKitPlayer.destroy();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/providers/AppleMusicProvider.ts`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/providers/AppleMusicProvider.ts
git commit -m "feat: add AppleMusicProvider wrapping existing MusicKitPlayer"
```

---

## Task 3: Migrate CleoVoiceEngine to Provider

**Files:**
- Modify: `src/services/CleoVoiceEngine.ts:1` (import) and `:223,:234` (usage)

CleoVoiceEngine currently imports `playAudioFromBase64` directly from `expo-music-kit`. It must accept the provider as a dependency.

- [ ] **Step 1: Read current CleoVoiceEngine.ts**

Read the full file to understand all exports and internal structure before modifying.

- [ ] **Step 2: Replace direct import with provider dependency**

Remove:
```typescript
import { playAudioFromBase64 } from '../../modules/expo-music-kit';
```

Add:
```typescript
import { getMusicProvider } from '../providers';
```

- [ ] **Step 3: Update `playCachedAudio` to use provider**

Replace:
```typescript
export async function playCachedAudio(base64Audio: string): Promise<void> {
  await playAudioFromBase64(base64Audio);
```

With:
```typescript
export async function playCachedAudio(base64Audio: string): Promise<void> {
  await getMusicProvider().playAudioFromBase64(base64Audio);
```

- [ ] **Step 4: Update `synthesizeAndPlay` to use provider**

Replace:
```typescript
await playAudioFromBase64(base64Audio);
```

With:
```typescript
await getMusicProvider().playAudioFromBase64(base64Audio);
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit src/services/CleoVoiceEngine.ts`

- [ ] **Step 6: Commit**

```bash
git add src/services/CleoVoiceEngine.ts
git commit -m "refactor: migrate CleoVoiceEngine to MusicProvider abstraction"
```

---

## Task 4: Migrate AudioCoordinator to Provider

**Files:**
- Modify: `src/engines/AudioCoordinator.ts:8` (imports) and all usages of `getPlaybackStatus`, `activateDuckingSession`, `deactivateDuckingSession`, `setTTSVolume`

- [ ] **Step 1: Read current AudioCoordinator.ts**

Read the full file to understand all import sites and usages.

- [ ] **Step 2: Replace direct expo-music-kit imports with provider**

Remove:
```typescript
import { getPlaybackStatus, activateDuckingSession, deactivateDuckingSession, setTTSVolume } from '../../modules/expo-music-kit';
```

Add:
```typescript
import { getMusicProvider } from '../providers';
```

- [ ] **Step 3: Replace all usages**

Replace all `getPlaybackStatus()` calls with `getMusicProvider().getPlaybackStatus()`.
Replace all `activateDuckingSession()` calls with `getMusicProvider().activateDuckingSession()`.
Replace all `deactivateDuckingSession()` calls with `getMusicProvider().deactivateDuckingSession()`.
Replace all `setTTSVolume(...)` calls with `getMusicProvider().setTTSVolume(...)`.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit src/engines/AudioCoordinator.ts`

- [ ] **Step 5: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "refactor: migrate AudioCoordinator to MusicProvider abstraction"
```

---

## Task 5: Migrate TransitionPreloader to Provider

**Files:**
- Modify: `src/engines/TransitionPreloader.ts:10-11` (imports) and all usages

- [ ] **Step 1: Read current TransitionPreloader.ts**

- [ ] **Step 2: Replace imports**

Remove:
```typescript
import { playEjectTransition, cancelEjectTransition } from '../../modules/expo-music-kit';
import { musicKitPlayer } from '../services/MusicKitPlayer';
```

Add:
```typescript
import { getMusicProvider } from '../providers';
```

- [ ] **Step 3: Replace all usages**

Replace `playEjectTransition(...)` with `getMusicProvider().playEjectTransition(...)`.
Replace `cancelEjectTransition()` with `getMusicProvider().cancelEjectTransition()`.
Replace `musicKitPlayer.getNextInQueue()` with `getMusicProvider().getNextInQueue()`.
Replace `musicKitPlayer.getPlaybackTime()` with `getMusicProvider().getPlaybackTime()`.
Replace any other `musicKitPlayer.*` calls with `getMusicProvider().*`.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit src/engines/TransitionPreloader.ts`

- [ ] **Step 5: Commit**

```bash
git add src/engines/TransitionPreloader.ts
git commit -m "refactor: migrate TransitionPreloader to MusicProvider abstraction"
```

---

## Task 6: Migrate QueueManager to Provider

**Files:**
- Modify: `src/engines/QueueManager.ts:7,9` (imports)

- [ ] **Step 1: Read current QueueManager.ts**

- [ ] **Step 2: Replace imports**

Remove:
```typescript
import { musicKitPlayer } from '../services/MusicKitPlayer';
import { clearQueueCache, type MusicTrack } from '../../modules/expo-music-kit';
```

Add:
```typescript
import { getMusicProvider, type MusicTrack } from '../providers';
```

- [ ] **Step 3: Replace all usages**

Replace `musicKitPlayer.*` calls with `getMusicProvider().*`.
Replace `clearQueueCache()` with `getMusicProvider().clearQueueCache()`.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit src/engines/QueueManager.ts`

- [ ] **Step 5: Commit**

```bash
git add src/engines/QueueManager.ts
git commit -m "refactor: migrate QueueManager to MusicProvider abstraction"
```

---

## Task 7: Migrate BroadcastScreen to Provider

**Files:**
- Modify: `src/screens/player/BroadcastScreen.tsx:34,42` (imports)

- [ ] **Step 1: Read current BroadcastScreen.tsx**

Read imports section and all usages of `musicKitPlayer`, `getNextInQueue`, `skipToPrevious`.

- [ ] **Step 2: Replace imports**

Remove:
```typescript
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { getNextInQueue, skipToPrevious, type NowPlaying } from '../../../modules/expo-music-kit';
```

Add:
```typescript
import { getMusicProvider, type NowPlaying } from '../../providers';
```

- [ ] **Step 3: Replace all usages**

Replace `musicKitPlayer.*` with `getMusicProvider().*`.
Replace `getNextInQueue()` with `getMusicProvider().getNextInQueue()`.
Replace `skipToPrevious()` with `getMusicProvider().skipToPrevious()`.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit src/screens/player/BroadcastScreen.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/screens/player/BroadcastScreen.tsx
git commit -m "refactor: migrate BroadcastScreen to MusicProvider abstraction"
```

---

## Task 8: Migrate Remaining Screens to Provider

**Files:**
- Modify: `src/screens/home/HomeScreenRedesign.tsx:35,48`
- Modify: `src/screens/arc/SessionArcScreen.tsx:11,12`
- Modify: `src/screens/settings/ProfileScreen.tsx:17,18`

- [ ] **Step 1: Migrate HomeScreenRedesign.tsx**

Remove:
```typescript
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
```

Add:
```typescript
import { getMusicProvider, type MusicPlaylist } from '../../providers';
```

Replace all `musicKitPlayer.*` with `getMusicProvider().*`.

- [ ] **Step 2: Migrate SessionArcScreen.tsx**

Remove:
```typescript
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { getUpcomingQueue, type NowPlaying, type UpcomingTrack } from '../../../modules/expo-music-kit';
```

Add:
```typescript
import { getMusicProvider, type NowPlaying, type UpcomingTrack } from '../../providers';
```

Replace `musicKitPlayer.*` with `getMusicProvider().*`.
Replace `getUpcomingQueue(...)` with `getMusicProvider().getUpcomingQueue(...)`.

- [ ] **Step 3: Migrate ProfileScreen.tsx**

Remove:
```typescript
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { setTTSVolume, authorize } from '../../../modules/expo-music-kit';
```

Add:
```typescript
import { getMusicProvider } from '../../providers';
```

Replace `musicKitPlayer.*` with `getMusicProvider().*`.
Replace `setTTSVolume(...)` with `getMusicProvider().setTTSVolume(...)`.
Replace `authorize()` with `getMusicProvider().authorize()`.

- [ ] **Step 4: Verify all screens compile**

Run: `npx tsc --noEmit src/screens/home/HomeScreenRedesign.tsx src/screens/arc/SessionArcScreen.tsx src/screens/settings/ProfileScreen.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/screens/home/HomeScreenRedesign.tsx src/screens/arc/SessionArcScreen.tsx src/screens/settings/ProfileScreen.tsx
git commit -m "refactor: migrate remaining screens to MusicProvider abstraction"
```

---

## Task 9: Migrate music-auth.tsx + Type-Only Imports

**Files:**
- Modify: `app/(onboarding)/music-auth.tsx:6`
- Modify: `src/services/TrackEnrichmentService.ts:3`
- Modify: `src/services/Storage.ts:3`

- [ ] **Step 1: Migrate music-auth.tsx**

Remove:
```typescript
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';
```

Add:
```typescript
import { getMusicProvider } from '../../src/providers';
```

Replace `musicKitPlayer.*` with `getMusicProvider().*`.

- [ ] **Step 2: Migrate type-only imports**

In `src/services/TrackEnrichmentService.ts`, replace:
```typescript
import type { MusicTrack } from '../../modules/expo-music-kit';
```
With:
```typescript
import type { MusicTrack } from '../providers';
```

In `src/services/Storage.ts`, replace:
```typescript
import type { MusicPlaylist } from '../../modules/expo-music-kit';
```
With:
```typescript
import type { MusicPlaylist } from '../providers';
```

- [ ] **Step 3: Audit for remaining direct imports**

Run: `grep -r "from.*expo-music-kit" src/ app/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "providers/AppleMusicProvider"`

Expected: NO results. The only file that should import from `expo-music-kit` is `src/providers/AppleMusicProvider.ts`.

If any remain, migrate them.

- [ ] **Step 4: Audit for remaining MusicKitPlayer imports**

Run: `grep -r "from.*MusicKitPlayer" src/ app/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "providers/AppleMusicProvider"`

Expected: NO results outside `AppleMusicProvider.ts`.

- [ ] **Step 5: Verify full project compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add app/(onboarding)/music-auth.tsx src/services/TrackEnrichmentService.ts src/services/Storage.ts
git commit -m "refactor: complete migration of all imports to MusicProvider abstraction"
```

---

## Task 10: Test on Device — Apple Music Path

**Files:** None (verification only)

This is a critical checkpoint. The abstraction layer should be fully transparent — the app must work identically to before via AppleMusicProvider.

- [ ] **Step 1: Build the app**

```bash
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

Build and run on device via Xcode.

- [ ] **Step 2: Verify full radio loop**

1. Launch app, sign in
2. Select a playlist, start broadcast
3. Verify: track plays, ONAY speaks (pre_song delivery), music ducks and resumes
4. Wait for eject transition — verify three-layer crossfade works
5. Skip a track manually — verify fallback path works
6. Check Session Arc screen — upcoming manifest loads
7. Check Profile screen — TTS volume slider works

- [ ] **Step 3: Commit checkpoint tag**

```bash
git tag provider-abstraction-verified
```

---

## Task 11: Server Spotify Routes

**Files:**
- Create: `server/src/routes/spotify.ts`
- Modify: `server/src/index.ts`
- Modify: `server/.env`

- [ ] **Step 1: Add env vars to server/.env**

```
SPOTIFY_CLIENT_ID=<your-spotify-client-id>
SPOTIFY_CLIENT_SECRET=<your-spotify-client-secret>
```

- [ ] **Step 2: Create Spotify routes file**

```typescript
// server/src/routes/spotify.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Token swap — NO requireAuth (called directly by SPTSessionManager from native code, no Firebase JWT)
router.post('/spotify/token-swap', async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing auth code' });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: req.body.redirectUri || '',
      client_id: process.env.SPOTIFY_CLIENT_ID || '',
      client_secret: process.env.SPOTIFY_CLIENT_SECRET || '',
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Token swap failed' });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Token swap failed' });
  }
});

// Token refresh — NO requireAuth (called by SPTSessionManager from native code)
router.post('/spotify/token-refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'Missing refresh token' });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID || '',
      client_secret: process.env.SPOTIFY_CLIENT_SECRET || '',
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Token refresh failed' });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Fetch user's playlists
router.post('/spotify/playlists', requireAuth, async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'Missing access token' });
  }

  try {
    const playlists: any[] = [];
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50';

    while (url) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch playlists' });
      }

      const data = await response.json();
      playlists.push(
        ...data.items.map((p: any) => ({
          id: p.id,
          name: p.name,
          trackCount: p.tracks?.total,
          artworkUrl: p.images?.[0]?.url || null,
        }))
      );

      url = data.next; // Pagination
    }

    res.json({ playlists });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// Fetch playlist tracks with genre enrichment
router.post('/spotify/playlist-tracks', requireAuth, async (req, res) => {
  const { accessToken, playlistId } = req.body;
  if (!accessToken || !playlistId) {
    return res.status(400).json({ error: 'Missing access token or playlist ID' });
  }

  try {
    const tracks: any[] = [];
    let url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`;

    while (url) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch tracks' });
      }

      const data = await response.json();
      tracks.push(...data.items.filter((item: any) => item.track).map((item: any) => item.track));
      url = data.next;
    }

    // Batch fetch artist genres (max 50 per request)
    const artistIds = [...new Set(tracks.flatMap((t: any) => t.artists.map((a: any) => a.id)))];
    const artistGenres: Record<string, string[]> = {};

    for (let i = 0; i < artistIds.length; i += 50) {
      const batch = artistIds.slice(i, i + 50);
      const response = await fetch(
        `https://api.spotify.com/v1/artists?ids=${batch.join(',')}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (response.ok) {
        const data = await response.json();
        data.artists.forEach((a: any) => {
          if (a) artistGenres[a.id] = a.genres || [];
        });
      }

      // Rate limit spacing
      if (i + 50 < artistIds.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const normalizedTracks = tracks.map((t: any) => ({
      id: t.id,
      title: t.name,
      artistName: t.artists.map((a: any) => a.name).join(', '),
      albumTitle: t.album?.name || '',
      duration: Math.round(t.duration_ms / 1000),
      genreNames: t.artists.flatMap((a: any) => artistGenres[a.id] || []).slice(0, 5),
      artworkUrl: t.album?.images?.[0]?.url || null,
      trackNumber: t.track_number || 0,
      discNumber: t.disc_number || 0,
    }));

    res.json({ tracks: normalizedTracks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// Curated ONAY stations (Spotify playlist URIs)
router.post('/spotify/curated-stations', requireAuth, async (_req, res) => {
  // These would be configured in env or a config file
  const stations = [
    { id: 'placeholder-chill', name: 'ONAY Chill', trackCount: 50, artworkUrl: null },
    { id: 'placeholder-energy', name: 'ONAY Energy', trackCount: 50, artworkUrl: null },
    { id: 'placeholder-focus', name: 'ONAY Focus', trackCount: 50, artworkUrl: null },
  ];
  res.json({ stations });
});

export default router;
```

- [ ] **Step 3: Register routes in server/src/index.ts**

Add to the route registration section:
```typescript
import spotifyRoutes from './routes/spotify';
app.use(spotifyRoutes);
```

- [ ] **Step 4: Test routes compile**

```bash
cd server && npx tsc --noEmit && cd ..
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/spotify.ts server/src/index.ts
git commit -m "feat: add Spotify server routes (token swap, playlists, curated stations)"
```

---

## Task 12: Expo Spotify Native Module — Scaffold

**Files:**
- Create: `modules/expo-spotify/expo-module.config.json`
- Create: `modules/expo-spotify/index.ts`
- Create: `modules/expo-spotify/src/ExpoSpotifyModule.ts`
- Create: `modules/expo-spotify/ios/ExpoSpotify.podspec`
- Create: `modules/expo-spotify/ios/ExpoSpotifyModule.swift`

- [ ] **Step 1: Create module config**

```json
// modules/expo-spotify/expo-module.config.json
{
  "platforms": ["ios"],
  "ios": {
    "modules": ["ExpoSpotifyModule"]
  }
}
```

- [ ] **Step 2: Create podspec**

```ruby
# modules/expo-spotify/ios/ExpoSpotify.podspec
Pod::Spec.new do |s|
  s.name           = 'ExpoSpotify'
  s.version        = '1.0.0'
  s.summary        = 'Expo module for Spotify iOS SDK integration'
  s.homepage       = 'https://github.com/user/cleo-app'
  s.license        = 'MIT'
  s.author         = 'ONAY'
  s.source         = { git: '' }
  s.platform       = :ios, '16.0'
  s.swift_version  = '5.9'
  s.source_files   = '**/*.swift'

  s.dependency 'ExpoModulesCore'
  s.dependency 'SpotifyiOS'
end
```

- [ ] **Step 3: Create TypeScript API**

```typescript
// modules/expo-spotify/index.ts
export {
  // Auth
  authorize,
  getConnectionStatus,
  isSpotifyInstalled,
  disconnect,
  // Playback
  play,
  pause,
  resume,
  skipToNext,
  skipToPrevious,
  seekToPosition,
  enqueueTrackUri,
  // State
  getPlayerState,
  // TTS
  playAudioFromBase64,
  stopAudio,
  setTTSVolume,
  // Eject
  playEjectTransition,
  cancelEjectTransition,
  // Events
  addPlayerStateChangedListener,
  addTrackChangedListener,
  addConnectionStatusChangedListener,
  addEjectTrackChangedListener,
  // Types
  type SpotifyPlayerState,
  type SpotifyTrackChangedEvent,
  type SpotifyConnectionStatus,
} from './src/ExpoSpotifyModule';
```

- [ ] **Step 4: Create module bridge**

```typescript
// modules/expo-spotify/src/ExpoSpotifyModule.ts
import { requireNativeModule, EventEmitter, type Subscription } from 'expo-modules-core';

const ExpoSpotify = requireNativeModule('ExpoSpotify');
const emitter = new EventEmitter(ExpoSpotify);

// Types
export type SpotifyConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export type SpotifyPlayerState = {
  trackUri: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number; // seconds
  playbackPosition: number; // seconds
  isPaused: boolean;
  artworkUrl?: string;
};

export type SpotifyTrackChangedEvent = {
  trackId: string;
  previousTrackId?: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  artworkUrl?: string;
};

// Auth
export async function authorize(accessToken: string): Promise<boolean> {
  return ExpoSpotify.authorize(accessToken);
}

export async function isSpotifyInstalled(): Promise<boolean> {
  return ExpoSpotify.isSpotifyInstalled();
}

export async function getConnectionStatus(): Promise<SpotifyConnectionStatus> {
  return ExpoSpotify.getConnectionStatus();
}

export async function disconnect(): Promise<void> {
  return ExpoSpotify.disconnect();
}

// Playback
export async function play(uri: string): Promise<void> {
  return ExpoSpotify.play(uri);
}

export async function pause(): Promise<void> {
  return ExpoSpotify.pause();
}

export async function resume(): Promise<void> {
  return ExpoSpotify.resume();
}

export async function skipToNext(): Promise<void> {
  return ExpoSpotify.skipToNext();
}

export async function skipToPrevious(): Promise<void> {
  return ExpoSpotify.skipToPrevious();
}

export async function seekToPosition(positionMs: number): Promise<void> {
  return ExpoSpotify.seekToPosition(positionMs);
}

export async function enqueueTrackUri(uri: string): Promise<void> {
  return ExpoSpotify.enqueueTrackUri(uri);
}

// State
export async function getPlayerState(): Promise<SpotifyPlayerState | null> {
  return ExpoSpotify.getPlayerState();
}

// TTS
export async function playAudioFromBase64(base64: string): Promise<void> {
  return ExpoSpotify.playAudioFromBase64(base64);
}

export async function stopAudio(): Promise<void> {
  return ExpoSpotify.stopAudio();
}

export function setTTSVolume(volume: number): void {
  ExpoSpotify.setTTSVolume(volume);
}

// Eject
export async function playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void> {
  return ExpoSpotify.playEjectTransition(ttsBase64, fadeInDelayMs);
}

export async function cancelEjectTransition(): Promise<void> {
  return ExpoSpotify.cancelEjectTransition();
}

// Event listeners
export function addPlayerStateChangedListener(
  listener: (event: SpotifyPlayerState) => void
): Subscription {
  return emitter.addListener('onPlayerStateChanged', listener);
}

export function addTrackChangedListener(
  listener: (event: SpotifyTrackChangedEvent) => void
): Subscription {
  return emitter.addListener('onTrackChanged', listener);
}

export function addConnectionStatusChangedListener(
  listener: (event: { status: SpotifyConnectionStatus }) => void
): Subscription {
  return emitter.addListener('onConnectionStatusChanged', listener);
}

export function addEjectTrackChangedListener(
  listener: (event: SpotifyTrackChangedEvent) => void
): Subscription {
  return emitter.addListener('onEjectTrackChanged', listener);
}
```

- [ ] **Step 5: Create Swift module skeleton**

```swift
// modules/expo-spotify/ios/ExpoSpotifyModule.swift
import ExpoModulesCore
import AVFoundation

public class ExpoSpotifyModule: Module {
  // MARK: - State
  private var audioPlayer: AVAudioPlayer?
  private var ejectInProgress = false
  private var previousTrackUri: String?

  public func definition() -> ModuleDefinition {
    Name("ExpoSpotify")

    Events(
      "onPlayerStateChanged",
      "onTrackChanged",
      "onConnectionStatusChanged",
      "onEjectTrackChanged"
    )

    // -- Auth --
    AsyncFunction("authorize") { (accessToken: String) -> Bool in
      // TODO: Connect SPTAppRemote with access token
      return false
    }

    AsyncFunction("isSpotifyInstalled") { () -> Bool in
      // TODO: Check canOpenURL for spotify: scheme
      return false
    }

    AsyncFunction("getConnectionStatus") { () -> String in
      return "disconnected"
    }

    AsyncFunction("disconnect") { () in
      // TODO: Disconnect SPTAppRemote
    }

    // -- Playback --
    AsyncFunction("play") { (uri: String) in
      // TODO: appRemote.playerAPI?.play(uri)
    }

    AsyncFunction("pause") { () in
      // TODO: appRemote.playerAPI?.pause()
    }

    AsyncFunction("resume") { () in
      // TODO: appRemote.playerAPI?.resume()
    }

    AsyncFunction("skipToNext") { () in
      // TODO: appRemote.playerAPI?.skip(toNext:)
    }

    AsyncFunction("skipToPrevious") { () in
      // TODO: appRemote.playerAPI?.skip(toPrevious:)
    }

    AsyncFunction("seekToPosition") { (positionMs: Int) in
      // TODO: appRemote.playerAPI?.seek(toPosition: positionMs)
    }

    AsyncFunction("enqueueTrackUri") { (uri: String) in
      // TODO: appRemote.playerAPI?.enqueueTrackUri(uri)
    }

    // -- State --
    AsyncFunction("getPlayerState") { () -> [String: Any]? in
      // TODO: appRemote.playerAPI?.getPlayerState
      return nil
    }

    // -- TTS Audio (standalone AVAudioPlayer, no ducking) --
    // NOTE: This is a scaffold. Task 14 replaces this with proper
    // AVAudioPlayerDelegate pattern (promise-based, no blocking).
    // DO NOT use Thread.sleep in production — it blocks the Expo module thread.
    AsyncFunction("playAudioFromBase64") { (base64: String, promise: Promise) in
      guard let data = Data(base64Encoded: base64) else {
        promise.reject(NSError(domain: "ExpoSpotify", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64"]))
        return
      }
      // Task 14 implements: AVAudioPlayerDelegate, crossfade timer, proper promise resolution
      promise.reject(NSError(domain: "ExpoSpotify", code: 2, userInfo: [NSLocalizedDescriptionKey: "Not yet implemented — see Task 14"]))
    }

    AsyncFunction("stopAudio") { () in
      self.audioPlayer?.stop()
      self.audioPlayer = nil
    }

    Function("setTTSVolume") { (volume: Double) in
      self.audioPlayer?.volume = Float(min(volume, 0.85))
    }

    // -- Eject --
    AsyncFunction("playEjectTransition") { (ttsBase64: String, fadeInDelayMs: Int) in
      // TODO: Play TTS overlay + schedule skipToNext at fadeInDelayMs
      // Emit onEjectTrackChanged when new track detected
    }

    AsyncFunction("cancelEjectTransition") { () in
      self.ejectInProgress = false
      self.audioPlayer?.stop()
      self.audioPlayer = nil
    }
  }
}
```

- [ ] **Step 6: Commit scaffold**

```bash
git add modules/expo-spotify/
git commit -m "feat: scaffold expo-spotify native module (types, bridge, Swift skeleton)"
```

---

## Task 13: Swift — SPTAppRemote Auth & Connection

**Files:**
- Modify: `modules/expo-spotify/ios/ExpoSpotifyModule.swift`
- Modify: `modules/expo-spotify/ios/ExpoSpotify.podspec` (add SpotifyiOS dependency)

This task fills in the auth, connection lifecycle, and Spotify Connect device guard. Requires the Spotify iOS SDK framework (`SpotifyiOS` pod).

- [ ] **Step 1: Read the Spotify iOS SDK docs**

Reference the context7 docs pulled during brainstorming. Key classes: `SPTConfiguration`, `SPTAppRemote`, `SPTAppRemoteDelegate`, `SPTAppRemotePlayerStateDelegate`.

- [ ] **Step 2: Implement SPTAppRemote connection**

Add to ExpoSpotifyModule.swift:
- `SPTConfiguration` with client ID + redirect URL
- `SPTAppRemote` instance with delegate
- `authorize(accessToken)` — sets token and connects
- `appRemoteDidEstablishConnection` — emits `onConnectionStatusChanged: connected`
- `didDisconnectWithError` — emits `onConnectionStatusChanged: disconnected`, attempts reconnect after 2s
- `isSpotifyInstalled()` — checks `UIApplication.shared.canOpenURL(URL(string: "spotify:")!)`

- [ ] **Step 3: Implement player state subscription**

On connection established:
- `appRemote.playerAPI?.delegate = self`
- `appRemote.playerAPI?.subscribe(toPlayerState:)`
- On `playerStateDidChange`: normalize to event dict, emit `onPlayerStateChanged`
- Track URI comparison: if changed, emit `onTrackChanged` with current + previous track info

- [ ] **Step 4: Add Premium check capability**

```swift
AsyncFunction("checkPremium") { () -> Bool in
  // Fetch capabilities via userAPI
  // Return canPlayOnDemand
}
```

- [ ] **Step 5: Build and verify module loads**

```bash
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

Build via Xcode — verify no compile errors in ExpoSpotifyModule.swift.

- [ ] **Step 6: Commit**

```bash
git add modules/expo-spotify/
git commit -m "feat: implement SPTAppRemote auth, connection lifecycle, player state subscription"
```

---

## Task 14: Swift — TTS Playback & Eject Transition

**Files:**
- Modify: `modules/expo-spotify/ios/ExpoSpotifyModule.swift`

- [ ] **Step 1: Implement proper TTS playback with delegate**

Replace the blocking `Thread.sleep` pattern with proper `AVAudioPlayerDelegate`:
- Set audio session to `.playback` with `.mixWithOthers` only
- Play base64 audio at 0.85 volume
- Use delegate `audioPlayerDidFinishPlaying` to resolve the async promise
- Crossfade timer at `duration - 1.0s` for overlay dismiss timing (fires JS event)

- [ ] **Step 2: Implement two-layer eject transition**

```swift
// playEjectTransition:
// 1. Start playing TTS (overlays Spotify's music)
// 2. Schedule skipToNext() at fadeInDelayMs
// 3. On playerStateDidChange with new track URI → emit onEjectTrackChanged
// 4. If skipToNext fails (Spotify killed) → do not emit onEjectTrackChanged,
//    let normal onTrackChanged fallback handle it
```

- [ ] **Step 3: Implement cancelEjectTransition**

- Stop TTS audio player
- Cancel scheduled skip timer
- Resolve any pending promise
- Reset `ejectInProgress` flag

- [ ] **Step 4: Build and verify**

Build via Xcode, verify no compile errors.

- [ ] **Step 5: Commit**

```bash
git add modules/expo-spotify/ios/ExpoSpotifyModule.swift
git commit -m "feat: implement TTS overlay playback and two-layer eject transition for Spotify"
```

---

## Task 15: SpotifyProvider Implementation

**Files:**
- Create: `src/providers/SpotifyProvider.ts`

This implements the `MusicProvider` interface using `expo-spotify` + server API calls.

- [ ] **Step 1: Create SpotifyProvider**

Implement all interface methods:
- Auth: delegates to `expo-spotify` native module
- Library: calls server `/spotify/playlists` and `/spotify/playlist-tracks` via `authenticatedFetch`
- Playback: delegates to `expo-spotify` (`play`, `pause`, `skipToNext`, etc.)
- Queue: track-by-track enqueue strategy — maintains local queue pointer, enqueues next 1-2 tracks on each `onTrackChanged`
- State: `getNowPlaying()` from `getPlayerState()`, `getNextInQueue()` from local queue plan
- TTS: delegates to `expo-spotify` (plays at 0.85 vol, no ducking)
- Eject: delegates to `expo-spotify`'s `playEjectTransition`
- Connection: tracks `SPTAppRemote` status via `onConnectionStatusChanged` events
- `activateDuckingSession()` / `deactivateDuckingSession()` → no-ops
- `getUpcomingQueue(count)` → returns next N entries from local queue plan
- `clearQueueCache()` → no-op

Key implementation detail — token management:
- Store access token + refresh token + expiry in MMKV
- Before each Web API call, check expiry and refresh if needed
- On 401 from any call, refresh and retry once

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/providers/SpotifyProvider.ts`

- [ ] **Step 3: Commit**

```bash
git add src/providers/SpotifyProvider.ts
git commit -m "feat: implement SpotifyProvider with queue management and token handling"
```

---

## Task 16: Onboarding — Provider Choice Screen

**Files:**
- Modify: `app/(onboarding)/music-auth.tsx`

- [ ] **Step 1: Read current music-auth.tsx**

Understand existing layout, animations, and auth flow.

- [ ] **Step 2: Add provider choice step**

Before the existing Apple Music auth UI, add a "Choose Your Music" screen with:
- Two cards: Apple Music logo + "Apple Music" / Spotify logo + "Spotify"
- Gold left-edge styling matching Stitch Gold Edition design
- On Apple Music tap: set `Storage.set('musicProvider', 'apple-music')`, proceed to existing auth flow
- On Spotify tap: set `Storage.set('musicProvider', 'spotify')`, check `isSpotifyInstalled()`:
  - If not installed: show "Spotify app required" message
  - If installed: initiate OAuth flow → on success check Premium → proceed or block

- [ ] **Step 3: Handle existing user migration**

If `Storage.getString('musicProvider')` is already set (existing user hit this screen from settings), skip the choice and go straight to auth for the selected provider.

Default to `'apple-music'` if unset (covers existing users who updated the app).

- [ ] **Step 4: Build and test on device**

Verify both paths work:
- Apple Music path unchanged
- Spotify path shows appropriate UI (even if Spotify SDK not yet fully functional)

- [ ] **Step 5: Commit**

```bash
git add app/(onboarding)/music-auth.tsx
git commit -m "feat: add provider choice screen to onboarding (Apple Music / Spotify)"
```

---

## Task 17: Home Screen — Provider-Aware Playlists + Curated Stations

**Files:**
- Modify: `src/screens/home/HomeScreenRedesign.tsx`

- [ ] **Step 1: Read current HomeScreenRedesign.tsx**

- [ ] **Step 2: Add curated stations section for Spotify**

Below "YOUR STATIONS", add "ONAY STATIONS" section (visible for Spotify users):
- Fetches from `/spotify/curated-stations` via `authenticatedFetch`
- Renders same `StationCard` components with gold-edge styling
- Only shows when `provider.providerType === 'spotify'`

- [ ] **Step 3: Add provider badge to station cards**

Small Apple Music / Spotify icon in the corner of each station card.

- [ ] **Step 4: Verify both provider paths render correctly**

Test with `Storage.set('musicProvider', 'apple-music')` and `'spotify'` manually to verify UI.

- [ ] **Step 5: Commit**

```bash
git add src/screens/home/HomeScreenRedesign.tsx
git commit -m "feat: add curated stations and provider badge to home screen"
```

---

## Task 18: Profile Screen — Provider Display & Switch

**Files:**
- Modify: `src/screens/settings/ProfileScreen.tsx`

- [ ] **Step 1: Add connected provider display**

Under "CONNECTED ECOSYSTEM" section, show:
- Provider icon + name (Apple Music or Spotify)
- Connection status for Spotify

- [ ] **Step 2: Add "Switch Music Service" option**

- Pressable row with provider icon
- On tap: confirmation dialog ("Switching will end your current session")
- If confirmed: call `resetMusicProvider()`, clear session memory, navigate to music-auth screen

- [ ] **Step 3: Commit**

```bash
git add src/screens/settings/ProfileScreen.tsx
git commit -m "feat: add provider display and switch option to profile screen"
```

---

## Task 19: BroadcastScreen — Connection Status Handling

**Files:**
- Modify: `src/screens/player/BroadcastScreen.tsx`

- [ ] **Step 1: Subscribe to connection status**

Add `provider.onConnectionStatusChanged` listener in the main useEffect. If status becomes `'disconnected'`:
- Show "Reconnecting to Spotify..." overlay text
- Pause commentary generation (AudioCoordinator skips when provider disconnected)

When status returns to `'connected'`:
- Dismiss overlay
- Resume normal operation

- [ ] **Step 2: Commit**

```bash
git add src/screens/player/BroadcastScreen.tsx
git commit -m "feat: handle Spotify connection status changes in BroadcastScreen"
```

---

## Task 20: Spotify Connect Guard

**Files:**
- Modify: `src/providers/SpotifyProvider.ts`

The spec requires checking that playback is on the local device before starting a broadcast. If Spotify is playing on a remote device (desktop, speaker), ONAY must prompt the user to transfer.

- [ ] **Step 1: Add device check to SpotifyProvider**

In `SpotifyProvider.play()`, before starting playback:
- Call Spotify Web API `GET /me/player/devices` via `authenticatedFetch`
- Check if active device is this iPhone (match device name or type === 'Smartphone')
- If active device is remote: throw an error that BroadcastScreen can catch and show "Transfer playback to this device?" prompt
- If no active device: proceed normally (Spotify will activate on this device)

- [ ] **Step 2: Add transfer playback helper**

```typescript
async transferPlaybackToLocal(): Promise<void> {
  // Call Web API PUT /me/player with device_id of this device
  // SpotifyProvider stores its device_id from getPlayerState after connection
}
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/SpotifyProvider.ts
git commit -m "feat: add Spotify Connect guard — verify local device before broadcast"
```

---

## Task 21: Production Fastify Server Routes

**Files:**
- Reference: `server/src/routes/spotify.ts` (local Express version from Task 11)
- Deploy to: `/home/cleo/cleo-api/` on Hostinger VPS (<VPS_HOST>)

The local Express server and the production Fastify server need the same Spotify routes. The production server uses Fastify, not Express.

- [ ] **Step 1: Port Spotify routes to Fastify syntax**

Convert the Express router from Task 11 to Fastify route registration:
- `router.post(path, requireAuth, handler)` → `fastify.post(path, { preHandler: requireAuth }, handler)`
- `req.body` access is the same
- `res.json()` → `reply.send()`
- Token swap/refresh routes: NO auth middleware (called from native SDK)

- [ ] **Step 2: Deploy to production**

```bash
ssh cleo@<VPS_HOST>
cd /home/cleo/cleo-api
# Pull changes, install deps, restart
```

- [ ] **Step 3: Add env vars to production .env**

```
SPOTIFY_CLIENT_ID=<production-client-id>
SPOTIFY_CLIENT_SECRET=<production-client-secret>
```

- [ ] **Step 4: Verify routes respond**

```bash
curl -X POST https://api.worthymedia.tech/spotify/curated-stations -H "Authorization: Bearer <firebase-jwt>"
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: deploy Spotify routes to production Fastify server"
```

---

## Task 22: Full Integration Test on Device

**Files:** None (verification only)

- [ ] **Step 1: Configure Spotify Developer App**

1. Create app at developer.spotify.com
2. Set redirect URI to match your app's URL scheme
3. Add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` to `server/.env`
4. Add `spotify:` URL scheme to `Info.plist` `LSApplicationQueriesSchemes`
5. Add your app's URL scheme to `Info.plist` `CFBundleURLTypes` for Spotify callback

- [ ] **Step 2: Build and run**

```bash
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

Build via Xcode on physical device.

- [ ] **Step 3: Test Apple Music path (regression)**

Verify entire radio loop still works identically with Apple Music provider.

- [ ] **Step 4: Test Spotify path**

1. Select Spotify at onboarding
2. OAuth flow → connect to Spotify app
3. Premium check passes
4. Playlists load from library
5. Select playlist → broadcast starts
6. ONAY speaks over Spotify music (TTS overlay, no ducking)
7. Eject transition fires (TTS + skip)
8. Manual skip works
9. Session Arc shows upcoming tracks from local queue plan

- [ ] **Step 5: Test edge cases**

1. Kill Spotify app mid-session → reconnect flow
2. Background the app → no CPU spike from Spotify events
3. Switch provider in settings → clears session, re-auths
4. Token expiry → auto-refresh (wait 1 hour or manually invalidate)

- [ ] **Step 6: Test Spotify Connect guard**

1. Start playing music on Spotify desktop → try to start ONAY broadcast → should prompt to transfer
2. Transfer → broadcast starts on phone

- [ ] **Step 7: Commit final verified state**

Stage specific files (not `git add -A` to avoid staging secrets):
```bash
git status
# Review changes, then add specific files
git commit -m "feat: complete Spotify integration with full provider abstraction"
```

---

## Task Order & Dependencies

```
Task 1  (Interface)
  ↓
Task 2  (AppleMusicProvider)
  ↓
Tasks 3-9  (Migration — can be parallelized)
  ↓
Task 10  (Device test — Apple Music regression)
  ↓
Tasks 11-12  (Server routes + Native module scaffold — parallel)
  ↓
Tasks 13-14  (Swift implementation — sequential)
  ↓
Task 15  (SpotifyProvider)
  ↓
Tasks 16-20  (UI changes + Spotify Connect guard — can be parallelized)
  ↓
Task 21  (Production Fastify routes)
  ↓
Task 22  (Full integration test)
```

Tasks 3-9 are the migration tasks — they can be done in any order or in parallel since each touches different files. The critical path is: interface → AppleMusicProvider → migration → device test → native module → SpotifyProvider → UI → production deploy → integration test.

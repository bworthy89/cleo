# Android Spotify Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Android support using Spotify as the music provider, behind a `MusicProvider` abstraction layer that keeps all shared TypeScript code platform-agnostic.

**Architecture:** `MusicProvider` interface with two implementations — `AppleMusicProvider` (iOS, wraps existing `expo-music-kit`) and `SpotifyProvider` (Android, wraps new `expo-spotify` Kotlin native module). Platform-based singleton factory via `Platform.OS`. All consumers migrate from direct `expo-music-kit` imports to the provider interface.

**Tech Stack:** React Native / Expo SDK 55, TypeScript, Kotlin (Spotify Android SDK), Express (server), Spotify Web API

**Spec:** `docs/superpowers/specs/2026-03-22-android-spotify-integration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/providers/MusicProvider.ts` | Interface definition, shared types (`MusicTrack`, `MusicPlaylist`, `NowPlaying`, `PlaybackStatus`, `UpcomingTrack`, callbacks) |
| `src/providers/AppleMusicProvider.ts` | Wraps `expo-music-kit` functions + event listener multiplexing from `MusicKitPlayer.ts`. Implements `MusicProvider`. iOS only. |
| `src/providers/SpotifyProvider.ts` | Wraps `expo-spotify` native module. Implements `MusicProvider`. Android only. |
| `src/providers/index.ts` | `getMusicProvider()` singleton factory — `Platform.OS === 'ios'` → Apple, else Spotify |
| `modules/expo-spotify/expo-module.config.json` | Expo module config |
| `modules/expo-spotify/index.ts` | TypeScript API for Spotify native module |
| `modules/expo-spotify/src/ExpoSpotifyModule.ts` | Expo module bridge |
| `modules/expo-spotify/android/build.gradle.kts` | Spotify Android SDK dependencies |
| `modules/expo-spotify/android/src/main/java/expo/modules/spotify/ExpoSpotifyModule.kt` | Auth, playback, ducking, TTS, eject, track detection, connection lifecycle |
| `server/src/routes/spotify.ts` | Token swap, token refresh, playlists, playlist-tracks routes |
| `__tests__/providers/MusicProvider.test.ts` | Tests for provider factory |
| `__tests__/providers/AppleMusicProvider.test.ts` | Tests for Apple Music provider |

### Modified Files

| File | Change |
|------|--------|
| `src/engines/AudioCoordinator.ts` | Replace 4 direct `expo-music-kit` imports with `getMusicProvider()` |
| `src/engines/TransitionPreloader.ts` | Replace `playEjectTransition`, `cancelEjectTransition` + `musicKitPlayer` with provider |
| `src/services/CleoVoiceEngine.ts` | Replace `playAudioFromBase64` import with provider |
| `src/engines/QueueManager.ts` | Replace `clearQueueCache`, `type MusicTrack` + `musicKitPlayer` with provider |
| `src/screens/player/BroadcastScreen.tsx` | Replace `getNextInQueue`, `skipToPrevious`, `type NowPlaying` + `musicKitPlayer` with provider |
| `src/screens/home/HomeScreenRedesign.tsx` | Replace `type MusicPlaylist` + `musicKitPlayer` with provider |
| `src/screens/arc/SessionArcScreen.tsx` | Replace `getUpcomingQueue`, `type NowPlaying`, `type UpcomingTrack` + `musicKitPlayer` with provider |
| `src/screens/settings/ProfileScreen.tsx` | Replace `setTTSVolume`, `authorize` + `musicKitPlayer` with provider; show provider name |
| `app/(onboarding)/music-auth.tsx` | Replace `musicKitPlayer` with provider; add Android Spotify auth flow |
| `src/services/Storage.ts` | Redirect `type MusicPlaylist` import to `src/providers/MusicProvider` |
| `src/services/TrackEnrichmentService.ts` | Redirect `type MusicTrack` import to `src/providers/MusicProvider` |
| `server/src/index.ts` | Register Spotify routes |
| `__tests__/engines/AudioCoordinator.test.ts` | Update mocks to use provider |
| `__tests__/engines/TransitionPreloader.test.ts` | Update mocks to use provider |
| `__tests__/services/CleoVoiceEngine.test.ts` | Update mocks to use provider |
| `__tests__/services/Storage.test.ts` | Update type import |

### Deleted Files

| File | Reason |
|------|--------|
| `src/services/MusicKitPlayer.ts` | Absorbed into `AppleMusicProvider.ts` |

---

## Task 1: MusicProvider Interface & Types

**Files:**
- Create: `src/providers/MusicProvider.ts`

- [ ] **Step 1: Create the MusicProvider interface file**

```typescript
// src/providers/MusicProvider.ts

// ── Shared Types (migrated from expo-music-kit/index.ts) ────────────

export type MusicTrack = {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  genreNames: string[];
  artworkUrl?: string;
  trackNumber: number;
  discNumber: number;
};

export type MusicPlaylist = {
  id: string;
  name: string;
  trackCount?: number;
  artworkUrl?: string;
};

export type PlaybackStatus =
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'interrupted'
  | 'seekingForward'
  | 'seekingBackward'
  | 'unknown';

export type NowPlaying = MusicTrack & {
  playbackTime: number;
  status: PlaybackStatus;
};

export type UpcomingTrack = {
  id?: string;
  title: string;
  artistName: string;
  artworkUrl?: string;
};

// ── Auth Types ──────────────────────────────────────────────────────

export type AuthStatus = 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unknown';

export interface AuthResult {
  status: AuthStatus;
  canPlayCatalog: boolean;
}

// ── Callback Types ──────────────────────────────────────────────────

export type TrackChangedEvent = {
  trackId?: string;
  previousTrackId?: string;
};

export type PlaybackStateEvent = {
  status: PlaybackStatus;
  playbackTime: number;
};

export type EjectTrackChangedEvent = {
  trackId?: string;
  previousTrackId?: string;
};

export type TrackChangedCallback = (event: TrackChangedEvent) => void;
export type PlaybackStateCallback = (event: PlaybackStateEvent) => void;
export type EjectTrackChangedCallback = (event: EjectTrackChangedEvent) => void;

// ── Connection ──────────────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export type NextTrack = { id?: string; title: string; artistName: string } | null;

// ── MusicProvider Interface ─────────────────────────────────────────

export interface MusicProvider {
  // Auth
  authorize(): Promise<AuthResult>;
  getAuthorizationStatus(): Promise<AuthStatus>;

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

  // TTS
  activateDuckingSession(): Promise<void>;
  deactivateDuckingSession(): Promise<void>;
  playAudioFromBase64(base64: string): Promise<void>;
  stopAudio(): Promise<void>;
  setTTSVolume(volume: number): void;

  // Eject
  playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void>;
  cancelEjectTransition(): Promise<void>;

  // Events (return unsubscribe function)
  onTrackChanged(cb: TrackChangedCallback): () => void;
  onPlaybackStateChanged(cb: PlaybackStateCallback): () => void;
  onEjectTrackChanged(cb: EjectTrackChangedCallback): () => void;

  // Connection
  readonly connectionStatus: ConnectionStatus;
  onConnectionStatusChanged(cb: (status: ConnectionStatus) => void): () => void;

  // Lifecycle
  destroy(): void;

  // Capabilities
  readonly providerType: 'apple-music' | 'spotify';
  readonly supportsDucking: boolean;
  readonly supportsThreeLayerCrossfade: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/providers/MusicProvider.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/providers/MusicProvider.ts
git commit -m "feat: add MusicProvider interface and shared types"
```

---

## Task 2: Provider Factory

**Files:**
- Create: `src/providers/index.ts`

- [ ] **Step 1: Create the factory module**

```typescript
// src/providers/index.ts
import { Platform } from 'react-native';
import type { MusicProvider } from './MusicProvider';

// Re-export all types so consumers can import from 'src/providers'
export type {
  MusicProvider,
  MusicTrack,
  MusicPlaylist,
  NowPlaying,
  PlaybackStatus,
  UpcomingTrack,
  AuthResult,
  AuthStatus,
  TrackChangedEvent,
  PlaybackStateEvent,
  EjectTrackChangedEvent,
  TrackChangedCallback,
  PlaybackStateCallback,
  EjectTrackChangedCallback,
  ConnectionStatus,
  NextTrack,
} from './MusicProvider';

let _provider: MusicProvider | null = null;

export function getMusicProvider(): MusicProvider {
  if (!_provider) {
    if (Platform.OS === 'ios') {
      // Lazy require to avoid loading Spotify code on iOS and vice versa
      const { AppleMusicProvider } = require('./AppleMusicProvider');
      _provider = new AppleMusicProvider();
    } else {
      const { SpotifyProvider } = require('./SpotifyProvider');
      _provider = new SpotifyProvider();
    }
  }
  return _provider;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/providers/index.ts
git commit -m "feat: add platform-based MusicProvider factory"
```

---

## Task 3: AppleMusicProvider (wraps existing expo-music-kit)

**Files:**
- Create: `src/providers/AppleMusicProvider.ts`
- Reference: `src/services/MusicKitPlayer.ts` (absorb its logic)

- [ ] **Step 1: Create AppleMusicProvider**

This file combines:
- All `expo-music-kit` function imports (from `MusicKitPlayer.ts` lines 1-26)
- The event listener multiplexing pattern (from `MusicKitPlayer.ts` lines 33-170)
- Direct function imports currently used by other consumers (e.g., `activateDuckingSession`, `getPlaybackStatus`, `playAudioFromBase64`, etc.)

```typescript
// src/providers/AppleMusicProvider.ts
import {
  authorize,
  getAuthorizationStatus,
  fetchPlaylists,
  fetchPlaylistTracks,
  play,
  pause,
  skip,
  skipToPrevious,
  seekTo,
  setUpcomingQueue,
  clearQueueCache,
  getNowPlaying,
  getPlaybackTime,
  getPlaybackStatus as getPlaybackStatusNative,
  getNextInQueue,
  getUpcomingQueue,
  activateDuckingSession,
  deactivateDuckingSession,
  playAudioFromBase64,
  stopAudio,
  setTTSVolume,
  playEjectTransition,
  cancelEjectTransition,
  addTrackChangedListener,
  addPlaybackStateListener,
  addEjectTrackChangedListener,
} from '../../modules/expo-music-kit';
import type { EventSubscription } from 'expo-modules-core';
import type {
  MusicProvider,
  AuthResult,
  AuthStatus,
  MusicPlaylist,
  MusicTrack,
  NowPlaying,
  NextTrack,
  PlaybackStatus,
  UpcomingTrack,
  TrackChangedCallback,
  PlaybackStateCallback,
  EjectTrackChangedCallback,
  ConnectionStatus,
  TrackChangedEvent,
  PlaybackStateEvent,
  EjectTrackChangedEvent,
} from './MusicProvider';

export class AppleMusicProvider implements MusicProvider {
  private trackSub: EventSubscription | null = null;
  private stateSub: EventSubscription | null = null;
  private ejectSub: EventSubscription | null = null;
  private trackListeners: TrackChangedCallback[] = [];
  private stateListeners: PlaybackStateCallback[] = [];
  private ejectListeners: EjectTrackChangedCallback[] = [];

  readonly providerType = 'apple-music' as const;
  readonly supportsDucking = true;
  readonly supportsThreeLayerCrossfade = true;
  readonly connectionStatus: ConnectionStatus = 'connected';

  // ── Auth ───────────────────────────────────────────────────────────

  async authorize(): Promise<AuthResult> {
    return authorize();
  }

  async getAuthorizationStatus(): Promise<AuthStatus> {
    return getAuthorizationStatus();
  }

  // ── Library ────────────────────────────────────────────────────────

  async fetchPlaylists(): Promise<MusicPlaylist[]> {
    return fetchPlaylists();
  }

  async fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
    return fetchPlaylistTracks(playlistId);
  }

  // ── Playback ───────────────────────────────────────────────────────

  async play(trackIds?: string[], playlistId?: string): Promise<void> {
    return play(trackIds, playlistId);
  }

  async pause(): Promise<void> {
    return pause();
  }

  async skip(): Promise<void> {
    return skip();
  }

  async skipToPrevious(): Promise<void> {
    return skipToPrevious();
  }

  async seekTo(time: number): Promise<void> {
    return seekTo(time);
  }

  async setUpcomingQueue(trackIds: string[]): Promise<void> {
    return setUpcomingQueue(trackIds);
  }

  async clearQueueCache(): Promise<void> {
    return clearQueueCache();
  }

  // ── State ──────────────────────────────────────────────────────────

  async getNowPlaying(): Promise<NowPlaying | null> {
    return getNowPlaying();
  }

  async getNextInQueue(): Promise<NextTrack> {
    return getNextInQueue();
  }

  async getPlaybackTime(): Promise<number> {
    return getPlaybackTime();
  }

  async getPlaybackStatus(): Promise<PlaybackStatus> {
    return getPlaybackStatusNative();
  }

  async getUpcomingQueue(count: number): Promise<UpcomingTrack[]> {
    return getUpcomingQueue(count);
  }

  // ── TTS ────────────────────────────────────────────────────────────

  async activateDuckingSession(): Promise<void> {
    return activateDuckingSession();
  }

  async deactivateDuckingSession(): Promise<void> {
    return deactivateDuckingSession();
  }

  async playAudioFromBase64(base64: string): Promise<void> {
    return playAudioFromBase64(base64);
  }

  async stopAudio(): Promise<void> {
    return stopAudio();
  }

  setTTSVolume(volume: number): void {
    setTTSVolume(volume);
  }

  // ── Eject ──────────────────────────────────────────────────────────
  // Note: `onSegmentReady` is NOT a native event — it's a JS callback passed
  // through TransitionPreloader.startForTrack(). The provider doesn't need to
  // handle it. TransitionPreloader fires it in fireEject() before calling
  // provider.playEjectTransition().

  async playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void> {
    return playEjectTransition(ttsBase64, fadeInDelayMs);
  }

  async cancelEjectTransition(): Promise<void> {
    return cancelEjectTransition();
  }

  // ── Events (multiplexed, same pattern as MusicKitPlayer.ts) ───────

  onTrackChanged(callback: TrackChangedCallback): () => void {
    this.trackListeners.push(callback);
    this.ensureSubscriptions();
    return () => {
      this.trackListeners = this.trackListeners.filter(cb => cb !== callback);
      this.cleanupIfEmpty();
    };
  }

  onPlaybackStateChanged(callback: PlaybackStateCallback): () => void {
    this.stateListeners.push(callback);
    this.ensureSubscriptions();
    return () => {
      this.stateListeners = this.stateListeners.filter(cb => cb !== callback);
      this.cleanupIfEmpty();
    };
  }

  onEjectTrackChanged(callback: EjectTrackChangedCallback): () => void {
    this.ejectListeners.push(callback);
    this.ensureSubscriptions();
    return () => {
      this.ejectListeners = this.ejectListeners.filter(cb => cb !== callback);
      this.cleanupIfEmpty();
    };
  }

  onConnectionStatusChanged(_cb: (status: ConnectionStatus) => void): () => void {
    // Apple Music is always connected — no-op
    return () => {};
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  destroy(): void {
    this.trackSub?.remove();
    this.stateSub?.remove();
    this.ejectSub?.remove();
    this.trackSub = null;
    this.stateSub = null;
    this.ejectSub = null;
    this.trackListeners = [];
    this.stateListeners = [];
    this.ejectListeners = [];
  }

  // ── Private ────────────────────────────────────────────────────────

  private ensureSubscriptions(): void {
    if (!this.trackSub && this.trackListeners.length > 0) {
      this.trackSub = addTrackChangedListener((event: TrackChangedEvent) => {
        this.trackListeners.forEach(cb => {
          try { cb(event); } catch (e) { console.error('[AppleMusicProvider] trackListener error:', e); }
        });
      });
    }
    if (!this.stateSub && this.stateListeners.length > 0) {
      this.stateSub = addPlaybackStateListener((event: PlaybackStateEvent) => {
        this.stateListeners.forEach(cb => {
          try { cb(event); } catch (e) { console.error('[AppleMusicProvider] stateListener error:', e); }
        });
      });
    }
    if (!this.ejectSub && this.ejectListeners.length > 0) {
      this.ejectSub = addEjectTrackChangedListener((event: EjectTrackChangedEvent) => {
        this.ejectListeners.forEach(cb => {
          try { cb(event); } catch (e) { console.error('[AppleMusicProvider] ejectListener error:', e); }
        });
      });
    }
  }

  private cleanupIfEmpty(): void {
    if (this.trackListeners.length === 0 && this.trackSub) {
      this.trackSub.remove();
      this.trackSub = null;
    }
    if (this.stateListeners.length === 0 && this.stateSub) {
      this.stateSub.remove();
      this.stateSub = null;
    }
    if (this.ejectListeners.length === 0 && this.ejectSub) {
      this.ejectSub.remove();
      this.ejectSub = null;
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/providers/AppleMusicProvider.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/providers/AppleMusicProvider.ts
git commit -m "feat: add AppleMusicProvider wrapping expo-music-kit"
```

---

## Task 4: Migrate AudioCoordinator

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`
- Modify: `__tests__/engines/AudioCoordinator.test.ts`

- [ ] **Step 1: Update AudioCoordinator imports**

Replace line 8:
```typescript
// OLD:
import { getPlaybackStatus, activateDuckingSession, deactivateDuckingSession, setTTSVolume } from '../../modules/expo-music-kit';
// NEW:
import { getMusicProvider } from '../providers';
```

- [ ] **Step 2: Update constructor**

Replace `setTTSVolume(parseFloat(saved))` (line 52) with:
```typescript
getMusicProvider().setTTSVolume(parseFloat(saved));
```

- [ ] **Step 3: Update isMusicPlaying method**

Replace `getPlaybackStatus()` call (line 94) with:
```typescript
const status = await getMusicProvider().getPlaybackStatus();
```

- [ ] **Step 4: Update ducking calls**

Replace all `activateDuckingSession()` calls (lines 130, 218) with:
```typescript
await getMusicProvider().activateDuckingSession().catch(() => {});
```

Replace all `deactivateDuckingSession()` calls (lines 136, 220, 229, 297) with:
```typescript
await getMusicProvider().deactivateDuckingSession().catch(() => {});
```

- [ ] **Step 5: Update test mocks**

In `__tests__/engines/AudioCoordinator.test.ts`, replace the `expo-music-kit` mock (line 2 import + mock block) with a provider mock:

```typescript
// Replace:
import { getPlaybackStatus, activateDuckingSession, deactivateDuckingSession } from '../../modules/expo-music-kit';
// With:
// (no import needed — mock the provider module)

// Replace expo-music-kit mock with:
jest.mock('../../src/providers', () => ({
  getMusicProvider: jest.fn(() => ({
    getPlaybackStatus: jest.fn().mockResolvedValue('playing'),
    activateDuckingSession: jest.fn().mockResolvedValue(undefined),
    deactivateDuckingSession: jest.fn().mockResolvedValue(undefined),
    setTTSVolume: jest.fn(),
  })),
}));
```

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/engines/AudioCoordinator.test.ts --no-coverage`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/engines/AudioCoordinator.ts __tests__/engines/AudioCoordinator.test.ts
git commit -m "refactor: migrate AudioCoordinator to MusicProvider"
```

---

## Task 5: Migrate CleoVoiceEngine

**Files:**
- Modify: `src/services/CleoVoiceEngine.ts`
- Modify: `__tests__/services/CleoVoiceEngine.test.ts`

- [ ] **Step 1: Update CleoVoiceEngine import**

Replace line 1:
```typescript
// OLD:
import { playAudioFromBase64 } from '../../modules/expo-music-kit';
// NEW:
import { getMusicProvider } from '../providers';
```

- [ ] **Step 2: Update playCachedAudio function**

Replace `playAudioFromBase64(base64Audio)` (line 223) with:
```typescript
await getMusicProvider().playAudioFromBase64(base64Audio);
```

- [ ] **Step 3: Update synthesizeAndPlay function**

Replace `playAudioFromBase64(base64Audio)` (line 234) with:
```typescript
await getMusicProvider().playAudioFromBase64(base64Audio);
```

- [ ] **Step 4: Update test mocks**

In `__tests__/services/CleoVoiceEngine.test.ts`, replace `expo-music-kit` mock with:

```typescript
jest.mock('../../src/providers', () => ({
  getMusicProvider: jest.fn(() => ({
    playAudioFromBase64: jest.fn().mockResolvedValue(undefined),
  })),
}));
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/services/CleoVoiceEngine.test.ts --no-coverage`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/services/CleoVoiceEngine.ts __tests__/services/CleoVoiceEngine.test.ts
git commit -m "refactor: migrate CleoVoiceEngine to MusicProvider"
```

---

## Task 6: Migrate TransitionPreloader

**Files:**
- Modify: `src/engines/TransitionPreloader.ts`
- Modify: `__tests__/engines/TransitionPreloader.test.ts`

- [ ] **Step 1: Update TransitionPreloader imports**

Replace lines 10-11:
```typescript
// OLD:
import { playEjectTransition, cancelEjectTransition } from '../../modules/expo-music-kit';
import { musicKitPlayer } from '../services/MusicKitPlayer';
// NEW:
import { getMusicProvider } from '../providers';
```

- [ ] **Step 2: Update polling — replace musicKitPlayer.getPlaybackTime()**

In `startForTrack` method, line 141:
```typescript
// OLD:
const time = await musicKitPlayer.getPlaybackTime();
// NEW:
const time = await getMusicProvider().getPlaybackTime();
```

- [ ] **Step 3: Update cancel — replace cancelEjectTransition()**

In `cancel` method, line 177:
```typescript
// OLD:
cancelEjectTransition().catch(...)
// NEW:
getMusicProvider().cancelEjectTransition().catch(...)
```

- [ ] **Step 4: Update revalidateNextTrack — replace musicKitPlayer.getNextInQueue()**

In `revalidateNextTrack` method, line 206:
```typescript
// OLD:
musicKitPlayer.getNextInQueue().then(...)
// NEW:
getMusicProvider().getNextInQueue().then(...)
```

- [ ] **Step 5: Update beginGeneration — replace musicKitPlayer.getNextInQueue()**

In `beginGeneration` method, line 239:
```typescript
// OLD:
const realNext = await musicKitPlayer.getNextInQueue();
// NEW:
const realNext = await getMusicProvider().getNextInQueue();
```

- [ ] **Step 6: Update tryFireEject — replace musicKitPlayer.getNextInQueue()**

In `tryFireEject` method, line 305:
```typescript
// OLD:
const realNext = await musicKitPlayer.getNextInQueue();
// NEW:
const realNext = await getMusicProvider().getNextInQueue();
```

- [ ] **Step 7: Update fireEject — replace playEjectTransition()**

In `fireEject` method, line 382:
```typescript
// OLD:
playEjectTransition(this.cachedBase64, fadeInDelayMs)
// NEW:
getMusicProvider().playEjectTransition(this.cachedBase64, fadeInDelayMs)
```

- [ ] **Step 8: Update test mocks**

In `__tests__/engines/TransitionPreloader.test.ts`, replace `expo-music-kit` and `MusicKitPlayer` mocks with:

```typescript
jest.mock('../../src/providers', () => ({
  getMusicProvider: jest.fn(() => ({
    getPlaybackTime: jest.fn().mockResolvedValue(0),
    getNextInQueue: jest.fn().mockResolvedValue({ title: 'Next Song', artistName: 'Artist' }),
    playEjectTransition: jest.fn().mockResolvedValue(undefined),
    cancelEjectTransition: jest.fn().mockResolvedValue(undefined),
  })),
}));
```

- [ ] **Step 9: Run tests**

Run: `npx jest __tests__/engines/TransitionPreloader.test.ts --no-coverage`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add src/engines/TransitionPreloader.ts __tests__/engines/TransitionPreloader.test.ts
git commit -m "refactor: migrate TransitionPreloader to MusicProvider"
```

---

## Task 7: Migrate QueueManager

**Files:**
- Modify: `src/engines/QueueManager.ts`
- Modify: `__tests__/engines/QueueManager.test.ts`

- [ ] **Step 1: Update QueueManager imports**

Replace lines 7 and 9:
```typescript
// OLD:
import { musicKitPlayer } from '../services/MusicKitPlayer';
import { clearQueueCache, type MusicTrack } from '../../modules/expo-music-kit';
// NEW:
import { getMusicProvider, type MusicTrack } from '../providers';
```

- [ ] **Step 2: Replace all musicKitPlayer usages**

Search for `musicKitPlayer.` in QueueManager.ts and replace each call:
- `musicKitPlayer.fetchPlaylistTracks(...)` → `getMusicProvider().fetchPlaylistTracks(...)`
- `musicKitPlayer.play(...)` → `getMusicProvider().play(...)`
- `musicKitPlayer.setUpcomingQueue(...)` → `getMusicProvider().setUpcomingQueue(...)`

- [ ] **Step 3: Replace clearQueueCache usage**

Replace `clearQueueCache()` with `getMusicProvider().clearQueueCache()`.

- [ ] **Step 4: Update test mocks if needed**

In `__tests__/engines/QueueManager.test.ts`, replace `MusicKitPlayer` and `expo-music-kit` mocks with provider mock.

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/engines/QueueManager.test.ts --no-coverage`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/engines/QueueManager.ts __tests__/engines/QueueManager.test.ts
git commit -m "refactor: migrate QueueManager to MusicProvider"
```

---

## Task 8: Migrate BroadcastScreen

**Files:**
- Modify: `src/screens/player/BroadcastScreen.tsx`

- [ ] **Step 1: Update imports**

Replace lines 34 and 42:
```typescript
// OLD:
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { getNextInQueue, skipToPrevious, type NowPlaying } from '../../../modules/expo-music-kit';
// NEW:
import { getMusicProvider, type NowPlaying } from '../../providers';
```

- [ ] **Step 2: Replace all musicKitPlayer and direct function usages**

Throughout BroadcastScreen.tsx:
- `musicKitPlayer.onTrackChanged(...)` → `getMusicProvider().onTrackChanged(...)`
- `musicKitPlayer.onPlaybackStateChanged(...)` → `getMusicProvider().onPlaybackStateChanged(...)`
- `musicKitPlayer.onEjectTrackChanged(...)` → `getMusicProvider().onEjectTrackChanged(...)`
- `musicKitPlayer.getNowPlaying()` → `getMusicProvider().getNowPlaying()`
- `musicKitPlayer.getPlaybackTime()` → `getMusicProvider().getPlaybackTime()`
- `musicKitPlayer.getPlaybackStatus()` → `getMusicProvider().getPlaybackStatus()`
- `musicKitPlayer.pause()` → `getMusicProvider().pause()`
- `musicKitPlayer.skip()` → `getMusicProvider().skip()`
- `musicKitPlayer.play()` → `getMusicProvider().play()`
- `getNextInQueue()` → `getMusicProvider().getNextInQueue()`
- `skipToPrevious()` → `getMusicProvider().skipToPrevious()`

- [ ] **Step 3: Verify no remaining expo-music-kit or MusicKitPlayer imports**

Run: `grep -n 'expo-music-kit\|MusicKitPlayer' src/screens/player/BroadcastScreen.tsx`
Expected: No matches

- [ ] **Step 4: Commit**

```bash
git add src/screens/player/BroadcastScreen.tsx
git commit -m "refactor: migrate BroadcastScreen to MusicProvider"
```

---

## Task 9: Migrate Remaining Screens

**Files:**
- Modify: `src/screens/home/HomeScreenRedesign.tsx`
- Modify: `src/screens/arc/SessionArcScreen.tsx`
- Modify: `src/screens/settings/ProfileScreen.tsx`
- Modify: `app/(onboarding)/music-auth.tsx`

- [ ] **Step 1: Migrate HomeScreenRedesign.tsx**

Replace:
```typescript
// OLD:
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
// NEW:
import { getMusicProvider, type MusicPlaylist } from '../../providers';
```
Replace all `musicKitPlayer.` calls with `getMusicProvider().` calls.

- [ ] **Step 2: Migrate SessionArcScreen.tsx**

Replace:
```typescript
// OLD:
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { getUpcomingQueue, type NowPlaying, type UpcomingTrack } from '../../../modules/expo-music-kit';
// NEW:
import { getMusicProvider, type NowPlaying, type UpcomingTrack } from '../../providers';
```
Replace `musicKitPlayer.` calls with `getMusicProvider().` calls.
Replace `getUpcomingQueue(count)` with `getMusicProvider().getUpcomingQueue(count)`.

- [ ] **Step 3: Migrate ProfileScreen.tsx**

Replace:
```typescript
// OLD:
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { setTTSVolume, authorize } from '../../../modules/expo-music-kit';
// NEW:
import { getMusicProvider } from '../../providers';
```
Replace `setTTSVolume(...)` with `getMusicProvider().setTTSVolume(...)`.
Replace `authorize()` with `getMusicProvider().authorize()`.
Replace all `musicKitPlayer.` calls with `getMusicProvider().` calls.

Add provider name display in "CONNECTED ECOSYSTEM" section:
```typescript
import { Platform } from 'react-native';
// In the render, where the provider name is shown:
const providerName = Platform.OS === 'ios' ? 'Apple Music' : 'Spotify';
```

- [ ] **Step 4: Migrate music-auth.tsx**

Replace:
```typescript
// OLD:
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';
// NEW:
import { getMusicProvider } from '../../src/providers';
```
Replace all `musicKitPlayer.` calls with `getMusicProvider().` calls.

The Android-specific Spotify auth flow will be added in a later task (Task 12) after the native module is built.

- [ ] **Step 5: Verify no remaining MusicKitPlayer imports across all screens**

Run: `grep -rn 'MusicKitPlayer' src/screens/ app/`
Expected: No matches

- [ ] **Step 6: Commit**

```bash
git add src/screens/ app/(onboarding)/music-auth.tsx
git commit -m "refactor: migrate all screens to MusicProvider"
```

---

## Task 10: Migrate Type-Only Imports & Delete MusicKitPlayer

**Files:**
- Modify: `src/services/Storage.ts`
- Modify: `src/services/TrackEnrichmentService.ts`
- Modify: `__tests__/services/Storage.test.ts`
- Delete: `src/services/MusicKitPlayer.ts`

- [ ] **Step 1: Update Storage.ts type import**

Replace line 3:
```typescript
// OLD:
import type { MusicPlaylist } from '../../modules/expo-music-kit';
// NEW:
import type { MusicPlaylist } from '../providers/MusicProvider';
```

- [ ] **Step 2: Update TrackEnrichmentService.ts type import**

Replace line 3:
```typescript
// OLD:
import type { MusicTrack } from '../../modules/expo-music-kit';
// NEW:
import type { MusicTrack } from '../providers/MusicProvider';
```

- [ ] **Step 3: Update Storage.test.ts type import**

Replace:
```typescript
// OLD:
import type { MusicPlaylist } from '../../modules/expo-music-kit';
// NEW:
import type { MusicPlaylist } from '../../src/providers/MusicProvider';
```

- [ ] **Step 4: Run post-migration verification**

Run: `grep -rn "from.*expo-music-kit" src/ app/ __tests__/ --include='*.ts' --include='*.tsx' | grep -v 'AppleMusicProvider'`
Expected: No matches

Run: `grep -rn "MusicKitPlayer" src/ app/ __tests__/ --include='*.ts' --include='*.tsx' | grep -v 'AppleMusicProvider'`
Expected: No matches

- [ ] **Step 5: Delete MusicKitPlayer.ts**

```bash
rm src/services/MusicKitPlayer.ts
```

- [ ] **Step 6: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: complete provider migration, delete MusicKitPlayer.ts"
```

---

## Task 11: Server Spotify Routes

**Files:**
- Create: `server/src/routes/spotify.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create Spotify route module**

```typescript
// server/src/routes/spotify.ts
import { Router, Request, Response } from 'express';

export const spotifyRouter = Router();

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

function getSpotifyCredentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set');
  }
  return { clientId, clientSecret };
}

// POST /spotify/token-swap — exchange auth code for tokens
spotifyRouter.post('/spotify/token-swap', async (req: Request, res: Response) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing or invalid code' });
      return;
    }
    if (!redirectUri || typeof redirectUri !== 'string') {
      res.status(400).json({ error: 'Missing or invalid redirectUri' });
      return;
    }

    const { clientId, clientSecret } = getSpotifyCredentials();
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Spotify] Token swap failed:', response.status, errorText);
      res.status(response.status).json({ error: 'Token swap failed' });
      return;
    }

    const data = await response.json();
    res.json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    });
  } catch (error) {
    console.error('[Spotify] Token swap error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /spotify/token-refresh — refresh an expired access token
spotifyRouter.post('/spotify/token-refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({ error: 'Missing or invalid refreshToken' });
      return;
    }

    const { clientId, clientSecret } = getSpotifyCredentials();
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Spotify] Token refresh failed:', response.status, errorText);
      res.status(response.status).json({ error: 'Token refresh failed' });
      return;
    }

    const data = await response.json();
    res.json({
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    });
  } catch (error) {
    console.error('[Spotify] Token refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /spotify/playlists — fetch user's playlists
spotifyRouter.post('/spotify/playlists', async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken || typeof accessToken !== 'string') {
      res.status(400).json({ error: 'Missing or invalid accessToken' });
      return;
    }

    const playlists: any[] = [];
    let url: string | null = `${SPOTIFY_API_BASE}/me/playlists?limit=50`;

    while (url) {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          res.status(401).json({ error: 'Token expired' });
          return;
        }
        throw new Error(`Spotify API error: ${response.status}`);
      }

      const data = await response.json();
      playlists.push(...data.items);
      url = data.next;
    }

    // Normalize to MusicPlaylist shape
    const normalized = playlists.map((p: any) => ({
      id: p.id,
      name: p.name,
      trackCount: p.tracks?.total,
      artworkUrl: p.images?.[0]?.url,
    }));

    res.json({ playlists: normalized });
  } catch (error) {
    console.error('[Spotify] Playlists error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /spotify/playlist-tracks — fetch tracks for a playlist with genre enrichment
spotifyRouter.post('/spotify/playlist-tracks', async (req: Request, res: Response) => {
  try {
    const { accessToken, playlistId } = req.body;
    if (!accessToken || typeof accessToken !== 'string') {
      res.status(400).json({ error: 'Missing or invalid accessToken' });
      return;
    }
    if (!playlistId || typeof playlistId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid playlistId' });
      return;
    }

    // Fetch all tracks from the playlist (paginated)
    const items: any[] = [];
    let url: string | null = `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`;

    while (url) {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          res.status(401).json({ error: 'Token expired' });
          return;
        }
        throw new Error(`Spotify API error: ${response.status}`);
      }

      const data = await response.json();
      items.push(...data.items);
      url = data.next;
    }

    // Collect unique artist IDs for genre lookup
    const artistIds = new Set<string>();
    for (const item of items) {
      if (item.track?.artists) {
        for (const artist of item.track.artists) {
          artistIds.add(artist.id);
        }
      }
    }

    // Batch fetch artist genres (max 50 per request, 500ms delay between batches)
    const artistGenreMap = new Map<string, string[]>();
    const artistIdArray = Array.from(artistIds);

    for (let i = 0; i < artistIdArray.length; i += 50) {
      if (i > 0) await new Promise(r => setTimeout(r, 500));
      const batch = artistIdArray.slice(i, i + 50);

      const response = await fetch(
        `${SPOTIFY_API_BASE}/artists?ids=${batch.join(',')}`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );

      if (response.ok) {
        const data = await response.json();
        for (const artist of data.artists) {
          if (artist) {
            artistGenreMap.set(artist.id, artist.genres || []);
          }
        }
      }
    }

    // Normalize tracks to MusicTrack shape
    const tracks = items
      .filter((item: any) => item.track && item.track.id)
      .map((item: any, index: number) => {
        const track = item.track;
        // Merge genres from all track artists
        const genreNames: string[] = [];
        for (const artist of (track.artists || [])) {
          const genres = artistGenreMap.get(artist.id) || [];
          for (const g of genres) {
            if (!genreNames.includes(g)) genreNames.push(g);
          }
        }

        return {
          id: track.id,
          title: track.name,
          artistName: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
          albumTitle: track.album?.name || 'Unknown',
          duration: Math.round((track.duration_ms || 0) / 1000),
          genreNames,
          artworkUrl: track.album?.images?.[0]?.url,
          trackNumber: track.track_number || index + 1,
          discNumber: track.disc_number || 1,
        };
      });

    res.json({ tracks });
  } catch (error) {
    console.error('[Spotify] Playlist tracks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 2: Register Spotify routes in server/src/index.ts**

Add after existing route imports (line 8):
```typescript
import { spotifyRouter } from './routes/spotify';
```

Add a Spotify-specific rate limiter (more permissive than generation routes, since playlist fetching is bursty at session start):
```typescript
const spotifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: keyByUser,
  standardHeaders: true,
  legacyHeaders: false,
});
```

Add after existing route registrations (line 84):
```typescript
app.use(requireAuth, spotifyLimiter, spotifyRouter);
```

Note: The Spotify access token is passed from the client in request bodies. This is a trade-off — the alternative (server-side token storage per Firebase UID) is more secure but adds database/cache complexity. The current approach is acceptable because: (1) all routes are behind Firebase JWT auth, (2) the Spotify token scope is limited to read-only + app-remote-control, (3) tokens expire after 1 hour. If server-side storage is desired later, the migration is straightforward — store tokens keyed by `req.uid` and remove the `accessToken` field from request bodies.

- [ ] **Step 3: Add env var placeholders**

Add to `server/.env` (the file is gitignored):
```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

- [ ] **Step 4: Verify server compiles**

Run: `cd server && npx tsc --noEmit && cd ..`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/spotify.ts server/src/index.ts
git commit -m "feat: add Spotify server routes (token swap, playlists, tracks)"
```

---

## Task 12: Spotify Native Module Scaffold (Android/Kotlin)

**Files:**
- Create: `modules/expo-spotify/expo-module.config.json`
- Create: `modules/expo-spotify/index.ts`
- Create: `modules/expo-spotify/src/ExpoSpotifyModule.ts`
- Create: `modules/expo-spotify/android/build.gradle.kts`
- Create: `modules/expo-spotify/android/src/main/java/expo/modules/spotify/ExpoSpotifyModule.kt`

- [ ] **Step 1: Create expo-module.config.json**

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.spotify.ExpoSpotifyModule"]
  }
}
```

- [ ] **Step 2: Create TypeScript bridge (index.ts)**

```typescript
// modules/expo-spotify/index.ts
import { type EventSubscription } from 'expo-modules-core';
import ExpoSpotify from './src/ExpoSpotifyModule';

const emitter = ExpoSpotify as unknown as {
  addListener(eventName: string, listener: (...args: any[]) => void): EventSubscription;
};

// ── Auth ──────────────────────────────────────────────────────────────

export async function authorize(clientId: string, redirectUri: string): Promise<{ code: string }> {
  return await ExpoSpotify.authorize(clientId, redirectUri);
}

export async function connectAppRemote(accessToken: string): Promise<void> {
  return await ExpoSpotify.connectAppRemote(accessToken);
}

export function isSpotifyInstalled(): boolean {
  return ExpoSpotify.isSpotifyInstalled();
}

// ── Playback ──────────────────────────────────────────────────────────

export async function play(uri: string): Promise<void> {
  return await ExpoSpotify.play(uri);
}

export async function pause(): Promise<void> {
  return await ExpoSpotify.pause();
}

export async function resume(): Promise<void> {
  return await ExpoSpotify.resume();
}

export async function skipNext(): Promise<void> {
  return await ExpoSpotify.skipNext();
}

export async function skipPrevious(): Promise<void> {
  return await ExpoSpotify.skipPrevious();
}

export async function seekTo(positionMs: number): Promise<void> {
  return await ExpoSpotify.seekTo(positionMs);
}

export async function queue(uri: string): Promise<void> {
  return await ExpoSpotify.queue(uri);
}

// ── State ─────────────────────────────────────────────────────────────

export async function getPlayerState(): Promise<{
  trackUri: string;
  trackName: string;
  artistName: string;
  albumName: string;
  albumArtUrl: string;
  durationMs: number;
  positionMs: number;
  isPaused: boolean;
} | null> {
  return await ExpoSpotify.getPlayerState();
}

// ── Audio / TTS ───────────────────────────────────────────────────────

export async function activateDuckingSession(): Promise<void> {
  return await ExpoSpotify.activateDuckingSession();
}

export async function deactivateDuckingSession(): Promise<void> {
  return await ExpoSpotify.deactivateDuckingSession();
}

export async function playAudioFromBase64(base64: string): Promise<void> {
  return await ExpoSpotify.playAudioFromBase64(base64);
}

export async function stopAudio(): Promise<void> {
  return await ExpoSpotify.stopAudio();
}

export function setTTSVolume(volume: number): void {
  ExpoSpotify.setTTSVolume(volume);
}

// ── Eject ─────────────────────────────────────────────────────────────

export async function playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void> {
  return await ExpoSpotify.playEjectTransition(ttsBase64, fadeInDelayMs);
}

export async function cancelEjectTransition(): Promise<void> {
  return await ExpoSpotify.cancelEjectTransition();
}

// ── Events ────────────────────────────────────────────────────────────

export function addTrackChangedListener(
  listener: (event: { trackUri: string; previousTrackUri?: string }) => void
): EventSubscription {
  return emitter.addListener('onTrackChanged', listener);
}

export function addPlayerStateListener(
  listener: (event: { isPaused: boolean; positionMs: number }) => void
): EventSubscription {
  return emitter.addListener('onPlayerStateChanged', listener);
}

export function addEjectTrackChangedListener(
  listener: (event: { trackUri: string; previousTrackUri?: string }) => void
): EventSubscription {
  return emitter.addListener('onEjectTrackChanged', listener);
}

export function addConnectionStatusListener(
  listener: (event: { status: string }) => void
): EventSubscription {
  return emitter.addListener('onConnectionStatusChanged', listener);
}
```

- [ ] **Step 3: Create ExpoSpotifyModule.ts bridge**

```typescript
// modules/expo-spotify/src/ExpoSpotifyModule.ts
import { requireNativeModule } from 'expo-modules-core';
export default requireNativeModule('ExpoSpotify');
```

- [ ] **Step 4: Create build.gradle.kts**

```kotlin
// modules/expo-spotify/android/build.gradle.kts
plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "expo.modules.spotify"
  compileSdk = 34

  defaultConfig {
    minSdk = 24
  }
}

dependencies {
  implementation("com.spotify.android:auth:2.1.1")
  implementation("com.spotify.android:app-remote:0.8.0")
  implementation("com.google.code.gson:gson:2.10.1")
  implementation("expo:expo-modules-core:latest.release")
}
```

Note: The Spotify Android SDK versions and exact dependency syntax should be verified against the latest Spotify Developer docs at implementation time. The `app-remote` artifact may need to be added as a local AAR rather than a Maven dependency.

- [ ] **Step 5: Create Kotlin module stub**

```kotlin
// modules/expo-spotify/android/src/main/java/expo/modules/spotify/ExpoSpotifyModule.kt
package expo.modules.spotify

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoSpotifyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoSpotify")

    // TODO: Implement auth, playback, ducking, TTS, eject, events
    // See spec: docs/superpowers/specs/2026-03-22-android-spotify-integration-design.md
    // Section: "Spotify Native Module (expo-spotify, Android/Kotlin)"

    Function("isSpotifyInstalled") {
      // Check if Spotify app is installed
      val pm = appContext.reactContext?.packageManager ?: return@Function false
      pm.getLaunchIntentForPackage("com.spotify.music") != null
    }
  }
}
```

The full Kotlin implementation (auth, playback, ducking via AudioFocus, TTS via MediaPlayer, eject transitions, player state subscription, connection lifecycle) is a substantial task that should be implemented incrementally with device testing after the abstraction layer is verified working on iOS.

- [ ] **Step 6: Commit**

```bash
git add modules/expo-spotify/
git commit -m "feat: scaffold expo-spotify native module (Android/Kotlin)"
```

---

## Task 13: SpotifyProvider (Android provider implementation)

**Files:**
- Create: `src/providers/SpotifyProvider.ts`

- [ ] **Step 1: Create SpotifyProvider**

This wraps the `expo-spotify` native module and Spotify Web API calls into the `MusicProvider` interface. It handles:
- Auth via OAuth + token swap through server
- Playback via `SpotifyAppRemote`
- Queue management (track-by-track enqueue, local queue plan)
- Ducking via AudioFocus
- TTS playback
- Two-layer eject transitions
- Connection status tracking
- Token refresh on expiry

```typescript
// src/providers/SpotifyProvider.ts
import {
  authorize as spotifyAuthorize,
  connectAppRemote,
  isSpotifyInstalled,
  play as spotifyPlay,
  pause as spotifyPause,
  resume as spotifyResume,
  skipNext,
  skipPrevious as spotifySkipPrevious,
  seekTo as spotifySeekTo,
  queue as spotifyQueue,
  getPlayerState,
  activateDuckingSession as nativeActivateDucking,
  deactivateDuckingSession as nativeDeactivateDucking,
  playAudioFromBase64 as nativePlayAudio,
  stopAudio as nativeStopAudio,
  setTTSVolume as nativeSetTTSVolume,
  playEjectTransition as nativePlayEject,
  cancelEjectTransition as nativeCancelEject,
  addTrackChangedListener,
  addPlayerStateListener,
  addEjectTrackChangedListener,
  addConnectionStatusListener,
} from '../../modules/expo-spotify';
import type { EventSubscription } from 'expo-modules-core';
import { authenticatedFetch } from '../services/api';
import { storage } from '../services/Storage';
import type {
  MusicProvider,
  AuthResult,
  AuthStatus,
  MusicPlaylist,
  MusicTrack,
  NowPlaying,
  NextTrack,
  PlaybackStatus,
  UpcomingTrack,
  TrackChangedCallback,
  PlaybackStateCallback,
  EjectTrackChangedCallback,
  ConnectionStatus,
} from './MusicProvider';

const SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID'; // TODO: move to config
const SPOTIFY_REDIRECT_URI = 'com.worthymedia.cleo://spotify-auth-callback';

export class SpotifyProvider implements MusicProvider {
  private trackSub: EventSubscription | null = null;
  private stateSub: EventSubscription | null = null;
  private ejectSub: EventSubscription | null = null;
  private connectionSub: EventSubscription | null = null;

  private trackListeners: TrackChangedCallback[] = [];
  private stateListeners: PlaybackStateCallback[] = [];
  private ejectListeners: EjectTrackChangedCallback[] = [];
  private connectionListeners: ((status: ConnectionStatus) => void)[] = [];

  private _connectionStatus: ConnectionStatus = 'disconnected';
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    // Load persisted tokens from MMKV on startup
    this.accessToken = storage.getString('spotify.accessToken') ?? null;
    this.refreshToken = storage.getString('spotify.refreshToken') ?? null;
    const expiresAt = storage.getString('spotify.tokenExpiresAt');
    this.tokenExpiresAt = expiresAt ? parseInt(expiresAt, 10) : 0;
  }

  private persistTokens(): void {
    if (this.accessToken) storage.set('spotify.accessToken', this.accessToken);
    if (this.refreshToken) storage.set('spotify.refreshToken', this.refreshToken);
    storage.set('spotify.tokenExpiresAt', this.tokenExpiresAt.toString());
  }

  // Local queue plan for getNextInQueue / getUpcomingQueue
  private queuePlan: MusicTrack[] = [];
  private queuePlanIds: string[] = [];
  private queueIndex = 0;

  readonly providerType = 'spotify' as const;
  readonly supportsDucking = true;
  readonly supportsThreeLayerCrossfade = false;

  get connectionStatus(): ConnectionStatus {
    return this._connectionStatus;
  }

  // ── Auth ───────────────────────────────────────────────────────────

  async authorize(): Promise<AuthResult> {
    if (!isSpotifyInstalled()) {
      return { status: 'denied', canPlayCatalog: false };
    }

    try {
      const { code } = await spotifyAuthorize(SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI);

      // Token swap via server
      const response = await authenticatedFetch('/spotify/token-swap', {
        method: 'POST',
        body: JSON.stringify({ code, redirectUri: SPOTIFY_REDIRECT_URI }),
      });
      const data = await response.json();
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.tokenExpiresAt = Date.now() + (data.expiresIn * 1000);
      this.persistTokens();

      // Connect App Remote
      await connectAppRemote(this.accessToken!);
      this._connectionStatus = 'connected';
      this.setupEventSubscriptions();

      // Check Premium via Web API
      const meResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });
      const me = await meResponse.json();
      const isPremium = me.product === 'premium';

      return {
        status: isPremium ? 'authorized' : 'denied',
        canPlayCatalog: isPremium,
      };
    } catch (error) {
      console.error('[SpotifyProvider] authorize error:', error);
      return { status: 'unknown', canPlayCatalog: false };
    }
  }

  async getAuthorizationStatus(): Promise<AuthStatus> {
    if (!isSpotifyInstalled()) return 'notDetermined';
    return this._connectionStatus === 'connected' ? 'authorized' : 'notDetermined';
  }

  // ── Library ────────────────────────────────────────────────────────

  async fetchPlaylists(): Promise<MusicPlaylist[]> {
    await this.ensureToken();
    // Note: authenticatedFetch sets Content-Type: application/json automatically
    const response = await authenticatedFetch('/spotify/playlists', {
      method: 'POST',
      body: JSON.stringify({ accessToken: this.accessToken }),
    });
    const data = await response.json();
    return data.playlists;
  }

  async fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
    await this.ensureToken();
    const response = await authenticatedFetch('/spotify/playlist-tracks', {
      method: 'POST',
      body: JSON.stringify({ accessToken: this.accessToken, playlistId }),
    });
    const data = await response.json();
    return data.tracks;
  }

  // ── Playback ───────────────────────────────────────────────────────

  async play(trackIds?: string[], playlistId?: string): Promise<void> {
    if (trackIds && trackIds.length > 0) {
      await spotifyPlay(`spotify:track:${trackIds[0]}`);
      // Store queue plan and enqueue next track
      this.queuePlan = []; // Will be populated by QueueManager
      this.queueIndex = 0;
      if (trackIds.length > 1) {
        await spotifyQueue(`spotify:track:${trackIds[1]}`);
      }
    } else if (playlistId) {
      await spotifyPlay(`spotify:playlist:${playlistId}`);
    }
  }

  async pause(): Promise<void> {
    await spotifyPause();
  }

  async skip(): Promise<void> {
    await skipNext();
  }

  async skipToPrevious(): Promise<void> {
    await spotifySkipPrevious();
  }

  async seekTo(time: number): Promise<void> {
    await spotifySeekTo(time * 1000); // Convert seconds to ms
  }

  async setUpcomingQueue(trackIds: string[]): Promise<void> {
    // Enqueue tracks one at a time (Spotify SDK limitation)
    for (const id of trackIds) {
      await spotifyQueue(`spotify:track:${id}`);
    }
    // Update local queue plan for getNextInQueue/getUpcomingQueue
    // The caller (QueueManager) passes the full ordered list of upcoming track IDs.
    // We need the full track objects — fetch from our cached playlist tracks.
    this.queuePlanIds = trackIds;
  }

  // Called by QueueManager after fetchPlaylistTracks to populate the local queue plan
  // so getNextInQueue() and getUpcomingQueue() have full track metadata.
  setQueuePlanTracks(tracks: MusicTrack[]): void {
    this.queuePlan = tracks;
    this.queueIndex = 0;
  }

  async clearQueueCache(): Promise<void> {
    // No-op for Spotify — no server-side queue to clear
    this.queuePlan = [];
    this.queuePlanIds = [];
    this.queueIndex = 0;
  }

  // ── State ──────────────────────────────────────────────────────────

  async getNowPlaying(): Promise<NowPlaying | null> {
    const state = await getPlayerState();
    if (!state) return null;
    return {
      id: state.trackUri.replace('spotify:track:', ''),
      title: state.trackName,
      artistName: state.artistName,
      albumTitle: state.albumName,
      duration: Math.round(state.durationMs / 1000),
      genreNames: [], // Genres not available from player state
      artworkUrl: state.albumArtUrl,
      trackNumber: 0,
      discNumber: 0,
      playbackTime: Math.round(state.positionMs / 1000),
      status: state.isPaused ? 'paused' : 'playing',
    };
  }

  async getNextInQueue(): Promise<NextTrack> {
    // Primary: local queue plan
    if (this.queuePlan.length > this.queueIndex + 1) {
      const next = this.queuePlan[this.queueIndex + 1];
      return { id: next.id, title: next.title, artistName: next.artistName };
    }
    return null;
  }

  async getPlaybackTime(): Promise<number> {
    const state = await getPlayerState();
    return state ? Math.round(state.positionMs / 1000) : 0;
  }

  async getPlaybackStatus(): Promise<PlaybackStatus> {
    const state = await getPlayerState();
    if (!state) return 'unknown';
    return state.isPaused ? 'paused' : 'playing';
  }

  async getUpcomingQueue(count: number): Promise<UpcomingTrack[]> {
    const upcoming: UpcomingTrack[] = [];
    for (let i = this.queueIndex + 1; i < Math.min(this.queueIndex + 1 + count, this.queuePlan.length); i++) {
      const track = this.queuePlan[i];
      upcoming.push({
        id: track.id,
        title: track.title,
        artistName: track.artistName,
        artworkUrl: track.artworkUrl,
      });
    }
    return upcoming;
  }

  // ── TTS ────────────────────────────────────────────────────────────

  async activateDuckingSession(): Promise<void> {
    return nativeActivateDucking();
  }

  async deactivateDuckingSession(): Promise<void> {
    return nativeDeactivateDucking();
  }

  async playAudioFromBase64(base64: string): Promise<void> {
    return nativePlayAudio(base64);
  }

  async stopAudio(): Promise<void> {
    return nativeStopAudio();
  }

  setTTSVolume(volume: number): void {
    nativeSetTTSVolume(volume);
  }

  // ── Eject ──────────────────────────────────────────────────────────

  async playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void> {
    return nativePlayEject(ttsBase64, fadeInDelayMs);
  }

  async cancelEjectTransition(): Promise<void> {
    return nativeCancelEject();
  }

  // ── Events ─────────────────────────────────────────────────────────

  onTrackChanged(cb: TrackChangedCallback): () => void {
    this.trackListeners.push(cb);
    this.ensureEventSubscriptions();
    return () => {
      this.trackListeners = this.trackListeners.filter(l => l !== cb);
    };
  }

  onPlaybackStateChanged(cb: PlaybackStateCallback): () => void {
    this.stateListeners.push(cb);
    this.ensureEventSubscriptions();
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== cb);
    };
  }

  onEjectTrackChanged(cb: EjectTrackChangedCallback): () => void {
    this.ejectListeners.push(cb);
    this.ensureEventSubscriptions();
    return () => {
      this.ejectListeners = this.ejectListeners.filter(l => l !== cb);
    };
  }

  onConnectionStatusChanged(cb: (status: ConnectionStatus) => void): () => void {
    this.connectionListeners.push(cb);
    this.ensureEventSubscriptions();
    return () => {
      this.connectionListeners = this.connectionListeners.filter(l => l !== cb);
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  destroy(): void {
    this.trackSub?.remove();
    this.stateSub?.remove();
    this.ejectSub?.remove();
    this.connectionSub?.remove();
    this.trackSub = null;
    this.stateSub = null;
    this.ejectSub = null;
    this.connectionSub = null;
    this.trackListeners = [];
    this.stateListeners = [];
    this.ejectListeners = [];
    this.connectionListeners = [];
  }

  // ── Private ────────────────────────────────────────────────────────

  private async ensureToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return;
    if (!this.refreshToken) throw new Error('No refresh token available');

    const response = await authenticatedFetch('/spotify/token-refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    const data = await response.json();
    this.accessToken = data.accessToken;
    this.tokenExpiresAt = Date.now() + (data.expiresIn * 1000);
    this.persistTokens();
  }

  private setupEventSubscriptions(): void {
    this.ensureEventSubscriptions();
  }

  private ensureEventSubscriptions(): void {
    if (!this.trackSub && this.trackListeners.length > 0) {
      this.trackSub = addTrackChangedListener((event) => {
        const trackId = event.trackUri.replace('spotify:track:', '');
        const previousTrackId = event.previousTrackUri?.replace('spotify:track:', '');
        this.queueIndex++;
        this.trackListeners.forEach(cb => {
          try { cb({ trackId, previousTrackId }); } catch (e) { console.error('[SpotifyProvider] trackListener error:', e); }
        });
      });
    }
    if (!this.stateSub && this.stateListeners.length > 0) {
      this.stateSub = addPlayerStateListener((event) => {
        const status: PlaybackStatus = event.isPaused ? 'paused' : 'playing';
        this.stateListeners.forEach(cb => {
          try { cb({ status, playbackTime: Math.round(event.positionMs / 1000) }); } catch (e) { console.error('[SpotifyProvider] stateListener error:', e); }
        });
      });
    }
    if (!this.ejectSub && this.ejectListeners.length > 0) {
      this.ejectSub = addEjectTrackChangedListener((event) => {
        const trackId = event.trackUri.replace('spotify:track:', '');
        const previousTrackId = event.previousTrackUri?.replace('spotify:track:', '');
        this.ejectListeners.forEach(cb => {
          try { cb({ trackId, previousTrackId }); } catch (e) { console.error('[SpotifyProvider] ejectListener error:', e); }
        });
      });
    }
    if (!this.connectionSub && this.connectionListeners.length > 0) {
      this.connectionSub = addConnectionStatusListener((event) => {
        this._connectionStatus = event.status as ConnectionStatus;
        this.connectionListeners.forEach(cb => {
          try { cb(this._connectionStatus); } catch (e) { console.error('[SpotifyProvider] connectionListener error:', e); }
        });
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/providers/SpotifyProvider.ts
git commit -m "feat: add SpotifyProvider wrapping expo-spotify native module"
```

---

## Task 14: Android Onboarding Flow

**Files:**
- Modify: `app/(onboarding)/music-auth.tsx`

- [ ] **Step 1: Add platform-conditional Android auth flow**

In `music-auth.tsx`, add the Spotify-specific onboarding path inside the platform conditional. The iOS path remains unchanged.

For Android:
1. Call `getMusicProvider().authorize()` — this triggers Spotify OAuth
2. If `status === 'denied'` and Spotify not installed: show "ONAY requires Spotify" + Play Store link
3. If `status === 'denied'` and not Premium: show "ONAY requires Spotify Premium"
4. If `status === 'authorized'`: persist state and navigate to next screen

Note: The exact UI implementation should match the Gold Edition design language (gold-edge cards, DM Mono labels, Playfair Display headings).

- [ ] **Step 2: Commit**

```bash
git add app/(onboarding)/music-auth.tsx
git commit -m "feat: add Android Spotify onboarding flow"
```

---

## Task 15: Android Project Setup

**Files:**
- Generated by Expo prebuild

- [ ] **Step 1: Generate Android project**

Run: `npx expo prebuild --platform android`

This generates the `android/` directory with Gradle build files, manifest, etc.

- [ ] **Step 2: Verify the expo-spotify module is linked**

Check that `modules/expo-spotify` appears in the autolinking configuration.

Run: `npx expo config --type prebuild | grep spotify`

- [ ] **Step 3: Add Spotify redirect URI intent filter**

In `android/app/src/main/AndroidManifest.xml`, add inside the main `<activity>`:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="com.worthymedia.cleo" android:host="spotify-auth-callback" />
</intent-filter>
```

- [ ] **Step 4: Verify Android builds**

Run: `cd android && ./gradlew assembleDebug && cd ..`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add android/ modules/expo-spotify/
git commit -m "feat: Android project setup with expo-spotify module linked"
```

---

## Task 16: Full Kotlin Implementation of ExpoSpotifyModule

**Files:**
- Modify: `modules/expo-spotify/android/src/main/java/expo/modules/spotify/ExpoSpotifyModule.kt`

This is the largest single task. Implement all 9 responsibilities from the spec:

- [ ] **Step 1: Auth & Connection** — `SpotifyAppRemote.connect()`, OAuth via `AuthorizationClient`, scopes
- [ ] **Step 2: Playback Control** — `play()`, `pause()`, `resume()`, `skipNext()`, `seekTo()`, `queue()`
- [ ] **Step 3: Ducking** — `AudioFocusRequest` with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`
- [ ] **Step 4: TTS Playback** — `MediaPlayer` for base64 audio, crossfade timer
- [ ] **Step 5: Track Change Detection** — `PlayerApi.subscribeToPlayerState()`, URI comparison, emit events
- [ ] **Step 6: Eject Transition** — Two-layer: duck → TTS → skipNext at delay → emit onEjectTrackChanged
- [ ] **Step 7: Connection Lifecycle** — Auto-reconnect, status changes, 30-min timeout handling
- [ ] **Step 8: Spotify App Check** — `packageManager.getLaunchIntentForPackage`
- [ ] **Step 9: Test on Android device/emulator**

Each sub-step should be committed individually:

```bash
git commit -m "feat(expo-spotify): implement auth and connection"
git commit -m "feat(expo-spotify): implement playback control"
# etc.
```

---

## Task 17: Integration Testing on Both Platforms

- [ ] **Step 1: Test iOS — verify nothing broke**

Run the app on an iOS device/simulator. Verify:
- Apple Music auth works
- Playback starts, track changes fire
- Cleo speaks (ducking works)
- Eject transitions fire
- All screens render correctly

- [ ] **Step 2: Test Android — full flow**

Run the app on an Android device. Verify:
- Spotify install check works
- OAuth flow completes
- Premium check gates non-Premium users
- Playback starts via App Remote
- Track changes fire
- Ducking via AudioFocus works
- TTS plays over ducked music
- Eject transitions (two-layer) fire
- Connection disconnect/reconnect works

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat: Android Spotify integration complete"
```

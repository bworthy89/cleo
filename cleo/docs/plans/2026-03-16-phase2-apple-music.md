# Phase 2 — Apple Music Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to authorize Apple Music, browse their playlists, select one to create a station, and play music through the app with song-end detection.

**Architecture:** Custom Expo native module (`expo-music-kit`) wrapping Apple's MusicKit Swift framework. The module exposes authorization, playlist fetching, playback control, and song-change events to the JS layer. A `MusicKitPlayer` TypeScript service wraps the module with app-specific logic. HomeScreen displays playlists as portrait station cards. MMKV stores recently played tracks and station data.

**Tech Stack:** Expo Module API (Swift), MusicKit framework, ApplicationMusicPlayer, react-native-mmkv, TypeScript

**Important:** MusicKit does NOT work in iOS Simulator. All playback testing requires a physical device with an Apple Music subscription. Authorization UI works in Simulator but returns `.denied` or `.restricted`.

---

### Task 1: Scaffold the custom Expo native module

**Files:**
- Create: `modules/expo-music-kit/expo-module.config.json`
- Create: `modules/expo-music-kit/index.ts`
- Create: `modules/expo-music-kit/src/ExpoMusicKitModule.ts`
- Create: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`

**Step 1: Create the module directory structure**

```bash
mkdir -p modules/expo-music-kit/src modules/expo-music-kit/ios
```

**Step 2: Create expo-module.config.json**

```json
{
  "platforms": ["ios"],
  "ios": {
    "modules": ["ExpoMusicKitModule"]
  }
}
```

**Step 3: Create the native bridge file**

`modules/expo-music-kit/src/ExpoMusicKitModule.ts`:
```typescript
import { requireNativeModule } from 'expo-modules-core';

export default requireNativeModule('ExpoMusicKit');
```

**Step 4: Create the Swift module with authorization**

`modules/expo-music-kit/ios/ExpoMusicKitModule.swift`:
```swift
import ExpoModulesCore
import MusicKit
import MediaPlayer

public class ExpoMusicKitModule: Module {
  private let player = ApplicationMusicPlayer.shared
  private var queueObservation: Any?
  private var currentTrackId: String = ""
  private var pollTimer: Timer?

  public func definition() -> ModuleDefinition {
    Name("ExpoMusicKit")

    Events("onTrackChanged", "onPlaybackStateChanged")

    // MARK: - Authorization

    AsyncFunction("authorize") { () -> [String: Any] in
      let status = await MusicAuthorization.request()
      return [
        "status": self.statusString(status),
        "canPlayCatalog": await self.checkSubscription()
      ]
    }

    AsyncFunction("getAuthorizationStatus") { () -> String in
      let status = MusicAuthorization.currentStatus
      return self.statusString(status)
    }

    // MARK: - Playlists

    AsyncFunction("fetchPlaylists") { () -> [[String: Any?]] in
      var request = MusicLibraryRequest<Playlist>()
      request.sort(by: \.lastPlayedDate, ascending: false)
      let response = try await request.response()

      return response.items.map { playlist in
        var dict: [String: Any?] = [
          "id": playlist.id.rawValue,
          "name": playlist.name,
          "trackCount": playlist.tracks?.count
        ]
        if let artwork = playlist.artwork {
          dict["artworkUrl"] = artwork.url(width: 600, height: 600)?.absoluteString
        }
        return dict
      }
    }

    // MARK: - Playlist Tracks

    AsyncFunction("fetchPlaylistTracks") { (playlistId: String) -> [[String: Any?]] in
      var request = MusicLibraryRequest<Playlist>()
      request.filter(matching: \.id, equalTo: MusicItemID(playlistId))
      let response = try await request.response()

      guard let playlist = response.items.first else {
        throw NSError(domain: "ExpoMusicKit", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "Playlist not found"
        ])
      }

      let detailed = try await playlist.with(.tracks, preferredSource: .library)
      guard let tracks = detailed.tracks else { return [] }

      return tracks.map { track in
        self.trackToDict(track)
      }
    }

    // MARK: - Playback

    AsyncFunction("play") { (trackIds: [String]?) in
      if let ids = trackIds, !ids.isEmpty {
        var request = MusicLibraryRequest<Song>()
        request.filter(matching: \.id, memberOf: ids.map { MusicItemID($0) })
        let response = try await request.response()
        self.player.queue = .init(for: response.items)
      }
      try await self.player.play()
    }

    Function("pause") {
      self.player.pause()
    }

    AsyncFunction("skip") {
      try await self.player.skipToNextEntry()
    }

    AsyncFunction("skipToPrevious") {
      try await self.player.skipToPreviousEntry()
    }

    Function("seekTo") { (time: Double) in
      self.player.playbackTime = time
    }

    // MARK: - Now Playing

    Function("getNowPlaying") { () -> [String: Any]? in
      guard let entry = self.player.queue.currentEntry else { return nil }

      var dict: [String: Any] = [
        "title": entry.title,
        "subtitle": entry.subtitle ?? "",
        "playbackTime": self.player.playbackTime,
        "status": self.playbackStatusString()
      ]

      if case .song(let song) = entry.item {
        dict["id"] = song.id.rawValue
        dict["artistName"] = song.artistName
        dict["albumTitle"] = song.albumTitle ?? ""
        dict["duration"] = song.duration ?? 0
        dict["genreNames"] = song.genreNames
        if let artwork = song.artwork {
          dict["artworkUrl"] = artwork.url(width: 800, height: 800)?.absoluteString
        }
      }

      return dict
    }

    // MARK: - Playback Time Polling

    Function("getPlaybackTime") { () -> Double in
      return self.player.playbackTime
    }

    Function("getPlaybackStatus") { () -> String in
      return self.playbackStatusString()
    }

    // MARK: - Observation

    OnStartObserving {
      self.startObserving()
    }

    OnStopObserving {
      self.stopObserving()
    }

    OnDestroy {
      self.stopObserving()
    }
  }

  // MARK: - Private Helpers

  private func statusString(_ status: MusicAuthorization.Status) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  private func checkSubscription() async -> Bool {
    do {
      let sub = try await MusicSubscription.current
      return sub.canPlayCatalogContent
    } catch {
      return false
    }
  }

  private func playbackStatusString() -> String {
    switch player.state.playbackStatus {
    case .playing: return "playing"
    case .paused: return "paused"
    case .stopped: return "stopped"
    case .interrupted: return "interrupted"
    case .seekingForward: return "seekingForward"
    case .seekingBackward: return "seekingBackward"
    @unknown default: return "unknown"
    }
  }

  private func trackToDict(_ track: Track) -> [String: Any?] {
    var dict: [String: Any?] = [
      "id": track.id.rawValue,
      "title": track.title,
      "artistName": track.artistName,
      "albumTitle": track.albumTitle,
      "duration": track.duration,
      "genreNames": track.genreNames,
      "trackNumber": track.trackNumber,
      "discNumber": track.discNumber
    ]
    if let artwork = track.artwork {
      dict["artworkUrl"] = artwork.url(width: 600, height: 600)?.absoluteString
    }
    return dict
  }

  private func startObserving() {
    // Observe queue changes for track transitions
    queueObservation = player.queue.objectWillChange
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in
        Task { @MainActor in
          self?.detectTrackChange()
        }
      }

    // Poll playback state
    pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      let status = self.playbackStatusString()
      self.sendEvent("onPlaybackStateChanged", [
        "status": status,
        "playbackTime": self.player.playbackTime
      ])
    }
  }

  private func stopObserving() {
    queueObservation = nil
    pollTimer?.invalidate()
    pollTimer = nil
  }

  private func detectTrackChange() {
    guard let entry = player.queue.currentEntry else { return }

    var newId = ""
    if case .song(let song) = entry.item {
      newId = song.id.rawValue
    }

    guard !newId.isEmpty, newId != currentTrackId else { return }
    let previousId = currentTrackId
    currentTrackId = newId

    var trackData = getNowPlayingDict()
    trackData["previousTrackId"] = previousId

    sendEvent("onTrackChanged", trackData)
  }

  private func getNowPlayingDict() -> [String: Any] {
    guard let entry = player.queue.currentEntry else {
      return ["status": "empty"]
    }

    var dict: [String: Any] = [
      "title": entry.title,
      "subtitle": entry.subtitle ?? "",
      "status": playbackStatusString()
    ]

    if case .song(let song) = entry.item {
      dict["id"] = song.id.rawValue
      dict["artistName"] = song.artistName
      dict["albumTitle"] = song.albumTitle ?? ""
      dict["duration"] = song.duration ?? 0
      dict["genreNames"] = song.genreNames
      if let artwork = song.artwork {
        dict["artworkUrl"] = artwork.url(width: 800, height: 800)?.absoluteString
      }
    }

    return dict
  }
}
```

**Step 5: Create the TypeScript public API**

`modules/expo-music-kit/index.ts`:
```typescript
import { EventEmitter, Subscription } from 'expo-modules-core';
import ExpoMusicKitModule from './src/ExpoMusicKitModule';

const emitter = new EventEmitter(ExpoMusicKitModule);

// Types
export interface MusicTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  duration?: number;
  genreNames?: string[];
  artworkUrl?: string;
  trackNumber?: number;
  discNumber?: number;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  trackCount?: number;
  artworkUrl?: string;
}

export interface AuthResult {
  status: 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'unknown';
  canPlayCatalog: boolean;
}

export interface NowPlaying extends MusicTrack {
  playbackTime: number;
  status: PlaybackStatus;
  subtitle?: string;
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'interrupted' | 'seekingForward' | 'seekingBackward' | 'unknown';

export interface TrackChangedEvent extends NowPlaying {
  previousTrackId: string;
}

export interface PlaybackStateEvent {
  status: PlaybackStatus;
  playbackTime: number;
}

// Authorization
export async function authorize(): Promise<AuthResult> {
  return await ExpoMusicKitModule.authorize();
}

export async function getAuthorizationStatus(): Promise<string> {
  return await ExpoMusicKitModule.getAuthorizationStatus();
}

// Playlists
export async function fetchPlaylists(): Promise<MusicPlaylist[]> {
  return await ExpoMusicKitModule.fetchPlaylists();
}

export async function fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
  return await ExpoMusicKitModule.fetchPlaylistTracks(playlistId);
}

// Playback
export async function play(trackIds?: string[]): Promise<void> {
  return await ExpoMusicKitModule.play(trackIds ?? null);
}

export function pause(): void {
  ExpoMusicKitModule.pause();
}

export async function skip(): Promise<void> {
  return await ExpoMusicKitModule.skip();
}

export async function skipToPrevious(): Promise<void> {
  return await ExpoMusicKitModule.skipToPrevious();
}

export function seekTo(time: number): void {
  ExpoMusicKitModule.seekTo(time);
}

// Now Playing
export function getNowPlaying(): NowPlaying | null {
  return ExpoMusicKitModule.getNowPlaying();
}

export function getPlaybackTime(): number {
  return ExpoMusicKitModule.getPlaybackTime();
}

export function getPlaybackStatus(): PlaybackStatus {
  return ExpoMusicKitModule.getPlaybackStatus();
}

// Events
export function addTrackChangedListener(callback: (event: TrackChangedEvent) => void): Subscription {
  return emitter.addListener('onTrackChanged', callback);
}

export function addPlaybackStateListener(callback: (event: PlaybackStateEvent) => void): Subscription {
  return emitter.addListener('onPlaybackStateChanged', callback);
}
```

**Step 6: Commit**

```bash
git add modules/
git commit -m "feat: scaffold expo-music-kit native module with MusicKit Swift integration"
```

---

### Task 2: Configure the Expo project for native builds

**Files:**
- Modify: `app.json`
- Modify: `tsconfig.json`
- Modify: `package.json`

**Step 1: Update app.json with MusicKit plugin and entitlement**

Add the local module path and MusicKit entitlement configuration:

```json
{
  "expo": {
    "name": "Cleo",
    "slug": "cleo",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#FAF6EF"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.worthymedia.cleo",
      "infoPlist": {
        "NSAppleMusicUsageDescription": "Cleo uses Apple Music to play your playlists with AI-powered radio hosting."
      },
      "entitlements": {
        "com.apple.developer.musickit": true
      }
    },
    "plugins": [
      "expo-font",
      "react-native-video",
      ["expo-av", { "microphonePermission": false }]
    ]
  }
}
```

**Step 2: Add path alias for modules**

Check `tsconfig.json` — Expo SDK 55 should auto-configure path aliases for `modules/`. If not, add:

```json
{
  "compilerOptions": {
    "paths": {
      "@/modules/*": ["./modules/*"]
    }
  }
}
```

**Step 3: Run prebuild to generate native projects**

```bash
npx expo prebuild --clean
```

This generates the `ios/` directory with CocoaPods, links the native module, and applies entitlements.

**Step 4: Verify the module links**

```bash
cd ios && pod install && cd ..
```

Check that `ExpoMusicKit` appears in the pod install output.

**Step 5: Build and launch on device**

```bash
npx expo run:ios --device
```

Or open `ios/cleo.xcworkspace` in Xcode for device-targeted builds.

**Step 6: Commit**

```bash
git add app.json tsconfig.json ios/ package.json
git commit -m "feat: configure native build with MusicKit entitlement and module linking"
```

---

### Task 3: Build MusicKitPlayer service wrapper

**Files:**
- Create: `src/services/MusicKitPlayer.ts`

**Step 1: Create the service file**

`src/services/MusicKitPlayer.ts`:
```typescript
import {
  authorize,
  getAuthorizationStatus,
  fetchPlaylists,
  fetchPlaylistTracks,
  play,
  pause,
  skip,
  seekTo,
  getNowPlaying,
  getPlaybackTime,
  addTrackChangedListener,
  addPlaybackStateListener,
  type AuthResult,
  type MusicPlaylist,
  type MusicTrack,
  type NowPlaying,
  type TrackChangedEvent,
  type PlaybackStateEvent,
  type PlaybackStatus,
} from '../../modules/expo-music-kit';
import { Subscription } from 'expo-modules-core';

type TrackChangeCallback = (event: TrackChangedEvent) => void;
type PlaybackStateCallback = (event: PlaybackStateEvent) => void;

class MusicKitPlayerService {
  private trackSub: Subscription | null = null;
  private stateSub: Subscription | null = null;
  private trackListeners: TrackChangeCallback[] = [];
  private stateListeners: PlaybackStateCallback[] = [];

  // Authorization

  async authorize(): Promise<AuthResult> {
    return authorize();
  }

  async isAuthorized(): Promise<boolean> {
    const status = await getAuthorizationStatus();
    return status === 'authorized';
  }

  // Playlists

  async fetchPlaylists(): Promise<MusicPlaylist[]> {
    return fetchPlaylists();
  }

  async fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
    return fetchPlaylistTracks(playlistId);
  }

  // Playback

  async play(trackIds?: string[]): Promise<void> {
    return play(trackIds);
  }

  pause(): void {
    pause();
  }

  async skip(): Promise<void> {
    return skip();
  }

  seekTo(time: number): void {
    seekTo(time);
  }

  // Now Playing

  getNowPlaying(): NowPlaying | null {
    return getNowPlaying();
  }

  getPlaybackTime(): number {
    return getPlaybackTime();
  }

  // Event Listeners

  onTrackChanged(callback: TrackChangeCallback): () => void {
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

  private ensureSubscriptions() {
    if (!this.trackSub && this.trackListeners.length > 0) {
      this.trackSub = addTrackChangedListener((event) => {
        this.trackListeners.forEach(cb => cb(event));
      });
    }
    if (!this.stateSub && this.stateListeners.length > 0) {
      this.stateSub = addPlaybackStateListener((event) => {
        this.stateListeners.forEach(cb => cb(event));
      });
    }
  }

  private cleanupIfEmpty() {
    if (this.trackListeners.length === 0 && this.trackSub) {
      this.trackSub.remove();
      this.trackSub = null;
    }
    if (this.stateListeners.length === 0 && this.stateSub) {
      this.stateSub.remove();
      this.stateSub = null;
    }
  }

  destroy() {
    this.trackSub?.remove();
    this.stateSub?.remove();
    this.trackSub = null;
    this.stateSub = null;
    this.trackListeners = [];
    this.stateListeners = [];
  }
}

export const musicKitPlayer = new MusicKitPlayerService();
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/services/MusicKitPlayer.ts
git commit -m "feat: add MusicKitPlayer service wrapper"
```

---

### Task 4: Set up MMKV storage

**Files:**
- Create: `src/services/Storage.ts`

**Step 1: Create storage service**

`src/services/Storage.ts`:
```typescript
import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({ id: 'cleo-storage' });

// Type-safe helpers for common operations
export const StorageKeys = {
  USER: 'user',
  STATIONS: 'stations',
  RECENTLY_PLAYED: 'recentlyPlayed',
  SESSIONS: 'sessions',
  COLD_OPEN_HISTORY: 'coldOpenHistory',
  CLEO_VIDEO_CACHE: 'cleoVideoCache',
  ENRICHMENT_CACHE: 'enrichmentCache',
} as const;

export interface UserData {
  name?: string;
  appleMusicAuthorized: boolean;
  createdAt: string;
}

export interface Station {
  id: string;
  name: string;
  playlistId: string;
  defaultVibe: string;
  artworkUrl?: string;
  createdAt: string;
}

export interface RecentlyPlayed {
  trackIds: string[];
  lastUpdated: string;
}

function getObject<T>(key: string): T | undefined {
  const raw = storage.getString(key);
  if (!raw) return undefined;
  return JSON.parse(raw) as T;
}

function setObject<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

// User
export function getUser(): UserData | undefined {
  return getObject<UserData>(StorageKeys.USER);
}

export function setUser(user: UserData): void {
  setObject(StorageKeys.USER, user);
}

// Stations
export function getStations(): Station[] {
  return getObject<Station[]>(StorageKeys.STATIONS) ?? [];
}

export function setStations(stations: Station[]): void {
  setObject(StorageKeys.STATIONS, stations);
}

export function addStation(station: Station): void {
  const existing = getStations();
  setStations([...existing, station]);
}

// Recently Played
export function getRecentlyPlayed(): RecentlyPlayed {
  return getObject<RecentlyPlayed>(StorageKeys.RECENTLY_PLAYED) ?? {
    trackIds: [],
    lastUpdated: new Date().toISOString(),
  };
}

export function addRecentlyPlayedTrack(trackId: string): void {
  const rp = getRecentlyPlayed();
  // Keep last 50 tracks as per PRD scoring algorithm
  const updated = [trackId, ...rp.trackIds.filter(id => id !== trackId)].slice(0, 50);
  setObject<RecentlyPlayed>(StorageKeys.RECENTLY_PLAYED, {
    trackIds: updated,
    lastUpdated: new Date().toISOString(),
  });
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/services/Storage.ts
git commit -m "feat: add MMKV storage service with typed helpers"
```

---

### Task 5: Build StationCard component

**Files:**
- Create: `src/components/StationCard.tsx`

**Step 1: Create the component**

`src/components/StationCard.tsx`:
```typescript
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../tokens/design-tokens';

interface StationCardProps {
  name: string;
  artworkUrl?: string;
  onPress: () => void;
}

export function StationCard({ name, artworkUrl, onPress }: StationCardProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.placeholder]} />
      )}
      <View style={styles.labelContainer}>
        <Text style={styles.label} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

const CARD_WIDTH = 160;
const CARD_HEIGHT = CARD_WIDTH * 1.5; // 2:3 portrait ratio per PRD

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginRight: Spacing.md,
    overflow: 'hidden',
  },
  artwork: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  placeholder: {
    backgroundColor: Colors.base.black,
  },
  labelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: Colors.base.white,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
```

**Step 2: Commit**

```bash
git add src/components/StationCard.tsx
git commit -m "feat: add StationCard component with 2:3 portrait layout"
```

---

### Task 6: Build HomeScreen with playlist picker

**Files:**
- Create: `src/screens/home/HomeScreen.tsx`

**Step 1: Create the HomeScreen**

`src/screens/home/HomeScreen.tsx`:
```typescript
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Alert,
} from 'react-native';
import { Colors, Typography, Spacing } from '../../tokens/design-tokens';
import { StationCard } from '../../components/StationCard';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import {
  getStations,
  addStation,
  addRecentlyPlayedTrack,
  type Station,
} from '../../services/Storage';
import type { MusicPlaylist, MusicTrack } from '../../../modules/expo-music-kit';

type HomeState = 'loading' | 'unauthorized' | 'ready' | 'playing';

interface HomeScreenProps {
  onNavigateToPlayer?: () => void;
}

export function HomeScreen({ onNavigateToPlayer }: HomeScreenProps) {
  const [state, setState] = useState<HomeState>('loading');
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [nowPlayingTitle, setNowPlayingTitle] = useState<string>('');

  useEffect(() => {
    checkAuth();
    setStations(getStations());
  }, []);

  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged((event) => {
      setNowPlayingTitle(event.title);
      addRecentlyPlayedTrack(event.id);
    });
    return unsub;
  }, []);

  const checkAuth = async () => {
    const authorized = await musicKitPlayer.isAuthorized();
    if (authorized) {
      await loadPlaylists();
    } else {
      setState('unauthorized');
    }
  };

  const handleAuthorize = async () => {
    const result = await musicKitPlayer.authorize();
    if (result.status === 'authorized') {
      await loadPlaylists();
    } else {
      Alert.alert(
        'Apple Music Required',
        'Cleo needs access to your Apple Music library to play your playlists.'
      );
    }
  };

  const loadPlaylists = async () => {
    try {
      const lists = await musicKitPlayer.fetchPlaylists();
      setPlaylists(lists);
      setState('ready');
    } catch (error) {
      console.error('Failed to fetch playlists:', error);
      setState('ready');
    }
  };

  const handlePlaylistSelect = async (playlist: MusicPlaylist) => {
    try {
      const tracks = await musicKitPlayer.fetchPlaylistTracks(playlist.id);
      if (tracks.length === 0) {
        Alert.alert('Empty Playlist', 'This playlist has no tracks.');
        return;
      }

      // Create station if not already saved
      const existingStations = getStations();
      const alreadySaved = existingStations.some(s => s.playlistId === playlist.id);
      if (!alreadySaved) {
        addStation({
          id: Date.now().toString(),
          name: playlist.name,
          playlistId: playlist.id,
          defaultVibe: 'chill',
          artworkUrl: playlist.artworkUrl,
          createdAt: new Date().toISOString(),
        });
        setStations(getStations());
      }

      // Play all tracks
      const trackIds = tracks.map(t => t.id);
      await musicKitPlayer.play(trackIds);
      setState('playing');

      if (tracks[0]) {
        setNowPlayingTitle(tracks[0].title);
        addRecentlyPlayedTrack(tracks[0].id);
      }
    } catch (error) {
      console.error('Failed to play playlist:', error);
    }
  };

  const renderPlaylist = useCallback(({ item }: { item: MusicPlaylist }) => (
    <StationCard
      name={item.name}
      artworkUrl={item.artworkUrl}
      onPress={() => handlePlaylistSelect(item)}
    />
  ), []);

  if (state === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  if (state === 'unauthorized') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.authContainer}>
          <Text style={styles.title}>CLEO</Text>
          <Text style={styles.subtitle}>Connect Apple Music to get started</Text>
          <Pressable style={styles.authButton} onPress={handleAuthorize}>
            <Text style={styles.authButtonText}>Connect Apple Music</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CLEO</Text>
        <Text style={styles.mono}>ON AIR</Text>
      </View>

      {nowPlayingTitle ? (
        <View style={styles.nowPlaying}>
          <Text style={styles.nowPlayingLabel}>NOW PLAYING</Text>
          <Text style={styles.nowPlayingTitle}>{nowPlayingTitle}</Text>
        </View>
      ) : null}

      {stations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>YOUR STATIONS</Text>
          <FlatList
            horizontal
            data={stations.map(s => ({
              id: s.playlistId,
              name: s.name,
              artworkUrl: s.artworkUrl,
            }))}
            renderItem={({ item }) => (
              <StationCard
                name={item.name}
                artworkUrl={item.artworkUrl}
                onPress={() => handlePlaylistSelect(item as MusicPlaylist)}
              />
            )}
            keyExtractor={item => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PLAYLISTS</Text>
        <FlatList
          horizontal
          data={playlists}
          renderItem={renderPlaylist}
          keyExtractor={item => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      </View>
    </SafeAreaView>
  );
}

import { Pressable } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 32,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
  },
  subtitle: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.vibe.morning.text,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  mono: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.accent,
    letterSpacing: 2,
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  authButton: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.base.black,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  authButtonText: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 14,
    color: Colors.base.white,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  nowPlaying: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    marginBottom: Spacing.lg,
  },
  nowPlayingLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.accent,
    letterSpacing: 2,
    marginBottom: Spacing.xs,
  },
  nowPlayingTitle: {
    fontFamily: Typography.display.family,
    fontSize: 24,
    color: Colors.vibe.morning.text,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 11,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  loadingText: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.vibe.morning.text,
    textAlign: 'center',
    marginTop: 100,
  },
});
```

**Step 2: Commit**

```bash
git add src/screens/home/HomeScreen.tsx
git commit -m "feat: add HomeScreen with playlist picker and station cards"
```

---

### Task 7: Wire HomeScreen into App.tsx

**Files:**
- Modify: `App.tsx`

**Step 1: Update App.tsx to render HomeScreen**

Replace the placeholder content in `App.tsx` with `HomeScreen`:

```typescript
import { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { HomeScreen } from './src/screens/home/HomeScreen';

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular: require('@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf'),
    WorkSans_400Regular: require('@expo-google-fonts/work-sans/400Regular/WorkSans_400Regular.ttf'),
    WorkSans_500Medium: require('@expo-google-fonts/work-sans/500Medium/WorkSans_500Medium.ttf'),
    EBGaramond_400Regular: require('@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf'),
    EBGaramond_400Regular_Italic: require('@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf'),
    DMMono_400Regular: require('@expo-google-fonts/dm-mono/400Regular/DMMono_400Regular.ttf'),
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <>
      <HomeScreen />
      <StatusBar style="dark" />
    </>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add App.tsx
git commit -m "feat: wire HomeScreen as root view"
```

---

### Task 8: Build and test on physical device

**Step 1: Prebuild native projects**

```bash
npx expo prebuild --clean
```

**Step 2: Verify MusicKit entitlement in Xcode**

Open `ios/cleo.xcworkspace` in Xcode. Under Signing & Capabilities:
- Set your Apple Developer Team
- Verify bundle ID is `com.worthymedia.cleo`
- Verify MusicKit capability is present
- If not, add via + Capability > MusicKit

**Step 3: Build to device**

```bash
npx expo run:ios --device
```

**Step 4: Test authorization flow**

- App launches → shows "Connect Apple Music" screen
- Tap button → iOS permission prompt appears
- Grant access → playlists load as station cards

**Step 5: Test playback**

- Tap a playlist card → music begins playing
- Now Playing section shows current track title
- When track ends → `onTrackChanged` fires, title updates, track saved to recently played

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: Phase 2 complete — Apple Music auth, playlists, playback with song detection"
```

---

## Milestone Verification

Phase 2 is complete when all of the following work on a physical device:

- [ ] Apple Music authorization prompt appears and grants access
- [ ] User's library playlists appear as portrait station cards
- [ ] Tapping a playlist starts music playback
- [ ] Now Playing shows the current track title
- [ ] Track changes are detected automatically (song-end detection)
- [ ] Recently played tracks are persisted to MMKV
- [ ] No crashes on authorization denial (graceful fallback)

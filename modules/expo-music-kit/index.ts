import { type EventSubscription } from 'expo-modules-core';
import ExpoMusicKit from './src/ExpoMusicKitModule';

// ── Types ──────────────────────────────────────────────────────────────

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
  /** Apple Music ISRC (International Standard Recording Code) when the native
   *  bridge can surface it. Used as the lookup key for ReccoBeats / Deezer
   *  audio-feature fetches during server-side sequencing. */
  isrc?: string;
};

export type MusicPlaylist = {
  id: string;
  name: string;
  trackCount?: number;
  artworkUrl?: string;
};

export type AuthResult = {
  status: 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unknown';
  canPlayCatalog: boolean;
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

export type TrackChangedEvent = {
  trackId?: string;
  previousTrackId?: string;
};

export type PlaybackStateEvent = {
  status: PlaybackStatus;
  playbackTime: number;
};

// ── Native Module (also an EventEmitter in SDK 52+) ────────────────────

const emitter = ExpoMusicKit as unknown as {
  addListener(eventName: string, listener: (...args: any[]) => void): EventSubscription;
};

// ── Authorization ──────────────────────────────────────────────────────

export async function authorize(): Promise<AuthResult> {
  return await ExpoMusicKit.authorize();
}

export async function getAuthorizationStatus(): Promise<AuthResult['status']> {
  return await ExpoMusicKit.getAuthorizationStatus();
}

// ── Playlists ──────────────────────────────────────────────────────────

export async function fetchPlaylists(): Promise<MusicPlaylist[]> {
  return await ExpoMusicKit.fetchPlaylists();
}

export async function fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
  return await ExpoMusicKit.fetchPlaylistTracks(playlistId);
}

// ── Playback ───────────────────────────────────────────────────────────

export async function clearQueueCache(): Promise<void> {
  return await ExpoMusicKit.clearQueueCache();
}

export async function play(trackIds?: string[], playlistId?: string): Promise<void> {
  return await ExpoMusicKit.play(trackIds ?? null, playlistId ?? null);
}

export async function setUpcomingQueue(trackIds: string[]): Promise<void> {
  return await ExpoMusicKit.setUpcomingQueue(trackIds);
}

export async function pause(): Promise<void> {
  return await ExpoMusicKit.pause();
}

export async function skip(): Promise<void> {
  return await ExpoMusicKit.skip();
}

export async function skipToPrevious(): Promise<void> {
  return await ExpoMusicKit.skipToPrevious();
}

export async function seekTo(time: number): Promise<void> {
  return await ExpoMusicKit.seekTo(time);
}

// ── Now Playing ────────────────────────────────────────────────────────

export async function getNowPlaying(): Promise<NowPlaying | null> {
  return await ExpoMusicKit.getNowPlaying();
}

export async function getNextInQueue(): Promise<{ id?: string; title: string; artistName: string } | null> {
  return await ExpoMusicKit.getNextInQueue();
}

export type UpcomingTrack = {
  id?: string;
  title: string;
  artistName: string;
  artworkUrl?: string;
};

export async function getUpcomingQueue(count: number = 6): Promise<UpcomingTrack[]> {
  return await ExpoMusicKit.getUpcomingQueue(count);
}

export interface CatalogSearchResult {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  genreNames: string[];
  artworkUrl: string;
  /** Apple Music content rating — 'explicit' or 'clean' when known. Undefined
   *  for tracks with no rating metadata. Callers can prefer explicit when
   *  both variants of a song exist in search results. */
  contentRating?: 'explicit' | 'clean';
  /** Apple Music ISRC when the native bridge can surface it. Carried through
   *  the Ask ONAY curator flow so featured-broadcast bakes can hit ReccoBeats
   *  (Tier 1 feature fetch) instead of degrading to Deezer+synth. */
  isrc?: string;
}

export async function searchCatalog(
  query: string,
  types: string[] = ['songs'],
  limit: number = 5
): Promise<CatalogSearchResult[]> {
  return await ExpoMusicKit.searchCatalog(query, types, limit);
}

export async function createPlaylist(
  name: string,
  description: string,
  trackIds: string[]
): Promise<string> {
  return await ExpoMusicKit.createPlaylist(name, description, trackIds);
}

export async function getPlaybackTime(): Promise<number> {
  return await ExpoMusicKit.getPlaybackTime();
}

export async function getPlaybackStatus(): Promise<PlaybackStatus> {
  return await ExpoMusicKit.getPlaybackStatus();
}

// ── Audio Playback (TTS) ──────────────────────────────────────────────

export async function playAudioFromBase64(base64: string): Promise<void> {
  return await ExpoMusicKit.playAudioFromBase64(base64);
}

export function setTTSVolume(volume: number): void {
  if (typeof ExpoMusicKit.setTTSVolume === 'function') {
    ExpoMusicKit.setTTSVolume(volume);
  }
}

export async function stopAudio(): Promise<void> {
  return await ExpoMusicKit.stopAudio();
}

export async function activateDuckingSession(): Promise<void> {
  return await ExpoMusicKit.activateDuckingSession();
}

export async function deactivateDuckingSession(): Promise<void> {
  return await ExpoMusicKit.deactivateDuckingSession();
}

export async function releaseAudioSession(): Promise<void> {
  return await ExpoMusicKit.releaseAudioSession();
}

/**
 * Tell the native module a broadcast is in progress so its 0.5s playback
 * timer keeps emitting events when the phone locks. Without this the timer
 * is paused on background and the JS state machine can't detect track-end
 * events, stalling the broadcast until the user unlocks the phone.
 */
export async function setBroadcastActive(active: boolean): Promise<void> {
  return await ExpoMusicKit.setBroadcastActive(active);
}

// ── Event Listeners ────────────────────────────────────────────────────

export function addTrackChangedListener(
  listener: (event: TrackChangedEvent) => void
): EventSubscription {
  return emitter.addListener('onTrackChanged', listener);
}

export function addPlaybackStateListener(
  listener: (event: PlaybackStateEvent) => void
): EventSubscription {
  return emitter.addListener('onPlaybackStateChanged', listener);
}

// ── Now Playing (lock-screen tile) ─────────────────────────────────────

// Runtime diagnostic — verify the native bindings were picked up by the
// build. Remove after lock-screen QA lands.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _mk = ExpoMusicKit as any;
console.log(
  '[LockScreenDiag] native bindings:',
  'setNowPlayingTrack=',   typeof _mk.setNowPlayingTrack,
  'setNowPlayingSegment=', typeof _mk.setNowPlayingSegment,
  'setNowPlayingElapsed=', typeof _mk.setNowPlayingElapsed,
  'clearNowPlaying=',      typeof _mk.clearNowPlaying,
);

export type NowPlayingTrackPayload = {
  title: string;
  artist: string;
  vibe: string;
  duration: number;
};

export type NowPlayingSegmentPayload = {
  vibe: string;
  kind: 'cold_open' | 'transition' | 'sign_off';
};

export async function setNowPlayingTrack(payload: NowPlayingTrackPayload): Promise<void> {
  return await ExpoMusicKit.setNowPlayingTrack(payload);
}

export async function setNowPlayingSegment(payload: NowPlayingSegmentPayload): Promise<void> {
  return await ExpoMusicKit.setNowPlayingSegment(payload);
}

export async function setNowPlayingElapsed(elapsed: number, playing: boolean): Promise<void> {
  return await ExpoMusicKit.setNowPlayingElapsed({ elapsed, playing });
}

export async function clearNowPlaying(): Promise<void> {
  return await ExpoMusicKit.clearNowPlaying();
}

export function addRemotePlayListener(listener: () => void): EventSubscription {
  return emitter.addListener('onRemotePlay', listener);
}

export function addRemotePauseListener(listener: () => void): EventSubscription {
  return emitter.addListener('onRemotePause', listener);
}

// ── Live Activity (ActivityKit, iOS 16.2+) ─────────────────────────────

export type BroadcastLiveActivityAttributes = {
  broadcastId: string;
  vibe: string;
  totalTracks: number;
};

export type BroadcastLiveActivityState = {
  kind: 'track' | 'cold_open' | 'transition' | 'sign_off';
  title: string;
  subtitle: string;
  trackNumber: number;
  playing: boolean;
};

export async function startBroadcastLiveActivity(
  attrs: BroadcastLiveActivityAttributes,
  state: BroadcastLiveActivityState,
): Promise<void> {
  return await ExpoMusicKit.startBroadcastLiveActivity({ ...attrs, ...state });
}

export async function updateBroadcastLiveActivity(
  state: BroadcastLiveActivityState,
): Promise<void> {
  return await ExpoMusicKit.updateBroadcastLiveActivity(state);
}

export async function endBroadcastLiveActivity(): Promise<void> {
  return await ExpoMusicKit.endBroadcastLiveActivity();
}

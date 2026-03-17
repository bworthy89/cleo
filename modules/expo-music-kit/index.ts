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

export async function play(trackIds?: string[]): Promise<void> {
  return await ExpoMusicKit.play(trackIds ?? null);
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

export async function stopAudio(): Promise<void> {
  return await ExpoMusicKit.stopAudio();
}

export async function activateDuckingSession(): Promise<void> {
  return await ExpoMusicKit.activateDuckingSession();
}

export async function deactivateDuckingSession(): Promise<void> {
  return await ExpoMusicKit.deactivateDuckingSession();
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

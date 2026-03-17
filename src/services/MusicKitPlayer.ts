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
import type { EventSubscription } from 'expo-modules-core';

type TrackChangeCallback = (event: TrackChangedEvent) => void;
type PlaybackStateCallback = (event: PlaybackStateEvent) => void;

class MusicKitPlayerService {
  private trackSub: EventSubscription | null = null;
  private stateSub: EventSubscription | null = null;
  private trackListeners: TrackChangeCallback[] = [];
  private stateListeners: PlaybackStateCallback[] = [];

  async authorize(): Promise<AuthResult> {
    return authorize();
  }

  async isAuthorized(): Promise<boolean> {
    const status = await getAuthorizationStatus();
    return status === 'authorized';
  }

  async fetchPlaylists(): Promise<MusicPlaylist[]> {
    return fetchPlaylists();
  }

  async fetchPlaylistTracks(playlistId: string): Promise<MusicTrack[]> {
    return fetchPlaylistTracks(playlistId);
  }

  async play(trackIds?: string[]): Promise<void> {
    return play(trackIds);
  }

  async pause(): Promise<void> {
    return pause();
  }

  async skip(): Promise<void> {
    return skip();
  }

  async seekTo(time: number): Promise<void> {
    return seekTo(time);
  }

  async getNowPlaying(): Promise<NowPlaying | null> {
    return getNowPlaying();
  }

  async getPlaybackTime(): Promise<number> {
    return getPlaybackTime();
  }

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

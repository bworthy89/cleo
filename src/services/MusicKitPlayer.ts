import {
  authorize,
  getAuthorizationStatus,
  fetchPlaylists,
  fetchPlaylistTracks,
  play,
  pause,
  skip,
  seekTo,
  setUpcomingQueue,
  getNowPlaying,
  getPlaybackTime,
  getPlaybackStatus as getPlaybackStatusNative,
  addTrackChangedListener,
  addPlaybackStateListener,
  addEjectTrackChangedListener,
  type AuthResult,
  type MusicPlaylist,
  type MusicTrack,
  type NowPlaying,
  type TrackChangedEvent,
  type PlaybackStateEvent,
  type PlaybackStatus,
  type EjectTrackChangedEvent,
} from '../../modules/expo-music-kit';
import type { EventSubscription } from 'expo-modules-core';

type TrackChangeCallback = (event: TrackChangedEvent) => void;
type PlaybackStateCallback = (event: PlaybackStateEvent) => void;
type EjectTrackChangeCallback = (event: EjectTrackChangedEvent) => void;

class MusicKitPlayerService {
  private trackSub: EventSubscription | null = null;
  private stateSub: EventSubscription | null = null;
  private ejectSub: EventSubscription | null = null;
  private trackListeners: TrackChangeCallback[] = [];
  private stateListeners: PlaybackStateCallback[] = [];
  private ejectListeners: EjectTrackChangeCallback[] = [];

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

  async play(trackIds?: string[], playlistId?: string): Promise<void> {
    return play(trackIds, playlistId);
  }

  async setUpcomingQueue(trackIds: string[]): Promise<void> {
    return setUpcomingQueue(trackIds);
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

  async getPlaybackStatus(): Promise<PlaybackStatus> {
    return getPlaybackStatusNative();
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

  onEjectTrackChanged(callback: EjectTrackChangeCallback): () => void {
    this.ejectListeners.push(callback);
    this.ensureSubscriptions();
    return () => {
      this.ejectListeners = this.ejectListeners.filter(cb => cb !== callback);
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
    if (!this.ejectSub && this.ejectListeners.length > 0) {
      this.ejectSub = addEjectTrackChangedListener((event) => {
        this.ejectListeners.forEach(cb => cb(event));
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
    if (this.ejectListeners.length === 0 && this.ejectSub) {
      this.ejectSub.remove();
      this.ejectSub = null;
    }
  }

  destroy() {
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
}

export const musicKitPlayer = new MusicKitPlayerService();

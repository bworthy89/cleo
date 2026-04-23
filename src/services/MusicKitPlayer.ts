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
  getNextInQueue,
  setNowPlayingTrack,
  setNowPlayingSegment,
  setNowPlayingElapsed,
  clearNowPlaying,
  addRemotePlayListener,
  addRemotePauseListener,
  type AuthResult,
  type MusicPlaylist,
  type MusicTrack,
  type NowPlaying,
  type TrackChangedEvent,
  type PlaybackStateEvent,
  type PlaybackStatus,
  type NowPlayingTrackPayload,
  type NowPlayingSegmentPayload,
} from '../../modules/expo-music-kit';
import type { EventSubscription } from 'expo-modules-core';
import { UITEST_MODE } from '../config/featureFlags';
import { UITEST_PLAYLISTS } from '../config/uitestFixtures';

type TrackChangeCallback = (event: TrackChangedEvent) => void;
type PlaybackStateCallback = (event: PlaybackStateEvent) => void;

class MusicKitPlayerService {
  private trackSub: EventSubscription | null = null;
  private stateSub: EventSubscription | null = null;
  private trackListeners: TrackChangeCallback[] = [];
  private stateListeners: PlaybackStateCallback[] = [];

  async authorize(): Promise<AuthResult> {
    if (UITEST_MODE) {
      return { status: 'authorized', canPlayCatalog: true };
    }
    return authorize();
  }

  async isAuthorized(): Promise<boolean> {
    if (UITEST_MODE) return true;
    const status = await getAuthorizationStatus();
    return status === 'authorized';
  }

  async fetchPlaylists(): Promise<MusicPlaylist[]> {
    if (UITEST_MODE) return UITEST_PLAYLISTS;
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

  async getNextInQueue(): Promise<{ id?: string; title: string; artistName: string } | null> {
    return getNextInQueue();
  }

  // ── Now Playing (lock-screen tile) ───────────────────────────────────
  async setNowPlayingTrack(payload: NowPlayingTrackPayload): Promise<void> {
    return setNowPlayingTrack(payload);
  }

  async setNowPlayingSegment(payload: NowPlayingSegmentPayload): Promise<void> {
    return setNowPlayingSegment(payload);
  }

  async setNowPlayingElapsed(elapsed: number, playing: boolean): Promise<void> {
    return setNowPlayingElapsed(elapsed, playing);
  }

  async clearNowPlaying(): Promise<void> {
    return clearNowPlaying();
  }

  /** Subscribe to lock-screen / control-center / headphone play & pause taps.
   *  Returns an unsubscribe closure. Same throwing-listener safety as the
   *  existing track/state subscriptions. */
  subscribeRemoteCommands(handlers: { onPlay: () => void; onPause: () => void }): () => void {
    const playSub = addRemotePlayListener(() => {
      try { handlers.onPlay(); } catch (e) {
        console.error('[MusicKitPlayer] onRemotePlay handler error:', e);
      }
    });
    const pauseSub = addRemotePauseListener(() => {
      try { handlers.onPause(); } catch (e) {
        console.error('[MusicKitPlayer] onRemotePause handler error:', e);
      }
    });
    return () => { playSub.remove(); pauseSub.remove(); };
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
        this.trackListeners.forEach(cb => {
          try { cb(event); } catch (e) { console.error('[MusicKitPlayer] trackListener error:', e); }
        });
      });
    }
    if (!this.stateSub && this.stateListeners.length > 0) {
      this.stateSub = addPlaybackStateListener((event) => {
        this.stateListeners.forEach(cb => {
          try { cb(event); } catch (e) { console.error('[MusicKitPlayer] stateListener error:', e); }
        });
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

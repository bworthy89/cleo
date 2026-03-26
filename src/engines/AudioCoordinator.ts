import { synthesizeAndPlay } from '../services/CleoVoiceEngine';
import { segmentController } from './SegmentController';
import type { SegmentResult } from './SegmentController';
import { transitionPreloader } from './TransitionPreloader';
import { queueManager } from './QueueManager';
import type { TrackInfo } from '../types/TrackInfo';
import type { Vibe } from '../cleo/fallbacks';
import { getPlaybackStatus, activateDuckingSession, deactivateDuckingSession, setTTSVolume } from '../../modules/expo-music-kit';
import { storage, StorageKeys } from '../services/Storage';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '../services/logger';

const GENERATION_TIMEOUT_MS = 8000;

function calculatePostSongDelay(durationSeconds: number | undefined): number {
  if (!durationSeconds) return 10000;

  if (durationSeconds < 180) {
    const min = durationSeconds * 0.08;
    const max = durationSeconds * 0.15;
    return (min + Math.random() * (max - min)) * 1000;
  }
  if (durationSeconds <= 300) {
    const min = durationSeconds * 0.05;
    const max = durationSeconds * 0.10;
    return (min + Math.random() * (max - min)) * 1000;
  }
  const min = durationSeconds * 0.04;
  const max = durationSeconds * 0.08;
  return (min + Math.random() * (max - min)) * 1000;
}

function calculateMidSongDelay(durationSeconds: number): number {
  const min = durationSeconds * 0.35;
  const max = durationSeconds * 0.50;
  return (min + Math.random() * (max - min)) * 1000;
}

class AudioCoordinatorEngine {
  private isSpeaking = false;
  private pendingPostSongTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPostSongResolve: ((v: SegmentResult | null) => void) | null = null;
  private previousTrack: TrackInfo | null = null;
  private generationId = 0;
  private pendingMidSongTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSegmentEndTime = 0;
  private currentVibe: Vibe = 'general';
  private isAppActiveCheck: (() => boolean) | null = null;

  constructor() {
    const saved = storage.getString(StorageKeys.HOST_VOLUME_MIX);
    if (saved) setTTSVolume(parseFloat(saved));
    transitionPreloader.setIsSpeakingCheck(() => this.isSpeaking);
  }

  setIsAppActiveCheck(fn: () => boolean): void {
    this.isAppActiveCheck = fn;
    transitionPreloader.setIsAppActiveCheck(fn);
  }

  private cancelPendingTimer() {
    // Note: does NOT cancel transitionPreloader — that's handled explicitly
    // by the caller on manual skips only, so natural track changes don't kill the preloader.
    if (this.pendingPostSongTimer) {
      clearTimeout(this.pendingPostSongTimer);
      this.pendingPostSongTimer = null;
    }
    // Resolve any dangling post_song Promise so callers don't hang forever
    if (this.pendingPostSongResolve) {
      this.pendingPostSongResolve(null);
      this.pendingPostSongResolve = null;
    }
    if (this.pendingMidSongTimer) {
      clearTimeout(this.pendingMidSongTimer);
      this.pendingMidSongTimer = null;
    }
    this.generationId++;
    this.isSpeaking = false;
  }

  private enrichTrack(track: TrackInfo): TrackInfo {
    if (!track.id) return track;
    const enrichedProfile = queueManager.getTrackProfile(track.id);
    if (!enrichedProfile) return track;
    return {
      ...track,
      enrichedFacts: enrichedProfile.enrichedFacts,
      hasRichData: enrichedProfile.hasRichData,
    };
  }

  private async isMusicPlaying(): Promise<boolean> {
    try {
      const status = await getPlaybackStatus();
      return status === 'playing';
    } catch (err) {
      logger.warn('AudioCoordinator', 'getPlaybackStatus failed', err);
      return false;
    }
  }

  async handleTrackChange(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    isManualSkip?: boolean
  ): Promise<void> {
    this.cancelPendingTimer();
    const myId = this.generationId;

    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    try {
      const trackInfo = this.enrichTrack(currentTrack);
      const generationStart = Date.now();
      const segment = await this._runSegment(trackInfo, nextTrack, previous ?? undefined, myId, isManualSkip);

      if (!segment) {
        if (myId === this.generationId) {
          this.isSpeaking = false;
          this.scheduleMidSongDrop(trackInfo);
        }
        return;
      }
      if (myId !== this.generationId) return;

      if (segment.deliveryMode === 'pre_song') {
        await activateDuckingSession().catch(() => {});
        await synthesizeAndPlay(segment.text, this.currentVibe);
        // Deactivate ducking after speech completes (or fails silently).
        // synthesizeAndPlay never throws — its internal catch returns void on failure.
        // The native playAudioFromBase64 handles crossfade, but if TTS failed and
        // no audio played, we must explicitly unduck the music.
        await deactivateDuckingSession().catch(() => {});
        if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
      } else {
        this.isSpeaking = false;
        const elapsed = Date.now() - generationStart;
        const targetDelay = calculatePostSongDelay(currentTrack.duration);
        const remainingMs = Math.max(0, targetDelay - elapsed);
        this.pendingPostSongTimer = setTimeout(async () => {
          this.pendingPostSongTimer = null;
          if (myId !== this.generationId || this.isSpeaking) return;
          const playing = await this.isMusicPlaying();
          if (!playing) {
            this.isSpeaking = false;
            return;
          }
          this.isSpeaking = true;
          try {
            // Note: playAudioFromBase64 (inside synthesizeAndPlay) handles ducking
            // natively — no need to activate/deactivate from JS side here.
            await synthesizeAndPlay(segment.text, this.currentVibe);
            if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
          } finally {
            if (myId === this.generationId) {
              this.lastSegmentEndTime = Date.now();
              this.isSpeaking = false;
            }
          }
        }, remainingMs);
        return;
      }
    } catch (error) {
      logger.error('AudioCoordinator', 'Handoff failed', error);
    } finally {
      if (myId === this.generationId && this.isSpeaking) {
        this.lastSegmentEndTime = Date.now();
        this.isSpeaking = false;
      }
    }
  }

  async handleTrackChangeWithResult(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void,
    isManualSkip?: boolean
  ): Promise<SegmentResult | null> {
    this.cancelPendingTimer();
    const myId = this.generationId;

    // Skip commentary when offline — music continues, ONAY stays quiet
    const netState = await NetInfo.fetch();
    if (!(netState.isConnected ?? true)) {
      console.log('[AudioCoordinator] Offline — skipping commentary');
      this.isSpeaking = false;
      return null;
    }

    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    const trackInfo = this.enrichTrack(currentTrack);

    const generationStart = Date.now();
    const segment = await this._runSegment(trackInfo, nextTrack, previous ?? undefined, myId, isManualSkip);

    if (!segment) {
      if (myId === this.generationId) {
        this.isSpeaking = false;
        this.scheduleMidSongDrop(trackInfo);
      }
      return null;
    }
    if (myId !== this.generationId) {
      this.isSpeaking = false;
      return null;
    }

    if (segment.deliveryMode === 'pre_song') {
      onSegmentReady?.(segment);
      try {
        await activateDuckingSession().catch(() => {});
        await synthesizeAndPlay(segment.text, this.currentVibe);
        await deactivateDuckingSession().catch(() => {});
        if (myId === this.generationId) {
          this.scheduleMidSongDrop(trackInfo);
          this.lastSegmentEndTime = Date.now();
          this.isSpeaking = false;
        }
      } catch (error) {
        logger.error('AudioCoordinator', 'pre_song playback failed in handleTrackChangeWithResult', error);
        this.isSpeaking = false;
        await deactivateDuckingSession().catch(() => {});
      }
      return segment;
    } else {
      this.isSpeaking = false;
      const elapsed = Date.now() - generationStart;
      const targetDelay = calculatePostSongDelay(currentTrack.duration);
      const remainingMs = Math.max(0, targetDelay - elapsed);

      return new Promise((resolve) => {
        this.pendingPostSongResolve = resolve;
        this.pendingPostSongTimer = setTimeout(async () => {
          this.pendingPostSongTimer = null;
          this.pendingPostSongResolve = null;

          if (myId !== this.generationId || this.isSpeaking) {
            resolve(null);
            return;
          }
          const playing = await this.isMusicPlaying();
          if (!playing) {
            resolve(null);
            return;
          }
          this.isSpeaking = true;

          try {
            onSegmentReady?.(segment);
            await synthesizeAndPlay(segment.text, this.currentVibe);
            if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
          } catch (error) {
            logger.error('AudioCoordinator', 'post_song playback failed', error);
          } finally {
            if (myId === this.generationId) {
              this.lastSegmentEndTime = Date.now();
              this.isSpeaking = false;
            }
          }

          resolve(segment);
        }, remainingMs);
      });
    }
  }

  private async _runSegment(
    trackInfo: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo,
    genId?: number,
    isManualSkip?: boolean
  ): Promise<SegmentResult | null> {
    try {
      const delay = isManualSkip ? 1500 : 3500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (genId !== undefined && genId !== this.generationId) return null;

      const generationPromise = segmentController.generateNext(
        trackInfo, nextTrack, previousTrack, isManualSkip
      );
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), GENERATION_TIMEOUT_MS)
      );

      const result = await Promise.race([generationPromise, timeoutPromise]);

      if (result === 'timeout') {
        logger.warn('AudioCoordinator', 'Generation timed out at 8s — skipping segment');
        await deactivateDuckingSession().catch(() => {});
        return null;
      }

      if (genId !== undefined && genId !== this.generationId) return null;
      const segment = result;

      if (!segment) {
        console.log('[AudioCoordinator] Segment controller returned null — staying silent');
        return null;
      }

      console.log(`[Cleo] ${segment.type} (${segment.deliveryMode}): ${segment.text}`);
      return segment;
    } catch (error) {
      logger.error('AudioCoordinator', 'Segment generation failed', error);
      return null;
    }
  }

  private scheduleMidSongDrop(trackInfo: TrackInfo) {
    if (!trackInfo.duration || trackInfo.duration <= 210) return;

    const quietVibes: Vibe[] = ['focus', 'chill', 'lateNight', 'melancholy'];
    const highEnergyVibes: Vibe[] = ['workout', 'party'];
    let chance = 0.4;
    if (quietVibes.includes(this.currentVibe)) chance = 0.2;
    if (highEnergyVibes.includes(this.currentVibe)) chance = 0.15;
    if (Math.random() >= chance) return;

    const delay = calculateMidSongDelay(trackInfo.duration);

    this.pendingMidSongTimer = setTimeout(async () => {
      this.pendingMidSongTimer = null;

      if (this.isSpeaking) return;
      if (this.pendingPostSongTimer !== null) return;
      if (Date.now() - this.lastSegmentEndTime < 30000) return;

      const playing = await this.isMusicPlaying();
      if (!playing) {
        console.log('[AudioCoordinator] Mid-song drop skipped — music not playing');
        return;
      }

      const myId = this.generationId;
      this.isSpeaking = true;

      try {
        const segment = await segmentController.generateMidSongDrop(trackInfo);
        if (myId !== this.generationId) return;
        console.log(`[Cleo] mid-song ${segment.type}: ${segment.text}`);
        await synthesizeAndPlay(segment.text, this.currentVibe);
        segmentController.markMidSongDropCompleted();
      } catch (error) {
        logger.error('AudioCoordinator', 'Mid-song drop failed', error);
      } finally {
        if (myId === this.generationId) {
          this.lastSegmentEndTime = Date.now();
          this.isSpeaking = false;
        }
      }
    }, delay);
  }

  /**
   * Primary entry point for new tracks. Kicks off the eject window pre-generation
   * pipeline. Does NOT schedule mid-song drops — the caller handles that separately
   * or handleTrackChangeWithResult handles it in fallback mode.
   */
  handleTrackStart(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void
  ): void {
    // Read previousTrack but do NOT overwrite it — handleTrackChangeWithResult
    // already set it correctly. Double-writing loses the real previous track.
    const previous = this.previousTrack;

    const trackInfo = this.enrichTrack(currentTrack);

    transitionPreloader.startForTrack(
      { ...trackInfo, genreNames: currentTrack.genreNames },
      nextTrack,
      previous ?? undefined,
      (segment) => {
        onSegmentReady?.(segment);
      },
      () => {
        this.isSpeaking = true;
      },
      () => {
        console.log('[AudioCoordinator] Eject fallback — will use handleTrackChange on next track event');
      }
    );
    // No scheduleMidSongDrop here — handleTrackChangeWithResult already schedules it.
  }

  handleEjectComplete(): void {
    this.isSpeaking = false;
    this.lastSegmentEndTime = Date.now();
  }

  setVibe(vibe: Vibe) {
    this.currentVibe = vibe;
    transitionPreloader.setVibe(vibe);
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const audioCoordinator = new AudioCoordinatorEngine();

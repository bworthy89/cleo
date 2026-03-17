import { synthesizeAndPlay } from '../services/CleoVoiceEngine';
import { segmentController } from './SegmentController';
import type { SegmentResult } from './SegmentController';
import { queueManager } from './QueueManager';
import type { EnrichedFacts } from '../services/TrackEnrichmentService';

interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
  duration?: number;
}

class AudioCoordinatorEngine {
  private isSpeaking = false;
  private pendingPostSongTimer: ReturnType<typeof setTimeout> | null = null;
  private previousTrack: TrackInfo | null = null;
  private generationId = 0;
  private pendingMidSongTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSegmentEndTime = 0;

  private cancelPendingTimer() {
    if (this.pendingPostSongTimer) {
      clearTimeout(this.pendingPostSongTimer);
      this.pendingPostSongTimer = null;
    }
    if (this.pendingMidSongTimer) {
      clearTimeout(this.pendingMidSongTimer);
      this.pendingMidSongTimer = null;
    }
    // Invalidate any in-progress generation so stale results are discarded
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

  async handleTrackChange(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo
  ): Promise<void> {
    this.cancelPendingTimer(); // increments generationId, resets isSpeaking
    const myId = this.generationId;
    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    try {
      const trackInfo = this.enrichTrack(currentTrack);
      const generationStart = Date.now();
      const segment = await this._runSegment(trackInfo, nextTrack, previous ?? undefined, myId);
      if (!segment || myId !== this.generationId) return;

      if (segment.deliveryMode === 'pre_song') {
        await synthesizeAndPlay(segment.text);
        if (myId === this.generationId) segmentController.preloadNext(trackInfo, nextTrack);
        if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
      } else {
        this.isSpeaking = false;
        const elapsed = Date.now() - generationStart;
        const targetDelay = 8000 + Math.floor(Math.random() * 4000);
        const remainingMs = Math.max(0, targetDelay - elapsed);
        this.pendingPostSongTimer = setTimeout(async () => {
          this.pendingPostSongTimer = null;
          if (myId !== this.generationId || this.isSpeaking) return;
          this.isSpeaking = true;
          try {
            await synthesizeAndPlay(segment.text);
            if (myId === this.generationId) segmentController.preloadNext(trackInfo, nextTrack);
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
      console.error('[AudioCoordinator] Handoff failed:', error);
    } finally {
      if (myId === this.generationId) {
        this.lastSegmentEndTime = Date.now();
        this.isSpeaking = false;
      }
    }
  }

  async handleTrackChangeWithResult(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void
  ): Promise<SegmentResult | null> {
    this.cancelPendingTimer(); // increments generationId, resets isSpeaking
    const myId = this.generationId;
    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    const trackInfo = this.enrichTrack(currentTrack);

    const generationStart = Date.now();
    const segment = await this._runSegment(trackInfo, nextTrack, previous ?? undefined, myId);

    if (!segment || myId !== this.generationId) {
      if (myId === this.generationId) this.isSpeaking = false;
      return null;
    }

    if (segment.deliveryMode === 'pre_song') {
      onSegmentReady?.(segment);
      try {
        await synthesizeAndPlay(segment.text);
        if (myId === this.generationId) segmentController.preloadNext(trackInfo, nextTrack);
        if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
      } catch (error) {
        console.error('[AudioCoordinator] pre_song playback failed:', error);
      } finally {
        if (myId === this.generationId) {
          this.lastSegmentEndTime = Date.now();
          this.isSpeaking = false;
        }
      }
      return segment;
    } else {
      this.isSpeaking = false;
      const elapsed = Date.now() - generationStart;
      const targetDelay = 8000 + Math.floor(Math.random() * 4000);
      const remainingMs = Math.max(0, targetDelay - elapsed);

      return new Promise((resolve) => {
        this.pendingPostSongTimer = setTimeout(async () => {
          this.pendingPostSongTimer = null;

          if (myId !== this.generationId || this.isSpeaking) {
            resolve(null);
            return;
          }
          this.isSpeaking = true;

          try {
            onSegmentReady?.(segment);
            await synthesizeAndPlay(segment.text);
            if (myId === this.generationId) segmentController.preloadNext(trackInfo, nextTrack);
            if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
          } catch (error) {
            console.error('[AudioCoordinator] post_song playback failed:', error);
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
    genId?: number
  ): Promise<SegmentResult | null> {
    try {
      // 3.5s natural pause before generating — breathing room between songs
      await new Promise((resolve) => setTimeout(resolve, 3500));
      // Bail if a skip happened during the delay
      if (genId !== undefined && genId !== this.generationId) return null;
      const segment = await segmentController.generateNext(trackInfo, nextTrack, previousTrack);
      // Bail if a skip happened during generation
      if (genId !== undefined && genId !== this.generationId) return null;
      console.log(`[Cleo] ${segment.type} (${segment.deliveryMode}): ${segment.text}`);
      return segment;
    } catch (error) {
      console.error('[AudioCoordinator] Segment generation failed:', error);
      return null;
    }
  }

  private scheduleMidSongDrop(trackInfo: TrackInfo) {
    // Only for tracks > 3 minutes
    if (!trackInfo.duration || trackInfo.duration <= 180) return;
    // 40% chance
    if (Math.random() >= 0.4) return;

    // Random delay between 45-90 seconds
    const delay = 45000 + Math.floor(Math.random() * 45000);

    this.pendingMidSongTimer = setTimeout(async () => {
      this.pendingMidSongTimer = null;

      // Guards: not speaking, cooldown passed, no pending post-song segment
      if (this.isSpeaking) return;
      if (this.pendingPostSongTimer !== null) return;
      if (Date.now() - this.lastSegmentEndTime < 30000) return;

      this.isSpeaking = true;
      const myId = this.generationId;

      try {
        const segment = await segmentController.generateMidSongDrop(trackInfo);
        if (myId !== this.generationId) return;
        console.log(`[Cleo] mid-song ${segment.type}: ${segment.text}`);
        await synthesizeAndPlay(segment.text);
      } catch (error) {
        console.error('[AudioCoordinator] Mid-song drop failed:', error);
      } finally {
        if (myId === this.generationId) {
          this.lastSegmentEndTime = Date.now();
          this.isSpeaking = false;
        }
      }
    }, delay);
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const audioCoordinator = new AudioCoordinatorEngine();

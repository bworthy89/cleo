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
}

class AudioCoordinatorEngine {
  private isSpeaking = false;
  private pendingPostSongTimer: ReturnType<typeof setTimeout> | null = null;
  private previousTrack: TrackInfo | null = null;

  private cancelPendingTimer() {
    if (this.pendingPostSongTimer) {
      clearTimeout(this.pendingPostSongTimer);
      this.pendingPostSongTimer = null;
      this.isSpeaking = false;
    }
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
    // Cancel any pending post_song timer from a previous track
    this.cancelPendingTimer();

    if (this.isSpeaking) return;
    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    try {
      const trackInfo = this.enrichTrack(currentTrack);
      const generationStart = Date.now();
      const segment = await this._runSegment(trackInfo, nextTrack, previous ?? undefined);
      if (segment) {
        if (segment.deliveryMode === 'pre_song') {
          await synthesizeAndPlay(segment.text);
          segmentController.preloadNext(trackInfo, nextTrack);
        } else {
          // post_song: release speaking lock, fire after delay
          this.isSpeaking = false;
          const elapsed = Date.now() - generationStart;
          const targetDelay = 8000 + Math.floor(Math.random() * 4000);
          const remainingMs = Math.max(0, targetDelay - elapsed);
          this.pendingPostSongTimer = setTimeout(async () => {
            this.pendingPostSongTimer = null;
            if (this.isSpeaking) return;
            this.isSpeaking = true;
            try {
              await synthesizeAndPlay(segment.text);
              segmentController.preloadNext(trackInfo, nextTrack);
            } finally {
              this.isSpeaking = false;
            }
          }, remainingMs);
          return;
        }
      }
    } catch (error) {
      console.error('[AudioCoordinator] Handoff failed:', error);
    } finally {
      this.isSpeaking = false;
    }
  }

  async handleTrackChangeWithResult(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void
  ): Promise<SegmentResult | null> {
    // Cancel any pending post_song timer from a previous track
    this.cancelPendingTimer();

    if (this.isSpeaking) return null;
    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    const trackInfo = this.enrichTrack(currentTrack);

    // Generate segment upfront (includes 1.5s natural delay)
    const generationStart = Date.now();
    const segment = await this._runSegment(trackInfo, nextTrack, previous ?? undefined);

    if (!segment) {
      this.isSpeaking = false;
      return null;
    }

    if (segment.deliveryMode === 'pre_song') {
      // Notify UI before playing audio so display syncs with speech
      onSegmentReady?.(segment);
      try {
        await synthesizeAndPlay(segment.text);
        segmentController.preloadNext(trackInfo, nextTrack);
      } catch (error) {
        console.error('[AudioCoordinator] pre_song playback failed:', error);
      } finally {
        this.isSpeaking = false;
      }
      return segment;
    } else {
      // post_song: release isSpeaking now, fire at ~8–12s from track change
      // Subtract time already elapsed (generation + 1.5s delay) so total ≈ 8–12s
      this.isSpeaking = false;
      const elapsed = Date.now() - generationStart;
      const targetDelay = 8000 + Math.floor(Math.random() * 4000); // 8–12s from track change
      const remainingMs = Math.max(0, targetDelay - elapsed);

      return new Promise((resolve) => {
        this.pendingPostSongTimer = setTimeout(async () => {
          this.pendingPostSongTimer = null;

          if (this.isSpeaking) {
            resolve(null);
            return;
          }
          this.isSpeaking = true;

          try {
            onSegmentReady?.(segment);
            await synthesizeAndPlay(segment.text);
            segmentController.preloadNext(trackInfo, nextTrack);
          } catch (error) {
            console.error('[AudioCoordinator] post_song playback failed:', error);
          } finally {
            this.isSpeaking = false;
          }

          resolve(segment);
        }, remainingMs);
      });
    }
  }

  private async _runSegment(
    trackInfo: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo
  ): Promise<SegmentResult | null> {
    try {
      // 1.5s natural pause before generating
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const segment = await segmentController.generateNext(trackInfo, nextTrack, previousTrack);
      console.log(`[Cleo] ${segment.type} (${segment.deliveryMode}): ${segment.text}`);
      return segment;
    } catch (error) {
      console.error('[AudioCoordinator] Segment generation failed:', error);
      return null;
    }
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const audioCoordinator = new AudioCoordinatorEngine();

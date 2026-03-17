import { synthesizeAndPlay } from '../services/CleoVoiceEngine';
import { segmentController } from './SegmentController';
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

  async handleTrackChange(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo
  ): Promise<void> {
    if (this.isSpeaking) return;
    this.isSpeaking = true;

    try {
      // Small delay for natural feel
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Look up enriched profile for current track
      let trackInfo = currentTrack;
      if (currentTrack.id) {
        const enrichedProfile = queueManager.getTrackProfile(currentTrack.id);
        if (enrichedProfile) {
          trackInfo = {
            ...currentTrack,
            enrichedFacts: enrichedProfile.enrichedFacts,
            hasRichData: enrichedProfile.hasRichData,
          };
        }
      }

      // Generate segment (uses buffer if pre-loaded)
      const segment = await segmentController.generateNext(trackInfo, nextTrack);

      console.log(`[Cleo] ${segment.type}: ${segment.text}`);

      // Play TTS — ducking is handled inside playAudioFromBase64 natively
      // MusicKit auto-advances through the queue, no manual skip needed
      await synthesizeAndPlay(segment.text);

      // Pre-load next segment while music plays
      segmentController.preloadNext(trackInfo, nextTrack);
    } catch (error) {
      console.error('[AudioCoordinator] Handoff failed:', error);
    } finally {
      this.isSpeaking = false;
    }
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const audioCoordinator = new AudioCoordinatorEngine();

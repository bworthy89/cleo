import { synthesizeAndPlay } from '../services/CleoVoiceEngine';
import { segmentController } from './SegmentController';

interface TrackInfo {
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
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

      // Generate segment (uses buffer if pre-loaded)
      const segment = await segmentController.generateNext(currentTrack, nextTrack);

      console.log(`[Cleo] ${segment.type}: ${segment.text}`);

      // Play TTS — ducking is handled inside playAudioFromBase64 natively
      // MusicKit auto-advances through the queue, no manual skip needed
      await synthesizeAndPlay(segment.text);

      // Pre-load next segment while music plays
      segmentController.preloadNext(currentTrack, nextTrack);
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

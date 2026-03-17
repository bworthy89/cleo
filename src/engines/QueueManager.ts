import { planQueue, type QueuePlan } from './QueuePlanner';
import { enforceRules } from './RulesEngine';
import { enrichTracks, type TrackProfile } from '../services/TrackEnrichmentService';
import { sessionEngine } from './SessionEngine';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import type { Vibe } from '../cleo/fallbacks';
import type { MusicTrack } from '../../modules/expo-music-kit';

class QueueManagerService {
  private trackProfiles: TrackProfile[] = [];
  private enrichmentInProgress = false;

  async initializeSession(
    playlistId: string,
    vibe: Vibe,
    stationId: string
  ): Promise<void> {
    sessionEngine.startSession(stationId, vibe);

    const tracks = await musicKitPlayer.fetchPlaylistTracks(playlistId);
    if (tracks.length === 0) return;

    this.trackProfiles = tracks.map((t) => ({
      ...t,
      tags: [],
      mbEnriched: false,
    }));

    const rawPlan = await planQueue(this.trackProfiles, vibe);
    const validatedPlan = enforceRules(rawPlan, this.trackProfiles);
    sessionEngine.setQueuePlan(validatedPlan);

    const firstTrackId = validatedPlan.queue[0]?.trackId;
    if (firstTrackId) {
      await musicKitPlayer.play([firstTrackId]);
      sessionEngine.advanceTrack(firstTrackId);
    }

    this.enrichInBackground(tracks);
  }

  async playNextTrack(): Promise<string | null> {
    const nextId = sessionEngine.getNextTrackId();
    if (!nextId) return null;

    await musicKitPlayer.play([nextId]);
    sessionEngine.advanceTrack(nextId);
    return nextId;
  }

  async handleSkip(skippedTrackId: string): Promise<void> {
    sessionEngine.recordSkip(skippedTrackId);

    const consecutiveSkips = sessionEngine.getConsecutiveSkips();
    if (consecutiveSkips >= 2) {
      await this.replanQueue();
    }
  }

  private async replanQueue(): Promise<void> {
    const session = sessionEngine.getSession();
    if (!session?.queuePlan) return;

    const remainingQueue = session.queuePlan.queue.slice(session.currentQueueIndex);
    const remainingTrackIds = new Set(remainingQueue.map((q) => q.trackId));
    const remainingProfiles = this.trackProfiles.filter((t) => remainingTrackIds.has(t.id));

    if (remainingProfiles.length === 0) return;

    const newPlan = await planQueue(remainingProfiles, session.vibe);
    const validated = enforceRules(newPlan, remainingProfiles);

    const playedQueue = session.queuePlan.queue.slice(0, session.currentQueueIndex);
    const mergedPlan: QueuePlan = {
      queue: [
        ...playedQueue,
        ...validated.queue.map((q, i) => ({ ...q, position: playedQueue.length + i + 1 })),
      ],
      arcShape: validated.arcShape,
    };

    sessionEngine.setQueuePlan(mergedPlan);
    console.log('[QueueManager] Re-planned queue after skips');
  }

  private async enrichInBackground(tracks: MusicTrack[]): Promise<void> {
    if (this.enrichmentInProgress) return;
    this.enrichmentInProgress = true;

    try {
      this.trackProfiles = await enrichTracks(tracks);
    } catch {
      // Non-fatal
    } finally {
      this.enrichmentInProgress = false;
    }
  }

  getTrackProfiles(): TrackProfile[] {
    return this.trackProfiles;
  }
}

export const queueManager = new QueueManagerService();

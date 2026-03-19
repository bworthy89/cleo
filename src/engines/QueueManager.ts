import { planQueue, type QueuePlan } from './QueuePlanner';
import { planQueueLocally } from './LocalQueuePlanner';
import { enforceRules } from './RulesEngine';
import { enrichTracks, enrichTracksMusicBrainzOnly, type TrackProfile } from '../services/TrackEnrichmentService';
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
    this.enrichmentInProgress = false; // Reset for new session

    const tracks = await musicKitPlayer.fetchPlaylistTracks(playlistId);
    if (tracks.length === 0) {
      // No individual tracks resolved — try queuing the playlist directly
      console.log('[QueueManager] No tracks resolved, queuing playlist directly');
      await musicKitPlayer.play(undefined, playlistId);
      return;
    }

    this.trackProfiles = tracks.map((t) => ({
      ...t,
      tags: [],
      mbEnriched: false,
      hasRichData: false,
    }));

    // Fast path: local plan → start playing immediately
    const localPlan = planQueueLocally(this.trackProfiles, vibe);
    const localValidated = enforceRules(localPlan, this.trackProfiles);
    sessionEngine.setQueuePlan(localValidated);

    const allTrackIds = localValidated.queue.map((q) => q.trackId);
    if (allTrackIds.length > 0) {
      // Native play() caps at 50 items to avoid XPC crashes.
      // Pass all IDs — native queues first 50, we add the rest below.
      await musicKitPlayer.play(allTrackIds, playlistId);
      sessionEngine.advanceTrack(allTrackIds[0]);

      // Queue next batch after initial 50 (cap at 100 more — no session needs 1000+)
      if (allTrackIds.length > 50) {
        const remaining = allTrackIds.slice(50, 150);
        await musicKitPlayer.setUpcomingQueue(remaining).catch(() => {
          // Non-fatal — playback continues with initial batch
        });
      }
    } else {
      // No tracks resolved — try playing the playlist directly
      await musicKitPlayer.play(undefined, playlistId);
    }

    // Phase 1: MusicBrainz enrichment (fast) — awaited so tags/year are available for queue planning
    // Runs while first track is already playing
    this.enrichMusicBrainzFirst(tracks).then(async () => {
      // Longer delay to avoid Gemini 429 rate limit collision with segment generation
      await new Promise((r) => setTimeout(r, 10000));
      // Phase 2: AI queue planning uses enriched tags/year
      this.upgradeQueueInBackground(vibe);
      // Phase 3: Genius metadata (slow) — background, non-blocking
      this.enrichGeniusInBackground(tracks);
    }).catch((err) => {
      console.warn('[QueueManager] Enrichment chain failed:', err);
      // Fallback: still run queue planning and Genius enrichment
      this.upgradeQueueInBackground(vibe);
      this.enrichGeniusInBackground(tracks);
    });
  }

  private async upgradeQueueInBackground(vibe: Vibe): Promise<void> {
    try {
      const aiPlan = await planQueue(this.trackProfiles, vibe);
      const validated = enforceRules(aiPlan, this.trackProfiles);

      const session = sessionEngine.getSession();
      if (!session) return;

      // Keep already-played tracks, replace upcoming with AI plan
      const playedIds = new Set(session.tracksPlayed);
      const upcomingAi = validated.queue.filter((q) => !playedIds.has(q.trackId));

      if (upcomingAi.length === 0) return;

      // Merge: played portion stays, upcoming replaced by AI ordering
      const playedQueue = session.queuePlan?.queue.slice(0, session.currentQueueIndex) ?? [];
      const mergedPlan: QueuePlan = {
        queue: [
          ...playedQueue,
          ...upcomingAi.map((q, i) => ({ ...q, position: playedQueue.length + i + 1 })),
        ],
        arcShape: validated.arcShape,
      };
      sessionEngine.setQueuePlan(mergedPlan);

      // Update MusicKit's upcoming queue
      const upcomingIds = upcomingAi.map((q) => q.trackId);
      await musicKitPlayer.setUpcomingQueue(upcomingIds);

      console.log('[QueueManager] Upgraded to AI-planned queue');
    } catch (error) {
      // Non-fatal — local plan keeps playing
      console.log('[QueueManager] AI plan failed, continuing with local plan:', error);
    }
  }

  async playNextTrack(): Promise<string | null> {
    const nextId = sessionEngine.getNextTrackId();
    if (!nextId) return null;

    // MusicKit auto-advances through the queue we loaded at session start.
    // Just skip to next track.
    await musicKitPlayer.skip();
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

  private async enrichMusicBrainzFirst(tracks: MusicTrack[]): Promise<void> {
    if (this.enrichmentInProgress) return;
    this.enrichmentInProgress = true;

    try {
      // Fast pass: MusicBrainz only (tags, year)
      this.trackProfiles = await enrichTracksMusicBrainzOnly(tracks);
      console.log('[QueueManager] MusicBrainz enrichment complete');
    } catch {
      // Non-fatal
    }
    // enrichmentInProgress stays true until enrichGeniusInBackground resets it in finally
  }

  private async enrichGeniusInBackground(tracks: MusicTrack[]): Promise<void> {
    try {
      // Full enrichment pass (MusicBrainz cache hit + Genius details)
      this.trackProfiles = await enrichTracks(tracks);
      console.log('[QueueManager] Full Genius enrichment complete');
    } catch {
      // Non-fatal
    } finally {
      this.enrichmentInProgress = false;
    }
  }

  getTrackProfiles(): TrackProfile[] {
    return this.trackProfiles;
  }

  getTrackProfile(trackId: string): TrackProfile | undefined {
    return this.trackProfiles.find((t) => t.id === trackId);
  }
}

export const queueManager = new QueueManagerService();

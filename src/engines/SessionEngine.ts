import { storage, StorageKeys, getObject } from '../services/Storage';
import type { Vibe } from '../cleo/fallbacks';
import type { QueuePlan, QueuedTrack } from './QueuePlanner';

export type SessionPhase = 'coldOpen' | 'earlySession' | 'build' | 'peak' | 'resolution' | 'signOff';

export interface Session {
  id: string;
  stationId: string;
  vibe: Vibe;
  startTime: number;
  tracksPlayed: string[];
  skippedTracks: string[];
  currentPhase: SessionPhase;
  queuePlan: QueuePlan | null;
  currentQueueIndex: number;
}

class SessionEngineService {
  private session: Session | null = null;
  private consecutiveSkipCount = 0;

  startSession(stationId: string, vibe: Vibe): Session {
    this.consecutiveSkipCount = 0;
    this.session = {
      id: `session-${Date.now()}`,
      stationId,
      vibe,
      startTime: Date.now(),
      tracksPlayed: [],
      skippedTracks: [],
      currentPhase: 'coldOpen',
      queuePlan: null,
      currentQueueIndex: 0,
    };
    this.persist();
    return this.session;
  }

  getSession(): Session | null {
    return this.session;
  }

  setQueuePlan(plan: QueuePlan): void {
    if (!this.session) return;
    this.session.queuePlan = plan;
    this.persist();
  }

  getCurrentPhase(): SessionPhase {
    if (!this.session) return 'coldOpen';
    const minutes = this.getSessionDuration();
    const trackCount = this.session.tracksPlayed.length;

    if (trackCount === 0) return 'coldOpen';
    if (minutes < 12) return 'earlySession';
    if (minutes < 35) return 'build';
    if (minutes < 50) return 'peak';
    return 'resolution';
  }

  getSessionDuration(): number {
    if (!this.session) return 0;
    return Math.floor((Date.now() - this.session.startTime) / 60000);
  }

  getNextTrackId(): string | null {
    if (!this.session?.queuePlan) return null;
    const { queue } = this.session.queuePlan;
    if (this.session.currentQueueIndex >= queue.length) return null;
    return queue[this.session.currentQueueIndex].trackId;
  }

  getNextTrackIds(count: number): string[] {
    if (!this.session?.queuePlan) return [];
    const { queue } = this.session.queuePlan;
    const start = this.session.currentQueueIndex;
    return queue.slice(start, start + count).map((q) => q.trackId);
  }

  getCurrentQueueEntry(): QueuedTrack | null {
    if (!this.session?.queuePlan) return null;
    const idx = Math.max(0, this.session.currentQueueIndex - 1);
    return this.session.queuePlan.queue[idx] ?? null;
  }

  advanceTrack(trackId: string): void {
    if (!this.session) return;
    this.session.tracksPlayed.push(trackId);
    this.session.currentQueueIndex++;
    this.session.currentPhase = this.getCurrentPhase();
    this.consecutiveSkipCount = 0;
    this.persist();
  }

  recordSkip(trackId: string): void {
    if (!this.session) return;
    this.session.skippedTracks.push(trackId);
    this.consecutiveSkipCount++;
    this.persist();
  }

  getConsecutiveSkips(): number {
    return this.consecutiveSkipCount;
  }

  endSession(): void {
    if (!this.session) return;
    // Save to session history
    const history = getObject<Session[]>(StorageKeys.SESSION_HISTORY) ?? [];
    history.unshift(this.session);
    if (history.length > 20) history.pop();
    storage.set(StorageKeys.SESSION_HISTORY, JSON.stringify(history));
    this.session = null;
  }

  private persist(): void {
    if (!this.session) return;
    storage.set(StorageKeys.CURRENT_SESSION, JSON.stringify(this.session));
  }
}

export const sessionEngine = new SessionEngineService();

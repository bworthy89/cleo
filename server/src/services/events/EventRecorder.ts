import type { Db } from '../db/Db';
import type { Vibe, BroadcastLength } from '../broadcast/types';

/**
 * Discriminated payload map. Adding a new event type means adding an entry
 * here AND a string in EventType — TS surfaces missing combinations at every
 * call site. The DB column `payload_json` stays freeform `TEXT`, so adding a
 * new field to a payload type is a one-line change here — no SQL migration.
 */
export interface AppEventPayloads {
  app_open: { appVersion: string; platform: 'ios' | 'android'; buildNumber: number };
  broadcast_started: { vibe: Vibe; length: BroadcastLength; source: 'user' | 'featured' };
  broadcast_completed: { durationMs: number; segmentsPlayed: number };
  broadcast_failed: { slotIndex: number; provider: string; errorCategory: string };
  track_completed: { trackIndex: number; wasSkipped: boolean; listenedMs: number };
}

export type EventType = keyof AppEventPayloads;

export class EventRecorder {
  constructor(private readonly db: Db) {}

  record<T extends EventType>(
    userId: string,
    type: T,
    payload: AppEventPayloads[T],
    opts?: { broadcastId?: string },
  ): void {
    this.db.prepare(
      `INSERT INTO app_events (user_id, event_type, occurred_at, broadcast_id, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      userId,
      type,
      Date.now(),
      opts?.broadcastId ?? null,
      JSON.stringify(payload),
    );
  }
}

import { createHash } from 'crypto';
import type { Db } from '../db/Db';
import type { Vibe, BroadcastLength } from '../broadcast/types';

function redactId(id: string | null | undefined): string {
  if (!id) return 'null';
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}

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
    // Best-effort: telemetry must never crash the user-facing path. A DB-level
    // failure here (closed handle, disk full, schema drift) gets logged and
    // swallowed — the broadcast lifecycle continues uninterrupted.
    try {
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
    } catch (err) {
      console.warn(
        `[EventRecorder] record failed (type=${type} user=${redactId(userId)} broadcast=${redactId(opts?.broadcastId)}):`,
        err,
      );
    }
  }
}

import type { Manifest, SegmentSlot } from './types';
import type { Db } from '../db/Db';

// 24h matches the client's BROADCAST_HISTORY_RETENTION_MS and the R2
// presigned audio-URL TTL (DEFAULT_PRESIGN_TTL_SECONDS). Manifest,
// audio URLs, and history all expire on the same window so a user
// who comes back within 24h can resume; past 24h, all three are gone.
const TTL_MS = 24 * 60 * 60 * 1000;

interface BroadcastRow {
  id: string;
  manifest_json: string;
  created_at: number;
}

interface SlotRow {
  slot_index: number;
  status: SegmentSlot['status'];
  audio_urls_json: string | null;
}

export class BroadcastStore {
  constructor(private readonly db: Db) {}

  put(manifest: Manifest): void {
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO broadcasts
         (id, user_id, vibe, length, playlist_id, created_at, bake_status, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, 'baking', ?)
         ON CONFLICT(id) DO UPDATE SET
           manifest_json = excluded.manifest_json,
           created_at = excluded.created_at,
           bake_status = excluded.bake_status`,
      ).run(
        manifest.broadcastId,
        manifest.userId,
        manifest.vibe,
        manifest.length,
        manifest.playlistId,
        manifest.createdAt,
        JSON.stringify(manifest),
      );
      this.db.prepare('DELETE FROM broadcast_slots WHERE broadcast_id = ?').run(manifest.broadcastId);
      const insertSlot = this.db.prepare(
        `INSERT INTO broadcast_slots
         (broadcast_id, slot_index, status, audio_urls_json, attempt_count, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      );
      for (const slot of manifest.segmentSlots) {
        insertSlot.run(
          manifest.broadcastId,
          slot.index,
          slot.status,
          slot.audioUrls ? JSON.stringify(slot.audioUrls) : null,
          now,
        );
      }
    });
  }

  get(id: string): Manifest | undefined {
    const row = this.db.prepare<BroadcastRow>(
      'SELECT id, manifest_json, created_at FROM broadcasts WHERE id = ?',
    ).get(id);
    if (!row) return undefined;
    if (Date.now() - row.created_at > TTL_MS) {
      this.db.prepare('DELETE FROM broadcasts WHERE id = ?').run(id);
      return undefined;
    }
    const manifest = JSON.parse(row.manifest_json) as Manifest;
    const slots = this.db.prepare<SlotRow>(
      'SELECT slot_index, status, audio_urls_json FROM broadcast_slots ' +
      'WHERE broadcast_id = ? ORDER BY slot_index',
    ).all(id);
    for (const slotRow of slots) {
      const target = manifest.segmentSlots[slotRow.slot_index];
      if (!target) continue;
      target.status = slotRow.status;
      target.audioUrls = slotRow.audio_urls_json ? JSON.parse(slotRow.audio_urls_json) : undefined;
    }
    return manifest;
  }

  updateSlot(
    id: string,
    slotIndex: number,
    patch: Partial<Pick<SegmentSlot, 'status' | 'audioUrls'>>,
  ): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) {
      setClauses.push('status = ?');
      params.push(patch.status);
    }
    if (patch.audioUrls !== undefined) {
      setClauses.push('audio_urls_json = ?');
      params.push(JSON.stringify(patch.audioUrls));
    }
    if (setClauses.length === 0) return;
    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id, slotIndex);
    const result = this.db.prepare(
      `UPDATE broadcast_slots SET ${setClauses.join(', ')} ` +
      `WHERE broadcast_id = ? AND slot_index = ?`,
    ).run(...params);
    if (result.changes === 0) {
      const broadcast = this.db.prepare(
        'SELECT id FROM broadcasts WHERE id = ?',
      ).get(id);
      if (!broadcast) throw new Error(`broadcast not found: ${id}`);
      throw new Error(`slot ${slotIndex} not found`);
    }
  }

  /** Flip every 'pending' slot in this broadcast's manifest to 'aborted'.
   *  No-op when the broadcast is unknown or has no pending slots. Used by
   *  BroadcastOrchestrator.abortBake to propagate cancellation into the
   *  store so client polling picks up the aborted state. */
  markPendingSlotsAborted(broadcastId: string): void {
    this.db.prepare(
      `UPDATE broadcast_slots
       SET status = 'aborted', updated_at = ?
       WHERE broadcast_id = ? AND status = 'pending'`,
    ).run(Date.now(), broadcastId);
  }

  /** Current row count (includes not-yet-evicted expired entries; TTL is
   *  applied lazily on `get`). Used by the admin status endpoint for a rough
   *  footprint signal. */
  size(): number {
    const { n } = this.db.prepare<{ n: number }>(
      'SELECT COUNT(*) AS n FROM broadcasts',
    ).get();
    return n;
  }
}

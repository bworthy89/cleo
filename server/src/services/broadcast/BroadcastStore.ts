import type { Manifest, SegmentSlot } from './types';

// 24h matches the client's BROADCAST_HISTORY_RETENTION_MS. R2 presigned
// audio URLs live 7 days, so the manifest was the artificially short leg;
// widening lets a user come back the next morning and still resume.
const TTL_MS = 24 * 60 * 60 * 1000;

export class BroadcastStore {
  private readonly entries = new Map<string, Manifest>();

  put(manifest: Manifest): void {
    this.entries.set(manifest.broadcastId, structuredClone(manifest));
  }

  get(id: string): Manifest | undefined {
    const m = this.entries.get(id);
    if (!m) return undefined;
    if (Date.now() - m.createdAt > TTL_MS) {
      this.entries.delete(id);
      return undefined;
    }
    return structuredClone(m);
  }

  updateSlot(
    id: string,
    slotIndex: number,
    patch: Partial<Pick<SegmentSlot, 'status' | 'audioUrls'>>,
  ): void {
    const m = this.entries.get(id);
    if (!m) throw new Error(`broadcast not found: ${id}`);
    const slot = m.segmentSlots[slotIndex];
    if (!slot) throw new Error(`slot ${slotIndex} not found`);
    Object.assign(slot, patch);
  }

  /** Flip every 'pending' slot in this broadcast's manifest to 'aborted'.
   *  No-op when the broadcast is unknown or has no pending slots. Used by
   *  BroadcastOrchestrator.abortBake to propagate cancellation into the
   *  store so client polling picks up the aborted state. */
  markPendingSlotsAborted(broadcastId: string): void {
    const m = this.entries.get(broadcastId);
    if (!m) return;
    for (const slot of m.segmentSlots) {
      if (slot.status === 'pending') slot.status = 'aborted';
    }
  }

  /** Current entry count (includes not-yet-evicted expired entries; TTL is
   *  applied lazily on `get`). Used by the admin status endpoint for a rough
   *  memory-footprint signal. */
  size(): number {
    return this.entries.size;
  }
}

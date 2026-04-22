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
}

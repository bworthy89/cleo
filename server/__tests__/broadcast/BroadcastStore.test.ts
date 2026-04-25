import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import type { Manifest } from '@/services/broadcast/types';

const baseManifest = (): Manifest => ({
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
    { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
  ],
});

describe('BroadcastStore', () => {
  it('stores and retrieves a manifest', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    store.put(m);
    expect(store.get('b1')).toEqual(m);
  });

  it('returns undefined for unknown ids', () => {
    const store = new BroadcastStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('updates a slot with audio URLs and marks it ready', () => {
    const store = new BroadcastStore();
    store.put(baseManifest());
    store.updateSlot('b1', 0, { status: 'ready', audioUrls: ['u0', 'u1', 'u2'] });
    const m = store.get('b1')!;
    expect(m.segmentSlots[0].status).toBe('ready');
    expect(m.segmentSlots[0].audioUrls).toEqual(['u0', 'u1', 'u2']);
  });

  it('marks a slot as failed', () => {
    const store = new BroadcastStore();
    store.put(baseManifest());
    store.updateSlot('b1', 1, { status: 'failed' });
    expect(store.get('b1')!.segmentSlots[1].status).toBe('failed');
  });

  it('returns defensive copies (caller mutations do not leak)', () => {
    const store = new BroadcastStore();
    store.put(baseManifest());
    const m = store.get('b1')!;
    m.segmentSlots[0].status = 'ready';
    expect(store.get('b1')!.segmentSlots[0].status).toBe('pending');
  });

  it('evicts entries older than 24h on access', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    m.createdAt = Date.now() - (24 * 60 * 60 * 1000 + 1000);
    store.put(m);
    expect(store.get('b1')).toBeUndefined();
  });

  it('markPendingSlotsAborted flips only pending slots to aborted', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    m.segmentSlots = [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'ready' },
      { index: 1, kind: 'transition', beforeTrackId: 't0', variantCount: 1, status: 'pending' },
      { index: 2, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'failed' },
    ];
    store.put(m);
    store.markPendingSlotsAborted('b1');
    const out = store.get('b1')!;
    expect(out.segmentSlots[0].status).toBe('ready');
    expect(out.segmentSlots[1].status).toBe('aborted');
    expect(out.segmentSlots[2].status).toBe('failed');
  });

  it('markPendingSlotsAborted is a no-op for unknown broadcastId', () => {
    const store = new BroadcastStore();
    expect(() => store.markPendingSlotsAborted('nope')).not.toThrow();
  });

  it('markPendingSlotsAborted is a no-op when no slots are pending', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    m.segmentSlots = [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'ready' },
    ];
    store.put(m);
    store.markPendingSlotsAborted('b1');
    expect(store.get('b1')!.segmentSlots[0].status).toBe('ready');
  });
});

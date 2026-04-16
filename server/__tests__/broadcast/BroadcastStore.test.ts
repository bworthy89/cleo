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

  it('evicts entries older than 2h on access', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    m.createdAt = Date.now() - (2 * 60 * 60 * 1000 + 1000);
    store.put(m);
    expect(store.get('b1')).toBeUndefined();
  });
});

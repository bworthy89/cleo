import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { Db } from '@/services/db/Db';
import type { Manifest } from '@/services/broadcast/types';

const baseManifest = (id = 'b1'): Manifest => ({
  broadcastId: id, userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
    { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
  ],
});

const newStore = (): { db: Db; store: BroadcastStore } => {
  const db = new Db(':memory:');
  return { db, store: new BroadcastStore(db) };
};

describe('BroadcastStore (sqlite)', () => {
  it('stores and retrieves a manifest', () => {
    const { db, store } = newStore();
    const m = baseManifest();
    store.put(m);
    expect(store.get('b1')).toEqual(m);
    db.close();
  });

  it('returns undefined for unknown ids', () => {
    const { db, store } = newStore();
    expect(store.get('nope')).toBeUndefined();
    db.close();
  });

  it('updates a slot with audio URLs and marks it ready', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    store.updateSlot('b1', 0, { status: 'ready', audioUrls: ['u0', 'u1', 'u2'] });
    const m = store.get('b1')!;
    expect(m.segmentSlots[0].status).toBe('ready');
    expect(m.segmentSlots[0].audioUrls).toEqual(['u0', 'u1', 'u2']);
    db.close();
  });

  it('marks a slot as failed', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    store.updateSlot('b1', 1, { status: 'failed' });
    expect(store.get('b1')!.segmentSlots[1].status).toBe('failed');
    db.close();
  });

  it('returns defensive copies (caller mutations do not leak)', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    const m = store.get('b1')!;
    m.segmentSlots[0].status = 'ready';
    expect(store.get('b1')!.segmentSlots[0].status).toBe('pending');
    db.close();
  });

  it('evicts entries older than 24h on access', () => {
    const { db, store } = newStore();
    const m = baseManifest();
    m.createdAt = Date.now() - (24 * 60 * 60 * 1000 + 1000);
    store.put(m);
    expect(store.get('b1')).toBeUndefined();
    db.close();
  });

  it('markPendingSlotsAborted flips only pending slots to aborted', () => {
    const { db, store } = newStore();
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
    db.close();
  });

  it('markPendingSlotsAborted is a no-op for unknown broadcastId', () => {
    const { db, store } = newStore();
    expect(() => store.markPendingSlotsAborted('nope')).not.toThrow();
    db.close();
  });

  it('size() returns the row count', () => {
    const { db, store } = newStore();
    expect(store.size()).toBe(0);
    store.put(baseManifest('a'));
    store.put(baseManifest('b'));
    expect(store.size()).toBe(2);
    db.close();
  });

  it('updateSlot throws "broadcast not found" for an unknown broadcast id', () => {
    const { db, store } = newStore();
    expect(() => store.updateSlot('nope', 0, { status: 'ready' }))
      .toThrow('broadcast not found: nope');
    db.close();
  });

  it('updateSlot throws "slot N not found" for an out-of-range slot index', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    expect(() => store.updateSlot('b1', 99, { status: 'ready' }))
      .toThrow('slot 99 not found');
    db.close();
  });

  it('persists across BroadcastStore instances on the same Db', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    const second = new BroadcastStore(db);
    expect(second.get('b1')).toBeDefined();
    expect(second.get('b1')!.segmentSlots[0].status).toBe('pending');
    db.close();
  });

  it('boot sweep marks orphaned baking rows as failed and pending slots as aborted', () => {
    const tmp = `/tmp/test-cleo-bootsweep-${process.pid}-${Date.now()}.db`;
    let first: Db | undefined;
    let second: Db | undefined;
    try {
      // First Db: simulate a bake that started but never finished.
      first = new Db(tmp);
      const fStore = new BroadcastStore(first);
      fStore.put(baseManifest());
      // Manually flip the status to 'baking' to simulate mid-flight crash —
      // BroadcastStore.put writes 'baking' by default but be explicit.
      first.prepare(
        "UPDATE broadcasts SET bake_status='baking' WHERE id='b1'",
      ).run();
      first.close();
      first = undefined;

      // Second Db: opening it triggers markCrashedBakes.
      second = new Db(tmp);
      const { bake_status } = second.prepare<{ bake_status: string }>(
        "SELECT bake_status FROM broadcasts WHERE id='b1'",
      ).get();
      expect(bake_status).toBe('failed');
      const slotStatuses = second.prepare<{ status: string }>(
        "SELECT status FROM broadcast_slots WHERE broadcast_id='b1' ORDER BY slot_index",
      ).all().map(r => r.status);
      expect(slotStatuses).toEqual(['aborted', 'aborted']);
    } finally {
      try { first?.close(); } catch { /* ignore */ }
      try { second?.close(); } catch { /* ignore */ }
      try { require('fs').unlinkSync(tmp); } catch { /* ignore */ }
      for (const ext of ['-wal', '-shm']) {
        try { require('fs').unlinkSync(tmp + ext); } catch { /* ignore */ }
      }
    }
  });
});

import { FeaturedBroadcastRegistry, type FeaturedBroadcast } from '@/services/broadcast/FeaturedBroadcastRegistry';
import { Db } from '@/services/db/Db';
import type { Manifest } from '@/services/broadcast/types';

const baseManifest = (id: string): Manifest => ({
  broadcastId: id, userId: 'curator', playlistId: null,
  vibe: 'morning', length: 'standard', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'ready', audioUrls: ['u0'] },
  ],
});

const sampleRecord = (id: string, overrides: Partial<FeaturedBroadcast> = {}): FeaturedBroadcast => ({
  id, title: 'T', description: 'D', vibe: 'morning', length: 'standard',
  baked: true, createdAt: Date.now(), manifest: baseManifest(id),
  ...overrides,
});

const newRegistry = (): { db: Db; reg: FeaturedBroadcastRegistry } => {
  const db = new Db(':memory:');
  return { db, reg: new FeaturedBroadcastRegistry(db) };
};

describe('FeaturedBroadcastRegistry (sqlite)', () => {
  it('load() resolves immediately', async () => {
    const { db, reg } = newRegistry();
    await expect(reg.load()).resolves.toBeUndefined();
    db.close();
  });

  it('list() returns empty for fresh db', () => {
    const { db, reg } = newRegistry();
    expect(reg.list()).toEqual([]);
    db.close();
  });

  it('put + list returns the record', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a'));
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
    db.close();
  });

  it('list() filters out unbaked records', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a', { baked: true }));
    await reg.put(sampleRecord('b', { baked: false }));
    const list = reg.list();
    expect(list.map(r => r.id)).toEqual(['a']);
    db.close();
  });

  it('list() orders morning slot, evening slot, then legacy', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('legacy'));
    await reg.put(sampleRecord('evening', { slot: 'evening' }));
    await reg.put(sampleRecord('morning', { slot: 'morning' }));
    const list = reg.list();
    expect(list.map(r => r.id)).toEqual(['morning', 'evening', 'legacy']);
    db.close();
  });

  it('put() updates an existing record by id', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a', { title: 'first' }));
    await reg.put(sampleRecord('a', { title: 'second' }));
    expect(reg.list()[0].title).toBe('second');
    db.close();
  });

  it('remove() deletes a record', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a'));
    await reg.remove('a');
    expect(reg.list()).toEqual([]);
    db.close();
  });

  it('getBySlot returns the matching baked record or null', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('m', { slot: 'morning' }));
    expect(reg.getBySlot('morning')!.id).toBe('m');
    expect(reg.getBySlot('evening')).toBeNull();
    db.close();
  });

  it('getBySlot returns the most recent baked record when multiple share the slot', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('old', { slot: 'morning', createdAt: 1000 }));
    // Bypass put()'s natural-key upsert (which would overwrite by id) by
    // inserting a second row directly. In production the slot ids 'slot_morning'
    // and 'slot_evening' enforce uniqueness through put's ON CONFLICT, but the
    // SQL ordering still has to behave correctly if two rows ever coexist —
    // pin the contract here.
    db.prepare(
      `INSERT INTO featured_broadcasts
       (id, slot, theme_day, title, description, vibe, length, artwork_url, baked, created_at, manifest_json)
       VALUES ('new', 'morning', null, 'T', 'D', 'morning', 'standard', null, 1, 2000, ?)`,
    ).run(JSON.stringify(baseManifest('new')));
    expect(reg.getBySlot('morning')!.id).toBe('new');
    db.close();
  });

  it('returns defensive copies (caller mutations do not leak)', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a'));
    const out = reg.list()[0];
    out.title = 'mutated';
    expect(reg.list()[0].title).not.toBe('mutated');
    db.close();
  });

  it('rowToRecord throws descriptively on corrupt manifest_json', () => {
    const { db, reg } = newRegistry();
    // Bypass put() to insert a corrupt row directly so we can exercise the
    // try/catch in rowToRecord. A corrupt manifest_json in the DB is the
    // operator-visible signal — fail loud, don't silently drop the record.
    db.prepare(
      `INSERT INTO featured_broadcasts
       (id, slot, theme_day, title, description, vibe, length, artwork_url, baked, created_at, manifest_json)
       VALUES ('bad', null, null, 'T', 'D', 'morning', 'standard', null, 1, 1000, 'not-json')`,
    ).run();
    expect(() => reg.list()).toThrow(/manifest_json corrupt for id="bad"/);
    db.close();
  });
});

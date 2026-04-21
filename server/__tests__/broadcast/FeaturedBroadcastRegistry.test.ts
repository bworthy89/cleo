import { FeaturedBroadcastRegistry, type FeaturedBroadcast } from '@/services/broadcast/FeaturedBroadcastRegistry';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FeaturedBroadcastRegistry', () => {
  let dir: string;
  let reg: FeaturedBroadcastRegistry;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'featured-'));
    reg = new FeaturedBroadcastRegistry(path.join(dir, 'registry.json'));
    await reg.load();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const mk = (id: string, baked: boolean): FeaturedBroadcast => ({
    id, title: `T ${id}`, description: 'D', vibe: 'morning', length: 'quick',
    baked, createdAt: Date.now(),
    manifest: { broadcastId: id, userId: 'curator', playlistId: null,
      vibe: 'morning', length: 'quick', createdAt: Date.now(),
      tracks: [], segmentSlots: [] },
  });

  it('starts empty', () => {
    expect(reg.list()).toEqual([]);
  });

  it('put + list returns baked records only', async () => {
    await reg.put(mk('a', true));
    await reg.put(mk('b', false));
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('persists across load cycles', async () => {
    await reg.put(mk('x', true));

    const reg2 = new FeaturedBroadcastRegistry(path.join(dir, 'registry.json'));
    await reg2.load();
    expect(reg2.list()).toHaveLength(1);
    expect(reg2.list()[0].id).toBe('x');
  });

  it('remove deletes a record', async () => {
    await reg.put(mk('a', true));
    await reg.remove('a');
    expect(reg.list()).toEqual([]);
  });

  it('load tolerates malformed JSON (resets to empty, does not crash)', async () => {
    const p = path.join(dir, 'registry.json');
    await fs.writeFile(p, 'not valid json {{{');
    const reg3 = new FeaturedBroadcastRegistry(p);
    await expect(reg3.load()).resolves.toBeUndefined();
    expect(reg3.list()).toEqual([]);
  });

  it('save is atomic (tmp file + rename)', async () => {
    const p = path.join(dir, 'registry.json');
    await reg.put(mk('a', true));
    const listing = await fs.readdir(dir);
    // After successful write, only the final file should remain — no stray .tmp
    expect(listing.filter(f => f.endsWith('.tmp'))).toEqual([]);
    expect(listing).toContain('registry.json');
    const content = await fs.readFile(p, 'utf8');
    expect(JSON.parse(content).records).toHaveLength(1);
  });

  const mkSlot = (id: string, slot: 'morning'|'evening', day: 'mon', createdAt: number) => ({
    id, slot, themeDay: day, title: `T ${id}`, description: 'D',
    vibe: slot === 'morning' ? 'morning' as const : 'lateNight' as const,
    length: 'quick' as const,
    baked: true, createdAt,
    manifest: { broadcastId: id, userId: 'curator', playlistId: null,
      vibe: 'morning' as const, length: 'quick' as const, createdAt,
      tracks: [], segmentSlots: [] },
  });

  it('slot put overwrites on id match (newer wins)', async () => {
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 100));
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 200));
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].createdAt).toBe(200);
  });

  it('list orders morning → evening → legacy', async () => {
    await reg.put(mk('legacy-a', true));
    await reg.put(mkSlot('slot_evening', 'evening', 'mon', 10));
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 10));
    const ids = reg.list().map(r => r.id);
    expect(ids).toEqual(['slot_morning', 'slot_evening', 'legacy-a']);
  });

  it('getBySlot returns the record or null', async () => {
    expect(reg.getBySlot('morning')).toBeNull();
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 10));
    const got = reg.getBySlot('morning');
    expect(got?.id).toBe('slot_morning');
    expect(reg.getBySlot('evening')).toBeNull();
  });
});

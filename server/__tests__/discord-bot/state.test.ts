import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BotStateStore } from '../../src/discord-bot/state';

describe('BotStateStore', () => {
  let dir: string;
  let store: BotStateStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-state-'));
    store = new BotStateStore(dir);
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns the default when the file does not exist', async () => {
    const value = await store.read<{ x: number }>('missing.json', { x: 0 });
    expect(value).toEqual({ x: 0 });
  });

  it('round-trips an object via write + read', async () => {
    await store.write('thing.json', { a: 1, b: 'two' });
    await store.flush();
    const back = await store.read('thing.json', {});
    expect(back).toEqual({ a: 1, b: 'two' });
  });

  it('persists to disk atomically (no .tmp left behind)', async () => {
    await store.write('atomic.json', { ok: true });
    await store.flush();
    const entries = await fs.readdir(dir);
    expect(entries).toContain('atomic.json');
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('update() serializes concurrent read-modify-write per filename', async () => {
    // Without serialization, two concurrent updaters that each do
    // read-merge-write would race: both read the empty starting state,
    // both merge their key, both write — last-write-wins clobbers the
    // first one's entry. With update(), they queue and run sequentially,
    // so both keys land.
    type M = Record<string, number>;
    const slowAdd = (k: string, v: number) =>
      store.update<M>('counts.json', {}, async (curr) => {
        // Simulate a slow async step inside the updater (e.g., a network
        // call) to make the race window observable in test.
        await new Promise((r) => setTimeout(r, 20));
        return { ...curr, [k]: v };
      });
    await Promise.all([slowAdd('a', 1), slowAdd('b', 2), slowAdd('c', 3)]);
    await store.flush();
    const final = await store.read<M>('counts.json', {});
    expect(final).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('update() releases the lock when the updater throws', async () => {
    type M = { v: number };
    await expect(
      store.update<M>('thrower.json', { v: 0 }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // Subsequent update should still run (queue not poisoned).
    await store.update<M>('thrower.json', { v: 0 }, async (curr) => ({
      v: curr.v + 1,
    }));
    await store.flush();
    const final = await store.read<M>('thrower.json', { v: -1 });
    expect(final).toEqual({ v: 1 });
  });

  it('coalesces a burst of writes via the debounce', async () => {
    const writeSpy = jest.spyOn(fs, 'writeFile');
    try {
      for (let i = 0; i < 5; i++) {
        await store.write('debounced.json', { i });
      }
      await store.flush();
      expect(writeSpy).toHaveBeenCalledTimes(1);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('returns the default on malformed JSON instead of throwing', async () => {
    await fs.writeFile(path.join(dir, 'broken.json'), '{ this: is not json');
    const value = await store.read<{ ok: boolean }>('broken.json', { ok: false });
    expect(value).toEqual({ ok: false });
  });

  it('flushOne does not wipe a timer that was scheduled mid-flight (I1 regression)', async () => {
    // Block writeFile so we can land a fresh write() while flushOne is in-flight.
    let releaseWrite: (() => void) | null = null;
    const blockedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const realWriteFile = fs.writeFile.bind(fs);
    const writeFileSpy = jest
      .spyOn(fs, 'writeFile')
      .mockImplementationOnce(async (...args: Parameters<typeof realWriteFile>) => {
        await blockedWrite;
        return realWriteFile(...args);
      });

    // First write — schedules a timer for 'race.json'.
    await store.write('race.json', { gen: 1 });

    // Manually start the flush (it will block on writeFile).
    const flushPromise = store.flush();

    // Yield so flush() runs setTimeout cleanup and kicks flushOne — flushOne
    // is now awaiting the gated writeFile.
    await new Promise((r) => setImmediate(r));

    // Land a fresh write while flushOne is in-flight. This schedules a NEW
    // timer in pending. Under the buggy code, flushOne's trailing
    // `pending.delete(filename)` would wipe this entry. Under the fix,
    // it must remain.
    await store.write('race.json', { gen: 2 });

    // Release the gate and let the in-flight flush complete. The buggy
    // flushOne does `pending.delete(filename)` as its last async step —
    // wiping the fresh timer. The fix never touches pending inside flushOne.
    releaseWrite!();
    await flushPromise;

    // NOW assert: the fresh timer scheduled by write('race.json', gen:2)
    // must still be in pending. Under the bug it has been deleted.
    expect((store as unknown as { pending: Map<string, unknown> }).pending.has('race.json')).toBe(true);

    // Clean up the lingering timer so afterEach flush doesn't leak.
    await store.flush();

    writeFileSpy.mockRestore();
  });
});

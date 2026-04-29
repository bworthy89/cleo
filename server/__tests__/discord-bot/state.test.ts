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

  it('coalesces a burst of writes via the debounce', async () => {
    const writeSpy = jest.spyOn(fs, 'writeFile');
    for (let i = 0; i < 5; i++) {
      await store.write('debounced.json', { i });
    }
    await store.flush();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    writeSpy.mockRestore();
  });

  it('returns the default on malformed JSON instead of throwing', async () => {
    await fs.writeFile(path.join(dir, 'broken.json'), '{ this: is not json');
    const value = await store.read<{ ok: boolean }>('broken.json', { ok: false });
    expect(value).toEqual({ ok: false });
  });

  it('flush() after a write that lands mid-flight persists the newer value (I1 regression)', async () => {
    // Capture the real writeFile before the spy replaces it so we can
    // delegate to it inside the mock without infinite recursion.
    const realWriteFile = fs.writeFile;

    // Gate: hold the first writeFile call open so a second write() can land
    // while the first flushOne is in-flight.
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    let writeCallCount = 0;
    const writeFileSpy = jest
      .spyOn(fs, 'writeFile')
      .mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
        writeCallCount += 1;
        if (writeCallCount === 1) {
          await firstWriteGate;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return realWriteFile(...(args as [any, any, any]));
      });

    try {
      // First write + immediate flush — flushOne starts but hangs on writeFile.
      await store.write('race.json', { gen: 1 });
      const firstFlush = store.flush();

      // Slip in a second write while the first flushOne is blocked.
      await store.write('race.json', { gen: 2 });

      // Unblock the first write and let the first flush settle.
      releaseFirstWrite();
      await firstFlush;

      // Second flush must see the gen:2 entry in pending and commit it.
      await store.flush();
    } finally {
      writeFileSpy.mockRestore();
    }

    // Restore complete — fs.readFile is the real one again.
    // Read directly from disk, bypassing the in-memory cache.
    const diskRaw = await fs.readFile(path.join(dir, 'race.json'), 'utf-8');
    expect(JSON.parse(diskRaw)).toEqual({ gen: 2 });
  });
});

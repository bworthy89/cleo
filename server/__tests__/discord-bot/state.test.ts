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
});

import { LocalFilesystemStorage } from '@/services/storage/ObjectStorage';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('LocalFilesystemStorage', () => {
  let root: string;
  let storage: LocalFilesystemStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'broadcast-test-'));
    storage = new LocalFilesystemStorage(root, 'http://localhost:3001/broadcast-asset');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes bytes and returns a URL', async () => {
    const url = await storage.put('bcast/1/seg/0/v0.mp3', Buffer.from([0x49, 0x44, 0x33]));
    expect(url).toBe('http://localhost:3001/broadcast-asset/bcast/1/seg/0/v0.mp3');
  });

  it('round-trips bytes via getAbsolutePath', async () => {
    const payload = Buffer.from('hello world');
    await storage.put('k.txt', payload);
    const abs = storage.getAbsolutePath('k.txt');
    const read = await fs.readFile(abs);
    expect(read.equals(payload)).toBe(true);
  });

  it('creates subdirectories as needed', async () => {
    await storage.put('deep/nested/key.mp3', Buffer.from([0]));
    const abs = storage.getAbsolutePath('deep/nested/key.mp3');
    const stat = await fs.stat(abs);
    expect(stat.isFile()).toBe(true);
  });

  it('rejects keys that escape the root', async () => {
    await expect(storage.put('../evil.mp3', Buffer.from([0]))).rejects.toThrow();
  });
});

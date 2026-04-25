import { R2ObjectStorage, type R2Uploader } from '@/services/storage/R2ObjectStorage';

const makeUploader = (): R2Uploader & {
  uploads: Array<{ key: string; bytes: Buffer; contentType: string }>;
  signs: Array<{ key: string; ttlSeconds: number }>;
} => {
  const uploads: Array<{ key: string; bytes: Buffer; contentType: string }> = [];
  const signs: Array<{ key: string; ttlSeconds: number }> = [];
  return {
    uploads,
    signs,
    async upload(key, bytes, contentType) {
      uploads.push({ key, bytes, contentType });
    },
    async sign(key, ttlSeconds) {
      signs.push({ key, ttlSeconds });
      return `https://signed.example/${key}?sig=abc&exp=${ttlSeconds}`;
    },
  };
};

describe('R2ObjectStorage', () => {
  it('uploads bytes with audio/mpeg content type', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({ uploader });
    const bytes = Buffer.from([0x49, 0x44, 0x33]);

    await storage.put('broadcast/abc/segment/0/v0.mp3', bytes);

    expect(uploader.uploads).toHaveLength(1);
    expect(uploader.uploads[0].key).toBe('broadcast/abc/segment/0/v0.mp3');
    expect(uploader.uploads[0].bytes.equals(bytes)).toBe(true);
    expect(uploader.uploads[0].contentType).toBe('audio/mpeg');
  });

  it('returns a presigned URL by default with 24-hour TTL', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({ uploader });

    const url = await storage.put('a/b.mp3', Buffer.from([1]));

    expect(uploader.signs).toHaveLength(1);
    expect(uploader.signs[0].key).toBe('a/b.mp3');
    expect(uploader.signs[0].ttlSeconds).toBe(24 * 60 * 60);
    expect(url).toContain('https://signed.example/a/b.mp3');
  });

  it('honors a custom presign TTL', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({ uploader, presignTtlSeconds: 3600 });

    await storage.put('k.mp3', Buffer.from([1]));

    expect(uploader.signs[0].ttlSeconds).toBe(3600);
  });

  it('returns a public URL instead of signing when publicBaseUrl is set', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({
      uploader,
      publicBaseUrl: 'https://cdn.example.com',
    });

    const url = await storage.put('broadcast/x/segment/0/v0.mp3', Buffer.from([1]));

    expect(url).toBe('https://cdn.example.com/broadcast/x/segment/0/v0.mp3');
    expect(uploader.signs).toHaveLength(0);
  });

  it('strips a trailing slash from publicBaseUrl', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({
      uploader,
      publicBaseUrl: 'https://cdn.example.com/',
    });

    const url = await storage.put('k.mp3', Buffer.from([1]));

    expect(url).toBe('https://cdn.example.com/k.mp3');
  });

  it('rejects keys containing .. segments', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({ uploader });

    await expect(storage.put('../evil.mp3', Buffer.from([0]))).rejects.toThrow(/invalid key/i);
    await expect(storage.put('a/../b.mp3', Buffer.from([0]))).rejects.toThrow(/invalid key/i);
    expect(uploader.uploads).toHaveLength(0);
  });

  it('rejects keys with a leading slash', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({ uploader });

    await expect(storage.put('/abs.mp3', Buffer.from([0]))).rejects.toThrow(/invalid key/i);
  });

  it('rejects empty keys', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({ uploader });

    await expect(storage.put('', Buffer.from([0]))).rejects.toThrow(/invalid key/i);
  });

  it('rejects keys containing backslashes', async () => {
    const uploader = makeUploader();
    const storage = new R2ObjectStorage({ uploader });

    await expect(storage.put('a\\b.mp3', Buffer.from([0]))).rejects.toThrow(/invalid key/i);
  });
});

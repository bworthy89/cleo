import { BroadcastManifestClient } from '../../src/engines/BroadcastManifestClient';

jest.mock('../../src/services/api', () => ({
  API_BASE_URL: 'http://test',
  authenticatedFetch: jest.fn(),
}));
import { authenticatedFetch } from '../../src/services/api';

const makeResponse = (body: unknown, ok = true, status = 200): Partial<Response> => ({
  ok, status,
  json: async () => body,
  arrayBuffer: async () => {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    const buf = Buffer.from(s, 'utf8');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  },
});

describe('BroadcastManifestClient', () => {
  beforeEach(() => (authenticatedFetch as jest.Mock).mockReset());

  it('createBroadcast POSTs and returns manifest + first urls', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse({
      manifest: { broadcastId: 'b1', tracks: [], segmentSlots: [] },
      firstSegmentUrls: ['u1', 'u2'],
    }));

    const client = new BroadcastManifestClient();
    const result = await client.createBroadcast({
      playlistId: 'p1', vibe: 'morning', length: 'quick',
      userContext: { timeOfDay: '10:00', dayOfWeek: 'Mon', firstTimeUser: false },
      tracks: [],
    });

    expect(result.manifest.broadcastId).toBe('b1');
    expect(result.firstSegmentUrls).toEqual(['u1', 'u2']);
    const [path, init] = (authenticatedFetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/broadcast/create');
    expect(init.method).toBe('POST');
  });

  it('createBroadcast throws on non-ok response', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse({ error: 'bad' }, false, 400));
    const client = new BroadcastManifestClient();
    await expect(client.createBroadcast({
      playlistId: 'p1', vibe: 'morning', length: 'quick',
      userContext: { timeOfDay: '10:00', dayOfWeek: 'Mon', firstTimeUser: false },
      tracks: [],
    })).rejects.toThrow();
  });

  it('fetchManifest GETs with a relative path', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse({
      broadcastId: 'b1', tracks: [], segmentSlots: [],
    }));
    const client = new BroadcastManifestClient();
    const m = await client.fetchManifest('b1');
    expect(m.broadcastId).toBe('b1');
    const [path] = (authenticatedFetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/broadcast/b1/manifest');
  });

  it('fetchSegmentAudio fetches full URLs directly (e.g. R2 presigned)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse('hello'));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    const client = new BroadcastManifestClient();

    const presignedUrl = 'https://bucket.abc.r2.cloudflarestorage.com/broadcast/b/segment/0/v0.mp3?X-Amz-Signature=abc';
    const base64 = await client.fetchSegmentAudio(presignedUrl);

    // "hello" base64 = "aGVsbG8="
    expect(base64).toBe('aGVsbG8=');
    expect(fetchMock).toHaveBeenCalledWith(presignedUrl);
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });

  it('fetchSegmentAudio sends relative paths through authenticatedFetch (local dev)', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse('x'));
    const client = new BroadcastManifestClient();

    await client.fetchSegmentAudio('/broadcast-asset/rel/seg.mp3');

    const [path] = (authenticatedFetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/broadcast-asset/rel/seg.mp3');
  });

  it('fetchSegmentAudio throws with status on non-ok fetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse('nope', false, 403));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    const client = new BroadcastManifestClient();

    await expect(client.fetchSegmentAudio('https://r2.example/x.mp3'))
      .rejects.toThrow(/403/);
  });
});

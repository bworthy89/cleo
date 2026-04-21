import { BroadcastCurationClient } from '../../src/engines/BroadcastCurationClient';

jest.mock('../../src/services/api', () => ({
  API_BASE_URL: 'http://test',
  authenticatedFetch: jest.fn(),
}));
import { authenticatedFetch } from '../../src/services/api';

describe('BroadcastCurationClient', () => {
  beforeEach(() => (authenticatedFetch as jest.Mock).mockReset());

  it('fetches featured broadcasts', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ broadcasts: [
        { id: 'a', title: 'A', description: 'D', vibe: 'morning', length: 'quick',
          baked: true, createdAt: 1,
          manifest: { broadcastId: 'a', segmentSlots: [] } },
      ] }),
    });
    const client = new BroadcastCurationClient();
    const list = await client.listFeatured();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('calls the relative path /broadcast/featured', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ broadcasts: [] }),
    });
    const client = new BroadcastCurationClient();
    await client.listFeatured();
    const [path] = (authenticatedFetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/broadcast/featured');
  });

  it('returns empty list on non-ok response', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({}),
    });
    const client = new BroadcastCurationClient();
    const list = await client.listFeatured();
    expect(list).toEqual([]);
  });

  it('returns empty list on network error', async () => {
    (authenticatedFetch as jest.Mock).mockRejectedValue(new Error('net down'));
    const client = new BroadcastCurationClient();
    const list = await client.listFeatured();
    expect(list).toEqual([]);
  });
});

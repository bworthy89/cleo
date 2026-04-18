import { SpotifyFetcher } from '../../../src/services/enrichment/fetchers/SpotifyFetcher';

function mockSpotifyFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/api/token')) {
      return new Response(JSON.stringify({ access_token: 'fake_token', expires_in: 3600 }), { status: 200 });
    }
    if (href.includes('/v1/search')) {
      return new Response(JSON.stringify(map.search), { status: 200 });
    }
    if (href.includes('/v1/audio-features/')) {
      return new Response(JSON.stringify(map.features), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('SpotifyFetcher', () => {
  it('returns audio features after search + lookup', async () => {
    const fetchImpl = mockSpotifyFetch({
      search: { tracks: { items: [{ id: 'track123' }] } },
      features: {
        tempo: 72.1, valence: 0.28, energy: 0.4,
        danceability: 0.3, key: 9, mode: 0,
      },
    });
    const f = new SpotifyFetcher({ clientId: 'id', clientSecret: 'secret', fetchImpl });
    const result = await f.fetch('Track', 'Artist');
    expect(result?.audioFeatures?.tempo).toBeCloseTo(72.1, 1);
    expect(result?.audioFeatures?.key).toBe(9);
    expect(result?.audioFeatures?.mode).toBe(0);
    expect(result?.source).toBe('spotify');
  });

  it('returns null without credentials', async () => {
    const fetchImpl = jest.fn();
    const f = new SpotifyFetcher({ clientId: undefined, clientSecret: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await f.fetch('T', 'A')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when search yields no hits', async () => {
    const fetchImpl = mockSpotifyFetch({ search: { tracks: { items: [] } }, features: {} });
    const f = new SpotifyFetcher({ clientId: 'i', clientSecret: 's', fetchImpl });
    expect(await f.fetch('T', 'A')).toBeNull();
  });
});

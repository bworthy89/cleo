import { SpotifyFetcher } from '../../../src/services/enrichment/fetchers/SpotifyFetcher';

function mockSpotifyFetch(map: {
  search?: unknown;
  artist?: unknown;
  album?: unknown;
  tokenStatus?: number;
}): typeof fetch {
  return (async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/api/token')) {
      const status = map.tokenStatus ?? 200;
      if (status !== 200) return new Response('err', { status });
      return new Response(JSON.stringify({ access_token: 'fake_token', expires_in: 3600 }), { status: 200 });
    }
    if (href.includes('/v1/search')) {
      return new Response(JSON.stringify(map.search), { status: 200 });
    }
    if (href.includes('/v1/artists/')) {
      return new Response(JSON.stringify(map.artist), { status: 200 });
    }
    if (href.includes('/v1/albums/')) {
      return new Response(JSON.stringify(map.album), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('SpotifyFetcher', () => {
  it('returns genre, albumLabel, and releaseYear when all lookups succeed', async () => {
    const fetchImpl = mockSpotifyFetch({
      search: {
        tracks: {
          items: [{
            artists: [{ id: 'artist123' }],
            album: { id: 'album456' },
          }],
        },
      },
      artist: { genres: ['neo soul', 'philly soul', 'quiet storm'] },
      album: { label: 'Stax', release_date: '1968-07-15' },
    });
    const f = new SpotifyFetcher({ clientId: 'id', clientSecret: 'secret', fetchImpl });
    const result = await f.fetch('Track', 'Artist');
    expect(result?.genre).toBe('neo soul');
    expect(result?.albumLabel).toBe('Stax');
    expect(result?.releaseYear).toBe('1968');
    expect(result?.source).toBe('spotify');
  });

  it('returns partial data when only album lookup succeeds', async () => {
    const fetchImpl = mockSpotifyFetch({
      search: {
        tracks: {
          items: [{
            artists: [{ id: 'artist123' }],
            album: { id: 'album456' },
          }],
        },
      },
      artist: null,  // artist call returns invalid shape → null genres
      album: { label: 'Motown', release_date: '1971' },
    });
    const f = new SpotifyFetcher({ clientId: 'id', clientSecret: 'secret', fetchImpl });
    const result = await f.fetch('Track', 'Artist');
    expect(result?.genre).toBeUndefined();
    expect(result?.albumLabel).toBe('Motown');
    expect(result?.releaseYear).toBe('1971');
    expect(result?.source).toBe('spotify');
  });

  it('returns null without credentials', async () => {
    const fetchImpl = jest.fn();
    const f = new SpotifyFetcher({ clientId: undefined, clientSecret: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await f.fetch('T', 'A')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when search yields no hits', async () => {
    const fetchImpl = mockSpotifyFetch({ search: { tracks: { items: [] } } });
    const f = new SpotifyFetcher({ clientId: 'i', clientSecret: 's', fetchImpl });
    expect(await f.fetch('T', 'A')).toBeNull();
  });

  it('returns null when search has a track but no artist or album ids', async () => {
    const fetchImpl = mockSpotifyFetch({
      search: { tracks: { items: [{ artists: [], album: null }] } },
    });
    const f = new SpotifyFetcher({ clientId: 'i', clientSecret: 's', fetchImpl });
    expect(await f.fetch('T', 'A')).toBeNull();
  });
});

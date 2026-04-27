import { fetchAuthUrl, connect, disconnect, nowPlaying, scrobble } from '../../src/services/LastFmService';

jest.mock('../../src/services/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '../../src/services/api';

const mockFetch = authenticatedFetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
});

const okJson = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const ok204 = () => new Response(null, { status: 204 });

describe('LastFmService', () => {
  it('fetchAuthUrl POSTs /lastfm/auth-url and returns url', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ url: 'https://www.last.fm/api/auth/?api_key=K&cb=cleo%3A%2F%2Flastfm-callback' }));
    const url = await fetchAuthUrl();
    expect(url).toContain('last.fm/api/auth');
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/auth-url', expect.objectContaining({ method: 'POST' }));
  });

  it('connect POSTs /lastfm/connect with token', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await connect('OAUTH_T');
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/connect', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ token: 'OAUTH_T' }),
    }));
  });

  it('disconnect POSTs /lastfm/disconnect', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await disconnect();
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/disconnect', expect.objectContaining({ method: 'POST' }));
  });

  it('nowPlaying POSTs /lastfm/now-playing with payload', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await nowPlaying({ trackId: 't', title: 'T', artistName: 'A', duration: 180 });
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/now-playing', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ trackId: 't', title: 'T', artistName: 'A', duration: 180 }),
    }));
  });

  it('scrobble POSTs /lastfm/scrobble with startedAt', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await scrobble({ trackId: 't', title: 'T', artistName: 'A', duration: 180, startedAt: 1714200000 });
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/scrobble', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"startedAt":1714200000'),
    }));
  });

  it('connect throws on 5xx (caller decides what to do)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(connect('T')).rejects.toThrow();
  });
});

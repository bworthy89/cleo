import { LastFmFetcher } from '../../../src/services/enrichment/fetchers/LastFmFetcher';

function mockFetch(responses: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('track.getInfo')) {
      return new Response(JSON.stringify(responses.track), { status: 200 });
    }
    if (href.includes('artist.getInfo')) {
      return new Response(JSON.stringify(responses.artist), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('LastFmFetcher', () => {
  it('returns tags, moodTags, and artistBio when data is available', async () => {
    const fetchImpl = mockFetch({
      track: {
        track: {
          toptags: { tag: [{ name: 'chill' }, { name: 'neo-soul' }, { name: 'mellow' }] },
        },
      },
      artist: {
        artist: {
          bio: { summary: 'A soulful singer with a distinctive voice. <a>Read more</a>' },
        },
      },
    });
    const f = new LastFmFetcher({ apiKey: 'test-key', fetchImpl });
    const result = await f.fetch('Track', 'Artist');
    expect(result?.moodTags).toContain('chill');
    expect(result?.artistBio).toContain('soulful singer');
    expect(result?.artistBio).not.toContain('<a>');
    expect(result?.source).toBe('lastfm');
  });

  it('returns null without an API key', async () => {
    const fetchImpl = jest.fn();
    const f = new LastFmFetcher({ apiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await f.fetch('T', 'A')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when both endpoints fail', async () => {
    const fetchImpl: typeof fetch = (async () => new Response('error', { status: 500 })) as typeof fetch;
    const f = new LastFmFetcher({ apiKey: 'k', fetchImpl });
    expect(await f.fetch('T', 'A')).toBeNull();
  });
});

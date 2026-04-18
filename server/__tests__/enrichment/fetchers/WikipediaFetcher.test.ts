import { WikipediaFetcher } from '../../../src/services/enrichment/fetchers/WikipediaFetcher';

describe('WikipediaFetcher', () => {
  it('returns summary + notable facts from a successful search', async () => {
    const mixedFetch: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/search/title')) {
        return new Response(
          JSON.stringify({ pages: [{ key: 'Adore_(Prince_song)', title: 'Adore (Prince song)' }] }),
          { status: 200 },
        );
      }
      if (href.includes('/page/summary/')) {
        return new Response(
          JSON.stringify({ extract: 'Adore is a 1987 song by Prince from Sign o\u2019 the Times.' }),
          { status: 200 },
        );
      }
      if (href.includes('/page/html/')) {
        return new Response(
          '<h2>Background</h2><p>Prince recorded the track at Paisley Park.</p>' +
          '<h2>Recording</h2><p>The song uses a falsetto vocal throughout its duration.</p>',
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const w = new WikipediaFetcher({ fetchImpl: mixedFetch });
    const result = await w.fetch('Adore', 'Prince');
    expect(result?.wikipediaSummary).toContain('Adore is a 1987 song');
    expect(result?.notableFacts?.length ?? 0).toBeGreaterThan(0);
    expect(result?.source).toBe('wikipedia');
  });

  it('returns null when search yields no results', async () => {
    const fakeFetch: typeof fetch = (async () => {
      return new Response(JSON.stringify({ pages: [] }), { status: 200 });
    }) as typeof fetch;
    const w = new WikipediaFetcher({ fetchImpl: fakeFetch });
    expect(await w.fetch('Obscure Track', 'Unknown')).toBeNull();
  });

  it('returns null when summary fetch fails', async () => {
    const fakeFetch: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/search/title')) {
        return new Response(JSON.stringify({ pages: [{ key: 'x', title: 'x' }] }), { status: 200 });
      }
      return new Response('server error', { status: 500 });
    }) as typeof fetch;
    const w = new WikipediaFetcher({ fetchImpl: fakeFetch });
    expect(await w.fetch('X', 'Y')).toBeNull();
  });

  it('returns summary only when html fetch fails (notable facts optional)', async () => {
    const fakeFetch: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/search/title')) {
        return new Response(
          JSON.stringify({ pages: [{ key: 'Track', title: 'Track' }] }),
          { status: 200 },
        );
      }
      if (href.includes('/page/summary/')) {
        return new Response(JSON.stringify({ extract: 'A song by X.' }), { status: 200 });
      }
      // html fetch fails
      return new Response('error', { status: 500 });
    }) as typeof fetch;
    const w = new WikipediaFetcher({ fetchImpl: fakeFetch });
    const result = await w.fetch('Track', 'X');
    expect(result?.wikipediaSummary).toContain('A song by X');
    expect(result?.notableFacts ?? []).toEqual([]);
    expect(result?.source).toBe('wikipedia');
  });
});

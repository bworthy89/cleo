import { WeatherProvider } from '@/providers/weather/WeatherProvider';

const owmCurrentResponse = (overrides: Record<string, unknown> = {}) => ({
  weather: [{ id: 800, main: 'Clear', description: 'clear sky' }],
  main: { temp: 47.4 },
  ...overrides,
});

const owmGeocodeResponse = () => ([
  { name: 'Brooklyn', state: 'New York', country: 'US', lat: 40.6501, lon: -73.9496 },
  { name: 'Brooklyn', state: 'Iowa', country: 'US', lat: 41.7344, lon: -92.4441 },
]);

describe('WeatherProvider.getHint', () => {
  it('caches results within the 30-min window', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify(owmCurrentResponse())));
    let now = 1_000_000;
    const wp = new WeatherProvider({ apiKey: 'k', clock: () => now, fetch: fetchMock as any });
    const hint1 = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    const hint2 = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(hint1).toBe('It’s a clear 47 in Brooklyn.');
    expect(hint2).toBe('It’s a clear 47 in Brooklyn.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the cache expires', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify(owmCurrentResponse())));
    let now = 1_000_000;
    const wp = new WeatherProvider({ apiKey: 'k', clock: () => now, fetch: fetchMock as any });
    await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    now += 31 * 60 * 1000; // advance past 30-min TTL
    await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null on fetch error (caller skips silently)', async () => {
    const fetchMock = jest.fn(async () => { throw new Error('network down'); });
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any });
    const hint = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(hint).toBeNull();
  });

  it('returns null when OWM responds with non-2xx status', async () => {
    const fetchMock = jest.fn(async () => new Response('rate limited', { status: 429 }));
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any });
    const hint = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(hint).toBeNull();
  });

  it('aborts the fetch when the request exceeds timeoutMs', async () => {
    // fetchMock honors the AbortController signal — when aborted, it
    // rejects with an AbortError-like exception (mirrors undici's behavior).
    const fetchMock = jest.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as Error & { name: string }).name = 'AbortError';
          reject(err);
        });
      }),
    );
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any, timeoutMs: 30 });
    const hint = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(hint).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('formats rain conditions using OWM weather id ranges', async () => {
    const lightRain = new Response(JSON.stringify(owmCurrentResponse({
      weather: [{ id: 500, main: 'Rain', description: 'light rain' }],
      main: { temp: 52 },
    })));
    const heavyRain = new Response(JSON.stringify(owmCurrentResponse({
      weather: [{ id: 502, main: 'Rain', description: 'heavy rain' }],
      main: { temp: 52 },
    })));
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(lightRain)
      .mockResolvedValueOnce(heavyRain);
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any });
    const a = await wp.getHint({ lat: 1, lon: 2 }, 'Brooklyn');
    const b = await wp.getHint({ lat: 3, lon: 4 }, 'Brooklyn');
    expect(a).toBe('It’s 52 and lightly raining in Brooklyn.');
    expect(b).toBe('It’s pouring in Brooklyn — 52.');
  });
});

describe('WeatherProvider.geocode', () => {
  it('returns up to 3 candidates from OWM', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify(owmGeocodeResponse())));
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any });
    const candidates = await wp.geocode('Brooklyn');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      name: 'Brooklyn',
      state: 'New York',
      country: 'US',
      lat: 40.6501,
      lon: -73.9496,
    });
  });
});

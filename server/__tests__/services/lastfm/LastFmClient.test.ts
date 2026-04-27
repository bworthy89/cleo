import { createHash } from 'node:crypto';
import { LastFmClient } from '@/services/lastfm/LastFmClient';

describe('LastFmClient.signRequest', () => {
  it('sorts params alphabetically, concatenates key+value, appends secret, md5s the result', () => {
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC' });

    const sig = client.signRequest({ method: 'm', foo: 'a', bar: 'b' });

    // alphabetical: bar, foo, method  →  bar+b + foo+a + method+m = "barbfooamethodm"
    // append secret: "barbfooamethodmSEC"
    const expected = createHash('md5').update('barbfooamethodmSEC').digest('hex');
    expect(sig).toBe(expected);
  });

  it('omits the api_sig key from the signed input even if present', () => {
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC' });

    const sig = client.signRequest({ method: 'm', api_sig: 'should-be-ignored' });

    const expected = createHash('md5').update('methodmSEC').digest('hex');
    expect(sig).toBe(expected);
  });

  it('omits the format key from the signed input (Last.fm rule)', () => {
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC' });

    const sig = client.signRequest({ method: 'm', format: 'json' });

    const expected = createHash('md5').update('methodmSEC').digest('hex');
    expect(sig).toBe(expected);
  });

  it('throws if constructed without apiKey or apiSecret', () => {
    expect(() => new LastFmClient({ apiKey: '', apiSecret: 'S' })).toThrow(/apiKey/);
    expect(() => new LastFmClient({ apiKey: 'K', apiSecret: '' })).toThrow(/apiSecret/);
  });
});

describe('LastFmClient.getSession', () => {
  it('POSTs auth.getSession with signed params and returns the session', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ session: { name: 'kari_w', key: 'SK_ABC' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    const result = await client.getSession('OAUTH_TOKEN');

    expect(result).toEqual({ name: 'kari_w', key: 'SK_ABC' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('method')).toBe('auth.getSession');
    expect(body.get('api_key')).toBe('K');
    expect(body.get('token')).toBe('OAUTH_TOKEN');
    expect(body.get('format')).toBe('json');
    expect(body.get('api_sig')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('throws on Last.fm error response', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ error: 4, message: 'Authentication failed' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    await expect(client.getSession('BAD_TOKEN')).rejects.toThrow(/Authentication failed/);
  });

  it('throws on HTTP non-200', async () => {
    const fetchImpl = jest.fn(async () => new Response('boom', { status: 500 }));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    await expect(client.getSession('T')).rejects.toThrow(/500/);
  });
});

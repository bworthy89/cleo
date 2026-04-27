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

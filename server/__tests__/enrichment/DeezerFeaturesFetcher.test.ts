import { DeezerFeaturesFetcher } from '../../src/services/enrichment/fetchers/DeezerFeaturesFetcher';

const originalFetch = global.fetch;

describe('DeezerFeaturesFetcher', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns BPM + loudness from /track/isrc: endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123, bpm: 128, gain: -5.2 }),
    } as any);
    const f = new DeezerFeaturesFetcher();
    const out = await f.fetch('USRC17607839');
    expect(out?.tempo).toBe(128);
    expect(out?.loudness).toBeCloseTo((-5.2 + 60) / 60, 3);
  });

  it('returns null when ISRC is unknown to Deezer', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => '',
    } as any);
    const f = new DeezerFeaturesFetcher();
    const out = await f.fetch('USRC17607839');
    expect(out).toBeNull();
  });

  it('returns null when bpm is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ id: 123 }),
    } as any);
    const f = new DeezerFeaturesFetcher();
    const out = await f.fetch('USRC17607839');
    expect(out).toBeNull();
  });

  it('returns null when Deezer times out', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), 10)
      )
    );
    const f = new DeezerFeaturesFetcher();
    const out = await f.fetch('USRC17607839');
    expect(out).toBeNull();
  });
});

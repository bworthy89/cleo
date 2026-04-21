import { ReccoBeatsFetcher } from '../../src/services/enrichment/fetchers/ReccoBeatsFetcher';

const originalFetch = global.fetch;

describe('ReccoBeatsFetcher', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('returns features keyed by ISRC, not by ReccoBeats id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          id: '2670c328-c40f-45f4-80df-f48b29296deb',  // UUID — NOT the ISRC
          isrc: 'USRC17607839',
          tempo: 123.4, energy: 0.72, valence: 0.55,
          danceability: 0.68, acousticness: 0.12,
          loudness: -6.2, instrumentalness: 0.02,
        }],
      }),
    } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(1);
    const rec = out.get('USRC17607839');  // ← keyed by ISRC, not UUID
    expect(rec?.tempo).toBe(123.4);
    expect(rec?.loudness).toBeCloseTo(0.897, 2);
    expect(out.get('2670c328-c40f-45f4-80df-f48b29296deb')).toBeUndefined();
  });

  it('returns empty map on API 500 after one retry', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'bad',
    } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => 'not found',
    } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);  // NOT 2
  });

  it('recovers on retry after transient 500', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'bad' } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{
          id: 'uuid-x', isrc: 'USRC17607839',
          tempo: 120, energy: 0.7, valence: 0.5, danceability: 0.6,
          acousticness: 0.2, loudness: -6.0, instrumentalness: 0.05,
        }] }),
      } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(1);
    expect(out.get('USRC17607839')?.tempo).toBe(120);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('chunks more than 10 ISRCs into multiple requests', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as any);
    const f = new ReccoBeatsFetcher();
    const isrcs = Array.from({ length: 25 }, (_, i) => `USRC${String(i).padStart(8, '0')}`);
    await f.fetch(isrcs);
    expect(global.fetch).toHaveBeenCalledTimes(3); // 10 + 10 + 5
  });

  it('skips missing ISRCs gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as any);
    const f = new ReccoBeatsFetcher();
    const out = await f.fetch(['USRC17607839']);
    expect(out.size).toBe(0);
  });
});

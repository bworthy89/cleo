import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LLMTrackSequencer } from '@/services/broadcast/TrackSequencer';
import { SequenceCache } from '@/services/broadcast/SequenceCache';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import type { ManifestTrack } from '@/services/broadcast/types';
import type { LLMCaller } from '@/services/broadcast/SegmentGenerator';
import type { LLMRequest, LLMResponse } from '@/providers/llm/types';

const track = (id: string, artist = `A-${id}`): ManifestTrack => ({
  id, title: `t-${id}`, artistName: artist, albumTitle: `al-${id}`, duration: 200,
});

function mockLLM(responses: string[]): jest.Mocked<LLMCaller> {
  let i = 0;
  return {
    generate: jest.fn<Promise<LLMResponse>, [LLMRequest]>(
      async () => ({ text: responses[Math.min(i++, responses.length - 1)] }),
    ),
  };
}

async function emptyEnrichmentCache(): Promise<EnrichmentCache> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seq-test-'));
  const c = new EnrichmentCache(path.join(dir, 'tracks.json'));
  await c.load();
  return c;
}

describe('LLMTrackSequencer.sequence', () => {
  const pool = Array.from({ length: 10 }, (_, i) => track(String(i), `Artist${i}`));
  const ctx = { timeOfDay: '20:00', dayOfWeek: 'Thursday' };

  it('returns cached order on cache hit', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    const first = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(first.source).toBe('llm');

    const second = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(second.source).toBe('cache');
    expect(second.orderedTracks.map(t => t.id)).toEqual(first.orderedTracks.map(t => t.id));
    expect(llm.generate).toHaveBeenCalledTimes(1); // cache hit avoided LLM
  });

  it('calls LLM on cache miss and returns ordered tracks', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["2","4","0","6","8"]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(result.source).toBe('llm');
    expect(result.orderedTracks.map(t => t.id)).toEqual(['2', '4', '0', '6', '8']);
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('retries once on invalid JSON, then falls back', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['not json', 'also not json']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(result.source).toBe('fallback');
    expect(result.orderedTracks).toHaveLength(5);
    expect(llm.generate).toHaveBeenCalledTimes(2);
  });

  it('retries once on hallucinated IDs', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      '{"ordered":["99","88","77","66","55"]}', // all hallucinated
      '{"ordered":["0","1","2","3","4"]}',       // valid on retry
    ]);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(result.source).toBe('llm');
    expect(result.orderedTracks.map(t => t.id)).toEqual(['0', '1', '2', '3', '4']);
    expect(llm.generate).toHaveBeenCalledTimes(2);
  });

  it('retries on wrong-length output', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      '{"ordered":["0","1","2"]}',              // too short
      '{"ordered":["0","1","2","3","4"]}',       // correct length
    ]);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(result.source).toBe('llm');
    expect(result.orderedTracks).toHaveLength(5);
    expect(llm.generate).toHaveBeenCalledTimes(2);
  });

  it('caps pool at 40 tracks when input is larger', async () => {
    const largePool = Array.from({ length: 100 }, (_, i) => track(String(i), `Artist${i}`));
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    await seq.sequence({
      pool: largePool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });

    const userPrompt = (llm.generate as jest.Mock).mock.calls[0][0].userPrompt as string;
    // Track 50 should not appear (beyond cap), track 0 should
    expect(userPrompt).toContain('t-0');
    expect(userPrompt).not.toContain('t-50');
  });

  it('throws fast when pool < N', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":[]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    await expect(seq.sequence({
      pool: pool.slice(0, 3), vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    })).rejects.toThrow(/insufficient tracks/);
  });

  it('includes arc prose, preferred, avoid, and soft-signal framing in prompt', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    await seq.sequence({
      pool, vibe: 'lateNight', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });

    const call = (llm.generate as jest.Mock).mock.calls[0][0];
    expect(call.systemPrompt).toContain('Preferred and avoid');
    expect(call.systemPrompt).toContain('aesthetic hints');
    expect(call.systemPrompt).toContain('Never refuse');
    expect(call.userPrompt).toContain('lateNight');
    expect(call.userPrompt).toContain('neo-soul');
    expect(call.userPrompt).toContain('four-on-the-floor');
  });

  it('runs repair after LLM (duplicate removed)', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    // LLM duplicates track "0"
    const llm = mockLLM(['{"ordered":["0","0","1","2","3"]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    const result = await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(result.source).toBe('llm');
    const ids = result.orderedTracks.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it('passes enrichment to the LLM when cache has records', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    await enrich.set('t-0', 'Artist0', {
      genre: 'soul', producer: 'Stevie Wonder',
      lastEnrichedAt: Date.now(), source: 'hybrid',
    });
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });

    const call = (llm.generate as jest.Mock).mock.calls[0][0];
    expect(call.userPrompt).toContain('Stevie Wonder');
    expect(call.userPrompt).toContain('soul');
  });

  it('includes wikipediaSummary first sentence in per-track enrichment hints', async () => {
    const cache = new SequenceCache();
    const enrich = await emptyEnrichmentCache();
    await enrich.set('t-0', 'Artist0', {
      wikipediaSummary: 'Dummy song is a classic 1972 soul track. It later won two Grammy awards.',
      lastEnrichedAt: Date.now(), source: 'wikipedia',
    });
    const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
    const seq = new LLMTrackSequencer(llm, cache, enrich);

    await seq.sequence({
      pool, vibe: 'morning', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });

    const call = (llm.generate as jest.Mock).mock.calls[0][0];
    expect(call.userPrompt).toContain('wiki: ');
    expect(call.userPrompt).toContain('Dummy song is a classic 1972 soul track');
    // Second sentence (after the first period) must not appear.
    expect(call.userPrompt).not.toContain('Grammy awards');
  });

  describe('observability log', () => {
    afterEach(() => jest.restoreAllMocks());

    it('logs source + vibe + N + first/last ids on LLM success', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const cache = new SequenceCache();
      const enrich = await emptyEnrichmentCache();
      const llm = mockLLM(['{"ordered":["2","4","0","6","8"]}']);
      const seq = new LLMTrackSequencer(llm, cache, enrich);

      await seq.sequence({ pool, vibe: 'lateNight', length: 'quick', userContext: ctx, broadcastId: "bid-test" });

      const line = logSpy.mock.calls.map(c => c.join(' ')).find(s => s.includes('[LLMTrackSequencer]'));
      expect(line).toBeDefined();
      expect(line).toContain('source=llm');
      expect(line).toContain('vibe=lateNight');
      expect(line).toContain('N=5');
      expect(line).toContain('poolSize=10');
      expect(line).toContain('firstId=2');
      expect(line).toContain('lastId=8');
    });

    it('logs source=cache on cache hit', async () => {
      const cache = new SequenceCache();
      const enrich = await emptyEnrichmentCache();
      const llm = mockLLM(['{"ordered":["0","1","2","3","4"]}']);
      const seq = new LLMTrackSequencer(llm, cache, enrich);

      await seq.sequence({ pool, vibe: 'morning', length: 'quick', userContext: ctx, broadcastId: "bid-test" });
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await seq.sequence({ pool, vibe: 'morning', length: 'quick', userContext: ctx, broadcastId: "bid-test" });

      const line = logSpy.mock.calls.map(c => c.join(' ')).find(s => s.includes('[LLMTrackSequencer]'));
      expect(line).toContain('source=cache');
    });

    it('logs source=fallback when all LLM attempts fail', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const cache = new SequenceCache();
      const enrich = await emptyEnrichmentCache();
      const llm = mockLLM(['not json', 'still not json']);
      const seq = new LLMTrackSequencer(llm, cache, enrich);

      await seq.sequence({ pool, vibe: 'morning', length: 'quick', userContext: ctx, broadcastId: "bid-test" });

      const line = logSpy.mock.calls.map(c => c.join(' ')).find(s => s.includes('[LLMTrackSequencer]'));
      expect(line).toContain('source=fallback');
    });
  });
});

describe('LLMTrackSequencer featureSlots', () => {
  const ctx = { timeOfDay: 'night', dayOfWeek: 'Sat' };

  it('returns featureSlots from a valid LLM response', async () => {
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      JSON.stringify({ ordered: ['1','2','3','4','5'], featureSlots: [2] }),
    ]);
    const pool = [1,2,3,4,5].map(n => ({
      id: String(n), title: `T${n}`, artistName: `A-${n}`, albumTitle: `al-${n}`, duration: 180,
    }));
    const sequencer = new LLMTrackSequencer(llm, new SequenceCache(), enrich);
    const result = await sequencer.sequence({
      pool, vibe: 'lateNight', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(result.featureSlots).toEqual([2]);
  });

  it('drops out-of-range featureSlots', async () => {
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      JSON.stringify({ ordered: ['1','2','3','4','5'], featureSlots: [0, 2, 99] }),
    ]);
    const pool = [1,2,3,4,5].map(n => ({
      id: String(n), title: `T${n}`, artistName: `A-${n}`, albumTitle: `al-${n}`, duration: 180,
    }));
    const sequencer = new LLMTrackSequencer(llm, new SequenceCache(), enrich);
    const result = await sequencer.sequence({
      pool, vibe: 'lateNight', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    expect(result.featureSlots).toEqual([2]);
  });

  it('forces at least one featureSlot at the middle transition when empty', async () => {
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      JSON.stringify({ ordered: ['1','2','3','4','5'], featureSlots: [] }),
    ]);
    const pool = [1,2,3,4,5].map(n => ({
      id: String(n), title: `T${n}`, artistName: `A-${n}`, albumTitle: `al-${n}`, duration: 180,
    }));
    const sequencer = new LLMTrackSequencer(llm, new SequenceCache(), enrich);
    const result = await sequencer.sequence({
      pool, vibe: 'lateNight', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    // 5 tracks → valid range is 1..4; middle is 2
    expect(result.featureSlots.length).toBeGreaterThan(0);
  });

  it('truncates featureSlots count when LLM returns too many', async () => {
    const enrich = await emptyEnrichmentCache();
    const llm = mockLLM([
      JSON.stringify({ ordered: ['1','2','3','4','5'], featureSlots: [1, 2, 3, 4] }),
    ]);
    const pool = [1,2,3,4,5].map(n => ({
      id: String(n), title: `T${n}`, artistName: `A-${n}`, albumTitle: `al-${n}`, duration: 180,
    }));
    const sequencer = new LLMTrackSequencer(llm, new SequenceCache(), enrich);
    const result = await sequencer.sequence({
      pool, vibe: 'lateNight', length: 'quick', userContext: ctx,
      broadcastId: "bid-test",
    });
    // 5 tracks → ceil(5/4) = 2 max feature slots
    expect(result.featureSlots.length).toBeLessThanOrEqual(2);
  });
});

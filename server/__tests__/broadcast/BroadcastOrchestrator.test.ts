import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import type { ManifestTrack } from '@/services/broadcast/types';

const makeStorage = (): ObjectStorage => ({
  put: jest.fn(async (key: string) => `https://cdn/${key}`),
  getAbsolutePath: jest.fn(),
});

const tracks = (n: number): ManifestTrack[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Title ${i}`, artistName: `Artist ${i}`,
    albumTitle: `Album ${i}`, duration: 200,
  }));

const ctx = {
  timeOfDay: '20:47', dayOfWeek: 'Thursday', firstTimeUser: false,
};

const SEQUENCER_RESPONSE = JSON.stringify({
  ordered: ['t0', 't1', 't2', 't3', 't4'],
});

async function makeDeps() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-test-'));
  const enrichCache = new EnrichmentCache(path.join(dir, 'tracks.json'));
  await enrichCache.load();
  const enricher = new BackgroundEnricher(enrichCache, {
    fetchGenius: jest.fn(async () => null),
    fetchMusicBrainz: jest.fn(async () => null),
    fetchWikipedia: async () => null,
    fetchLastFm: async () => null,
    fetchSpotify: async () => null,
  });
  return { enrichCache, enricher };
}

describe('BroadcastOrchestrator.create', () => {
  it('returns manifest + first segment URLs synchronously', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher,
    );
    const result = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    // 5 tracks → cold_open + 4 transitions + sign_off = 6 slots
    expect(result.manifest.segmentSlots).toHaveLength(6);
    expect(result.firstSegmentUrls).toHaveLength(1);
    expect(result.firstSegmentUrls[0]).toMatch(/^https:\/\/cdn\/broadcast\/.+\/segment\/0\/v0\.mp3$/);
  });

  it('marks first slot ready in the store immediately', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      store, enrichCache, enricher,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    const stored = store.get(manifest.broadcastId)!;
    expect(stored.segmentSlots[0].status).toBe('ready');
    expect(stored.segmentSlots[0].audioUrls).toHaveLength(1);
  });

  it('schedules async generation of remaining slots', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const llm = makeMockLLM(SEQUENCER_RESPONSE);
    const tts = makeMockTTS();
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      llm, tts, makeStorage(), store, enrichCache, enricher,
    );

    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });

    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    for (const slot of final.segmentSlots) {
      expect(slot.status).toBe('ready');
    }
    // 1 sequencer call + 1 cold_open + 4 transitions + 1 sign_off = 7 LLM calls
    expect(llm.generate).toHaveBeenCalledTimes(7);
  });

  it('marks individual slots as failed on provider errors without rejecting create()', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const llm = makeMockLLM();
    // Sequence of calls: sequencer (JSON), cold_open (sync), 4 transitions + 1
    // sign_off (async). Fail one of the async segment calls.
    (llm.generate as jest.Mock)
      .mockImplementationOnce(async () => ({ text: SEQUENCER_RESPONSE })) // sequencer
      .mockImplementationOnce(async () => ({ text: 'ok' })) // cold_open
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => { throw new Error('llm exploded'); })
      .mockImplementation(async () => ({ text: 'ok' }));

    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      llm, makeMockTTS(), makeStorage(), store, enrichCache, enricher,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });

    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    const failed = final.segmentSlots.filter(s => s.status === 'failed');
    expect(failed.length).toBe(1);
    expect(final.segmentSlots[0].status).toBe('ready');
  });

  it('cleans up inFlight map after completion', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    await orch.waitForCompletion(manifest.broadcastId);
    // after completion, waitForCompletion should be a no-op (no pending promise)
    expect(orch.isInFlight(manifest.broadcastId)).toBe(false);
  });
});

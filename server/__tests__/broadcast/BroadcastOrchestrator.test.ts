import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import type { ManifestTrack } from '@/services/broadcast/types';

// These tests exercise the LLM sequencer path (mocked LLM returns canned
// SEQUENCER_RESPONSE). Pin the mode so the orchestrator doesn't fall back to
// DeterministicTrackSequencer, which would bypass the mocked LLM entirely.
const ORIGINAL_SEQUENCER_MODE = process.env.SEQUENCER_MODE;
beforeAll(() => { process.env.SEQUENCER_MODE = 'llm'; });
afterAll(() => {
  if (ORIGINAL_SEQUENCER_MODE === undefined) delete process.env.SEQUENCER_MODE;
  else process.env.SEQUENCER_MODE = ORIGINAL_SEQUENCER_MODE;
});

// Noop feature-fetch chain. The LLM sequencer doesn't use it, but the
// orchestrator constructor requires it.
const noopFetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;

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

const SEQUENCER_RESPONSE_LONG = JSON.stringify({
  ordered: ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13', 't14'],
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
  });
  return { enrichCache, enricher };
}

describe('BroadcastOrchestrator.create', () => {
  it('returns manifest + first segment URLs synchronously', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher, noopFetchChain,
    );
    const result = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    // 5 tracks → cold_open + 2 transitions (halved, at i=2,4) + sign_off = 4 slots
    expect(result.manifest.segmentSlots).toHaveLength(4);
    expect(result.firstSegmentUrls).toHaveLength(1);
    expect(result.firstSegmentUrls[0]).toMatch(/^https:\/\/cdn\/broadcast\/.+\/segment\/0\/v0\.mp3$/);
  });

  it('marks first slot ready in the store immediately', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      store, enrichCache, enricher, noopFetchChain,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    const stored = store.get(manifest.broadcastId)!;
    expect(stored.segmentSlots[0].status).toBe('ready');
    expect(stored.segmentSlots[0].audioUrls).toHaveLength(1);
  });

  it('marks slot 0 ready synchronously and the rest pending until waitForCompletion resolves', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const llm = makeMockLLM(SEQUENCER_RESPONSE);
    const tts = makeMockTTS();
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      llm, tts, makeStorage(), store, enrichCache, enricher, noopFetchChain,
    );

    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });

    // Immediately after create resolves: slot 0 ready, 1..N still pending.
    const afterCreate = store.get(manifest.broadcastId)!;
    expect(afterCreate.segmentSlots[0].status).toBe('ready');
    expect(afterCreate.segmentSlots.slice(1).some(s => s.status === 'pending')).toBe(true);

    // Waiting for completion drains the background bake.
    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    for (const slot of final.segmentSlots) {
      expect(slot.status).toBe('ready');
    }
    // 1 sequencer + 1 cold_open + 2 transitions + 1 sign_off = 5 LLM calls total
    expect(llm.generate).toHaveBeenCalledTimes(5);
  });

  it('marks individual slots as failed on provider errors without rejecting create()', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const llm = makeMockLLM();
    // Sequence of calls: sequencer (JSON), cold_open (sync, must succeed),
    // then slots 1..N in background. Fail one non-cold-open slot; the
    // broadcast remains playable with that slot marked 'failed'.
    (llm.generate as jest.Mock)
      .mockImplementationOnce(async () => ({ text: SEQUENCER_RESPONSE })) // sequencer
      .mockImplementationOnce(async () => ({ text: 'ok' })) // cold_open (sync)
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => { throw new Error('llm exploded'); })
      .mockImplementation(async () => ({ text: 'ok' }));

    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      llm, makeMockTTS(), makeStorage(), store, enrichCache, enricher, noopFetchChain,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    // Drain the background bake so the failure is recorded before assertions.
    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    const failed = final.segmentSlots.filter(s => s.status === 'failed');
    expect(failed.length).toBe(1);
    expect(final.segmentSlots[0].status).toBe('ready');
  });

  it('isInFlight is true immediately after create() and false after waitForCompletion', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher, noopFetchChain,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    // Background slots 1..N are still baking right after create resolves.
    expect(orch.isInFlight(manifest.broadcastId)).toBe(true);
    await orch.waitForCompletion(manifest.broadcastId);
    expect(orch.isInFlight(manifest.broadcastId)).toBe(false);
  });

});

describe('BroadcastOrchestrator — sync slot 0 + async slots 1..N', () => {
  it('returns slot 0 ready synchronously; all slots ready after waitForCompletion', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher, noopFetchChain,
    );
    const res = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    expect(res.manifest.segmentSlots[0].status).toBe('ready');
    expect(res.manifest.featureSlots).toBeDefined();

    await orch.waitForCompletion(res.manifest.broadcastId);
    const final = orch.getManifest(res.manifest.broadcastId)!;
    expect(final.segmentSlots.every(s => s.status === 'ready')).toBe(true);
  });

  it('drainNow completes before any slot > 0 starts', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const llm = makeMockLLM(SEQUENCER_RESPONSE);
    const tts = makeMockTTS();
    const storage = makeStorage();

    const callOrder: string[] = [];
    // Keep drainNow slow so we can observe that slots 1..N wait for it.
    // Slot 0 runs in parallel, so 'segment:.../segment/0/' may appear before
    // drainNow resolves — that's expected under the new design.
    const drainSpy = jest.spyOn(enricher, 'drainNow').mockImplementation(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        callOrder.push('drainNow');
      },
    );

    const origPut = storage.put;
    (storage.put as jest.Mock) = jest.fn(async (key: string, bytes: Buffer) => {
      callOrder.push(`segment:${key}`);
      return origPut(key, bytes);
    });

    const orch = new BroadcastOrchestrator(
      llm, tts, storage, new BroadcastStore(), enrichCache, enricher, noopFetchChain,
    );

    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    await orch.waitForCompletion(manifest.broadcastId);

    expect(drainSpy).toHaveBeenCalledTimes(1);
    const drainIndex = callOrder.indexOf('drainNow');
    expect(drainIndex).toBeGreaterThanOrEqual(0);

    // Every slot > 0 must be written after drainNow completes.
    const slotGtZeroIndices = callOrder
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => /segment:.*\/segment\/[1-9]\d*\//.test(entry))
      .map(({ i }) => i);
    expect(slotGtZeroIndices.length).toBeGreaterThan(0);
    for (const i of slotGtZeroIndices) {
      expect(i).toBeGreaterThan(drainIndex);
    }
  });

  it('drains enrichment for the chosen N tracks only, not the full pool', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const drainSpy = jest.spyOn(enricher, 'drainNow');

    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher, noopFetchChain,
    );

    await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(20),
    });

    expect(drainSpy).toHaveBeenCalledTimes(1);
    const passed = drainSpy.mock.calls[0][0] as ManifestTrack[];
    expect(passed.length).toBe(5);
  });

  it('respects the segment generation concurrency cap of 4 for background slots', async () => {
    const { enrichCache, enricher } = await makeDeps();

    // Instrument TTS so we can count concurrent segment generations during
    // the background slots 1..N fan-out. Slot 0 runs alone (sync) before
    // this, so peak overlap is the background worker pool.
    let active = 0;
    let maxActive = 0;
    const tts = makeMockTTS();
    (tts.synthesize as jest.Mock).mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return { audioContent: 'TU9DSw==' };
    });

    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE_LONG), tts, makeStorage(),
      new BroadcastStore(), enrichCache, enricher, noopFetchChain,
    );

    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'long', userContext: ctx, tracks: tracks(20),
    });
    await orch.waitForCompletion(manifest.broadcastId);

    // 15 tracks → 9 slots (sparse cadence). Background pool cap is 4.
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});

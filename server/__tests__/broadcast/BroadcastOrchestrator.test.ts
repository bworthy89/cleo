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
      new BroadcastStore(), enrichCache, enricher,
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

  it('marks all slots ready after create() (fully pre-baked)', async () => {
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

    // waitForCompletion is a no-op in the fully pre-baked pipeline but
    // callers still exercise it — ensure it still resolves without error.
    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    for (const slot of final.segmentSlots) {
      expect(slot.status).toBe('ready');
    }
    // 1 sequencer call + 1 cold_open + 2 transitions + 1 sign_off = 5 LLM calls
    expect(llm.generate).toHaveBeenCalledTimes(5);
  });

  it('marks individual slots as failed on provider errors without rejecting create()', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const llm = makeMockLLM();
    // Sequence of calls: sequencer (JSON), then 6 segment calls. Fail a
    // non-cold-open slot. Cold-open failures still throw (they block the
    // response); other slots record 'failed' so the client can show a
    // degraded broadcast.
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

    const final = store.get(manifest.broadcastId)!;
    const failed = final.segmentSlots.filter(s => s.status === 'failed');
    expect(failed.length).toBe(1);
    expect(final.segmentSlots[0].status).toBe('ready');
  });

  it('isInFlight always returns false in the fully pre-baked pipeline', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    // pipeline is synchronous in create(); no background work remains.
    expect(orch.isInFlight(manifest.broadcastId)).toBe(false);
  });
});

describe('BroadcastOrchestrator — fully pre-baked pipeline', () => {
  it('returns a manifest with all slots ready after create()', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher,
    );
    const res = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    expect(res.manifest.segmentSlots.every(s => s.status === 'ready')).toBe(true);
    expect(res.manifest.featureSlots).toBeDefined();
  });

  it('calls drainNow on the enricher before segment generation', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const llm = makeMockLLM(SEQUENCER_RESPONSE);
    const tts = makeMockTTS();
    const storage = makeStorage();

    const callOrder: string[] = [];
    const drainSpy = jest.spyOn(enricher, 'drainNow').mockImplementation(
      async () => {
        callOrder.push('drainNow');
      },
    );

    // Wrap storage.put so we can observe when segments start being persisted.
    // Storage.put is the tail end of a segment generation; if it's observed
    // only after drainNow runs, we've proved the ordering holds.
    const origPut = storage.put;
    (storage.put as jest.Mock) = jest.fn(async (key: string, bytes: Buffer) => {
      callOrder.push(`segment:${key}`);
      return origPut(key, bytes);
    });

    const orch = new BroadcastOrchestrator(
      llm, tts, storage, new BroadcastStore(), enrichCache, enricher,
    );

    await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });

    expect(drainSpy).toHaveBeenCalledTimes(1);
    const firstSegmentIndex = callOrder.findIndex(s => s.startsWith('segment:'));
    const drainIndex = callOrder.indexOf('drainNow');
    expect(drainIndex).toBeGreaterThanOrEqual(0);
    expect(firstSegmentIndex).toBeGreaterThan(drainIndex);
  });

  it('drains enrichment for the chosen N tracks only, not the full pool', async () => {
    const { enrichCache, enricher } = await makeDeps();
    const drainSpy = jest.spyOn(enricher, 'drainNow');

    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher,
    );

    await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(20),
    });

    expect(drainSpy).toHaveBeenCalledTimes(1);
    const passed = drainSpy.mock.calls[0][0] as ManifestTrack[];
    expect(passed.length).toBe(5);
  });

  it('respects the segment generation concurrency cap of 4', async () => {
    const { enrichCache, enricher } = await makeDeps();

    // Instrument TTS so we can count concurrent segment generations. Each
    // segment goes LLM → TTS → storage; wrapping synthesize gives us a hook
    // at the start of segment work that overlaps with peers.
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
      new BroadcastStore(), enrichCache, enricher,
    );

    await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'long', userContext: ctx, tracks: tracks(20),
    });

    // 15 tracks -> 16 slots. Cap is 4.
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});

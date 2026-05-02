import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { Db } from '@/services/db/Db';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';
import { makeMockLLM } from '../../__mocks__/llm';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import type { Manifest } from '@/services/broadcast/types';

function makeManifest(broadcastId: string): Manifest {
  return {
    broadcastId, userId: 'u1', playlistId: 'p1',
    vibe: 'morning', length: 'quick', createdAt: Date.now(),
    tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
    segmentSlots: [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready' },
      { index: 1, kind: 'transition', beforeTrackId: 't0', variantCount: 1, status: 'pending' },
      { index: 2, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
    ],
  };
}

describe('BroadcastOrchestrator.abortBake', () => {
  it('returns false when broadcast is not in flight', () => {
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.abortBake('not-in-flight')).toBe(false);
  });

  it('marks pending slots aborted and returns true when in flight', async () => {
    const orch = BroadcastOrchestrator.makeWithDefaults();
    const store = (orch as unknown as { store: BroadcastStore }).store;
    const m = makeManifest('b1');
    store.put(m);
    // Simulate an in-flight background bake by inserting a never-resolving
    // promise into inFlight so abortBake's pre-check passes.
    const inFlight = (orch as unknown as { inFlight: Map<string, Promise<void>> }).inFlight;
    inFlight.set('b1', new Promise(() => {}));

    expect(orch.abortBake('b1')).toBe(true);

    const out = store.get('b1')!;
    expect(out.segmentSlots[0].status).toBe('ready');
    expect(out.segmentSlots[1].status).toBe('aborted');
    expect(out.segmentSlots[2].status).toBe('aborted');
  });

  it('records the broadcast in the aborted Set', () => {
    const orch = BroadcastOrchestrator.makeWithDefaults();
    const inFlight = (orch as unknown as { inFlight: Map<string, Promise<void>> }).inFlight;
    inFlight.set('b1', new Promise(() => {}));
    orch.abortBake('b1');
    const aborted = (orch as unknown as { aborted: Set<string> }).aborted;
    expect(aborted.has('b1')).toBe(true);
  });
});

const ORIGINAL_SEQUENCER_MODE = process.env.SEQUENCER_MODE;
beforeAll(() => { process.env.SEQUENCER_MODE = 'llm'; });
afterAll(() => {
  if (ORIGINAL_SEQUENCER_MODE === undefined) delete process.env.SEQUENCER_MODE;
  else process.env.SEQUENCER_MODE = ORIGINAL_SEQUENCER_MODE;
});

const SEQUENCER_RESPONSE = JSON.stringify({
  ordered: ['t0', 't1', 't2', 't3', 't4'],
});

const noopFetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
const makeStorage = (): ObjectStorage => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

describe('BroadcastOrchestrator.abortBake — worker integration', () => {
  it('worker loop exits after abort; remaining slots stay aborted', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-abort-'));
    const enrichCache = new EnrichmentCache(path.join(tmp, 'tracks.json'));
    await enrichCache.load();
    const enricher = new BackgroundEnricher(enrichCache, {
      fetchGenius: jest.fn(async () => null),
      fetchMusicBrainz: jest.fn(async () => null),
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
    });
    const store = new BroadcastStore(new Db(':memory:'));

    // TTS that takes 50ms per call so we can abort during slot 1's generation.
    const slowTTS = {
      synthesize: jest.fn(async () => {
        await new Promise(r => setTimeout(r, 50));
        return { audioContent: 'YQ==' };
      }),
    };

    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), slowTTS, makeStorage(),
      store, enrichCache, enricher, noopFetchChain,
    );

    const tracks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, title: `T${i}`, artistName: `A${i}`,
      albumTitle: 'Al', duration: 200,
    }));

    const createPromise = orch.create({
      playlistId: 'p1', vibe: 'morning', length: 'quick',
      tracks, userId: 'u1',
      userContext: { timeOfDay: '10:00', dayOfWeek: 'Mon', firstTimeUser: false },
    });
    const result = await createPromise;
    const id = result.manifest.broadcastId;

    // Slot 0 has returned but slots 1..N are still in flight. Abort.
    expect(orch.isInFlight(id)).toBe(true);
    expect(orch.abortBake(id)).toBe(true);

    // Wait for the background bake to settle.
    await orch.waitForCompletion(id);

    const finalManifest = store.get(id)!;
    // At least one pending slot was flipped to aborted.
    const aborted = finalManifest.segmentSlots.filter(s => s.status === 'aborted');
    expect(aborted.length).toBeGreaterThan(0);
    // inFlight + aborted Sets cleaned up.
    expect(orch.isInFlight(id)).toBe(false);
    const internalAborted = (orch as unknown as { aborted: Set<string> }).aborted;
    expect(internalAborted.has(id)).toBe(false);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});

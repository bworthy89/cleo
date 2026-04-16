import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
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

describe('BroadcastOrchestrator.create', () => {
  it('returns manifest + first segment URLs synchronously', async () => {
    const orch = new BroadcastOrchestrator(
      makeMockLLM(), makeMockTTS(), makeStorage(), new BroadcastStore(),
    );
    const result = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    // 5 tracks → cold_open + 4 transitions + sign_off = 6 slots
    expect(result.manifest.segmentSlots).toHaveLength(6);
    expect(result.firstSegmentUrls).toHaveLength(3);
    expect(result.firstSegmentUrls[0]).toMatch(/^https:\/\/cdn\/broadcast\/.+\/segment\/0\/v0\.mp3$/);
  });

  it('marks first slot ready in the store immediately', async () => {
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(), makeMockTTS(), makeStorage(), store,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    const stored = store.get(manifest.broadcastId)!;
    expect(stored.segmentSlots[0].status).toBe('ready');
    expect(stored.segmentSlots[0].audioUrls).toHaveLength(3);
  });

  it('schedules async generation of remaining slots', async () => {
    const llm = makeMockLLM();
    const tts = makeMockTTS();
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(llm, tts, makeStorage(), store);

    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });

    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    for (const slot of final.segmentSlots) {
      expect(slot.status).toBe('ready');
    }
    // 3 for cold_open + 1 each for 4 transitions + 1 for sign_off = 8 LLM calls
    expect(llm.generate).toHaveBeenCalledTimes(8);
  });

  it('marks individual slots as failed on provider errors without rejecting create()', async () => {
    const llm = makeMockLLM();
    (llm.generate as jest.Mock).mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => { throw new Error('llm exploded'); })
      .mockImplementation(async () => ({ text: 'ok' }));

    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(llm, makeMockTTS(), makeStorage(), store);
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
    const orch = new BroadcastOrchestrator(
      makeMockLLM(), makeMockTTS(), makeStorage(), new BroadcastStore(),
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

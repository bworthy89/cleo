import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
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

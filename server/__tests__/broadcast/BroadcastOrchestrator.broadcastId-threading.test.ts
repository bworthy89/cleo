import { BroadcastOrchestrator } from '../../src/services/broadcast/BroadcastOrchestrator';

describe('BroadcastOrchestrator threads broadcastId into sequence()', () => {
  it('sequencer receives the manifest.broadcastId', async () => {
    const captured: string[] = [];
    const fakeSequencer = {
      async sequence(req: any) {
        captured.push(req.broadcastId);
        return {
          orderedTracks: req.pool.slice(0, 5),
          featureSlots: [],
          source: 'deterministic' as const,
        };
      },
    };
    const orch = BroadcastOrchestrator.makeWithDefaults({
      sequencer: fakeSequencer,
      generator: { generateVariants: async () => [] },
      backgroundEnricher: { drainNow: async () => {} },
    });

    const pool = Array.from({ length: 5 }, (_, i) => ({
      id: String(i), title: 't' + i, artistName: 'A', albumTitle: 'B', duration: 200,
    })) as any;
    const result = await orch.create({
      userId: 'u1', playlistId: 'p', vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: '22:00', dayOfWeek: 'Mon', firstTimeUser: false },
      tracks: pool,
    } as any);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(result.manifest.broadcastId);
    await orch.waitForCompletion(result.manifest.broadcastId);
  });
});

import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { EventRecorder } from '@/services/events/EventRecorder';
import { Db } from '@/services/db/Db';
import type { LLMCaller, TTSCaller } from '@/services/broadcast/SegmentGenerator';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import type { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import type { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';

// Pin to the LLM sequencer path — the noop LLM returns non-JSON which triggers
// LLMTrackSequencer's fallback-to-slice, but that's fine for event-recording
// tests. Without this pin the DeterministicTrackSequencer runs and asserts
// that every track has audio features (which noopFetchChain doesn't provide).
const ORIGINAL_SEQUENCER_MODE = process.env.SEQUENCER_MODE;
beforeAll(() => { process.env.SEQUENCER_MODE = 'llm'; });
afterAll(() => {
  if (ORIGINAL_SEQUENCER_MODE === undefined) delete process.env.SEQUENCER_MODE;
  else process.env.SEQUENCER_MODE = ORIGINAL_SEQUENCER_MODE;
});

describe('BroadcastOrchestrator events', () => {
  it('records broadcast_started for a user-driven bake', async () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const cache = new EnrichmentCache(db);
    const recorder = new EventRecorder(db);
    const noopLLM: LLMCaller = { generate: async () => ({ text: 'hello' }) };
    const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: 'AA' }) };
    const noopStorage: ObjectStorage = { put: async (key) => `noop://${key}` };
    const enricher = { drainNow: async () => {} } as unknown as BackgroundEnricher;
    const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
    const orch = new BroadcastOrchestrator(
      noopLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
      undefined, undefined, recorder,
    );
    try {
      await orch.create({
        userId: 'u1', userEmail: 'a@b.c',
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon', firstTimeUser: false },
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't2', title: 'T2', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't3', title: 'T3', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't4', title: 'T4', artistName: 'A', albumTitle: 'Al', duration: 200 },
        ],
      });
    } catch { /* may throw if downstream dies; we only care about the started event */ }
    const row = db.prepare<{ event_type: string; user_id: string; payload_json: string }>(
      "SELECT event_type, user_id, payload_json FROM app_events WHERE event_type = 'broadcast_started'",
    ).get();
    expect(row).toBeDefined();
    expect(row!.user_id).toBe('u1');
    expect(JSON.parse(row!.payload_json).source).toBe('user');
    db.close();
  });

  it('records source=featured for curator-driven bakes', async () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const cache = new EnrichmentCache(db);
    const recorder = new EventRecorder(db);
    const noopLLM: LLMCaller = { generate: async () => ({ text: 'hello' }) };
    const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: 'AA' }) };
    const noopStorage: ObjectStorage = { put: async (key) => `noop://${key}` };
    const enricher = { drainNow: async () => {} } as unknown as BackgroundEnricher;
    const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
    const orch = new BroadcastOrchestrator(
      noopLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
      undefined, undefined, recorder,
    );
    try {
      await orch.create({
        userId: 'curator',
        playlistId: null, vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon', firstTimeUser: false },
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't2', title: 'T2', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't3', title: 'T3', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't4', title: 'T4', artistName: 'A', albumTitle: 'Al', duration: 200 },
        ],
      });
    } catch { /* same tolerance */ }
    const row = db.prepare<{ payload_json: string }>(
      "SELECT payload_json FROM app_events WHERE event_type = 'broadcast_started'",
    ).get();
    expect(JSON.parse(row!.payload_json).source).toBe('featured');
    db.close();
  });

  it('records broadcast_completed after a successful bake', async () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const cache = new EnrichmentCache(db);
    const recorder = new EventRecorder(db);
    const noopLLM: LLMCaller = { generate: async () => ({ text: 'hello world' }) };
    const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: 'AA==' }) };
    const noopStorage: ObjectStorage = { put: async (key) => `noop://${key}` };
    const enricher = { drainNow: async () => {} } as unknown as BackgroundEnricher;
    const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
    const orch = new BroadcastOrchestrator(
      noopLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
      undefined, undefined, recorder,
    );
    const { manifest } = await orch.create({
      userId: 'u1',
      playlistId: 'p1', vibe: 'morning', length: 'quick',
      userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon', firstTimeUser: false },
      tracks: [
        { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'Al', duration: 200 },
        { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'Al', duration: 200 },
        { id: 't2', title: 'T2', artistName: 'A', albumTitle: 'Al', duration: 200 },
        { id: 't3', title: 'T3', artistName: 'A', albumTitle: 'Al', duration: 200 },
        { id: 't4', title: 'T4', artistName: 'A', albumTitle: 'Al', duration: 200 },
      ],
    });
    await orch.waitForCompletion(manifest.broadcastId);

    const completed = db.prepare<{ n: number }>(
      "SELECT COUNT(*) AS n FROM app_events WHERE event_type = 'broadcast_completed'",
    ).get()!;
    const failed = db.prepare<{ n: number }>(
      "SELECT COUNT(*) AS n FROM app_events WHERE event_type = 'broadcast_failed'",
    ).get()!;
    expect(completed.n).toBe(1);
    expect(failed.n).toBe(0);
    db.close();
  });

  it('records broadcast_failed when the bake throws', async () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const cache = new EnrichmentCache(db);
    const recorder = new EventRecorder(db);
    const throwingLLM: LLMCaller = {
      generate: async () => { throw new Error('LLM down'); },
    };
    const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: 'AA==' }) };
    const noopStorage: ObjectStorage = { put: async (key) => `noop://${key}` };
    const enricher = { drainNow: async () => {} } as unknown as BackgroundEnricher;
    const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
    const orch = new BroadcastOrchestrator(
      throwingLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
      undefined, undefined, recorder,
    );
    try {
      await orch.create({
        userId: 'u1',
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon', firstTimeUser: false },
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't2', title: 'T2', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't3', title: 'T3', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't4', title: 'T4', artistName: 'A', albumTitle: 'Al', duration: 200 },
        ],
      });
    } catch { /* expected — slot 0 throws via the throwing LLM */ }

    const failed = db.prepare<{ n: number; payload_json: string }>(
      "SELECT COUNT(*) AS n, payload_json FROM app_events WHERE event_type = 'broadcast_failed' GROUP BY payload_json",
    ).all();
    expect(failed.length).toBeGreaterThanOrEqual(1);
    // The slot-0 outer-catch path should record slotIndex: 0
    const hasSlot0 = failed.some(r => JSON.parse(r.payload_json).slotIndex === 0);
    expect(hasSlot0).toBe(true);
    db.close();
  });
});

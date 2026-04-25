import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import express from 'express';
import request from 'supertest';
import { createBroadcastRouter } from '@/routes/broadcast';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { Manifest } from '@/services/broadcast/types';

const noopFetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
const makeStorage = () => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as unknown as { uid: string }).uid = uid; next(); };

const buildApp = (
  orch: BroadcastOrchestrator,
  store: BroadcastStore,
  uid = 'uid-123',
) => {
  const app = express();
  app.use(express.json());
  app.use(authStub(uid));
  app.use(createBroadcastRouter(orch, store));
  return app;
};

const makeManifest = (broadcastId: string, userId: string): Manifest => ({
  broadcastId, userId, playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready' },
    { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
  ],
});

describe('DELETE /broadcast/:id', () => {
  let orch: BroadcastOrchestrator;
  let store: BroadcastStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'broadcast-delete-'));
    const enrichCache = new EnrichmentCache(path.join(tmpDir, 'tracks.json'));
    await enrichCache.load();
    const enricher = new BackgroundEnricher(enrichCache, {
      fetchGenius: jest.fn(async () => null),
      fetchMusicBrainz: jest.fn(async () => null),
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
    });
    store = new BroadcastStore();
    orch = new BroadcastOrchestrator(
      makeMockLLM(JSON.stringify({ ordered: ['t0'] })), makeMockTTS(), makeStorage(),
      store, enrichCache, enricher, noopFetchChain,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 404 for unknown broadcast id', async () => {
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-owner uid (no existence leak)', async () => {
    store.put(makeManifest('b1', 'someone-else'));
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(404);
  });

  it('returns 404 for curator-baked broadcast (strict ownership)', async () => {
    store.put(makeManifest('b1', 'curator'));
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(404);
  });

  it('returns 204 on successful abort and marks pending slots aborted', async () => {
    store.put(makeManifest('b1', 'uid-123'));
    // Insert a never-resolving promise so abortBake's inFlight check passes.
    const inFlight = (orch as unknown as { inFlight: Map<string, Promise<void>> }).inFlight;
    inFlight.set('b1', new Promise(() => {}));

    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(204);

    const m = store.get('b1')!;
    expect(m.segmentSlots[0].status).toBe('ready');
    expect(m.segmentSlots[1].status).toBe('aborted');
  });

  it('returns 204 idempotently when nothing in flight', async () => {
    store.put(makeManifest('b1', 'uid-123'));
    // No inFlight entry — abortBake returns false but the route still 204s.
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(204);
  });
});

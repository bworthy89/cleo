import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import express from 'express';
import request from 'supertest';
import { createBroadcastRouter } from '@/routes/broadcast';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { Db } from '@/services/db/Db';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ManifestTrack } from '@/services/broadcast/types';

// Pin to the LLM sequencer so the mocked SEQUENCER_RESPONSE is used.
const ORIGINAL_SEQUENCER_MODE = process.env.SEQUENCER_MODE;
beforeAll(() => { process.env.SEQUENCER_MODE = 'llm'; });
afterAll(() => {
  if (ORIGINAL_SEQUENCER_MODE === undefined) delete process.env.SEQUENCER_MODE;
  else process.env.SEQUENCER_MODE = ORIGINAL_SEQUENCER_MODE;
});

const noopFetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;

const makeStorage = () => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

const tracks = (n: number): ManifestTrack[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Title ${i}`, artistName: `Artist ${i}`,
    albumTitle: 'Album', duration: 200,
  }));

const SEQUENCER_RESPONSE = JSON.stringify({
  ordered: ['t0', 't1', 't2', 't3', 't4'],
});

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as any).uid = uid; next(); };

const buildApp = (orch: BroadcastOrchestrator, store: BroadcastStore) => {
  const app = express();
  app.use(express.json());
  app.use(authStub('uid-123'));
  app.use(createBroadcastRouter(orch, store));
  return app;
};

describe('broadcast router', () => {
  let orch: BroadcastOrchestrator;
  let store: BroadcastStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'broadcast-route-'));
    const enrichCache = new EnrichmentCache(path.join(tmpDir, 'tracks.json'));
    await enrichCache.load();
    const enricher = new BackgroundEnricher(enrichCache, {
      fetchGenius: jest.fn(async () => null),
      fetchMusicBrainz: jest.fn(async () => null),
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
    });
    store = new BroadcastStore(new Db(':memory:'));
    orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      store, enrichCache, enricher, noopFetchChain,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('POST /broadcast/create returns manifest + firstSegmentUrls', async () => {
    const app = buildApp(orch, store);
    const res = await request(app)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(10),
      });

    expect(res.status).toBe(200);
    expect(res.body.manifest.broadcastId).toBeDefined();
    expect(res.body.manifest.userId).toBe('uid-123');
    expect(res.body.firstSegmentUrls).toHaveLength(1);
  });

  it('POST /broadcast/create 400s on invalid body', async () => {
    const app = buildApp(orch, store);
    const res = await request(app)
      .post('/broadcast/create')
      .send({ playlistId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('POST /broadcast/create 400s on insufficient tracks', async () => {
    const app = buildApp(orch, store);
    const res = await request(app)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(3),
      });
    expect(res.status).toBe(400);
  });

  it('GET /broadcast/:id/manifest returns the live manifest', async () => {
    const app = buildApp(orch, store);
    const create = await request(app)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(10),
      });
    const id = create.body.manifest.broadcastId;

    const res = await request(app).get(`/broadcast/${id}/manifest`);
    expect(res.status).toBe(200);
    expect(res.body.broadcastId).toBe(id);
  });

  it('GET /broadcast/:id/manifest returns 404 for unknown id', async () => {
    const app = buildApp(orch, store);
    const res = await request(app).get('/broadcast/nope/manifest');
    expect(res.status).toBe(404);
  });

  it('GET /broadcast/:id/manifest returns 404 for broadcast owned by another uid', async () => {
    const ownerApp = (() => {
      const a = express();
      a.use(express.json());
      a.use(authStub('owner-uid'));
      a.use(createBroadcastRouter(orch, store));
      return a;
    })();
    const create = await request(ownerApp)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(10),
      });
    const id = create.body.manifest.broadcastId;

    const attackerApp = (() => {
      const a = express();
      a.use(express.json());
      a.use(authStub('attacker-uid'));
      a.use(createBroadcastRouter(orch, store));
      return a;
    })();
    const res = await request(attackerApp).get(`/broadcast/${id}/manifest`);
    expect(res.status).toBe(404);
  });

  it('GET /broadcast/:id/manifest allows any uid for curator-owned (featured) broadcasts', async () => {
    const curatorApp = (() => {
      const a = express();
      a.use(express.json());
      a.use(authStub('curator'));
      a.use(createBroadcastRouter(orch, store));
      return a;
    })();
    const create = await request(curatorApp)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(10),
      });
    const id = create.body.manifest.broadcastId;

    const otherApp = (() => {
      const a = express();
      a.use(express.json());
      a.use(authStub('random-user'));
      a.use(createBroadcastRouter(orch, store));
      return a;
    })();
    const res = await request(otherApp).get(`/broadcast/${id}/manifest`);
    expect(res.status).toBe(200);
    expect(res.body.broadcastId).toBe(id);
  });
});

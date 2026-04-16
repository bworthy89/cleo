import express from 'express';
import request from 'supertest';
import { createBroadcastRouter } from '@/routes/broadcast';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ManifestTrack } from '@/services/broadcast/types';

const makeStorage = () => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

const tracks = (n: number): ManifestTrack[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Title ${i}`, artistName: `Artist ${i}`,
    albumTitle: 'Album', duration: 200,
  }));

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

  beforeEach(() => {
    store = new BroadcastStore();
    orch = new BroadcastOrchestrator(makeMockLLM(), makeMockTTS(), makeStorage(), store);
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
    expect(res.body.firstSegmentUrls).toHaveLength(3);
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
});

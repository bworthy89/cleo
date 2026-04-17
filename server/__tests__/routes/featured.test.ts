import express from 'express';
import request from 'supertest';
import { createFeaturedRouter } from '@/routes/featured';
import { FeaturedBroadcastRegistry } from '@/services/broadcast/FeaturedBroadcastRegistry';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as express.Request & { uid?: string }).uid = uid; next(); };

describe('featured router', () => {
  let reg: FeaturedBroadcastRegistry;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'featured-'));
    reg = new FeaturedBroadcastRegistry(path.join(dir, 'registry.json'));
    await reg.load();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use(authStub('u1'));
    app.use(createFeaturedRouter(reg));
    return app;
  };

  it('returns an empty array when nothing is baked', async () => {
    const res = await request(buildApp()).get('/broadcast/featured');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ broadcasts: [] });
  });

  it('returns baked featured broadcasts in list form', async () => {
    await reg.put({
      id: 'a', title: 'A', description: 'd', vibe: 'morning', length: 'quick',
      baked: true, createdAt: 1,
      manifest: { broadcastId: 'a', userId: 'curator', playlistId: null,
        vibe: 'morning', length: 'quick', createdAt: 1, tracks: [], segmentSlots: [] },
    });
    const res = await request(buildApp()).get('/broadcast/featured');
    expect(res.status).toBe(200);
    expect(res.body.broadcasts).toHaveLength(1);
    expect(res.body.broadcasts[0]).toEqual(expect.objectContaining({
      id: 'a', title: 'A', manifest: expect.any(Object),
    }));
  });
});

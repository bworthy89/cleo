import express from 'express';
import request from 'supertest';
import { createFeaturedRouter } from '@/routes/featured';
import { FeaturedBroadcastRegistry } from '@/services/broadcast/FeaturedBroadcastRegistry';
import type { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as express.Request & { uid?: string }).uid = uid; next(); };

function stubOrchestrator(): BroadcastOrchestrator {
  const manifest = {
    broadcastId: 'bake-1', userId: 'curator', playlistId: null,
    vibe: 'morning' as const, length: 'standard' as const,
    createdAt: 1, tracks: [], segmentSlots: [],
  };
  return {
    create: jest.fn().mockResolvedValue({ manifest }),
    waitForCompletion: jest.fn().mockResolvedValue(undefined),
    getManifest: jest.fn().mockReturnValue(manifest),
  } as unknown as BroadcastOrchestrator;
}

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

  const slotBody = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'slot_morning',
    slot: 'morning',
    themeDay: 'mon',
    title: 'Monday Reset',
    description: 'Slow start. Coffee first, noise later.',
    vibe: 'morning',
    length: 'standard',
    tracks: Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, title: `T${i}`, artistName: 'A', albumTitle: '',
      duration: 180,
    })),
    ...over,
  });

  const curatorApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { uid?: string; email?: string }).uid = 'u1';
      (req as express.Request & { uid?: string; email?: string }).email = 'bworthy89@gmail.com';
      next();
    });
    app.use(createFeaturedRouter(reg, stubOrchestrator()));
    return app;
  };

  it('accepts slot + themeDay + matching id', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(slotBody());
    expect(res.status).toBe(200);
  });

  it('rejects slot present without themeDay', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const body = slotBody(); delete (body as Record<string, unknown>).themeDay;
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(body);
    expect(res.status).toBe(400);
  });

  it('rejects id that does not match slot_${slot}', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp())
      .post('/broadcast/featured/publish').send(slotBody({ id: 'slot_evening' }));
    expect(res.status).toBe(400);
  });

  it('rejects vibe/length that does not match the theme', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp())
      .post('/broadcast/featured/publish').send(slotBody({ vibe: 'party' }));
    expect(res.status).toBe(400);
  });

  it('rejects free-form publish with reserved id (slot_*)', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const body = slotBody({ id: 'slot_morning' });
    delete (body as Record<string, unknown>).slot;
    delete (body as Record<string, unknown>).themeDay;
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(body);
    expect(res.status).toBe(400);
  });

  it('persists slot + themeDay on the registry record', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(slotBody());
    expect(res.status).toBe(200);
    const stored = reg.getBySlot('morning');
    expect(stored?.slot).toBe('morning');
    expect(stored?.themeDay).toBe('mon');
  });
});

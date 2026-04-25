import express, { type RequestHandler } from 'express';
import request from 'supertest';
import {
  CuratorPublishBudget,
  makeCuratorPublishBudgetMiddleware,
} from '@/services/curator/CuratorPublishBudget';
import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';

const stubUid = (uid: string | undefined): RequestHandler => (req, _res, next) => {
  if (uid !== undefined) (req as unknown as { uid: string }).uid = uid;
  next();
};

const buildApp = (uid: string | undefined, middleware: RequestHandler) => {
  const app = express();
  app.use(express.json());
  app.use(stubUid(uid));
  app.use(middleware);
  app.post('/test', (_req, res) => res.json({ ok: true }));
  return app;
};

describe('makeCuratorPublishBudgetMiddleware', () => {
  let telemetrySpy: jest.SpyInstance;

  beforeEach(() => {
    telemetrySpy = jest
      .spyOn(bakeTelemetry, 'recordPublishCapHit')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    telemetrySpy.mockRestore();
  });

  it('passes requests through under cap', async () => {
    const budget = new CuratorPublishBudget({
      capPerWindow: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const app = buildApp('curator-1', makeCuratorPublishBudgetMiddleware(budget));
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/test').send({});
      expect(res.status).toBe(200);
    }
    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After header and retryAfterMs body at cap', async () => {
    const budget = new CuratorPublishBudget({
      capPerWindow: 3,
      windowMs: 60 * 60 * 1000, // 1h
    });
    const app = buildApp('curator-1', makeCuratorPublishBudgetMiddleware(budget));
    for (let i = 0; i < 3; i++) {
      await request(app).post('/test').send({});
    }
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(429);
    // Retry-After is integer seconds; with a 1h window it should be ~3600.
    const retryAfterSec = Number(res.headers['retry-after']);
    expect(Number.isInteger(retryAfterSec)).toBe(true);
    expect(retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(retryAfterSec).toBeLessThanOrEqual(3600);
    expect(typeof res.body.retryAfterMs).toBe('number');
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toContain('3');     // cap interpolated
    expect(res.body.error).toContain('1h');    // window phrasing — see note below
  });

  it('calls bakeTelemetry.recordPublishCapHit exactly once on rejection', async () => {
    const budget = new CuratorPublishBudget({
      capPerWindow: 1,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const app = buildApp('curator-1', makeCuratorPublishBudgetMiddleware(budget));
    await request(app).post('/test').send({});       // accepted
    await request(app).post('/test').send({});       // rejected
    expect(telemetrySpy).toHaveBeenCalledTimes(1);
    expect(telemetrySpy).toHaveBeenCalledWith({
      uid: 'curator-1',
      current: 1,
      retryAfterMs: expect.any(Number),
    });
  });

  it('returns 500 when req.uid is unset (defensive — auth chain misconfigured)', async () => {
    const budget = new CuratorPublishBudget({
      capPerWindow: 3,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const app = buildApp(undefined, makeCuratorPublishBudgetMiddleware(budget));
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/uid/i);
    expect(telemetrySpy).not.toHaveBeenCalled();
  });
});

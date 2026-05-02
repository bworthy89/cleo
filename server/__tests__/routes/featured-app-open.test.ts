import express from 'express';
import request from 'supertest';
import { createFeaturedRouter } from '@/routes/featured';
import { FeaturedBroadcastRegistry } from '@/services/broadcast/FeaturedBroadcastRegistry';
import { EventRecorder } from '@/services/events/EventRecorder';
import { Db } from '@/services/db/Db';

describe('GET /broadcast/featured app_open piggyback', () => {
  it('records an app_open event with default headers', async () => {
    const db = new Db(':memory:');
    const registry = new FeaturedBroadcastRegistry(db);
    const recorder = new EventRecorder(db);
    const app = express();
    // Stub auth: attach a fixed uid to req so the route's req.uid check passes.
    app.use((req, _res, next) => { (req as { uid?: string }).uid = 'u1'; next(); });
    app.use(createFeaturedRouter(registry, undefined, undefined, undefined, recorder));
    const res = await request(app).get('/broadcast/featured');
    expect(res.status).toBe(200);
    const row = db.prepare<{ user_id: string; payload_json: string }>(
      'SELECT user_id, payload_json FROM app_events',
    ).get();
    expect(row.user_id).toBe('u1');
    expect(JSON.parse(row.payload_json).platform).toBe('ios');
    db.close();
  });

  it('reads platform/version/build from request headers', async () => {
    const db = new Db(':memory:');
    const registry = new FeaturedBroadcastRegistry(db);
    const recorder = new EventRecorder(db);
    const app = express();
    app.use((req, _res, next) => { (req as { uid?: string }).uid = 'u2'; next(); });
    app.use(createFeaturedRouter(registry, undefined, undefined, undefined, recorder));
    const res = await request(app)
      .get('/broadcast/featured')
      .set('x-cleo-platform', 'android')
      .set('x-cleo-app-version', '1.2.3')
      .set('x-cleo-build-number', '99');
    expect(res.status).toBe(200);
    const row = db.prepare<{ payload_json: string }>(
      'SELECT payload_json FROM app_events',
    ).get();
    expect(JSON.parse(row.payload_json)).toEqual({
      appVersion: '1.2.3',
      platform: 'android',
      buildNumber: 99,
    });
    db.close();
  });

  it('returns 200 even if the recorder is omitted', async () => {
    const db = new Db(':memory:');
    const registry = new FeaturedBroadcastRegistry(db);
    const app = express();
    app.use((req, _res, next) => { (req as { uid?: string }).uid = 'u3'; next(); });
    app.use(createFeaturedRouter(registry));
    const res = await request(app).get('/broadcast/featured');
    expect(res.status).toBe(200);
    db.close();
  });
});

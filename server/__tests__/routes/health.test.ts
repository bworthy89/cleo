import express from 'express';
import request from 'supertest';
import { createPublicHealthRouter } from '@/routes/health';

describe('GET /health/public', () => {
  function makeApp(opts: {
    ttsStatus: { active: string; primary: { healthy: boolean }; fallback: { healthy: boolean }; tertiary: { healthy: boolean } };
    inFlightCount: number;
  }) {
    const app = express();
    const router = createPublicHealthRouter({
      getTtsStatus: () => ({
        active: opts.ttsStatus.active,
        primary: { name: 'voxcpm', healthy: opts.ttsStatus.primary.healthy, lastCheck: null },
        fallback: { name: 'cartesia', healthy: opts.ttsStatus.fallback.healthy, lastCheck: null },
        tertiary: { name: 'elevenlabs', healthy: opts.ttsStatus.tertiary.healthy, lastCheck: null },
      }),
      getInFlightCount: () => opts.inFlightCount,
    });
    app.use(router);
    return app;
  }

  it('returns operational when primary TTS healthy and queue light', async () => {
    const app = makeApp({
      ttsStatus: { active: 'voxcpm', primary: { healthy: true }, fallback: { healthy: true }, tertiary: { healthy: true } },
      inFlightCount: 0,
    });
    const res = await request(app).get('/health/public');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.status).toBe('operational');
    expect(res.body.components.tts.status).toBe('operational');
    expect(res.body.components.bake.queueDepth).toBe(0);
  });

  it('returns degraded when primary down but fallback healthy', async () => {
    const app = makeApp({
      ttsStatus: { active: 'cartesia', primary: { healthy: false }, fallback: { healthy: true }, tertiary: { healthy: true } },
      inFlightCount: 1,
    });
    const res = await request(app).get('/health/public');
    expect(res.body.status).toBe('degraded');
    expect(res.body.components.tts.status).toBe('degraded');
  });

  it('returns major when primary and fallback both down', async () => {
    const app = makeApp({
      ttsStatus: { active: 'cartesia', primary: { healthy: false }, fallback: { healthy: false }, tertiary: { healthy: true } },
      inFlightCount: 0,
    });
    const res = await request(app).get('/health/public');
    expect(res.body.status).toBe('major');
    expect(res.body.components.tts.status).toBe('major');
  });

  it('returns degraded when bake queue is backed up regardless of TTS', async () => {
    const app = makeApp({
      ttsStatus: { active: 'voxcpm', primary: { healthy: true }, fallback: { healthy: true }, tertiary: { healthy: true } },
      inFlightCount: 8,
    });
    const res = await request(app).get('/health/public');
    expect(res.body.status).toBe('degraded');
    expect(res.body.components.bake.status).toBe('degraded');
  });

  it('does not require auth', async () => {
    const app = makeApp({
      ttsStatus: { active: 'voxcpm', primary: { healthy: true }, fallback: { healthy: true }, tertiary: { healthy: true } },
      inFlightCount: 0,
    });
    const res = await request(app).get('/health/public');
    expect(res.status).toBe(200);
  });
});

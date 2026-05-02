import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAdminRouter } from '@/routes/admin';
import type { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import type { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';

function makeApp(opts: { sentinelDir: string }) {
  const app = express();
  // Stub auth so the gate passes — adminGate() accepts X-Admin-Token OR
  // a Firebase+curator JWT. We stub a uid/curatorEmail in dev.
  process.env.ADMIN_BEARER_TOKEN = 'test-token-at-least-16-chars-long';
  process.env.BACKUP_SENTINEL_DIR = opts.sentinelDir;
  const router = createAdminRouter({
    store: { size: () => 0 } as unknown as BroadcastStore,
    orch: { inFlightCount: 0 } as unknown as BroadcastOrchestrator,
    llm: { getStatus: () => ({}) },
    tts: { getStatus: () => ({}) },
    logDir: '/tmp/no-such-logs',
  });
  app.use('/admin', router);
  return app;
}

describe('GET /admin/status — lastBackupMinutesAgo', () => {
  it('returns null when sentinel file does not exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleo-backup-test-'));
    const app = makeApp({ sentinelDir: dir });
    const res = await request(app)
      .get('/admin/status')
      .set('X-Admin-Token', 'test-token-at-least-16-chars-long');
    expect(res.status).toBe(200);
    expect(res.body.lastBackupMinutesAgo).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns minutes since the sentinel mtime when present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleo-backup-test-'));
    const sentinel = path.join(dir, 'last-success');
    // Set mtime to 5 minutes ago.
    const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;
    fs.writeFileSync(sentinel, '');
    fs.utimesSync(sentinel, fiveMinAgo, fiveMinAgo);
    const app = makeApp({ sentinelDir: dir });
    const res = await request(app)
      .get('/admin/status')
      .set('X-Admin-Token', 'test-token-at-least-16-chars-long');
    expect(res.status).toBe(200);
    // Should be 5 ± 1 (rounding tolerance for the test runner's jitter).
    expect(res.body.lastBackupMinutesAgo).toBeGreaterThanOrEqual(4);
    expect(res.body.lastBackupMinutesAgo).toBeLessThanOrEqual(6);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

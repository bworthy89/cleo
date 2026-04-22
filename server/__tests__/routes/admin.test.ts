import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock requireAuth at module-load time — the real implementation does JWT
// verification against Firebase JWKS, which tests shouldn't exercise. The
// stub treats `req.uid` being pre-populated (by our authStub middleware) as
// the "authenticated" signal; absence → 401 with the same shape the real
// middleware returns.
jest.mock('@/middleware/auth', () => {
  const actual = jest.requireActual('@/middleware/auth');
  return {
    ...actual,
    requireAuth: (
      req: express.Request & { uid?: string },
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!req.uid) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
      }
      next();
    },
  };
});

import {
  createAdminRouter,
  readLogTail,
  interleaveByTimestamp,
  filterAndTail,
} from '@/routes/admin';
import type { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import type { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';

/** Inject uid + email the same way requireAuth would, without needing a
 *  real Firebase JWT. Mirrors the pattern used in featured.test.ts. */
const authStub = (uid: string, email: string): express.RequestHandler =>
  (req, _res, next) => {
    const r = req as express.Request & { uid?: string; email?: string };
    r.uid = uid;
    r.email = email;
    next();
  };

function stubDeps(logDir: string): {
  store: BroadcastStore;
  orch: BroadcastOrchestrator;
  llm: { getStatus(): unknown };
  tts: { getStatus(): unknown };
} {
  return {
    store: { size: () => 3 } as unknown as BroadcastStore,
    orch: { inFlightCount: () => 1 } as unknown as BroadcastOrchestrator,
    llm: { getStatus: () => ({ primary: 'gemini', healthy: true }) },
    tts: { getStatus: () => ({ primary: 'cosyvoice', healthy: true }) },
  };
}

describe('admin router — pure helpers', () => {
  describe('readLogTail', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-log-'));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns all lines when file is smaller than the window', async () => {
      const file = path.join(dir, 'small.log');
      await fs.writeFile(file, 'a\nb\nc\n');
      const lines = await readLogTail(file, 1024);
      expect(lines).toEqual(['a', 'b', 'c']);
    });

    it('drops the first partial line when bounded by maxBytes', async () => {
      const file = path.join(dir, 'big.log');
      // Each line is padded to 20 chars so we can reason about byte offsets.
      const full = Array.from({ length: 10 }, (_, i) => `line-${String(i).padStart(2, '0')}${'x'.repeat(12)}`).join('\n') + '\n';
      await fs.writeFile(file, full);
      // 50-byte tail cuts mid-line; the helper must discard the partial.
      const lines = await readLogTail(file, 50);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.startsWith('line-')).toBe(true);
      }
    });

    it('returns [] for an empty file', async () => {
      const file = path.join(dir, 'empty.log');
      await fs.writeFile(file, '');
      expect(await readLogTail(file, 1024)).toEqual([]);
    });

    it('throws when the file does not exist', async () => {
      await expect(readLogTail(path.join(dir, 'nope.log'), 1024))
        .rejects.toThrow();
    });

    it('does not emit null bytes if the file is truncated between stat() and read()', async () => {
      // Buffer.alloc zero-fills the read buffer. If read() returns fewer
      // bytes than the pre-sized buffer (race with log rotation, concurrent
      // truncate, etc.), the unread tail becomes \0 chars in the decoded
      // string. The fix slices to bytesRead; this regression test pins it.
      const realStat = fsSync.promises.stat;
      const spy = jest.spyOn(fsSync.promises, 'stat').mockImplementation(async (p: fsSync.PathLike) => {
        const s = await realStat(p);
        // Inflate the reported size so bytesToRead overshoots the real file.
        (s as fsSync.Stats & { size: number }).size = s.size + 64;
        return s;
      });
      try {
        const file = path.join(dir, 'truncated.log');
        await fs.writeFile(file, 'line1\nline2\n');
        const lines = await readLogTail(file, 1024);
        expect(lines).toEqual(['line1', 'line2']);
        for (const line of lines) {
          expect(line.includes('\0')).toBe(false);
        }
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('interleaveByTimestamp', () => {
    it('sorts out + err lines by PM2 timestamp prefix and tags the source', () => {
      const out = [
        '2026-04-22 10:00:00 +0000: out-first',
        '2026-04-22 10:00:05 +0000: out-third',
      ];
      const err = [
        '2026-04-22 10:00:02 +0000: err-second',
      ];
      const merged = interleaveByTimestamp(out, err);
      expect(merged).toEqual([
        '[out] 2026-04-22 10:00:00 +0000: out-first',
        '[err] 2026-04-22 10:00:02 +0000: err-second',
        '[out] 2026-04-22 10:00:05 +0000: out-third',
      ]);
    });

    it('places lines without a parseable timestamp at a deterministic position', () => {
      const out = ['2026-04-22 10:00:05 +0000: later', 'no-timestamp-line'];
      const err: string[] = [];
      const merged = interleaveByTimestamp(out, err);
      // String sort puts '2026...' before 'no-tim...' (digit < letter), so
      // undated lines fall to the bottom. Deterministic and readable.
      expect(merged).toEqual([
        '[out] 2026-04-22 10:00:05 +0000: later',
        '[out] no-timestamp-line',
      ]);
    });
  });

  describe('filterAndTail', () => {
    const lines = [
      '[bake id=AAAAAAAA user=a@x.com] start',
      '[bake id=BBBBBBBB user=b@x.com] start',
      '[bake id=AAAAAAAA user=a@x.com] sequencer',
      '[bake id=AAAAAAAA user=a@x.com] done',
      '[bake id=BBBBBBBB user=b@x.com] done',
    ];

    it('filters by user substring', () => {
      const out = filterAndTail(lines, { user: 'a@x.com', lines: 100 });
      expect(out).toHaveLength(3);
      expect(out.every(l => l.includes('a@x.com'))).toBe(true);
    });

    it('filters by id (AND) then caps to lines', () => {
      const out = filterAndTail(lines, { user: 'a@x.com', id: 'AAAAAAAA', lines: 2 });
      expect(out).toEqual([
        '[bake id=AAAAAAAA user=a@x.com] sequencer',
        '[bake id=AAAAAAAA user=a@x.com] done',
      ]);
    });

    it('treats filter inputs as literal substrings (no regex)', () => {
      // A string with regex special chars should match itself literally.
      const withMeta = ['ok', 'match: .* (a+)+$', 'also ok'];
      const out = filterAndTail(withMeta, { user: '.* (a+)+$', lines: 100 });
      expect(out).toEqual(['match: .* (a+)+$']);
    });
  });
});

describe('admin router — HTTP', () => {
  let dir: string;
  let origCuratorEmails: string | undefined;
  let origAdminToken: string | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-http-'));
    origCuratorEmails = process.env.CURATOR_EMAILS;
    origAdminToken = process.env.ADMIN_BEARER_TOKEN;
    process.env.CURATOR_EMAILS = 'curator@x.com';
    // Leave ADMIN_BEARER_TOKEN unset for the Firebase+curator tests; the
    // adminGate describe below sets it explicitly for the token-path tests.
    delete process.env.ADMIN_BEARER_TOKEN;
  });

  afterEach(async () => {
    if (origCuratorEmails === undefined) delete process.env.CURATOR_EMAILS;
    else process.env.CURATOR_EMAILS = origCuratorEmails;
    if (origAdminToken === undefined) delete process.env.ADMIN_BEARER_TOKEN;
    else process.env.ADMIN_BEARER_TOKEN = origAdminToken;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const buildApp = (email: string) => {
    const app = express();
    app.use(authStub('uid-1', email));
    app.use(createAdminRouter({ ...stubDeps(dir), logDir: dir }));
    return app;
  };

  it('returns 403 for non-curator emails', async () => {
    const app = buildApp('random@x.com');
    const res = await request(app).get('/admin/logs');
    expect(res.status).toBe(403);
  });

  it('returns 200 with tailed log content for curator', async () => {
    await fs.writeFile(
      path.join(dir, 'out.log'),
      '[bake id=AAAAAAAA user=a@x.com] start\n' +
      '[bake id=BBBBBBBB user=b@x.com] start\n' +
      '[bake id=AAAAAAAA user=a@x.com] done\n',
    );
    const res = await request(buildApp('curator@x.com')).get('/admin/logs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('id=AAAAAAAA');
    expect(res.text).toContain('id=BBBBBBBB');
  });

  it('filters by user query param', async () => {
    await fs.writeFile(
      path.join(dir, 'out.log'),
      '[bake id=AAAAAAAA user=a@x.com] start\n' +
      '[bake id=BBBBBBBB user=b@x.com] start\n',
    );
    const res = await request(buildApp('curator@x.com'))
      .get('/admin/logs?user=a@x.com');
    expect(res.status).toBe(200);
    expect(res.text).toContain('a@x.com');
    expect(res.text).not.toContain('b@x.com');
  });

  it('uppercases id param before matching so tester-pasted uppercase matches', async () => {
    await fs.writeFile(
      path.join(dir, 'out.log'),
      '[bake id=A3F9K2X1 user=t@x.com] start\n' +
      '[bake id=OTHER001 user=t@x.com] start\n',
    );
    const res = await request(buildApp('curator@x.com'))
      .get('/admin/logs?id=a3f9k2x1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('A3F9K2X1');
    expect(res.text).not.toContain('OTHER001');
  });

  it('clamps lines to MAX_LINES and ignores non-numeric values', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => `line-${i}`).join('\n') + '\n';
    await fs.writeFile(path.join(dir, 'out.log'), many);
    const resCapped = await request(buildApp('curator@x.com'))
      .get('/admin/logs?lines=9999');
    const capped = resCapped.text.trim().split('\n');
    expect(capped.length).toBeLessThanOrEqual(2000);

    const resDefault = await request(buildApp('curator@x.com'))
      .get('/admin/logs?lines=notanumber');
    const def = resDefault.text.trim().split('\n');
    expect(def.length).toBe(200);
  });

  it('defaults invalid stream param to out', async () => {
    await fs.writeFile(path.join(dir, 'out.log'), 'only-out-line\n');
    await fs.writeFile(path.join(dir, 'error.log'), 'only-err-line\n');
    const res = await request(buildApp('curator@x.com'))
      .get('/admin/logs?stream=../etc/passwd');
    expect(res.status).toBe(200);
    expect(res.text).toContain('only-out-line');
    expect(res.text).not.toContain('only-err-line');
  });

  it('stream=err reads error.log only', async () => {
    await fs.writeFile(path.join(dir, 'out.log'), 'only-out-line\n');
    await fs.writeFile(path.join(dir, 'error.log'), 'only-err-line\n');
    const res = await request(buildApp('curator@x.com'))
      .get('/admin/logs?stream=err');
    expect(res.status).toBe(200);
    expect(res.text).toContain('only-err-line');
    expect(res.text).not.toContain('only-out-line');
  });

  it('stream=all interleaves both with source tags', async () => {
    await fs.writeFile(
      path.join(dir, 'out.log'),
      '2026-04-22 10:00:00 +0000: out-first\n',
    );
    await fs.writeFile(
      path.join(dir, 'error.log'),
      '2026-04-22 10:00:01 +0000: err-second\n',
    );
    const res = await request(buildApp('curator@x.com'))
      .get('/admin/logs?stream=all');
    expect(res.status).toBe(200);
    expect(res.text).toContain('[out]');
    expect(res.text).toContain('[err]');
    expect(res.text.indexOf('out-first')).toBeLessThan(res.text.indexOf('err-second'));
  });

  it('returns 200 with empty body when log file is missing (stream=all)', async () => {
    // No files written — tolerant via .catch(() => [])
    const res = await request(buildApp('curator@x.com'))
      .get('/admin/logs?stream=all');
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });

  it('returns 500 text when log file is missing (stream=out)', async () => {
    const res = await request(buildApp('curator@x.com'))
      .get('/admin/logs?stream=out');
    expect(res.status).toBe(500);
    expect(res.text).toMatch(/log read failed/);
  });

  it('/admin/status returns uptime, memory, broadcast counts, log sizes', async () => {
    await fs.writeFile(path.join(dir, 'out.log'), 'x'.repeat(1024));
    await fs.writeFile(path.join(dir, 'error.log'), 'y'.repeat(512));

    const res = await request(buildApp('curator@x.com')).get('/admin/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      status: 'ok',
      uptime: expect.any(Number),
      memory: expect.objectContaining({
        rssMB: expect.any(Number),
        heapUsedMB: expect.any(Number),
      }),
      broadcast: { inFlight: 1, storeSize: 3 },
      providers: expect.objectContaining({
        llm: expect.any(Object),
        tts: expect.any(Object),
      }),
      logs: { out: 1024, err: 512 },
    }));
  });

  it('/admin/status returns zero log sizes when files are missing', async () => {
    const res = await request(buildApp('curator@x.com')).get('/admin/status');
    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual({ out: 0, err: 0 });
  });

  it('/admin/status is curator-gated', async () => {
    const res = await request(buildApp('random@x.com')).get('/admin/status');
    expect(res.status).toBe(403);
  });

  it('returns 401 when no auth is established and admin token is unset', async () => {
    // No authStub → requireAuth stub sees no uid → 401. No ADMIN_BEARER_TOKEN
    // → admin-token path is inactive. This is the "completely unauthenticated"
    // case mirroring what a random browser hit would produce in production.
    const app = express();
    app.use(createAdminRouter({ ...stubDeps(dir), logDir: dir }));
    const res = await request(app).get('/admin/logs');
    expect(res.status).toBe(401);
  });
});

describe('adminGate — X-Admin-Token path', () => {
  let dir: string;
  let origAdminToken: string | undefined;
  const TOKEN = 'test-admin-token-do-not-use-in-prod';

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-tok-'));
    origAdminToken = process.env.ADMIN_BEARER_TOKEN;
    process.env.ADMIN_BEARER_TOKEN = TOKEN;
    // Ensure CURATOR_EMAILS is empty so a leaked request without the token
    // definitely falls through to 403, not accidentally curator-pass.
    delete process.env.CURATOR_EMAILS;
  });

  afterEach(async () => {
    if (origAdminToken === undefined) delete process.env.ADMIN_BEARER_TOKEN;
    else process.env.ADMIN_BEARER_TOKEN = origAdminToken;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const buildApp = () => {
    const app = express();
    // No authStub — the admin token bypasses Firebase entirely.
    app.use(createAdminRouter({ ...stubDeps(dir), logDir: dir }));
    return app;
  };

  it('allows requests with matching X-Admin-Token (no Firebase needed)', async () => {
    await fs.writeFile(path.join(dir, 'out.log'), 'line\n');
    const res = await request(buildApp())
      .get('/admin/logs')
      .set('X-Admin-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.text).toContain('line');
  });

  it('rejects requests with a mismatched X-Admin-Token (falls through to Firebase, which 401s)', async () => {
    const res = await request(buildApp())
      .get('/admin/logs')
      .set('X-Admin-Token', 'wrong-token');
    expect(res.status).toBe(401);
  });

  it('rejects requests with no X-Admin-Token (falls through to Firebase, which 401s)', async () => {
    const res = await request(buildApp()).get('/admin/logs');
    expect(res.status).toBe(401);
  });

  it('rejects a trivially-short env token to prevent accidental weak secrets', async () => {
    process.env.ADMIN_BEARER_TOKEN = 'short';
    const res = await request(buildApp())
      .get('/admin/logs')
      .set('X-Admin-Token', 'short');
    // Short tokens are ignored — adminGate falls through to Firebase, 401.
    expect(res.status).toBe(401);
  });

  it('is timing-safe against length-extension probes (functional check)', async () => {
    // Functional: a shorter/longer provided token must still be rejected —
    // safeEqual short-circuits on length mismatch rather than throwing.
    const res = await request(buildApp())
      .get('/admin/logs')
      .set('X-Admin-Token', TOKEN + 'x');
    expect(res.status).toBe(401);
  });

  it('/admin/status also accepts X-Admin-Token', async () => {
    const res = await request(buildApp())
      .get('/admin/status')
      .set('X-Admin-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

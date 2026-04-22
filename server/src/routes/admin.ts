import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { requireAuth, requireCurator } from '../middleware/auth';
import type { BroadcastStore } from '../services/broadcast/BroadcastStore';
import type { BroadcastOrchestrator } from '../services/broadcast/BroadcastOrchestrator';

/** Provider-status accessor shape. Both llmProvider and ttsProvider expose
 *  `getStatus()` returning implementation-specific shapes; the router treats
 *  them as opaque JSON. */
interface HasStatus {
  getStatus(): unknown;
}

export interface AdminRouterDeps {
  store: BroadcastStore;
  orch: BroadcastOrchestrator;
  llm: HasStatus;
  tts: HasStatus;
  /** Directory containing PM2's `out.log` + `error.log`. Defaults to `logs/`
   *  relative to cwd, which matches ecosystem.config.cjs on the VPS. */
  logDir?: string;
}

/** Maximum bytes read from the tail of a log file per request. PM2 rotates,
 *  so log files are typically a few MB; this cap keeps the admin endpoint
 *  from pinning event-loop on a runaway unrotated file. */
const MAX_LOG_READ_BYTES = 5 * 1024 * 1024;

/** Cap on the `lines` query param. 2000 is enough for a deep dive on one
 *  tester's session without risking huge responses; default 200 covers the
 *  "what just happened" case. */
const MAX_LINES = 2000;
const DEFAULT_LINES = 200;

const STREAM_VALUES = ['out', 'err', 'all'] as const;

/** Zod schema for /admin/logs query params. Permissive on purpose — this is
 *  an operator triage endpoint, not a user-facing API, so invalid values
 *  coerce to sensible defaults rather than 400ing.
 *
 *  - `stream` unknown value → falls back to 'out' via `.catch`
 *  - `id` uppercased after slice so tester-pasted screenshots match server
 *    log lines (which emit uppercase short ids) regardless of the caller's
 *    casing. Slice before uppercase to cap both bytes and display length.
 *  - `lines` preprocess handles string/number/missing/negative/NaN in one
 *    place, always landing on an integer in [1, MAX_LINES]. */
const AdminLogsQuerySchema = z.object({
  stream: z.enum(STREAM_VALUES).catch('out'),
  user: z.string().max(200).optional(),
  id: z.string().transform(s => s.slice(0, 200).toUpperCase()).optional(),
  lines: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return DEFAULT_LINES;
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
      if (!Number.isFinite(n) || n <= 0) return DEFAULT_LINES;
      return Math.min(MAX_LINES, Math.floor(n));
    },
    z.number().int().positive().max(MAX_LINES),
  ),
});

/** Read up to `maxBytes` from the tail of a log file, returning split lines.
 *  When the read is bounded (file larger than the window), the first line is
 *  dropped because it's almost certainly a partial record from mid-line. */
export async function readLogTail(
  logPath: string,
  maxBytes: number = MAX_LOG_READ_BYTES,
): Promise<string[]> {
  const stat = await fs.promises.stat(logPath);
  const readFrom = Math.max(0, stat.size - maxBytes);
  const bytesToRead = stat.size - readFrom;
  if (bytesToRead === 0) return [];
  const fd = await fs.promises.open(logPath, 'r');
  try {
    const buf = Buffer.alloc(bytesToRead);
    // `Buffer.alloc` zero-fills; if the file is truncated between stat()
    // and read() (log rotation mid-request), bytesRead < bytesToRead and
    // the tail of `buf` would decode as `\0` chars that survive the
    // newline split. Slice to the actual bytes returned.
    const { bytesRead } = await fd.read(buf, 0, bytesToRead, readFrom);
    const content = buf.slice(0, bytesRead).toString('utf8');
    const lines = content.split('\n');
    // Drop the partial first line only when we didn't start at byte 0.
    if (readFrom > 0) lines.shift();
    // Drop a trailing empty string from a terminal newline.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  } finally {
    await fd.close();
  }
}

/** Interleave out + err lines by the PM2 timestamp prefix. The ecosystem
 *  config uses `log_date_format: 'YYYY-MM-DD HH:mm:ss Z'`, which sorts
 *  correctly as a plain string. Lines without a parseable prefix sort
 *  alongside whatever non-prefixed line preceded them — good enough for
 *  human reading. */
export function interleaveByTimestamp(
  outLines: string[],
  errLines: string[],
): string[] {
  const tagged = [
    ...outLines.map(l => ({ src: 'out', line: l })),
    ...errLines.map(l => ({ src: 'err', line: l })),
  ];
  tagged.sort((a, b) => a.line.slice(0, 19).localeCompare(b.line.slice(0, 19)));
  return tagged.map(t => `[${t.src}] ${t.line}`);
}

/** Timing-safe string equality. `crypto.timingSafeEqual` requires equal-
 *  length buffers, so the length check short-circuits non-matching lengths
 *  (leaks token length via timing, but not token content). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Combined auth gate for /admin/*. Tries three paths, in order:
 *
 *  1. `X-Admin-Token` header matches `ADMIN_BEARER_TOKEN` env — immediate
 *     pass, bypasses Firebase + curator. Intended for the operator's own
 *     phone/browser debugging (one saved long-lived token beats juggling
 *     60-minute Firebase JWTs).
 *  2. Firebase JWT + curator email allowlist — the existing path.
 *  3. Neither — 401 from requireAuth or 403 from requireCurator.
 *
 *  The admin-token path is only active when `ADMIN_BEARER_TOKEN` is set, so
 *  leaving the env unset preserves the pre-existing "Firebase only" posture
 *  with no behavior change. */
export function adminGate(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const envToken = process.env.ADMIN_BEARER_TOKEN;
    const provided = req.headers['x-admin-token'];
    if (
      envToken && envToken.length >= 16 &&
      typeof provided === 'string' &&
      safeEqual(envToken, provided)
    ) {
      next();
      return;
    }
    // Fall back to the standard Firebase + curator chain.
    requireAuth(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (res.headersSent) return;
      requireCurator(req, res, next);
    });
  };
}

/** Apply substring filters (user + id) and keep only the last `lines`
 *  matches. Both filters are literal substring matches — no regex — to
 *  sidestep ReDoS and to keep query semantics obvious from a browser URL. */
export function filterAndTail(
  lines: string[],
  opts: { user?: string; id?: string; lines: number },
): string[] {
  let out = lines;
  if (opts.user) {
    const needle = opts.user;
    out = out.filter(l => l.includes(needle));
  }
  if (opts.id) {
    const needle = opts.id;
    out = out.filter(l => l.includes(needle));
  }
  return out.slice(-opts.lines);
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const logDir = deps.logDir ?? path.resolve(process.cwd(), 'logs');

  // Gate every admin route with the combined token/Firebase auth chain.
  router.use(adminGate());

  // GET /admin/logs?stream=out|err|all&user=<sub>&id=<short>&lines=<n>
  // Returns text/plain so a browser renders it readably without a JSON
  // viewer. Filters are ANDed. `id` is uppercased before matching — the
  // server tag emits uppercase short ids, and testers will paste uppercase
  // from screenshots of the player display.
  router.get('/admin/logs', async (req: Request, res: Response) => {
    const parsed = AdminLogsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      // Only hit when truly invalid input arrives — e.g. `user` exceeds
      // max(200). Most malformed params are coerced to defaults by the
      // schema and never reach this branch.
      return res.status(400).type('text/plain')
        .send(`invalid query: ${parsed.error.issues.map(i => i.path.join('.')).join(',')}\n`);
    }
    const { stream, user, id, lines } = parsed.data;

    try {
      let all: string[];
      if (stream === 'out') {
        all = await readLogTail(path.join(logDir, 'out.log'));
      } else if (stream === 'err') {
        all = await readLogTail(path.join(logDir, 'error.log'));
      } else {
        // `all` — read both, tag source, interleave by timestamp.
        const [outLines, errLines] = await Promise.all([
          readLogTail(path.join(logDir, 'out.log')).catch(() => [] as string[]),
          readLogTail(path.join(logDir, 'error.log')).catch(() => [] as string[]),
        ]);
        all = interleaveByTimestamp(outLines, errLines);
      }
      const filtered = filterAndTail(all, { user, id, lines });
      res.type('text/plain').send(filtered.join('\n') + (filtered.length > 0 ? '\n' : ''));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).type('text/plain').send(`log read failed: ${msg}\n`);
    }
  });

  // GET /admin/status — richer /health: adds memory, broadcast store size,
  // in-flight bakes, and log file sizes on disk. Gated by `adminGate`
  // (router-level) — accepts either X-Admin-Token or Firebase+curator.
  router.get('/admin/status', async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    let logSizes: { out: number; err: number } = { out: 0, err: 0 };
    try {
      const [outStat, errStat] = await Promise.all([
        fs.promises.stat(path.join(logDir, 'out.log')).catch(() => null),
        fs.promises.stat(path.join(logDir, 'error.log')).catch(() => null),
      ]);
      logSizes = {
        out: outStat?.size ?? 0,
        err: errStat?.size ?? 0,
      };
    } catch {
      // Keep defaults; not fatal for a status call.
    }
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: {
        rssMB: Math.round(mem.rss / 1024 / 1024),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      },
      broadcast: {
        inFlight: deps.orch.inFlightCount(),
        storeSize: deps.store.size(),
      },
      providers: {
        llm: deps.llm.getStatus(),
        tts: deps.tts.getStatus(),
      },
      logs: logSizes,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

# Per-Curator Publish Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap `POST /broadcast/featured/publish` at 3 attempts per curator per rolling 24h window with 429 + telemetry on cap hit.

**Architecture:** New `CuratorPublishBudget` class with in-memory per-uid timestamp lists, lazy pruning on read, exposed through a thin Express middleware. Wired between `requireCurator` and the existing `bakeLimiter` in `featured.ts`. Counter increments on attempt before the bake runs. 429 returns `Retry-After` header (RFC 6585 integer seconds) and JSON body with precise `retryAfterMs`. Sentry telemetry fires once per rejection via a new `bakeTelemetry.recordPublishCapHit` method.

**Tech Stack:** TypeScript, Express, Jest + ts-jest, supertest, `@sentry/node` (via existing `BakeTelemetry`), `express-rate-limit` (existing — not modified).

**Spec:** [`docs/superpowers/specs/2026-04-25-curator-publish-budget-design.md`](../specs/2026-04-25-curator-publish-budget-design.md)

**Branch:** `phase-1-curator-publish-budget` (already created, spec already committed).

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/services/curator/CuratorPublishBudget.ts` (**new**) | `CuratorPublishBudget` class + `makeCuratorPublishBudgetMiddleware` factory |
| `server/__tests__/services/curator/CuratorPublishBudget.test.ts` (**new**) | Unit tests for `tryReserve` (4 cases) |
| `server/__tests__/services/curator/publish-budget-middleware.test.ts` (**new**) | Integration tests for the middleware (Express + supertest) |
| `server/src/services/telemetry/BakeTelemetry.ts` (**modify**) | Add `recordPublishCapHit()` method |
| `server/src/routes/featured.ts` (**modify**) | Accept optional middleware param, splice into publish chain after `requireCurator` |
| `server/src/index.ts` (**modify**) | Parse env vars, construct singleton + middleware, pass into `createFeaturedRouter` |
| `CLAUDE.md` (**modify**) | Document `CURATOR_PUBLISH_CAP` and `CURATOR_PUBLISH_WINDOW_MS` |

---

## Notes for the Implementer

- TypeScript strict mode. No `any` casts unless unavoidable; prefer `unknown` + narrowing.
- Tests use the `@/` path alias for `server/src/*` (configured in `server/tsconfig.json`'s `paths`).
- Sentry is mocked in this repo's Jest setup so `Sentry.captureMessage` is a no-op in tests. Spy on the `bakeTelemetry` method directly with `jest.spyOn(bakeTelemetry, 'recordPublishCapHit')` rather than mocking `@sentry/node`.
- The repo uses `it(...)` not `test(...)`. Use `describe`/`it`/`beforeEach`/`expect` only.
- Run tests with `cd server && npm test -- <pattern>` from the repo root, OR `cd server && npx jest <pattern>`. Both work.
- Commit messages follow `<type>: <subject>` (e.g. `feat:`, `test:`, `chore:`). Add `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` per repo convention.
- Don't `git add -A` — use specific paths. The working tree has unrelated dirty files that must not be swept into these commits.

---

### Task 1: `CuratorPublishBudget` class — under-cap reserves return ok

**Files:**
- Create: `server/src/services/curator/CuratorPublishBudget.ts`
- Test: `server/__tests__/services/curator/CuratorPublishBudget.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/curator/CuratorPublishBudget.test.ts` with:

```ts
import { CuratorPublishBudget } from '@/services/curator/CuratorPublishBudget';

describe('CuratorPublishBudget', () => {
  describe('tryReserve — under cap', () => {
    it('returns { ok: true } for first reserve', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      expect(budget.tryReserve('uid-a')).toEqual({ ok: true });
    });

    it('returns { ok: true } for second reserve under cap', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      expect(budget.tryReserve('uid-a')).toEqual({ ok: true });
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd server && npx jest __tests__/services/curator/CuratorPublishBudget`
Expected: FAIL — "Cannot find module '@/services/curator/CuratorPublishBudget'"

- [ ] **Step 3: Write the minimal class**

Create `server/src/services/curator/CuratorPublishBudget.ts`:

```ts
export interface CuratorPublishBudgetOptions {
  capPerWindow: number;
  windowMs: number;
  clock?: () => number;
}

export interface ReserveResult {
  ok: boolean;
  retryAfterMs?: number;
  current?: number;
}

/**
 * Per-curator rolling-window publish quota. State is in-memory
 * Map<uid, timestamp[]>; entries are pruned lazily on every read,
 * so there is no background timer.
 */
export class CuratorPublishBudget {
  private readonly capPerWindow: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  private readonly entries = new Map<string, number[]>();

  constructor(opts: CuratorPublishBudgetOptions) {
    this.capPerWindow = opts.capPerWindow;
    this.windowMs = opts.windowMs;
    this.clock = opts.clock ?? Date.now;
  }

  tryReserve(uid: string): ReserveResult {
    const now = this.clock();
    const list = this.entries.get(uid) ?? [];
    list.push(now);
    this.entries.set(uid, list);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd server && npx jest __tests__/services/curator/CuratorPublishBudget`
Expected: PASS — both `it` cases green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/curator/CuratorPublishBudget.ts \
        server/__tests__/services/curator/CuratorPublishBudget.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add CuratorPublishBudget with under-cap reserve path

First slice of #16 per-curator publish budget. Under-cap reserves
push a timestamp into the per-uid list and return { ok: true }.
At-cap, pruning, and per-uid isolation in next tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `tryReserve` — at-cap returns rejection with `retryAfterMs`

**Files:**
- Modify: `server/src/services/curator/CuratorPublishBudget.ts`
- Modify: `server/__tests__/services/curator/CuratorPublishBudget.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('CuratorPublishBudget', ...)` block:

```ts
  describe('tryReserve — at cap', () => {
    it('rejects fourth reserve when cap is 3', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      const result = budget.tryReserve('uid-a');
      expect(result.ok).toBe(false);
      expect(result.current).toBe(3);
      // First reserve was at `now`; the window expires at now + windowMs.
      // retryAfterMs = (oldestEntry + windowMs) - now = windowMs (since clock didn't move).
      expect(result.retryAfterMs).toBe(24 * 60 * 60 * 1000);
    });

    it('does not push a new timestamp when rejecting', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a'); // rejected
      // Reach into private state via a cast for whitebox verification.
      const list = (budget as unknown as { entries: Map<string, number[]> })
        .entries.get('uid-a')!;
      expect(list.length).toBe(3);
    });
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd server && npx jest __tests__/services/curator/CuratorPublishBudget`
Expected: FAIL — "Expected: false, Received: true" on the first new test (because Task 1 always returns ok), and "Expected: 3, Received: 4" on the second.

- [ ] **Step 3: Replace `tryReserve` with the gated implementation**

Edit `server/src/services/curator/CuratorPublishBudget.ts` — replace the `tryReserve` method with:

```ts
  tryReserve(uid: string): ReserveResult {
    const now = this.clock();
    const list = this.entries.get(uid) ?? [];

    if (list.length >= this.capPerWindow) {
      const oldest = list[0];
      const retryAfterMs = oldest + this.windowMs - now;
      return { ok: false, retryAfterMs, current: list.length };
    }

    list.push(now);
    this.entries.set(uid, list);
    return { ok: true };
  }
```

- [ ] **Step 4: Run all CuratorPublishBudget tests and verify pass**

Run: `cd server && npx jest __tests__/services/curator/CuratorPublishBudget`
Expected: PASS — all 4 `it` cases green (2 from Task 1 + 2 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/curator/CuratorPublishBudget.ts \
        server/__tests__/services/curator/CuratorPublishBudget.test.ts
git commit -m "$(cat <<'EOF'
feat(server): reject CuratorPublishBudget reserves at cap

At capPerWindow, tryReserve returns { ok: false, retryAfterMs,
current } computed from the oldest entry's expiry. Rejected
reserves do not push a new timestamp, so a hammering caller
cannot extend their own lockout window.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `tryReserve` — rolling-window pruning

**Files:**
- Modify: `server/src/services/curator/CuratorPublishBudget.ts`
- Modify: `server/__tests__/services/curator/CuratorPublishBudget.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('CuratorPublishBudget', ...)` block:

```ts
  describe('tryReserve — rolling-window pruning', () => {
    it('admits a new reserve after windowMs elapses', () => {
      let now = 1_000_000;
      const windowMs = 24 * 60 * 60 * 1000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs,
        clock: () => now,
      });
      budget.tryReserve('uid-a'); // t=1_000_000
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      expect(budget.tryReserve('uid-a').ok).toBe(false);

      // Advance past the first entry's window expiry. With the prune
      // rule "drop entries where t <= now - windowMs", at exactly
      // now = 1_000_000 + windowMs the oldest is on the boundary and
      // pruned; the next reserve must succeed.
      now = 1_000_000 + windowMs;
      const result = budget.tryReserve('uid-a');
      expect(result.ok).toBe(true);
    });

    it('does not accumulate entries outside the window', () => {
      let now = 0;
      const windowMs = 100;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs,
        clock: () => now,
      });
      // Four reserves at t=0, t=50, t=100, t=100. At the third
      // reserve (t=100) the t=0 entry is on the boundary and pruned,
      // so the list goes [0,50] -> filter -> [50] -> push 100 -> [50,100].
      // The fourth reserve (also at t=100) keeps both surviving entries
      // and pushes again: [50,100] -> [50,100,100].
      budget.tryReserve('uid-a');
      now = 50;
      budget.tryReserve('uid-a');
      now = 100;
      budget.tryReserve('uid-a');
      const result = budget.tryReserve('uid-a');
      expect(result.ok).toBe(true);
      const list = (budget as unknown as { entries: Map<string, number[]> })
        .entries.get('uid-a')!;
      expect(list).toEqual([50, 100, 100]);
    });
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd server && npx jest __tests__/services/curator/CuratorPublishBudget`
Expected: FAIL — first new test "Expected: true, Received: false" (the cap-rejection from Task 2 doesn't prune); second new test "Expected: [50, 100, 100], Received: [0, 50, 100]".

- [ ] **Step 3: Add prune-on-read to `tryReserve`**

Edit `server/src/services/curator/CuratorPublishBudget.ts` — replace `tryReserve` with:

```ts
  tryReserve(uid: string): ReserveResult {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const existing = this.entries.get(uid) ?? [];
    // Drop entries on or before the cutoff (rolling window: an entry
    // exactly windowMs old is no longer "in the window").
    const list = existing.filter(t => t > cutoff);

    if (list.length >= this.capPerWindow) {
      const oldest = list[0];
      const retryAfterMs = oldest + this.windowMs - now;
      this.entries.set(uid, list); // persist the pruned list
      return { ok: false, retryAfterMs, current: list.length };
    }

    list.push(now);
    this.entries.set(uid, list);
    return { ok: true };
  }
```

- [ ] **Step 4: Run all CuratorPublishBudget tests and verify pass**

Run: `cd server && npx jest __tests__/services/curator/CuratorPublishBudget`
Expected: PASS — all 6 `it` cases green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/curator/CuratorPublishBudget.ts \
        server/__tests__/services/curator/CuratorPublishBudget.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add rolling-window pruning to CuratorPublishBudget

Prune-on-read drops entries on or before now - windowMs before the
cap check, so a curator who attempts at t=0..3 can attempt again
once t=windowMs has elapsed. No background timer needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `tryReserve` — per-uid isolation (regression test)

**Files:**
- Modify: `server/__tests__/services/curator/CuratorPublishBudget.test.ts`

This task only adds a test — `Map<uid, number[]>` already isolates per-uid by construction. Run-then-commit (no red→green transition).

- [ ] **Step 1: Add the regression test**

Append to the existing `describe('CuratorPublishBudget', ...)` block:

```ts
  describe('tryReserve — per-uid isolation', () => {
    it('uid A at cap does not block uid B', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      expect(budget.tryReserve('uid-a').ok).toBe(false);

      expect(budget.tryReserve('uid-b').ok).toBe(true);
      expect(budget.tryReserve('uid-b').ok).toBe(true);
      expect(budget.tryReserve('uid-b').ok).toBe(true);
      expect(budget.tryReserve('uid-b').ok).toBe(false);
    });
  });
```

- [ ] **Step 2: Run the test and verify it passes immediately**

Run: `cd server && npx jest __tests__/services/curator/CuratorPublishBudget`
Expected: PASS — all 7 `it` cases green. The new test passes without code changes because the per-uid `Map` separates state.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/services/curator/CuratorPublishBudget.test.ts
git commit -m "$(cat <<'EOF'
test(server): add per-uid isolation regression for CuratorPublishBudget

Locks in that one curator at cap doesn't shadow another's quota.
Map<uid, number[]> isolates by construction; this test guards
against a future refactor that flattens the structure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `BakeTelemetry.recordPublishCapHit`

**Files:**
- Modify: `server/src/services/telemetry/BakeTelemetry.ts`
- Test: `server/__tests__/services/telemetry/BakeTelemetry.test.ts` (add or create)

- [ ] **Step 1: Check whether the test file already exists**

Run: `ls server/__tests__/services/telemetry/ 2>/dev/null`
Expected: either lists `BakeTelemetry.test.ts` or returns nothing. Either is fine — Step 2 handles both.

- [ ] **Step 2: Write the failing test**

If `server/__tests__/services/telemetry/BakeTelemetry.test.ts` does not exist, create it with:

```ts
import * as Sentry from '@sentry/node';
import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';

describe('BakeTelemetry.recordPublishCapHit', () => {
  it('emits a curator.publish-cap-hit warning to Sentry with uid in tags', () => {
    const captureSpy = jest.spyOn(Sentry, 'captureMessage')
      .mockReturnValue('msg-id' as unknown as string);
    try {
      bakeTelemetry.recordPublishCapHit({
        uid: 'curator-1',
        current: 3,
        retryAfterMs: 1234,
      });
      expect(captureSpy).toHaveBeenCalledWith(
        'curator.publish-cap-hit',
        expect.objectContaining({
          level: 'warning',
          tags: { uid: 'curator-1' },
          extra: { current: 3, retryAfterMs: 1234 },
        }),
      );
    } finally {
      captureSpy.mockRestore();
    }
  });
});
```

If the file already exists, add only the new `describe('BakeTelemetry.recordPublishCapHit', ...)` block at the bottom.

- [ ] **Step 3: Run the test and verify it fails**

Run: `cd server && npx jest __tests__/services/telemetry/BakeTelemetry`
Expected: FAIL — "bakeTelemetry.recordPublishCapHit is not a function".

- [ ] **Step 4: Add the method**

In `server/src/services/telemetry/BakeTelemetry.ts`, inside the `BakeTelemetry` class (after `recordSequencerResult`), add:

```ts
  recordPublishCapHit(input: {
    uid: string;
    current: number;
    retryAfterMs: number;
  }): void {
    Sentry.captureMessage('curator.publish-cap-hit', {
      level: 'warning',
      tags: { uid: input.uid },
      extra: { current: input.current, retryAfterMs: input.retryAfterMs },
    });
  }
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd server && npx jest __tests__/services/telemetry/BakeTelemetry`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/telemetry/BakeTelemetry.ts \
        server/__tests__/services/telemetry/BakeTelemetry.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add BakeTelemetry.recordPublishCapHit

Warning-level Sentry event emitted whenever the curator publish
budget rejects an attempt. uid lands in tags so Sentry alerts
can filter on it; current and retryAfterMs in extra.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `makeCuratorPublishBudgetMiddleware` factory + integration tests

**Files:**
- Modify: `server/src/services/curator/CuratorPublishBudget.ts`
- Create: `server/__tests__/services/curator/publish-budget-middleware.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `server/__tests__/services/curator/publish-budget-middleware.test.ts`:

```ts
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
    expect(res.body.error).toContain('24h');   // window phrasing
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd server && npx jest __tests__/services/curator/publish-budget-middleware`
Expected: FAIL — "makeCuratorPublishBudgetMiddleware is not exported".

- [ ] **Step 3: Add the middleware factory**

Add these imports at the **top** of `server/src/services/curator/CuratorPublishBudget.ts` (the class file currently has no imports):

```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { bakeTelemetry } from '../telemetry/BakeTelemetry';
```

Then append the factory function below the existing `CuratorPublishBudget` class:

```ts

/**
 * Express middleware that gates the wrapped handler on the curator's
 * remaining quota. Must run after auth so req.uid is populated.
 *
 * - 200 path: tryReserve → ok → next()
 * - 429 path: tryReserve → !ok → Retry-After header + JSON body, telemetry fires
 * - 500 path: req.uid missing → defensive bail (auth chain is misconfigured)
 */
export function makeCuratorPublishBudgetMiddleware(
  budget: CuratorPublishBudget,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const uid = (req as unknown as { uid?: string }).uid;
    if (!uid) {
      res.status(500).json({ error: 'req.uid not set; auth chain misconfigured' });
      return;
    }

    const result = budget.tryReserve(uid);
    if (result.ok) {
      next();
      return;
    }

    // result is narrowed to { ok: false; retryAfterMs: number; current: number }
    // by the discriminated union — no defensive ?? fallbacks needed.
    const { retryAfterMs, current } = result;
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    const cap = budget.capPerWindow;
    const windowHours = Math.round(budget.windowMs / (60 * 60 * 1000));

    const hours = Math.floor(retryAfterMs / (60 * 60 * 1000));
    const minutes = Math.floor((retryAfterMs % (60 * 60 * 1000)) / (60 * 1000));
    const human = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    bakeTelemetry.recordPublishCapHit({
      uid,
      current,
      retryAfterMs,
    });

    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: `Daily publish cap reached (${cap} per ${windowHours}h). Try again in ~${human}.`,
      retryAfterMs,
    });
  };
}
```

The factory reads `budget.capPerWindow` and `budget.windowMs`. Make those readable by changing the class fields in `server/src/services/curator/CuratorPublishBudget.ts` from `private readonly` to `readonly` (still immutable, just package-readable):

```ts
export class CuratorPublishBudget {
  readonly capPerWindow: number;
  readonly windowMs: number;
  private readonly clock: () => number;
  private readonly entries = new Map<string, number[]>();
  // ...
}
```

- [ ] **Step 4: Run all CuratorPublishBudget tests and verify pass**

Run: `cd server && npx jest __tests__/services/curator/`
Expected: PASS — all unit tests + 4 middleware integration tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/curator/CuratorPublishBudget.ts \
        server/__tests__/services/curator/publish-budget-middleware.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add makeCuratorPublishBudgetMiddleware factory

Express middleware wrapping CuratorPublishBudget.tryReserve.
Returns 429 with RFC 6585 integer-second Retry-After header and
JSON body { error, retryAfterMs }; emits bakeTelemetry.recordPublishCapHit
once per rejection; returns 500 when req.uid is missing (defensive).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire middleware into `featured.ts`

**Files:**
- Modify: `server/src/routes/featured.ts`

The existing `createFeaturedRouter(registry, orchestrator?, bakeLimiter?)` already takes optional middleware. Add a fourth optional parameter for the publish budget middleware. When provided, it runs *after* `requireCurator` and *before* `bakeLimiter`. Existing tests that don't pass it continue to work (no budget enforcement in test envs).

- [ ] **Step 1: Run the existing featured route test (if any) to baseline**

Run: `cd server && npx jest featured 2>&1 | tail -20`
Expected: any existing featured tests pass before the change. Note the count (e.g. "Tests: N passed").

- [ ] **Step 2: Modify the router signature**

Edit `server/src/routes/featured.ts` — find:

```ts
export function createFeaturedRouter(
  registry: FeaturedBroadcastRegistry,
  orchestrator?: BroadcastOrchestrator,
  bakeLimiter?: RequestHandler,
): Router {
```

Replace with:

```ts
export function createFeaturedRouter(
  registry: FeaturedBroadcastRegistry,
  orchestrator?: BroadcastOrchestrator,
  bakeLimiter?: RequestHandler,
  publishBudget?: RequestHandler,
): Router {
```

Then find the `publishMiddleware` array a few lines below:

```ts
    const publishMiddleware: RequestHandler[] = [
      requireCurator,
      ...(bakeLimiter ? [bakeLimiter] : []),
    ];
```

Replace with:

```ts
    const publishMiddleware: RequestHandler[] = [
      requireCurator,
      ...(publishBudget ? [publishBudget] : []),
      ...(bakeLimiter ? [bakeLimiter] : []),
    ];
```

- [ ] **Step 3: Run the existing tests and verify still pass**

Run: `cd server && npx jest featured 2>&1 | tail -20`
Expected: same test count green. No new tests yet (Task 8 wires it; Task 6 already covered the middleware behavior in isolation).

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/featured.ts
git commit -m "$(cat <<'EOF'
feat(server): accept optional publish budget middleware in featured router

Adds 4th optional param to createFeaturedRouter; when supplied, runs
between requireCurator and bakeLimiter. Existing tests don't pass
it, so they continue to bypass the budget — only production wiring
in index.ts (next task) installs it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Construct singleton in `index.ts` + parse env vars

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Read the current state of index.ts around the featured router wiring**

Run: `grep -n "createFeaturedRouter\|generationLimiter\|enrichmentLimiter\|broadcastStore" server/src/index.ts | head -20`
Note the line numbers — you'll need to insert the budget construction near the other singletons (between the existing limiter definitions and `createFeaturedRouter` invocation).

- [ ] **Step 2: Add an env-var parsing helper near the top of `index.ts`**

In `server/src/index.ts`, after the other top-level constants but before the rate-limiter definitions, add:

```ts
function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[env] ${name}="${raw}" is not a positive integer; using default ${fallback}`);
    return fallback;
  }
  return n;
}
```

- [ ] **Step 3: Construct the budget instance and middleware**

Add this import to the top-of-file import block in `server/src/index.ts` (alongside the other `./routes/...` and `./services/...` imports — the file uses relative paths, not the `@/` alias):

```ts
import { CuratorPublishBudget, makeCuratorPublishBudgetMiddleware } from './services/curator/CuratorPublishBudget';
```

Then, in the same file after the `enrichmentLimiter` definition (around line 88) but *before* the `app.use(...)` mount calls, add:

```ts
const curatorPublishBudget = new CuratorPublishBudget({
  capPerWindow: parsePositiveInt(process.env.CURATOR_PUBLISH_CAP, 3, 'CURATOR_PUBLISH_CAP'),
  windowMs: parsePositiveInt(
    process.env.CURATOR_PUBLISH_WINDOW_MS,
    24 * 60 * 60 * 1000,
    'CURATOR_PUBLISH_WINDOW_MS',
  ),
});
const curatorPublishBudgetMiddleware = makeCuratorPublishBudgetMiddleware(curatorPublishBudget);
```

- [ ] **Step 4: Pass the middleware into `createFeaturedRouter`**

In `server/src/index.ts`, find the line:

```ts
  app.use(requireAuth, createFeaturedRouter(featuredRegistry, broadcastOrchestrator, generationLimiter));
```

Replace with:

```ts
  app.use(requireAuth, createFeaturedRouter(
    featuredRegistry,
    broadcastOrchestrator,
    generationLimiter,
    curatorPublishBudgetMiddleware,
  ));
```

- [ ] **Step 5: Compile and run the full server test suite to confirm no regression**

Run: `cd server && npx tsc --noEmit`
Expected: clean — no type errors.

Run: `cd server && npm test`
Expected: PASS — all suites green, including the new `services/curator/` suites.

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): wire curator publish budget into featured publish chain

Constructs the CuratorPublishBudget singleton from env vars
(CURATOR_PUBLISH_CAP=3, CURATOR_PUBLISH_WINDOW_MS=86400000 by default)
with NaN/<=0 fallback to defaults plus a console warning. Middleware
is spliced after requireCurator and before generationLimiter so the
per-curator daily cap rejects before the per-minute generation cap
gets a chance to count the request.

Closes #16.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Document env vars in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Locate the server env-var section**

Run: `grep -n "CURATOR_EMAILS\|server/.env" CLAUDE.md | head -5`
Note the line where the `server/.env` section lists env vars.

- [ ] **Step 2: Add the two new vars**

Edit `CLAUDE.md`. In the `server/.env (gitignored)` env-var listing, find the line:

```
CURATOR_EMAILS                            # comma-separated
```

Append two lines below it:

```
CURATOR_PUBLISH_CAP                       # default 3 (per-curator daily publish cap)
CURATOR_PUBLISH_WINDOW_MS                 # default 86400000 (24h rolling window)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document CURATOR_PUBLISH_CAP and CURATOR_PUBLISH_WINDOW_MS

Adds the two env vars introduced in #16 to the server/.env section
of CLAUDE.md so future readers see the configurable defaults.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Pre-PR checklist

- [ ] All 9 tasks complete
- [ ] `cd server && npm test` — full suite green
- [ ] `cd server && npx tsc --noEmit` — clean
- [ ] `coderabbit review --agent --base main --type committed` from repo root; verify each finding against current code, fix legitimate ones in new commits, re-run only if substantive
- [ ] `gh pr create --title "feat(server): per-curator publish budget (#16)"` with body summarizing scope, link to spec, link to issue

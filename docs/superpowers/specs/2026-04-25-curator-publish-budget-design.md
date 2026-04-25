# Per-Curator Publish Budget — Design

**Date:** 2026-04-25
**Status:** Brainstorm-approved; awaiting user spec review
**Roadmap link:** [`2026-04-24-onay-roadmap-design.md`](2026-04-24-onay-roadmap-design.md) → Phase 1 → item 3 (per-curator publish budget)
**Issue:** [bworthy89/cleo#16](https://github.com/bworthy89/cleo/issues/16)

---

## Why

`POST /broadcast/featured/publish` is the only curator-only mutation route. It runs through `requireCurator` (email allowlist) and the global `generationLimiter` (60 req/min by `req.uid` across all generation paths) — but no per-curator daily ceiling. A runaway client (compromised curator account, scripted typo-loop, or a UI bug that retries on every tap) could chew through Gemini RPM, TTS minutes, and R2 storage well past what one human curator should produce in a day. Each publish triggers a full bake — sequencer LLM call + one segment LLM call and one TTS call per slot + R2 puts for every slot — so the cost ceiling matters even at modest abuse rates.

This is a defense-in-depth budget on top of the existing per-minute `generationLimiter`, not a replacement for it. The minute-limiter caps burst rate; the daily cap bounds total daily spend per curator.

## Scope

**In scope:**
- Per-curator daily cap on `POST /broadcast/featured/publish` attempts, keyed on `req.uid`
- Counter increments on **attempt**, before the bake runs (so failed bakes still count — they consumed quota too)
- **Rolling 24h window**: cap applies to attempts in the trailing 24 hours, not a fixed UTC-day reset
- 429 response with `Retry-After` header (RFC 6585) and JSON body containing a precise `retryAfterMs`
- Sentry telemetry event on cap hit (not on under-cap successes — issue language is "fires on cap hit")
- In-memory storage matching existing patterns (`BroadcastStore`, `EnrichmentCache`); single-instance server
- Configurable via env vars with sensible defaults

**Out of scope:**
- Other curator-gated routes (none exist today besides featured/publish)
- Multi-instance deployment / Redis backing — the server runs as a single PM2 process; the in-memory class exposes a stable interface that a Redis-backed implementation could swap behind later
- Counting *successful* publishes only — see Why above; attempts are the cost driver
- Client UI showing remaining quota — not requested in this issue, would be a follow-up if curators ask
- Bypass for admin-token-authenticated requests — `ADMIN_BEARER_TOKEN` only unlocks `/admin/*`, never goes through `requireCurator`, so it's not a concern
- Lifting the cap during legitimate "Tonight on ONAY" slot rotations — initial cap of 3/day is set above the expected 2 slots/day (`slot_morning` + `slot_evening`); if the cap turns out too tight in production, raise the env-var default rather than carving exceptions

## Approach

**Counter semantics:** rolling 24h window of attempt timestamps per `uid`. On every reservation, prune entries older than `now - windowMs`, then check the surviving count against the cap. If under: append `now`, accept. If at-or-over: reject, compute `retryAfterMs` from the oldest surviving entry's expiry.

**Storage:** in-memory `Map<string, number[]>` inside a single `CuratorPublishBudget` class instance. Memory bound is `cap × N curators` integers; with cap=3 and a single-digit allowlist, it's a few dozen numbers — negligible. Lazy pruning (on read) means no background timer.

**Wiring:** the middleware sits in the `featured.ts` publish chain between `requireCurator` and the existing `bakeLimiter` (the per-minute generation cap). Order: cheapest auth check first, per-curator daily cap second, per-minute generation cap third, then the route handler. All three must pass before the bake starts.

### Class API

```ts
// server/src/services/curator/CuratorPublishBudget.ts

export interface ReserveResult {
  ok: boolean;
  retryAfterMs?: number;  // present only when ok === false
  current?: number;       // attempts in window when ok === false
}

export class CuratorPublishBudget {
  constructor(opts: {
    capPerWindow: number;
    windowMs: number;
    clock?: () => number;   // defaults to Date.now; injected for tests
  });

  /** Atomic check-and-reserve. */
  tryReserve(uid: string): ReserveResult;
}

export function makeCuratorPublishBudgetMiddleware(
  budget: CuratorPublishBudget,
): RequestHandler;
```

`tryReserve` is the single source of truth for both the cap check and the increment, so there's no TOCTOU window between "is there room?" and "I took a slot".

The middleware factory takes only `budget`; it imports the
`bakeTelemetry` singleton directly rather than accepting it as an
injected parameter. This matches the codebase pattern (e.g.
`BroadcastOrchestrator` and `BackgroundEnricher` also import the
singleton) and keeps the call site in `index.ts` simpler. Tests
spy on the singleton via `jest.spyOn(bakeTelemetry, ...)`.

### Server flow

```text
POST /broadcast/featured/publish
  ├─ requireAuth          → req.uid set (Firebase JWT sub)
  ├─ requireCurator       → req.email is in CURATOR_EMAILS
  ├─ publishBudget        → budget.tryReserve(req.uid)
  │   ├─ ok: true   → next()
  │   └─ ok: false  → telemetry.recordPublishCapHit({ uid, current, retryAfterMs })
  │                   → 429 + Retry-After header + JSON body { error, retryAfterMs }
  ├─ bakeLimiter (existing 60/min generationLimiter)
  └─ route handler
        └─ orchestrator.create + waitForCompletion + registry.put
```

Rejected attempts never reach the bake path, so failed reservations cost nothing beyond the auth chain — exactly the point.

### Telemetry

Add to `BakeTelemetry`:

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

`uid` goes in tags so Sentry alerts can filter on it (per the same convention used for `vibe` and `poor_fit` in `recordSequencerResult`). `current` and `retryAfterMs` go in `extra` because alert rules don't filter on numeric fields anyway.

### 429 response shape

```
HTTP/1.1 429 Too Many Requests
Retry-After: <integer seconds, RFC 6585>
Content-Type: application/json

{
  "error": "Daily publish cap reached (<cap> per 24h). Try again in ~<Xh Ym>.",
  "retryAfterMs": <number>
}
```

`Retry-After` rounds `retryAfterMs / 1000` up to the next integer second (RFC 6585 §4 requires integer seconds). The JSON body keeps the precise millisecond value for client displays. The error string interpolates the configured cap so admins changing the env var don't get a stale message.

### Configuration

```env
CURATOR_PUBLISH_CAP=3                  # default 3
CURATOR_PUBLISH_WINDOW_MS=86400000     # default 24h (86_400_000 ms)
```

Parsed once in `server/src/index.ts`. Numeric validation: `Number.parseInt(value, 10)`; if `NaN` or `≤ 0`, log a warning and fall back to the default. The constructor itself takes raw numbers — env-parsing concerns stay in `index.ts`, the class stays mock-free.

The defaults are deliberately permissive enough for the expected workflow (2 daily "Tonight on ONAY" slots + 1 ad-hoc) and tight enough that a script burning through the cap registers as anomalous traffic. If production data shows the limit is too tight, raising it is one env-var change with no code redeploy.

## Files touched

- **Create** `server/src/services/curator/CuratorPublishBudget.ts` — class + middleware factory
- **Modify** `server/src/services/telemetry/BakeTelemetry.ts` — add `recordPublishCapHit()`
- **Modify** `server/src/routes/featured.ts` — accept budget instance, splice middleware into publish chain
- **Modify** `server/src/index.ts` — parse env vars, construct singleton, pass into `createFeaturedRouter`
- **Create** `server/__tests__/services/curator/CuratorPublishBudget.test.ts` — unit tests
- **Create** `server/__tests__/services/curator/publish-budget-middleware.test.ts` — integration tests against a stub Express app
- **Modify** `CLAUDE.md` — env-var documentation under the `server/.env` section

## Test strategy

**Unit tests (`CuratorPublishBudget.test.ts`)** — the four cases the issue requires, each via `clock` injection:

1. **Under cap:** With `cap=3`, two reserves return `{ ok: true }` with no `retryAfterMs`.
2. **At cap:** Three reserves succeed (= cap); fourth returns `{ ok: false, retryAfterMs: ~windowMs, current: 3 }`. `retryAfterMs` should be close to `windowMs` because the oldest entry just landed.
3. **Post-window reset:** After three reserves, advance the clock by `windowMs + 1` ms; the next reserve succeeds (oldest entry is now outside the window and pruned).
4. **Per-uid isolation:** uid A at cap does not affect uid B's first three reserves.

Plus one bonus invariant: pruning happens before the cap check on every call, so a pattern of `[reserve, sleep windowMs/2, reserve, sleep windowMs/2, reserve]` never accumulates state outside the window.

**Integration tests (`publish-budget-middleware.test.ts`)** — minimal Express app + supertest, mounting only the budget middleware on a stub `200 OK` handler:

- Under cap: 200 from stub handler.
- At cap: 429 with `Retry-After` header (integer ≥ 1) and JSON body containing `retryAfterMs` (number, > 0) and `error` string. Verify error string interpolates the cap.
- `bakeTelemetry.recordPublishCapHit` is called exactly once on rejection (jest.spyOn on the singleton).
- 500 when `req.uid` is unset (defensive — should never happen because `requireAuth` runs upstream, but the middleware shouldn't push to a `Map<undefined, ...>` if the chain is misconfigured).

The real `featured.ts` route is *not* exercised end-to-end here; that pulls in `BroadcastOrchestrator` + `FeaturedBroadcastRegistry` and isn't what these tests are validating. The existing publish-route test (if any) continues to cover the 200 path.

## Failure modes considered

- **Server restart wipes the counter.** Acceptable: a curator who was capped at 11pm can publish three more after a midnight restart. Multi-instance / persistence is explicitly out of scope; if it becomes load-bearing, the same class interface accepts a Redis-backed implementation.
- **Clock skew between `Date.now` and Sentry's ingest time.** Not relevant — we never compare client and server clocks; everything is relative to the server's monotonic-ish `Date.now` reading.
- **A curator with a long uptime and no publishes.** `Map<uid, number[]>` only adds entries on publish attempts, so silent curators never grow the map. The map only grows when a curator actually attempts a publish, and never beyond `cap` entries per uid.
- **Race between two parallel publish attempts at exactly the cap boundary.** Node's event loop is single-threaded; two `tryReserve` calls in the same JS tick are serialized. No locking needed.

## Open questions

None at design time. If the 3/day default proves too tight in real curator usage, raising `CURATOR_PUBLISH_CAP` is a runtime config change.

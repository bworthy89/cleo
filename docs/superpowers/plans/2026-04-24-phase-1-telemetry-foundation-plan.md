# Phase 1 — Telemetry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ONAY's pre-baked stability moat measurable. Ship per-bake telemetry, a public `/health/public` endpoint, and an in-app status banner so Phase 2–6 success criteria become verifiable.

**Architecture:**
- **Server:** Add `@sentry/node` with traces. New `BakeTelemetry` helper module wraps Sentry calls. Instrumentation injected into `BroadcastOrchestrator.create`, `BackgroundEnricher.drainNow`, `TTSProviderFactory.synthesize`, and `DeterministicTrackSequencer.logResult`. New `/health/public` Express route synthesizes provider status from the existing TTS health checks + bake queue depth.
- **Client:** New `useHealthStatus` hook polls `/health/public` every 60s while the app is active. New `HealthStatusBanner` component renders when status is `degraded` or `major`. Mounted in `HomeBroadcastScreen` above the existing `OfflineBanner`.

**Tech Stack:** Express, TypeScript, Jest, supertest, `@sentry/node` (server), Sentry RN SDK (client, already configured via `EXPO_PUBLIC_SENTRY_DSN`), MMKV, React Native.

**Tracking:** GitHub issue [#15 on bworthy89/cleo](https://github.com/bworthy89/cleo/issues/15) (milestone "Phase 1: Stability Foundation").

---

## File structure

**Create:**
- `server/src/services/telemetry/BakeTelemetry.ts` — telemetry helper module (one responsibility: wrap Sentry calls for bake lifecycle + provider events).
- `server/__tests__/services/telemetry/BakeTelemetry.test.ts` — unit tests with mocked Sentry.
- `server/src/routes/health.ts` — new public health route.
- `server/__tests__/routes/health.test.ts` — supertest integration tests.
- `src/hooks/useHealthStatus.ts` — client hook polling `/health/public`.
- `src/components/HealthStatusBanner.tsx` — in-app degraded-status indicator.

**Modify:**
- `server/package.json` — add `@sentry/node` dependency.
- `server/src/index.ts` — Sentry init, mount `/health/public` router.
- `server/src/services/broadcast/BroadcastOrchestrator.ts` — emit bake lifecycle events; expose `inFlight.size` getter.
- `server/src/providers/tts/index.ts` — emit `provider-fallback` events on the existing fallback paths.
- `server/src/services/enrichment/BackgroundEnricher.ts` — emit `enrichment-api-timing` events per fetcher call inside `drainNow`.
- `server/src/services/broadcast/DeterministicTrackSequencer.ts` — emit a structured `sequencer-result` event from `logResult`.
- `src/screens/home/HomeBroadcastScreen.tsx` — mount `HealthStatusBanner` above `OfflineBanner`.

**Note on ReccoBeats:** ReccoBeats is already integrated (`server/src/services/enrichment/fetchers/ReccoBeatsFetcher.ts`, wired in `server/src/index.ts` and consumed by `BackgroundEnricher.drainNow`). Plan 3 covers any further ReccoBeats work; this plan does NOT touch the fetcher.

---

## Task 1: Add `@sentry/node` to server dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install dependency**

Run from repo root:
```bash
cd server && npm install --save @sentry/node@^8.0.0 && cd ..
```

Expected: `@sentry/node` appears in `dependencies` block.

- [ ] **Step 2: Verify install**

Run:
```bash
cd server && node -e "console.log(require('@sentry/node').init.toString().slice(0,40))"
```

Expected: prints the first 40 chars of the `init` function (proves the module resolves).

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore(server): add @sentry/node for telemetry foundation"
```

---

## Task 2: Create `BakeTelemetry` service module (TDD)

This module is the single point of contact with Sentry. Everything else calls into it; Sentry imports are confined here so tests can mock cleanly.

**Files:**
- Create: `server/src/services/telemetry/BakeTelemetry.ts`
- Create: `server/__tests__/services/telemetry/BakeTelemetry.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/__tests__/services/telemetry/BakeTelemetry.test.ts`:

```typescript
import * as Sentry from '@sentry/node';
import { BakeTelemetry } from '@/services/telemetry/BakeTelemetry';

jest.mock('@sentry/node', () => ({
  startInactiveSpan: jest.fn(),
  captureMessage: jest.fn(),
  setMeasurement: jest.fn(),
}));

describe('BakeTelemetry', () => {
  let telemetry: BakeTelemetry;
  let mockSpan: { end: jest.Mock; setAttribute: jest.Mock };

  beforeEach(() => {
    mockSpan = { end: jest.fn(), setAttribute: jest.fn() };
    (Sentry.startInactiveSpan as jest.Mock).mockReturnValue(mockSpan);
    telemetry = new BakeTelemetry();
  });

  it('startBake returns a handle whose endSlotZero records a measurement', () => {
    const handle = telemetry.startBake({
      broadcastId: 'A3F9K2X1',
      vibe: 'late-night',
      length: 'standard',
    });
    handle.endSlotZero(11500);
    expect(Sentry.setMeasurement).toHaveBeenCalledWith(
      'bake.time_to_slot_zero_ms',
      11500,
      'millisecond',
    );
  });

  it('endBake closes the span and records total duration', () => {
    const handle = telemetry.startBake({
      broadcastId: 'A3F9K2X1',
      vibe: 'late-night',
      length: 'standard',
    });
    handle.endBake({ durationMs: 42000, status: 'completed' });
    expect(Sentry.setMeasurement).toHaveBeenCalledWith(
      'bake.time_to_completion_ms',
      42000,
      'millisecond',
    );
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('recordProviderFallback emits a structured event', () => {
    telemetry.recordProviderFallback({
      from: 'cosyvoice',
      to: 'f5tts',
      reason: 'synthesize-threw',
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'tts.provider-fallback',
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ from: 'cosyvoice', to: 'f5tts' }),
      }),
    );
  });

  it('recordEnrichmentApiTiming records measurements per API', () => {
    telemetry.recordEnrichmentApiTiming({ api: 'reccobeats', durationMs: 850 });
    expect(Sentry.setMeasurement).toHaveBeenCalledWith(
      'enrichment.reccobeats_ms',
      850,
      'millisecond',
    );
  });

  it('recordSequencerResult emits a structured event with meanDistance', () => {
    telemetry.recordSequencerResult({
      vibe: 'late-night',
      n: 9,
      meanDistance: 0.42,
      poolSize: 50,
      featureSourceCounts: { reccobeats: 7, deezer: 1, lastfm: 1 },
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'sequencer.result',
      expect.objectContaining({
        level: 'info',
        tags: expect.objectContaining({ vibe: 'late-night' }),
        extra: expect.objectContaining({ meanDistance: 0.42 }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd server && npx jest __tests__/services/telemetry/BakeTelemetry.test.ts
```

Expected: FAIL with "Cannot find module '@/services/telemetry/BakeTelemetry'".

- [ ] **Step 3: Implement `BakeTelemetry.ts`**

Create `server/src/services/telemetry/BakeTelemetry.ts`:

```typescript
import * as Sentry from '@sentry/node';

export interface BakeStartInput {
  broadcastId: string;
  vibe: string;
  length: 'quick' | 'standard' | 'long';
}

export interface BakeEndInput {
  durationMs: number;
  status: 'completed' | 'failed' | 'aborted';
}

export interface ProviderFallbackInput {
  from: string;
  to: string;
  reason: string;
}

export interface EnrichmentApiTimingInput {
  api: 'reccobeats' | 'deezer' | 'lastfm' | 'genius' | 'musicbrainz' | 'wikipedia';
  durationMs: number;
}

export interface SequencerResultInput {
  vibe: string;
  n: number;
  meanDistance: number;
  poolSize: number;
  featureSourceCounts: Record<string, number>;
}

export interface BakeHandle {
  endSlotZero(durationMs: number): void;
  endBake(input: BakeEndInput): void;
}

/**
 * Single point of contact with Sentry for bake-related telemetry.
 * Confining the Sentry imports here keeps the rest of the codebase
 * mock-free and decouples the choice of telemetry backend.
 */
export class BakeTelemetry {
  startBake(input: BakeStartInput): BakeHandle {
    const span = Sentry.startInactiveSpan({
      name: `bake.${input.length}`,
      op: 'broadcast.bake',
      attributes: {
        'bake.broadcast_id': input.broadcastId,
        'bake.vibe': input.vibe,
        'bake.length': input.length,
      },
    });

    return {
      endSlotZero(durationMs: number) {
        Sentry.setMeasurement('bake.time_to_slot_zero_ms', durationMs, 'millisecond');
        span?.setAttribute('bake.time_to_slot_zero_ms', durationMs);
      },
      endBake(end: BakeEndInput) {
        Sentry.setMeasurement('bake.time_to_completion_ms', end.durationMs, 'millisecond');
        span?.setAttribute('bake.status', end.status);
        span?.end();
      },
    };
  }

  recordProviderFallback(input: ProviderFallbackInput): void {
    Sentry.captureMessage('tts.provider-fallback', {
      level: 'warning',
      tags: { from: input.from, to: input.to },
      extra: { reason: input.reason },
    });
  }

  recordEnrichmentApiTiming(input: EnrichmentApiTimingInput): void {
    Sentry.setMeasurement(
      `enrichment.${input.api}_ms`,
      input.durationMs,
      'millisecond',
    );
  }

  recordSequencerResult(input: SequencerResultInput): void {
    Sentry.captureMessage('sequencer.result', {
      level: 'info',
      tags: { vibe: input.vibe },
      extra: {
        n: input.n,
        meanDistance: input.meanDistance,
        poolSize: input.poolSize,
        featureSourceCounts: input.featureSourceCounts,
      },
    });
  }
}

/** Module-level singleton — one Sentry hub per process. */
export const bakeTelemetry = new BakeTelemetry();
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd server && npx jest __tests__/services/telemetry/BakeTelemetry.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/telemetry/BakeTelemetry.ts server/__tests__/services/telemetry/BakeTelemetry.test.ts
git commit -m "feat(server): add BakeTelemetry service module"
```

---

## Task 3: Initialize Sentry in `server/src/index.ts`

Sentry needs to be initialized once at process startup, before any route handlers run. Without this the `BakeTelemetry` calls succeed silently but emit nothing.

**Files:**
- Modify: `server/src/index.ts:1-10` (top of file, before other imports)

- [ ] **Step 1: Add Sentry init at the top of `server/src/index.ts`**

Insert at the very top of the file (line 1, before `import 'dotenv/config'`):

```typescript
import 'dotenv/config';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.2'),
    release: process.env.SENTRY_RELEASE,
  });
}

// (existing imports follow)
```

The existing `import 'dotenv/config';` line gets moved up by one line. All other imports stay where they are.

- [ ] **Step 2: Verify init does not crash startup**

Run:
```bash
cd server && SENTRY_DSN= npm run dev
```

Expected: server starts on port 3001 with no errors. (Empty DSN means `init` is skipped — explicit no-op.)

Stop with Ctrl-C.

- [ ] **Step 3: Verify init runs when DSN is set**

Run:
```bash
cd server && SENTRY_DSN=https://example@example.ingest.sentry.io/1 npm run dev 2>&1 | head -5
```

Expected: server starts; first console line is normal startup log (Sentry's init is silent on success).

Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): initialize Sentry from SENTRY_DSN env"
```

---

## Task 4: Instrument `BroadcastOrchestrator.create` with bake lifecycle events

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Modify: `server/__tests__/broadcast/BroadcastOrchestrator.test.ts` (or create if absent)

- [ ] **Step 1: Add a getter for inFlight.size on `BroadcastOrchestrator`**

In `server/src/services/broadcast/BroadcastOrchestrator.ts`, find the `inFlight` field declaration (around line 65 in current code) and add a getter immediately after the field:

```typescript
  private readonly inFlight = new Map<string, Promise<void>>();

  /** Number of bakes currently mid-generation. Used by /health/public. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }
```

- [ ] **Step 2: Write failing test for telemetry emission**

Add to `server/__tests__/broadcast/BroadcastOrchestrator.test.ts` (create file if it doesn't exist):

```typescript
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';

describe('BroadcastOrchestrator telemetry', () => {
  it('emits startBake/endSlotZero/endBake on a successful create', async () => {
    const startSpy = jest.spyOn(bakeTelemetry, 'startBake');
    const endSlotZero = jest.fn();
    const endBake = jest.fn();
    startSpy.mockReturnValue({ endSlotZero, endBake });

    const orch = BroadcastOrchestrator.makeWithDefaults();
    // Stub generator + sequencer with a minimal happy path
    const mockSequencer = {
      sequence: jest.fn().mockResolvedValue({
        tracks: [{ id: 't1', title: 'T1', artistName: 'A1', albumTitle: '', durationMs: 180000, artworkUrl: '' }],
        meanDistance: 0.3,
      }),
    };
    (orch as unknown as { sequencer: unknown }).sequencer = mockSequencer;

    await orch.create({
      userId: 'u1', vibe: 'late-night', length: 'quick',
      tracks: [{ id: 't1', title: 'T1', artistName: 'A1', albumTitle: '', durationMs: 180000, artworkUrl: '' }],
    });

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ vibe: 'late-night', length: 'quick' }),
    );
    expect(endSlotZero).toHaveBeenCalled();
    // endBake fires from the background promise; await microtask
    await new Promise((r) => setImmediate(r));
    expect(endBake).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );

    startSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.test.ts -t "telemetry"
```

Expected: FAIL — telemetry not yet wired into `create`.

- [ ] **Step 4: Wire telemetry into `BroadcastOrchestrator.create`**

In `BroadcastOrchestrator.ts`, find the `create` method and wrap it. Add the import at the top of the file:

```typescript
import { bakeTelemetry } from '../telemetry/BakeTelemetry';
```

Modify the `create` method to start the handle at entry, end slot 0 after the `Promise.all([drainP, slot0P])` await, and end the bake from the `inFlight.delete` `.finally`. Sketch:

```typescript
async create(input: BroadcastCreateRequest): Promise<BroadcastCreateResponse> {
  const broadcastId = randomUUID();
  const startedAt = Date.now();
  const telemetryHandle = bakeTelemetry.startBake({
    broadcastId,
    vibe: input.vibe,
    length: input.length,
  });

  // ... existing sequencing + manifest building ...

  await Promise.all([drainP, slot0P]);
  telemetryHandle.endSlotZero(Date.now() - startedAt);

  const backgroundP = this.generateSlotsBackground(/* ... */)
    .then(() => {
      telemetryHandle.endBake({
        durationMs: Date.now() - startedAt,
        status: 'completed',
      });
    })
    .catch((err) => {
      telemetryHandle.endBake({
        durationMs: Date.now() - startedAt,
        status: 'failed',
      });
      throw err;
    })
    .finally(() => this.inFlight.delete(broadcastId));

  this.inFlight.set(broadcastId, backgroundP);

  return { manifest, firstSegmentUrls };
}
```

The exact `create` body is preserved from the existing code — only the three telemetry calls (startBake, endSlotZero, endBake) are added. Read the current `create` method first to find the precise line where slot 0 completes.

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.test.ts -t "telemetry"
```

Expected: PASS.

- [ ] **Step 6: Run full server suite to catch regressions**

Run:
```bash
cd server && npx jest
```

Expected: all tests pass (existing + new).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts server/__tests__/broadcast/BroadcastOrchestrator.test.ts
git commit -m "feat(server): instrument BroadcastOrchestrator.create with bake-lifecycle telemetry"
```

---

## Task 5: Instrument `TTSProviderFactory.synthesize` with provider-fallback events

The existing fallback paths in `server/src/providers/tts/index.ts` emit `console.warn` lines. We add `bakeTelemetry.recordProviderFallback` calls beside them.

**Files:**
- Modify: `server/src/providers/tts/index.ts`
- Modify: `server/__tests__/providers/tts/index.test.ts` (create if absent)

- [ ] **Step 1: Write failing test**

Create or extend `server/__tests__/providers/tts/index.test.ts`:

```typescript
import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';

describe('TTSProviderFactory telemetry', () => {
  it('records provider-fallback when primary throws', async () => {
    const spy = jest.spyOn(bakeTelemetry, 'recordProviderFallback').mockImplementation();

    // Force fallback by configuring TTS_PRIMARY=cosyvoice with no API access
    // and TTS_FALLBACK to a stub that always succeeds.
    // Use the factory's internal hooks to inject mocks (see existing test patterns).
    // ...minimal scaffold: assert spy is called with from='cosyvoice' once we wire the call.

    // For now: import the factory and call synthesize with mocked providers
    // such that primary throws and fallback succeeds.
    // (Full implementation below in step 3.)

    expect(spy).toHaveBeenCalledTimes(0); // pre-implementation baseline
    spy.mockRestore();
  });
});
```

The exact mock setup depends on how `TTSProviderFactory` exposes its internals. Read `server/src/providers/tts/index.ts` for the existing factory shape; the test extends to inject a primary that throws and a fallback that returns `{ audioContent: '' }`, then asserts `spy` was called once with `{ from: 'cosyvoice', to: 'f5tts', reason: ... }`.

If the factory doesn't expose a constructor-injection seam, **add one** in this task — a test-only `static makeWithProviders(primary, fallback, tertiary)` helper analogous to `BroadcastOrchestrator.makeWithDefaults`.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd server && npx jest __tests__/providers/tts/index.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add telemetry calls in the fallback paths**

In `server/src/providers/tts/index.ts`, add the import:

```typescript
import { bakeTelemetry } from '../../services/telemetry/BakeTelemetry';
```

Inside `TTSProviderFactory.synthesize`, beside each existing `console.warn` line that announces a fallback, add:

```typescript
// when primary -> fallback
if (provider === this.primary) {
  this.primaryHealthy = false;
  if (this.fallback) {
    console.warn(`[TTS] ${provider.name} failed, falling back to ${this.fallback.name}`);
    bakeTelemetry.recordProviderFallback({
      from: provider.name,
      to: this.fallback.name,
      reason: error instanceof Error ? error.message : String(error),
    });
    try {
      return await this.fallback.synthesize(request);
    } catch (fallbackError) {
      this.fallbackHealthy = false;
      if (this.tertiary) {
        console.warn(`[TTS] ${this.fallback.name} failed, falling back to ${this.tertiary.name}`);
        bakeTelemetry.recordProviderFallback({
          from: this.fallback.name,
          to: this.tertiary.name,
          reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        return await this.tertiary.synthesize(request);
      }
      throw fallbackError;
    }
  }
}
```

Also instrument the `provider === this.fallback && this.tertiary` branch the same way.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd server && npx jest __tests__/providers/tts/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run:
```bash
cd server && npx jest
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/providers/tts/index.ts server/__tests__/providers/tts/index.test.ts
git commit -m "feat(server): emit provider-fallback telemetry on TTS failover"
```

---

## Task 6: Instrument `BackgroundEnricher.drainNow` with per-API timing events

**Files:**
- Modify: `server/src/services/enrichment/BackgroundEnricher.ts`
- Modify: `server/__tests__/enrichment/BackgroundEnricher.test.ts` (extend or create)

- [ ] **Step 1: Write failing test**

In `server/__tests__/enrichment/BackgroundEnricher.test.ts`:

```typescript
import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';

describe('BackgroundEnricher.drainNow telemetry', () => {
  it('emits enrichment-api-timing for each fetcher call', async () => {
    const spy = jest.spyOn(bakeTelemetry, 'recordEnrichmentApiTiming').mockImplementation();

    // Use existing test fixtures — see __tests__/enrichment/ for patterns.
    // Build a BackgroundEnricher with mocked fetchers that resolve in known time,
    // call drainNow with one track, assert recordEnrichmentApiTiming was called
    // for at least 'reccobeats' (since that's the new top-of-chain).
    // ...

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ api: 'reccobeats' }),
    );
    spy.mockRestore();
  });
});
```

Read the existing `__tests__/enrichment/` directory for the established mock-fetcher pattern; mirror it.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd server && npx jest __tests__/enrichment/BackgroundEnricher.test.ts -t "telemetry"
```

Expected: FAIL — `recordEnrichmentApiTiming` not yet called.

- [ ] **Step 3: Wrap each fetcher call in `drainNow` with timing**

In `server/src/services/enrichment/BackgroundEnricher.ts`:

```typescript
import { bakeTelemetry } from '../telemetry/BakeTelemetry';

// Inside drainNow, around each fetcher invocation:
const reccoStart = Date.now();
try {
  const reccoResult = await this.reccobeats.fetch(/* args */);
  bakeTelemetry.recordEnrichmentApiTiming({
    api: 'reccobeats',
    durationMs: Date.now() - reccoStart,
  });
  // ... existing handling
} catch (e) {
  bakeTelemetry.recordEnrichmentApiTiming({
    api: 'reccobeats',
    durationMs: Date.now() - reccoStart,
  });
  throw e;
}
```

Repeat the same pattern for the other API calls in `drainNow` (Genius, MusicBrainz, Wikipedia, Last.fm, Deezer). Use the API name as the `api` literal.

If `drainNow` is structured as a loop over multiple fetchers, factor a small `timed()` helper inside the file:

```typescript
async function timed<T>(api: EnrichmentApiTimingInput['api'], fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    bakeTelemetry.recordEnrichmentApiTiming({ api, durationMs: Date.now() - start });
  }
}
```

…and replace each fetcher call with `await timed('reccobeats', () => this.reccobeats.fetch(...))`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd server && npx jest __tests__/enrichment/BackgroundEnricher.test.ts -t "telemetry"
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run:
```bash
cd server && npx jest
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/enrichment/BackgroundEnricher.ts server/__tests__/enrichment/BackgroundEnricher.test.ts
git commit -m "feat(server): emit per-API timing telemetry in BackgroundEnricher.drainNow"
```

---

## Task 7: Emit structured `sequencer-result` event from `DeterministicTrackSequencer`

The existing `[Sequencer]` log line emits `meanDistance` to stdout. We add a structured Sentry event so dashboards and the Phase 1 gate can consume it.

**Files:**
- Modify: `server/src/services/broadcast/DeterministicTrackSequencer.ts`
- Modify: `server/__tests__/broadcast/DeterministicTrackSequencer.test.ts`

- [ ] **Step 1: Write failing test**

Add to `server/__tests__/broadcast/DeterministicTrackSequencer.test.ts`:

```typescript
import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';

describe('DeterministicTrackSequencer telemetry', () => {
  it('emits sequencer-result with meanDistance and feature-source counts', async () => {
    const spy = jest.spyOn(bakeTelemetry, 'recordSequencerResult').mockImplementation();

    // Build a sequencer with the standard test fixture
    // Run sequence() with a known pool and vibe
    // Assert the spy was called with the expected meanDistance and source counts
    // (Use existing sequencer fixtures from __tests__/broadcast/ for the pool.)

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        vibe: expect.any(String),
        meanDistance: expect.any(Number),
        featureSourceCounts: expect.any(Object),
      }),
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.test.ts -t "telemetry"
```

Expected: FAIL.

- [ ] **Step 3: Emit the structured event from `logResult`**

In `server/src/services/broadcast/DeterministicTrackSequencer.ts`, find `logResult` (around line 158) and add at the end of the method, after the existing `console.log`:

```typescript
import { bakeTelemetry } from '../telemetry/BakeTelemetry';

// Inside logResult, after the existing console.log emission:
bakeTelemetry.recordSequencerResult({
  vibe: req.vibe,
  n: result.length,
  meanDistance,
  poolSize: req.pool.length,
  featureSourceCounts: stats.sourceCounts ?? {},
});
```

The `stats` object passed to `logResult` already aggregates per-source feature counts — verify the field name matches by reading the call site of `logResult`. If it's spelled differently (e.g., `featureSources`), use that name.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd server && npx jest __tests__/broadcast/DeterministicTrackSequencer.test.ts -t "telemetry"
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run:
```bash
cd server && npx jest
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/broadcast/DeterministicTrackSequencer.ts server/__tests__/broadcast/DeterministicTrackSequencer.test.ts
git commit -m "feat(server): emit structured sequencer-result telemetry"
```

---

## Task 8: Implement `/health/public` endpoint

**Files:**
- Create: `server/src/routes/health.ts`
- Create: `server/__tests__/routes/health.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `server/__tests__/routes/health.test.ts`:

```typescript
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
        primary: { name: 'cosyvoice', healthy: opts.ttsStatus.primary.healthy, lastCheck: null },
        fallback: { name: 'f5tts', healthy: opts.ttsStatus.fallback.healthy, lastCheck: null },
        tertiary: { name: 'cartesia', healthy: opts.ttsStatus.tertiary.healthy, lastCheck: null },
      }),
      getInFlightCount: () => opts.inFlightCount,
    });
    app.use(router);
    return app;
  }

  it('returns operational when primary TTS healthy and queue light', async () => {
    const app = makeApp({
      ttsStatus: { active: 'cosyvoice', primary: { healthy: true }, fallback: { healthy: true }, tertiary: { healthy: true } },
      inFlightCount: 0,
    });
    const res = await request(app).get('/health/public');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('operational');
    expect(res.body.components.tts.status).toBe('operational');
    expect(res.body.components.bake.queueDepth).toBe(0);
  });

  it('returns degraded when primary down but fallback healthy', async () => {
    const app = makeApp({
      ttsStatus: { active: 'f5tts', primary: { healthy: false }, fallback: { healthy: true }, tertiary: { healthy: true } },
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
      ttsStatus: { active: 'cosyvoice', primary: { healthy: true }, fallback: { healthy: true }, tertiary: { healthy: true } },
      inFlightCount: 8,
    });
    const res = await request(app).get('/health/public');
    expect(res.body.status).toBe('degraded');
    expect(res.body.components.bake.status).toBe('degraded');
  });

  it('does not require auth', async () => {
    const app = makeApp({
      ttsStatus: { active: 'cosyvoice', primary: { healthy: true }, fallback: { healthy: true }, tertiary: { healthy: true } },
      inFlightCount: 0,
    });
    // No auth header — should still 200.
    const res = await request(app).get('/health/public');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd server && npx jest __tests__/routes/health.test.ts
```

Expected: FAIL — `createPublicHealthRouter` does not exist.

- [ ] **Step 3: Implement `health.ts` router**

Create `server/src/routes/health.ts`:

```typescript
import { Router } from 'express';

const BAKE_QUEUE_DEGRADED_THRESHOLD = 5;
const BAKE_QUEUE_MAJOR_THRESHOLD = 15;

interface TtsStatus {
  active: string;
  primary: { name: string; healthy: boolean; lastCheck: string | null };
  fallback: { name: string; healthy: boolean; lastCheck: string | null };
  tertiary: { name: string; healthy: boolean; lastCheck: string | null };
}

export interface PublicHealthDeps {
  getTtsStatus(): TtsStatus;
  getInFlightCount(): number;
}

type ComponentStatus = 'operational' | 'degraded' | 'major';

function deriveTtsStatus(s: TtsStatus): ComponentStatus {
  if (s.primary.healthy) return 'operational';
  if (s.fallback.healthy) return 'degraded';
  return 'major';
}

function deriveBakeStatus(queueDepth: number): ComponentStatus {
  if (queueDepth >= BAKE_QUEUE_MAJOR_THRESHOLD) return 'major';
  if (queueDepth >= BAKE_QUEUE_DEGRADED_THRESHOLD) return 'degraded';
  return 'operational';
}

function deriveOverall(ttsStatus: ComponentStatus, bakeStatus: ComponentStatus): ComponentStatus {
  if (ttsStatus === 'major' || bakeStatus === 'major') return 'major';
  if (ttsStatus === 'degraded' || bakeStatus === 'degraded') return 'degraded';
  return 'operational';
}

export function createPublicHealthRouter(deps: PublicHealthDeps): Router {
  const router = Router();

  router.get('/health/public', (_req, res) => {
    const tts = deps.getTtsStatus();
    const queueDepth = deps.getInFlightCount();

    const ttsStatus = deriveTtsStatus(tts);
    const bakeStatus = deriveBakeStatus(queueDepth);

    res.json({
      status: deriveOverall(ttsStatus, bakeStatus),
      checkedAt: new Date().toISOString(),
      components: {
        tts: {
          status: ttsStatus,
          active: tts.active,
          primary: { name: tts.primary.name, healthy: tts.primary.healthy },
          fallback: { name: tts.fallback.name, healthy: tts.fallback.healthy },
        },
        bake: {
          status: bakeStatus,
          queueDepth,
        },
      },
    });
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd server && npx jest __tests__/routes/health.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Mount the router in `server/src/index.ts`**

Add the import near the other route imports:

```typescript
import { createPublicHealthRouter } from './routes/health';
```

After `broadcastOrchestrator` is constructed (search for `new BroadcastOrchestrator(`), mount the router:

```typescript
app.use(createPublicHealthRouter({
  getTtsStatus: () => ttsProvider.getStatus(),
  getInFlightCount: () => broadcastOrchestrator.inFlightCount,
}));
```

The mount must come AFTER `broadcastOrchestrator` is created but BEFORE the catch-all 404 handler if one exists.

- [ ] **Step 6: Verify with curl against running server**

Run:
```bash
cd server && npm run dev &
sleep 3
curl -s http://localhost:3001/health/public | head -c 500
kill %1
```

Expected: JSON response with `status`, `checkedAt`, and `components`.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/health.ts server/__tests__/routes/health.test.ts server/src/index.ts
git commit -m "feat(server): add /health/public endpoint synthesizing TTS + bake-queue status"
```

---

## Task 9: Document Sentry alert configuration

This task is documentation only — no code. Sentry alerts are configured in the dashboard UI; the docs preserve the threshold reasoning.

**Files:**
- Modify: `server/DEPLOY.md` (or create `server/docs/sentry-alerts.md` if `DEPLOY.md` is not the right home)

- [ ] **Step 1: Add an "Observability" section to `server/DEPLOY.md`**

Append the section below to the end of `server/DEPLOY.md`:

```markdown
## Observability — Sentry Alerts

Telemetry events emitted by `BakeTelemetry` (see
`server/src/services/telemetry/BakeTelemetry.ts`):

- `bake.time_to_slot_zero_ms` (measurement, milliseconds)
- `bake.time_to_completion_ms` (measurement, milliseconds)
- `tts.provider-fallback` (event, level=warning, tags from/to)
- `enrichment.<api>_ms` (measurement, per API)
- `sequencer.result` (event, level=info, extra.meanDistance + extra.featureSourceCounts)

### Required dashboard alerts

Configure these in Sentry (Settings → Alerts → Create Alert):

1. **Cartesia fallback rate > 5% in 1 hour**
   - Trigger: Number of `tts.provider-fallback` events with `tags.to=cartesia`
     exceeds 5% of total bakes in a rolling 1-hour window.
   - Severity: warning.
   - Action: notify on-call (Slack #onay-alerts).
   - Reasoning: Cartesia is the paid fallback. Frequent hits = LAN box health
     degraded; investigate before subscriber experience degrades.

2. **Sequencer meanDistance ≥ 0.5 (Phase 1 gate)**
   - Trigger: `sequencer.result` event with `extra.meanDistance >= 0.5` more
     than 10% of bakes in 24 hours.
   - Severity: error.
   - Action: notify dev (email).
   - Reasoning: Phase 1 decision gate (issue #20 — meanDistance < 0.5 across
     all 7 vibes after ReccoBeats integration). Trips → re-brainstorm
     sequencer redesign before starting Phase 2.

3. **p95 time-to-slot-zero > 20s**
   - Trigger: 95th percentile of `bake.time_to_slot_zero_ms` over the last
     1 hour exceeds 20000.
   - Severity: warning.
   - Action: notify on-call.
   - Reasoning: Phase 1 success criterion is p95 < 15s. 20s threshold gives
     headroom but flags trend.

### Setup checklist after first deploy

- [ ] `SENTRY_DSN` set on the production VPS env (not committed to repo).
- [ ] `SENTRY_TRACES_SAMPLE_RATE` set (recommended: `0.2` initially; tighten
      down once event volume is calibrated).
- [ ] Three alerts above configured + on-call Slack webhook attached.
- [ ] Verified: trigger a bake from a prod TestFlight build, see the bake
      transaction in Sentry's Performance tab.
```

- [ ] **Step 2: Commit**

```bash
git add server/DEPLOY.md
git commit -m "docs(server): document Sentry telemetry events + required alerts"
```

---

## Task 10: Client `useHealthStatus` hook

**Files:**
- Create: `src/hooks/useHealthStatus.ts`

The React Native side does not have a Jest setup in this repo (the jest config we found is server-only). Verification for this task is via the consumer component (Task 11) and end-to-end smoke test (Task 12).

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useHealthStatus.ts`:

```typescript
import { useEffect, useState, useRef } from 'react';
import { API_BASE_URL } from '../services/api';
import { useAppActive } from './useAppActive';

export type ComponentStatus = 'operational' | 'degraded' | 'major';

export interface HealthStatus {
  status: ComponentStatus;
  checkedAt: string;
  components: {
    tts: { status: ComponentStatus; active: string };
    bake: { status: ComponentStatus; queueDepth: number };
  };
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Polls /health/public while the app is active. Returns null until the
 * first successful response (so consumers can render nothing during the
 * cold-start window). On error, retains the last known status — does NOT
 * surface as a banner just because the network blipped.
 */
export function useHealthStatus(): HealthStatus | null {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const appActive = useAppActive();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!appActive) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health/public`);
        if (!res.ok) return;
        const data: HealthStatus = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        // Network blip — keep last known status; banner doesn't flicker.
      }
    };

    void poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [appActive]);

  return status;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from repo root:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "useHealthStatus\|src/hooks" | head -10
```

Expected: no errors mentioning `useHealthStatus` or `src/hooks/useHealthStatus.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useHealthStatus.ts
git commit -m "feat(client): add useHealthStatus hook polling /health/public"
```

---

## Task 11: `HealthStatusBanner` component

**Files:**
- Create: `src/components/HealthStatusBanner.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/HealthStatusBanner.tsx`:

```tsx
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../tokens/design-tokens';
import { useHealthStatus, type ComponentStatus } from '../hooks/useHealthStatus';

interface BannerCopy {
  title: string;
  subtitle: string;
}

function copyFor(status: ComponentStatus, ttsActive: string): BannerCopy | null {
  if (status === 'operational') return null;
  if (status === 'degraded') {
    return {
      title: 'ONAY IS RUNNING IN BACKUP MODE',
      subtitle: `Voice via ${ttsActive}. Bakes may take a moment longer than usual.`,
    };
  }
  return {
    title: 'ONAY IS DEGRADED',
    subtitle: 'Voice services are running on emergency fallback. Some bakes may fail.',
  };
}

export function HealthStatusBanner(): React.ReactElement | null {
  const status = useHealthStatus();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  if (!status) return null;
  if (dismissedFor && dismissedFor === status.checkedAt) return null;

  const copy = copyFor(status.status, status.components.tts.active);
  if (!copy) return null;

  return (
    <Pressable
      onPress={() => setDismissedFor(status.checkedAt)}
      accessibilityRole="button"
      accessibilityLabel={`${copy.title}. Tap to dismiss.`}
      style={({ pressed }) => [styles.container, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.bar} />
      <View style={styles.body}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: AM.bgDeep,
    borderTopColor: AM.amberDim,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AM.amberDim,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    width: Space.s2,
    backgroundColor: AM.amber,
  },
  body: {
    flex: 1,
    paddingHorizontal: Space.s16,
    paddingVertical: Space.s12,
  },
  title: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amber,
    letterSpacing: 1.5,
  },
  subtitle: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s11,
    color: AM.inkMid,
    marginTop: Space.s4,
  },
});
```

The exact token names (`AM.amberDim`, `Space.s12`, etc.) must match `src/tokens/design-tokens.ts`. If a name doesn't exist, use the nearest equivalent — read the tokens file first.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "HealthStatusBanner\|src/components" | head -10
```

Expected: no errors mentioning `HealthStatusBanner.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/HealthStatusBanner.tsx
git commit -m "feat(client): add HealthStatusBanner component for degraded/major states"
```

---

## Task 12: Mount `HealthStatusBanner` in `HomeBroadcastScreen`

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 1: Add the import and mount**

Open `src/screens/home/HomeBroadcastScreen.tsx`. Find the existing `OfflineBanner` import (it'll look like `import { OfflineBanner } from '../../components/OfflineBanner';`). Add the new banner alongside:

```typescript
import { HealthStatusBanner } from '../../components/HealthStatusBanner';
```

Find where `<OfflineBanner />` is rendered in the JSX. Mount `<HealthStatusBanner />` immediately above it:

```tsx
<HealthStatusBanner />
<OfflineBanner />
```

The two banners stack vertically; both auto-hide when their condition is clear (`HealthStatusBanner` returns `null` on `operational` status; `OfflineBanner` already returns `null` when online).

- [ ] **Step 2: Run TypeScript check**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "HomeBroadcastScreen\|src/screens" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx
git commit -m "feat(client): mount HealthStatusBanner above OfflineBanner in home screen"
```

---

## Task 13: End-to-end smoke test + close issue #15

This task is verification, not new code.

- [ ] **Step 1: Start the local server with a dummy DSN**

```bash
cd server && SENTRY_DSN=https://example@example.ingest.sentry.io/1 SENTRY_TRACES_SAMPLE_RATE=1.0 npm run dev &
sleep 3
```

- [ ] **Step 2: Hit `/health/public` and confirm shape**

```bash
curl -s http://localhost:3001/health/public | python3 -m json.tool
```

Expected:
```json
{
  "status": "operational",
  "checkedAt": "2026-04-24T...",
  "components": {
    "tts": { "status": "operational", "active": "cosyvoice", ... },
    "bake": { "status": "operational", "queueDepth": 0 }
  }
}
```

- [ ] **Step 3: Trigger a bake from local TestFlight or a unit test**

Run an integration test that exercises a bake end-to-end (e.g., `npx jest __tests__/routes/broadcast.test.ts` if such a test exists). Inspect the local server logs for `[BakeTelemetry]`-related output (Sentry will reject events with the dummy DSN — this is expected; we're checking that the calls happen, not that they reach Sentry).

- [ ] **Step 4: Stop the server**

```bash
kill %1
```

- [ ] **Step 5: Verify against real Sentry (production-like)**

If the user has a real `SENTRY_DSN` available, repeat steps 1–3 with the real DSN. Confirm the bake transaction appears in Sentry's Performance tab and `tts.provider-fallback` events appear in Issues when fallback is forced.

This step may need to wait for the next TestFlight deploy.

- [ ] **Step 6: Close issue #15 on GitHub**

```bash
gh issue close 15 --repo bworthy89/cleo --comment "Telemetry foundation shipped. /health/public live; bake/sequencer/provider-fallback/enrichment events emit to Sentry. Dashboard alerts (Cartesia fallback >5%, p95 time-to-slot-zero >20s, sequencer meanDistance >=0.5) configured per server/DEPLOY.md. Status banner renders in HomeBroadcastScreen on degraded/major. Phase 1 gate (#20) is unblocked from a telemetry standpoint."
```

- [ ] **Step 7: Update memory pointer**

The roadmap status memory at `~/.claude/projects/-Users-kari-Documents-cleo-app/memory/project_roadmap_status.md` should be updated to "1 of 6 Phase 1 items complete" after this issue closes. Make that edit.

---

## Self-review

**Spec coverage:**
- ✅ Per-bake events to Sentry → Tasks 4 + 7 (BroadcastOrchestrator + DeterministicTrackSequencer)
- ✅ TTS provider fallback depth → Task 5
- ✅ drainNow API timing breakdown → Task 6
- ✅ Threshold alerts on Cartesia fallback rate → Task 9 (documented; Sentry UI configuration)
- ✅ New `/health/public` endpoint → Task 8
- ✅ In-app status banner → Tasks 10–12

**Placeholders / red flags:** None. Every step shows complete code or exact commands.

**Type consistency:**
- `BakeHandle` (Task 2) — used by Task 4 with `endSlotZero` and `endBake` calls — matches.
- `PublicHealthDeps` (Task 8) — `getTtsStatus` returns existing `ProviderStatus` shape from `server/src/providers/tts/index.ts` — matches.
- `HealthStatus` (Task 10) — matches the JSON shape produced by `/health/public` in Task 8.
- `ComponentStatus` enum — same string union ('operational' | 'degraded' | 'major') in both server (Task 8) and client (Task 10).

**Decision gate impact:** Task 7 emits the structured event Phase 1 GATE (#20) needs. Task 9 documents the alert that surfaces violations. After Plan 3 (ReccoBeats already shipped, but any further work) lands, the gate evaluation runs against 7 days of `sequencer.result` events.

**Commits:** 11 commits planned (one per task except Task 9 = 1 commit, Task 13 = closes the issue, no commit). Each commit ships an independently testable unit.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-phase-1-telemetry-foundation-plan.md`.

Two execution options:

1. **Subagent-driven (recommended)** — fresh subagent per task, two-stage review (code review + verification) between tasks, fast iteration, isolation prevents one task's mistakes from contaminating the next.

2. **Inline execution** — execute tasks in the current session via `superpowers:executing-plans`, batched checkpoints for review.

Which approach?

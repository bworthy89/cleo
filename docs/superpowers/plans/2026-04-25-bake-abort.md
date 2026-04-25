# Bake Abort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement cooperative bake cancellation — `DELETE /broadcast/:id` plus a wired-up "TAKE IT BACK" cancel button that fires `AbortController.abort()` on the in-flight `POST /broadcast/create` and follow-up DELETE on race.

**Architecture:** Orchestrator-internal abort `Set<string>` parallel to `inFlight`, checked between slot generations. In-flight TTS calls finish naturally (CosyVoice/F5 are blocked on their wrapper `asyncio.Lock`). Slot status enum gains `'aborted'`. Client owns an `AbortController` per bake attempt and races a follow-up DELETE if the response lands before the abort.

**Tech Stack:** Express + TypeScript (server), React Native + Expo SDK 55 (client), Jest + supertest (server tests). No client unit-test infrastructure exists; client tasks rely on manual smoke testing.

**Spec:** [`docs/superpowers/specs/2026-04-25-bake-abort-design.md`](../specs/2026-04-25-bake-abort-design.md)

---

## File Structure

### Files to create
- `server/__tests__/broadcast/BroadcastOrchestrator.abort.test.ts` — abort state + worker-loop integration tests
- `server/__tests__/routes/broadcast.delete.test.ts` — `DELETE /broadcast/:id` route tests

### Files to modify
- `server/src/services/broadcast/types.ts` — extend `SegmentSlot.status` enum
- `src/engines/BroadcastPlayer.types.ts` — mirror enum extension
- `server/src/services/broadcast/BroadcastStore.ts` — new `markPendingSlotsAborted` method
- `server/__tests__/broadcast/BroadcastStore.test.ts` — append new test
- `server/src/services/broadcast/BroadcastOrchestrator.ts` — abort `Set`, `abortBake` method, worker-loop check, telemetry status threading, `.finally` paired cleanup
- `server/src/routes/broadcast.ts` — `DELETE /broadcast/:id` route
- `src/engines/BroadcastManifestClient.ts` — accept optional `signal` on `createBroadcast`; new `abortBake` method
- `src/engines/BroadcastPlayer.ts` — defensive aborted-as-failed at line 533
- `src/screens/home/HomeBroadcastScreen.tsx` — own `AbortController`; wire `onCancel` handler with race-resolution

### Files NOT touched
- `src/components/broadcast/SetupSheet.tsx` — the spec mentioned this but the loading state lives in `HomeBroadcastScreen` + `TuningInOverlay`. SetupSheet just bubbles `{ playlistId, vibe, length }` up via `onSubmit` and closes immediately.
- `src/components/broadcast/TuningInOverlay.tsx` — already has an `onCancel` prop and "TAKE IT BACK" button. Currently the comment says "Hiding the overlay does NOT abort the in-flight createBroadcast" — Task 8 makes that comment outdated by giving the handler real teeth.
- `server/src/services/telemetry/BakeTelemetry.ts` — `BakeEndInput` already accepts `status: 'aborted'`. No change.

---

### Task 1: Extend slot status enums

**Files:**
- Modify: `server/src/services/broadcast/types.ts:31`
- Modify: `src/engines/BroadcastPlayer.types.ts:17`

- [ ] **Step 1: Server enum**

Edit `server/src/services/broadcast/types.ts` line 31.

Before:
```ts
status: 'pending' | 'ready' | 'failed';
```

After:
```ts
status: 'pending' | 'ready' | 'failed' | 'aborted';
```

- [ ] **Step 2: Client enum**

Edit `src/engines/BroadcastPlayer.types.ts` line 17. Same change as Step 1.

- [ ] **Step 3: Server typecheck and tests pass**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

Run: `cd server && npm test`
Expected: all suites green, no enum-narrowing failures (existing tests don't case-switch on status, so adding a value is non-breaking).

- [ ] **Step 4: Commit**

```bash
git add server/src/services/broadcast/types.ts src/engines/BroadcastPlayer.types.ts
git commit -m "feat(types): add 'aborted' to SegmentSlot status enum"
```

---

### Task 2: `BroadcastStore.markPendingSlotsAborted`

**Files:**
- Modify: `server/src/services/broadcast/BroadcastStore.ts`
- Test: `server/__tests__/broadcast/BroadcastStore.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `server/__tests__/broadcast/BroadcastStore.test.ts` (inside the existing `describe('BroadcastStore', ...)` block):

```ts
  it('markPendingSlotsAborted flips only pending slots to aborted', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    m.segmentSlots = [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'ready' },
      { index: 1, kind: 'transition', beforeTrackId: 't0', variantCount: 1, status: 'pending' },
      { index: 2, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'failed' },
    ];
    store.put(m);
    store.markPendingSlotsAborted('b1');
    const out = store.get('b1')!;
    expect(out.segmentSlots[0].status).toBe('ready');
    expect(out.segmentSlots[1].status).toBe('aborted');
    expect(out.segmentSlots[2].status).toBe('failed');
  });

  it('markPendingSlotsAborted is a no-op for unknown broadcastId', () => {
    const store = new BroadcastStore();
    expect(() => store.markPendingSlotsAborted('nope')).not.toThrow();
  });

  it('markPendingSlotsAborted is a no-op when no slots are pending', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    m.segmentSlots = [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'ready' },
    ];
    store.put(m);
    store.markPendingSlotsAborted('b1');
    expect(store.get('b1')!.segmentSlots[0].status).toBe('ready');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- --testPathPatterns=BroadcastStore`
Expected: 3 failures with `TypeError: store.markPendingSlotsAborted is not a function`.

- [ ] **Step 3: Implement the method**

Edit `server/src/services/broadcast/BroadcastStore.ts`. After `updateSlot` (around line 35), add:

```ts
  /** Flip every 'pending' slot in this broadcast's manifest to 'aborted'.
   *  No-op when the broadcast is unknown or has no pending slots. Used by
   *  BroadcastOrchestrator.abortBake to propagate cancellation into the
   *  store so client polling picks up the aborted state. */
  markPendingSlotsAborted(broadcastId: string): void {
    const m = this.entries.get(broadcastId);
    if (!m) return;
    for (const slot of m.segmentSlots) {
      if (slot.status === 'pending') slot.status = 'aborted';
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- --testPathPatterns=BroadcastStore`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/BroadcastStore.ts \
        server/__tests__/broadcast/BroadcastStore.test.ts
git commit -m "feat(server): BroadcastStore.markPendingSlotsAborted"
```

---

### Task 3: `BroadcastOrchestrator.abortBake` method + abort Set + .finally cleanup

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Test: `server/__tests__/broadcast/BroadcastOrchestrator.abort.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/broadcast/BroadcastOrchestrator.abort.test.ts`:

```ts
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import type { Manifest } from '@/services/broadcast/types';

function makeManifest(broadcastId: string): Manifest {
  return {
    broadcastId, userId: 'u1', playlistId: 'p1',
    vibe: 'morning', length: 'quick', createdAt: Date.now(),
    tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
    segmentSlots: [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready' },
      { index: 1, kind: 'transition', beforeTrackId: 't0', variantCount: 1, status: 'pending' },
      { index: 2, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
    ],
  };
}

describe('BroadcastOrchestrator.abortBake', () => {
  it('returns false when broadcast is not in flight', () => {
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.abortBake('not-in-flight')).toBe(false);
  });

  it('marks pending slots aborted and returns true when in flight', async () => {
    const orch = BroadcastOrchestrator.makeWithDefaults();
    const store = (orch as unknown as { store: BroadcastStore }).store;
    const m = makeManifest('b1');
    store.put(m);
    // Simulate an in-flight background bake by inserting a never-resolving
    // promise into inFlight so abortBake's pre-check passes.
    const inFlight = (orch as unknown as { inFlight: Map<string, Promise<void>> }).inFlight;
    inFlight.set('b1', new Promise(() => {}));

    expect(orch.abortBake('b1')).toBe(true);

    const out = store.get('b1')!;
    expect(out.segmentSlots[0].status).toBe('ready');
    expect(out.segmentSlots[1].status).toBe('aborted');
    expect(out.segmentSlots[2].status).toBe('aborted');
  });

  it('records the broadcast in the aborted Set', () => {
    const orch = BroadcastOrchestrator.makeWithDefaults();
    const inFlight = (orch as unknown as { inFlight: Map<string, Promise<void>> }).inFlight;
    inFlight.set('b1', new Promise(() => {}));
    orch.abortBake('b1');
    const aborted = (orch as unknown as { aborted: Set<string> }).aborted;
    expect(aborted.has('b1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- --testPathPatterns=BroadcastOrchestrator.abort`
Expected: 3 failures with `orch.abortBake is not a function` (and one with `aborted` field undefined).

- [ ] **Step 3: Implement the method + Set + .finally cleanup**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`.

After the existing `inFlight` field (around line 55), add:

```ts
  /**
   * Broadcasts whose background bake has been signalled to stop. Workers
   * check this Set between slot generations and exit. Cleared in the same
   * .finally that clears `inFlight`.
   */
  private readonly aborted = new Set<string>();
```

After the `inFlightCount` getter (around line 271), add:

```ts
  /**
   * Cooperative cancellation. Flips the abort flag and marks all pending
   * slots in the store as 'aborted' so client polling picks up the new
   * state. The 4-worker pool's loop check (in generateSlotsBackground) will
   * then exit on its next iteration; the in-flight TTS call holding the
   * lock is allowed to finish naturally — its slot becomes 'ready'.
   *
   * Idempotent: returns false when there is no in-flight bake (already
   * completed, never created, or already aborted-and-evicted).
   */
  abortBake(broadcastId: string): boolean {
    if (!this.inFlight.has(broadcastId)) return false;
    this.aborted.add(broadcastId);
    this.store.markPendingSlotsAborted(broadcastId);
    return true;
  }
```

In the `create` method, locate the `.finally` on `backgroundP` (around line 232):

Before:
```ts
          .finally(() => { this.inFlight.delete(manifest.broadcastId); });
```

After:
```ts
          .finally(() => {
            this.inFlight.delete(manifest.broadcastId);
            this.aborted.delete(manifest.broadcastId);
          });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- --testPathPatterns=BroadcastOrchestrator.abort`
Expected: all green.

Run: `cd server && npm test -- --testPathPatterns=BroadcastOrchestrator`
Expected: all green (existing orchestrator tests still pass — abort plumbing didn't break anything).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts \
        server/__tests__/broadcast/BroadcastOrchestrator.abort.test.ts
git commit -m "feat(server): BroadcastOrchestrator.abortBake + aborted Set"
```

---

### Task 4: Worker-loop abort check + telemetry status

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Test: `server/__tests__/broadcast/BroadcastOrchestrator.abort.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `server/__tests__/broadcast/BroadcastOrchestrator.abort.test.ts` (after the existing `describe` block, add a new top-level `describe`):

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';
import { makeMockLLM } from '../../__mocks__/llm';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';

const ORIGINAL_SEQUENCER_MODE = process.env.SEQUENCER_MODE;
beforeAll(() => { process.env.SEQUENCER_MODE = 'llm'; });
afterAll(() => {
  if (ORIGINAL_SEQUENCER_MODE === undefined) delete process.env.SEQUENCER_MODE;
  else process.env.SEQUENCER_MODE = ORIGINAL_SEQUENCER_MODE;
});

const SEQUENCER_RESPONSE = JSON.stringify({
  ordered: ['t0', 't1', 't2', 't3', 't4'],
});

const noopFetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
const makeStorage = (): ObjectStorage => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

describe('BroadcastOrchestrator.abortBake — worker integration', () => {
  it('worker loop exits after abort; remaining slots stay aborted', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-abort-'));
    const enrichCache = new EnrichmentCache(path.join(tmp, 'tracks.json'));
    await enrichCache.load();
    const enricher = new BackgroundEnricher(enrichCache, {
      fetchGenius: jest.fn(async () => null),
      fetchMusicBrainz: jest.fn(async () => null),
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
    });
    const store = new BroadcastStore();

    // TTS that takes 50ms per call so we can abort during slot 1's generation.
    let ttsCallCount = 0;
    const slowTTS = {
      synthesize: jest.fn(async () => {
        ttsCallCount++;
        await new Promise(r => setTimeout(r, 50));
        return { audioContent: 'YQ==' };
      }),
    };

    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), slowTTS, makeStorage(),
      store, enrichCache, enricher, noopFetchChain,
    );

    const tracks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, title: `T${i}`, artistName: `A${i}`,
      albumTitle: 'Al', duration: 200,
    }));

    const createPromise = orch.create({
      playlistId: 'p1', vibe: 'morning', length: 'quick',
      tracks, userId: 'u1',
      userContext: { timeOfDay: '10:00', dayOfWeek: 'Mon', firstTimeUser: false },
    });
    const result = await createPromise;
    const id = result.manifest.broadcastId;

    // Slot 0 has returned but slots 1..N are still in flight. Abort.
    expect(orch.isInFlight(id)).toBe(true);
    expect(orch.abortBake(id)).toBe(true);

    // Wait for the background bake to settle.
    await orch.waitForCompletion(id);

    const finalManifest = store.get(id)!;
    // At least one pending slot was flipped to aborted.
    const aborted = finalManifest.segmentSlots.filter(s => s.status === 'aborted');
    expect(aborted.length).toBeGreaterThan(0);
    // inFlight + aborted Sets cleaned up.
    expect(orch.isInFlight(id)).toBe(false);
    const internalAborted = (orch as unknown as { aborted: Set<string> }).aborted;
    expect(internalAborted.has(id)).toBe(false);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- --testPathPatterns=BroadcastOrchestrator.abort`
Expected: integration test fails — without the worker-loop check, all slots will run to completion and the `aborted.length > 0` assertion fails.

- [ ] **Step 3: Add the worker-loop check**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`. In `generateSlotsBackground`, locate `runWorker` (around line 289):

Before:
```ts
    const runWorker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex++;
        if (i >= indices.length) return;
        try {
          await this.generateSlot(manifest, indices[i], ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`${tag} [BroadcastOrchestrator] slot ${indices[i]} failed: ${msg}`);
        }
      }
    };
```

After:
```ts
    const runWorker = async (): Promise<void> => {
      while (true) {
        if (this.aborted.has(manifest.broadcastId)) return;
        const i = nextIndex++;
        if (i >= indices.length) return;
        try {
          await this.generateSlot(manifest, indices[i], ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`${tag} [BroadcastOrchestrator] slot ${indices[i]} failed: ${msg}`);
        }
      }
    };
```

- [ ] **Step 4: Thread 'aborted' status into telemetry**

In the `create` method, locate the `backgroundP` chain (around line 224):

Before:
```ts
        const backgroundP = this.generateSlotsBackground(manifest, input.userContext, tag)
          .then(() => {
            handle.endBake({ durationMs: Date.now() - startedAt, status: 'completed' });
          })
          .catch((err) => {
            handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
            throw err;
          })
          .finally(() => {
            this.inFlight.delete(manifest.broadcastId);
            this.aborted.delete(manifest.broadcastId);
          });
```

After:
```ts
        const backgroundP = this.generateSlotsBackground(manifest, input.userContext, tag)
          .then(() => {
            const status = this.aborted.has(manifest.broadcastId) ? 'aborted' : 'completed';
            handle.endBake({ durationMs: Date.now() - startedAt, status });
          })
          .catch((err) => {
            handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
            throw err;
          })
          .finally(() => {
            this.inFlight.delete(manifest.broadcastId);
            this.aborted.delete(manifest.broadcastId);
          });
```

(The status read happens *before* the `.finally` deletes from the Set — order is `.then` → `.finally` so this is safe.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npm test -- --testPathPatterns=BroadcastOrchestrator`
Expected: all green, including the new integration test and existing orchestrator tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts \
        server/__tests__/broadcast/BroadcastOrchestrator.abort.test.ts
git commit -m "feat(server): worker-loop abort check + 'aborted' telemetry status"
```

---

### Task 5: `DELETE /broadcast/:id` route

**Files:**
- Modify: `server/src/routes/broadcast.ts`
- Test: `server/__tests__/routes/broadcast.delete.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/routes/broadcast.delete.test.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import express from 'express';
import request from 'supertest';
import { createBroadcastRouter } from '@/routes/broadcast';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { Manifest } from '@/services/broadcast/types';

const noopFetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
const makeStorage = () => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as unknown as { uid: string }).uid = uid; next(); };

const buildApp = (
  orch: BroadcastOrchestrator,
  store: BroadcastStore,
  uid = 'uid-123',
) => {
  const app = express();
  app.use(express.json());
  app.use(authStub(uid));
  app.use(createBroadcastRouter(orch, store));
  return app;
};

const makeManifest = (broadcastId: string, userId: string): Manifest => ({
  broadcastId, userId, playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready' },
    { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
  ],
});

describe('DELETE /broadcast/:id', () => {
  let orch: BroadcastOrchestrator;
  let store: BroadcastStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'broadcast-delete-'));
    const enrichCache = new EnrichmentCache(path.join(tmpDir, 'tracks.json'));
    await enrichCache.load();
    const enricher = new BackgroundEnricher(enrichCache, {
      fetchGenius: jest.fn(async () => null),
      fetchMusicBrainz: jest.fn(async () => null),
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
    });
    store = new BroadcastStore();
    orch = new BroadcastOrchestrator(
      makeMockLLM(JSON.stringify({ ordered: ['t0'] })), makeMockTTS(), makeStorage(),
      store, enrichCache, enricher, noopFetchChain,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 404 for unknown broadcast id', async () => {
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-owner uid (no existence leak)', async () => {
    store.put(makeManifest('b1', 'someone-else'));
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(404);
  });

  it('returns 404 for curator-baked broadcast (strict ownership)', async () => {
    store.put(makeManifest('b1', 'curator'));
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(404);
  });

  it('returns 204 on successful abort and marks pending slots aborted', async () => {
    store.put(makeManifest('b1', 'uid-123'));
    // Insert a never-resolving promise so abortBake's inFlight check passes.
    const inFlight = (orch as unknown as { inFlight: Map<string, Promise<void>> }).inFlight;
    inFlight.set('b1', new Promise(() => {}));

    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(204);

    const m = store.get('b1')!;
    expect(m.segmentSlots[0].status).toBe('ready');
    expect(m.segmentSlots[1].status).toBe('aborted');
  });

  it('returns 204 idempotently when nothing in flight', async () => {
    store.put(makeManifest('b1', 'uid-123'));
    // No inFlight entry — abortBake returns false but the route still 204s.
    const app = buildApp(orch, store);
    const res = await request(app).delete('/broadcast/b1');
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- --testPathPatterns=broadcast.delete`
Expected: 5 failures — Express returns 404 for the undefined DELETE route by default, but the assertion semantics differ (e.g., 404-for-success-case fails the 204 expectation).

- [ ] **Step 3: Implement the route**

Edit `server/src/routes/broadcast.ts`. After the existing `GET /broadcast/:id/manifest` handler (after line 98, before `return router`), add:

```ts
  router.delete('/broadcast/:id', (req: AuthenticatedRequest, res) => {
    if (!req.uid) return res.status(401).json({ error: 'unauthenticated' });
    const manifest = store.get(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'not found' });
    // Strict ownership: curator-baked broadcasts (manifest.userId === 'curator')
    // are NOT abortable here. The GET endpoint's curator-readable carveout
    // does not apply — featured publishes use a separate code path.
    if (manifest.userId !== req.uid) return res.status(404).json({ error: 'not found' });
    orch.abortBake(req.params.id);
    return res.status(204).end();
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- --testPathPatterns=broadcast`
Expected: all green, including existing `broadcast.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/broadcast.ts \
        server/__tests__/routes/broadcast.delete.test.ts
git commit -m "feat(server): DELETE /broadcast/:id with strict-ownership gate"
```

---

### Task 6: `BroadcastManifestClient.createBroadcast` accepts `signal` + new `abortBake`

**Files:**
- Modify: `src/engines/BroadcastManifestClient.ts`

No client unit-test infra — verification is via typecheck and Task 8's manual smoke.

- [ ] **Step 1: Add `signal` parameter to `createBroadcast`**

Edit `src/engines/BroadcastManifestClient.ts`. Replace the existing `createBroadcast` method (lines 120–132):

```ts
  async createBroadcast(
    req: CreateBroadcastRequest,
    signal?: AbortSignal,
  ): Promise<CreateBroadcastResponse> {
    const res = await authenticatedFetch('/broadcast/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : '';
      throw new Error(`createBroadcast failed: ${res.status} ${msg}`);
    }
    return (await res.json()) as CreateBroadcastResponse;
  }
```

If `authenticatedFetch` does not accept a `signal` field on its `RequestInit`, also update it. Check `src/services/api.ts` first.

- [ ] **Step 2: Verify `authenticatedFetch` passes `signal` through**

Run: `grep -nE "signal|RequestInit" src/services/api.ts`
Expected: either signal is already accepted (RequestInit covers it) or the signature needs widening.

If the signature needs widening, edit `src/services/api.ts` so `authenticatedFetch` forwards `init.signal` into the underlying `fetch` call. The standard `RequestInit` type already includes `signal?: AbortSignal | null`, so this is usually a no-op — most implementations splat `...init` into the inner fetch.

- [ ] **Step 3: Add `abortBake` method**

In `BroadcastManifestClient`, after `fetchManifest` (around line 138), add:

```ts
  /** Fire-and-forget DELETE. Swallows errors — the user has already moved
   *  on, and a failed abort just means the server keeps baking that one
   *  bake, harmless beyond wasted compute. */
  async abortBake(broadcastId: string): Promise<void> {
    try {
      await authenticatedFetch(`/broadcast/${broadcastId}`, { method: 'DELETE' });
    } catch {
      // Intentional swallow.
    }
  }
```

- [ ] **Step 4: Typecheck**

Run from project root: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/engines/BroadcastManifestClient.ts src/services/api.ts
git commit -m "feat(client): BroadcastManifestClient signal + abortBake"
```

(If `src/services/api.ts` was not modified, omit it from the `git add`.)

---

### Task 7: BroadcastPlayer defensive aborted-as-failed

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts:533`

- [ ] **Step 1: Update the slot-status branch**

Edit `src/engines/BroadcastPlayer.ts` line 533.

Before:
```ts
    if (slot.status === 'failed') {
      // Slot failed at bake time — skip silently, continue broadcast.
      this.currentSegmentIndex = -1;
      return;
    }
```

After:
```ts
    if (slot.status === 'failed' || slot.status === 'aborted') {
      // Slot failed or was aborted at bake time — skip silently, continue
      // broadcast. The player is not expected to encounter 'aborted' slots
      // under user-driven flows (aborted bakes never reach /player), but a
      // stale resume could surface one — defensive.
      this.currentSegmentIndex = -1;
      return;
    }
```

- [ ] **Step 2: Typecheck**

Run from project root: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/engines/BroadcastPlayer.ts
git commit -m "feat(client): BroadcastPlayer treats 'aborted' as 'failed' (defensive)"
```

---

### Task 8: Wire up the cancel handler in HomeBroadcastScreen

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

The `TuningInOverlay` already renders a "TAKE IT BACK" button when `onCancel` is provided. Today the parent's handler is `() => setTuning(false)` — it hides the overlay without aborting. This task makes it actually abort.

- [ ] **Step 1: Add the AbortController + cancelRequested state**

Edit `src/screens/home/HomeBroadcastScreen.tsx`. At the top of the component, alongside the existing `setTuning` state declaration (around line 127), add:

```ts
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef<boolean>(false);
```

Make sure `useRef` is imported (it likely already is — verify with: `grep -n "useRef" src/screens/home/HomeBroadcastScreen.tsx`). If not, add it to the existing `react` import.

- [ ] **Step 2: Replace `playUserSourced` with cancel-aware version**

Edit `playUserSourced` (around lines 281–322). Full replacement:

```ts
  const playUserSourced = useCallback(async (result: SetupResult) => {
    abortControllerRef.current = new AbortController();
    cancelRequestedRef.current = false;
    setTuning(true);
    try {
      const tracks = await musicKitPlayer.fetchPlaylistTracks(result.playlistId);
      const client = new BroadcastManifestClient();
      const sanitized = sanitizeTracksForBake(tracks).slice(0, 20);
      if (sanitized.length < 5) {
        throw new Error(
          `Playlist has only ${sanitized.length} playable track${sanitized.length === 1 ? '' : 's'} (need at least 5).`,
        );
      }
      let response;
      try {
        response = await client.createBroadcast(
          {
            playlistId: result.playlistId,
            vibe: result.vibe,
            length: result.length,
            userContext: {
              timeOfDay: new Date().toTimeString().slice(0, 5),
              dayOfWeek: new Date().toLocaleDateString(undefined, { weekday: 'long' }),
              firstTimeUser: false,
            },
            tracks: sanitized,
          },
          abortControllerRef.current.signal,
        );
      } catch (err) {
        // AbortController.abort() rejects the fetch with an AbortError.
        // The bake may continue server-side as an orphan — accepted tradeoff.
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        throw err;
      }
      // Race: response landed before abort took effect. Fire DELETE to stop
      // the background slots 1..N, and don't navigate.
      if (cancelRequestedRef.current) {
        void client.abortBake(response.manifest.broadcastId);
        return;
      }
      const { manifest, firstSegmentUrls } = response;
      router.push('/(main)/(broadcast)/player');
      broadcastPlayer.start(manifest, firstSegmentUrls).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        Alert.alert('Broadcast error', msg);
      });
    } catch (err) {
      if (err instanceof Error && /playable tracks?/i.test(err.message)) {
        Alert.alert(
          'Playlist changed',
          'This playlist no longer has enough playable tracks. Pick another.',
          [{ text: 'OK', onPress: () => openSheetAt(0) }],
        );
        return;
      }
      const msg = err instanceof Error ? err.message : 'Try again.';
      Alert.alert('Broadcast unavailable', msg);
    } finally {
      setTuning(false);
      abortControllerRef.current = null;
    }
  }, [router, openSheetAt]);
```

- [ ] **Step 3: Replace the `onCancel` handler on TuningInOverlay**

Locate (around line 705):
```tsx
      <TuningInOverlay visible={tuning} onCancel={() => setTuning(false)} />
```

Replace with:
```tsx
      <TuningInOverlay
        visible={tuning}
        onCancel={() => {
          cancelRequestedRef.current = true;
          abortControllerRef.current?.abort();
          setTuning(false);
        }}
      />
```

- [ ] **Step 4: Update the obsolete TuningInOverlay comment**

Edit `src/components/broadcast/TuningInOverlay.tsx` lines 15–20.

Before:
```ts
  /**
   * Optional cancel handler. When provided, a TAKE IT BACK pressable
   * renders below the status label so the user can bail out of the
   * overlay on slow networks. Hiding the overlay does NOT abort the
   * in-flight createBroadcast — the server-side bake continues.
   */
  onCancel?: () => void;
```

After:
```ts
  /**
   * Optional cancel handler. When provided, a TAKE IT BACK pressable
   * renders below the status label so the user can bail out of the
   * overlay on slow networks. Wiring this to AbortController + abortBake
   * (see HomeBroadcastScreen.playUserSourced) is what stops the server-side
   * bake; this component just surfaces the affordance.
   */
  onCancel?: () => void;
```

- [ ] **Step 5: Typecheck**

Run from project root: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Smoke test**

Build and install on a real device:

```bash
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device
```

Manual verification:
1. **Cancel mid-bake:** Open the app, tap "Build your broadcast", pick a playlist of 9+ tracks, tap through to length, tap the final CTA. While "DROPPING THE NEEDLE…" overlay is up, tap "TAKE IT BACK". Expect:
   - Overlay dismisses to the home screen.
   - No error toast / alert.
   - Server PM2 logs (`pm2 logs cleo-broadcast`) show the `[bake id=…]` lines stop after the in-flight slot — no further "slot N ready" messages for slots after the abort point.
2. **Cancel after fast warm-cache response:** Repeat (1) but with a recently-baked playlist (warm cache, ~3-5s response). Tap "TAKE IT BACK" the moment the overlay appears. Either:
   - Overlay dismisses without navigating to /player (race resolved against us → DELETE fired). PM2 logs show the bake started and was aborted.
   - Or you missed the window; navigation to /player completes normally.
3. **Server-side abort log inspection:** After test (1), grep PM2 logs for the broadcast id 8-char prefix and confirm no slot generation started after the abort point.

- [ ] **Step 7: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx \
        src/components/broadcast/TuningInOverlay.tsx
git commit -m "feat(client): wire TAKE IT BACK cancel to AbortController + DELETE race"
```

---

### Task 9: Close the GitHub issue

- [ ] **Step 1: Update issue checklist**

Edit issue [bworthy89/cleo#14](https://github.com/bworthy89/cleo/issues/14) — check off all done-when items, link to the merged PR.

- [ ] **Step 2: Verify Phase 1 milestone progress**

Run: `gh issue list --repo bworthy89/cleo --milestone "Phase 1: Stability Foundation" --state all`
Expected: #14 closed; remaining open: #16, #17, #19, #20.

---

## Self-review against spec

**Spec coverage:**
- Endpoint: `DELETE /broadcast/:id` → Task 5 ✓
- Cooperative cancellation via `inFlight` map → Task 3 (parallel `aborted` Set) ✓
- Flag flipped to `aborted` → Task 3 ✓
- In-flight TTS request finishes → guaranteed by Approach 1's between-slot check (Task 4); existing `lock` semantics in CosyVoice/F5 wrappers prevent interruption ✓
- Abort flag checked between segment generations → Task 4 worker-loop check ✓
- Remaining slots marked `aborted` in manifest → Task 2 (`markPendingSlotsAborted`) called from Task 3 ✓
- Client drops broadcast from history → Task 8 doesn't navigate to /player on cancel; history is only written post-/player navigation, so no eviction code is needed (covered in spec's Done-when note) ✓
- Slot status enum extended → Task 1 ✓
- Strict ownership (curator-baked → 404) → Task 5 ✓
- Idempotent DELETE → Task 5 ✓
- Telemetry status='aborted' → Task 4 ✓
- Defensive client handling of `aborted` slots → Task 7 ✓
- Race-handling: response lands before abort → Task 8 fires DELETE ✓
- Backgrounding does not trigger DELETE → no app-state listener wired; trivially satisfied ✓

**Placeholder scan:** None — every step shows the code/command/expected output.

**Type consistency:** `abortBake(broadcastId: string): boolean` consistent across Tasks 3, 5; `aborted: Set<string>` consistent across Tasks 3, 4; `signal?: AbortSignal` consistent in Tasks 6, 8.

**Scope check:** Single feature, single PR-sized plan. No subsystem decomposition needed.

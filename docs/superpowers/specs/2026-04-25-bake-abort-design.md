# Bake Abort — Design

**Date:** 2026-04-25
**Status:** Brainstorm-approved; awaiting user spec review
**Roadmap link:** [`2026-04-24-onay-roadmap-design.md`](2026-04-24-onay-roadmap-design.md) → Phase 1 → MVP-1
**Issue:** [bworthy89/cleo#14](https://github.com/bworthy89/cleo/issues/14)

---

## Why

When a user starts a bake and changes their mind, the server today has no path to stop. Slot 0 is awaited synchronously inside `POST /broadcast/create` (~11–19s cold cache); slots 1..N then run as a background promise tracked in `BroadcastOrchestrator.inFlight`. A user who dismisses the SetupSheet mid-wait pays for every remaining LLM + TTS call regardless. This is a cost-reduction feature.

## Scope

The cancel-eligible window is *entirely pre-`/player`*: from when the user taps the final SetupSheet CTA until the `POST /broadcast/create` response arrives. Once the user lands on `/player`, the bake is committed — slots 1..N continue in the background unattended and the user has no way to stop them.

**In scope:**
- `DELETE /broadcast/:id` server route with cooperative cancellation
- Slot status `'aborted'` joining `'pending' | 'ready' | 'failed'` on both sides
- SetupSheet cancel UI + dismiss interception during the POST wait
- AbortController on the create fetch + race-handling for response-lands-before-abort

**Out of scope:**
- Cancel UI on `/player` — there is none
- Backgrounding the app — does not trigger DELETE; the background bake continues
- Curator/featured publish abort — featured publish is a fire-and-forget flow with separate semantics; the DELETE route deliberately 404s for `manifest.userId === 'curator'`
- Mid-TTS interruption — the spec requires the in-flight TTS request to complete; we honor it

## Approach

**Cooperative cancellation via an orchestrator-internal abort Set, parallel to `inFlight`.** Workers check the flag *between* slot generations; the in-flight TTS call is allowed to complete naturally. Approach chosen over an `AbortController`-driven design (signal too easy to plumb through to fetch by mistake, breaking the in-flight-TTS invariant) and over a `manifest.aborted` top-level field (entangles abort with the manifest contract for marginal gain — the slot enum already gives the client what it needs).

### Server flow

```
DELETE /broadcast/:id
  ├─ ownership gate (req.uid === manifest.userId; curator → 404)
  ├─ orchestrator.abortBake(id):
  │     ├─ if !inFlight.has(id) → no-op (return false; route returns 204)
  │     ├─ aborted.add(id)
  │     └─ store.markPendingSlotsAborted(id)
  └─ 204 No Content
```

The 4-worker pool's `runWorker` loop checks `this.aborted.has(broadcastId)` at the top of each iteration. On flag set, every worker exits cleanly on its next iteration. `Promise.all(workers)` resolves; the existing `.finally(() => this.inFlight.delete(id))` runs paired with `this.aborted.delete(id)` so the Set doesn't grow.

The slot the worker happens to be inside at abort time finishes its TTS call and is recorded as `'ready'`. Subsequent slots short-circuit to `'aborted'` (already marked by `markPendingSlotsAborted`).

### Client flow

```
SetupSheet — POST /broadcast/create in flight
  ├─ AbortController owned by the SetupSheet
  ├─ user taps Cancel button OR dismisses sheet (back / swipe-down / backdrop)
  ├─ handleCancel():
  │     ├─ cancelRequested.current = true
  │     └─ controller.abort()
  │
  ├─ original await fetch(...) resolves OR rejects:
  │     ├─ rejected with AbortError → orphan bake on server (accepted tradeoff)
  │     └─ resolved with broadcastId  → race window: fire abortBake(id)
  │
  └─ dismiss SetupSheet, no error toast (cancel was intentional)
```

The race-window DELETE matters — a fast warm-cache response can land between the user's tap and the abort taking effect. Without it, the background bake of slots 1..N would run uselessly. With it, slot 0 plus the in-flight slot complete and everything else is short-circuited.

## Files touched

### Server

| File | Change |
|---|---|
| `server/src/services/broadcast/types.ts` | Extend `SegmentSlot.status` with `'aborted'` |
| `server/src/services/broadcast/BroadcastStore.ts` | New `markPendingSlotsAborted(broadcastId)` method |
| `server/src/services/broadcast/BroadcastOrchestrator.ts` | `private aborted = new Set<string>()`; `abortBake(id)` method; worker-loop flag check; paired `aborted.delete` in the existing `.finally`; thread `'aborted'` status to `bakeTelemetry.endBake` |
| `server/src/routes/broadcast.ts` | New `DELETE /broadcast/:id` route with strict-ownership gate |

### Client

| File | Change |
|---|---|
| `src/engines/BroadcastPlayer.types.ts` | Mirror server enum extension |
| `src/engines/BroadcastPlayer.ts` | Treat `'aborted'` like `'failed'` at line 533 (defensive — the player should not encounter aborted slots in the user-driven flow, but must not crash if it does) |
| `src/engines/BroadcastManifestClient.ts` | New `abortBake(broadcastId)` fire-and-forget DELETE call |
| `src/components/broadcast/SetupSheet.tsx` | Cancel button; AbortController on the create fetch; `cancelRequested` ref; race-handling on response; dismiss-handler interception |

## Detailed design

### `BroadcastStore.markPendingSlotsAborted`

```ts
markPendingSlotsAborted(broadcastId: string): void {
  const entry = this.entries.get(broadcastId);
  if (!entry) return;
  for (const slot of entry.manifest.segmentSlots) {
    if (slot.status === 'pending') slot.status = 'aborted';
  }
}
```

In-process JS is single-threaded, so the iteration is atomic. No-op if the broadcast is unknown or has nothing pending.

### `BroadcastOrchestrator.abortBake`

```ts
abortBake(broadcastId: string): boolean {
  if (!this.inFlight.has(broadcastId)) return false;
  this.aborted.add(broadcastId);
  this.store.markPendingSlotsAborted(broadcastId);
  return true;
}
```

Returns `true` if abort was applied, `false` if there was no in-flight bake (idempotent — the route returns 204 either way).

### Worker-loop check

Inside `generateSlotsBackground`, the existing `runWorker`:

```ts
const runWorker = async (): Promise<void> => {
  while (true) {
    if (this.aborted.has(manifest.broadcastId)) return;  // ← new
    const i = nextIndex++;
    if (i >= indices.length) return;
    try {
      await this.generateSlot(manifest, indices[i], ctx);
    } catch (err) {
      // existing per-slot warn
    }
  }
};
```

Telemetry: in the `backgroundP` chain in `create()`, branch on whether abort was set when the promise resolved:

```ts
const backgroundP = this.generateSlotsBackground(manifest, input.userContext, tag)
  .then(() => {
    const status = this.aborted.has(manifest.broadcastId) ? 'aborted' : 'completed';
    handle.endBake({ durationMs: Date.now() - startedAt, status });
  })
  // ... existing .catch + .finally
  .finally(() => {
    this.inFlight.delete(manifest.broadcastId);
    this.aborted.delete(manifest.broadcastId);  // ← new
  });
```

### `DELETE /broadcast/:id`

```ts
router.delete('/broadcast/:id', (req: AuthenticatedRequest, res) => {
  if (!req.uid) return res.status(401).json({ error: 'unauthenticated' });
  const manifest = store.get(req.params.id);
  if (!manifest) return res.status(404).json({ error: 'not found' });
  // Strict ownership: curator-baked → 404. Featured publish abort is a
  // separate flow.
  if (manifest.userId !== req.uid) return res.status(404).json({ error: 'not found' });
  orch.abortBake(req.params.id);
  return res.status(204).end();
});
```

Returns 204 even if the bake was already aborted or already completed — DELETE is idempotent. 404 only when the broadcast is unknown or not owned by the requester.

Not rate-limited. The existing `generationLimiter` in `server/src/index.ts:70` is path-scoped via `GENERATION_PATHS = /^\/(generate-segment|synthesize-voice|curate-playlist|broadcast\/create)(\/|$)/`, which does not match `DELETE /broadcast/:id`. DELETEs are cheap and idempotent — no new limiter needed.

### `BroadcastManifestClient.abortBake`

```ts
export async function abortBake(broadcastId: string): Promise<void> {
  try {
    await authenticatedFetch(`/broadcast/${broadcastId}`, { method: 'DELETE' });
  } catch {
    // Best-effort — the user has already moved on. A failed abort means the
    // server keeps baking; harmless beyond wasted compute on that one bake.
  }
}
```

### `SetupSheet` cancel UI

Cancel button: rendered inside the existing loading state, below the "ONAY is curating…" copy. Hidden for the first ~500ms to avoid flicker on warm-cache fast responses.

```tsx
const controllerRef = useRef<AbortController | null>(null);
const cancelRequestedRef = useRef(false);

const handleCancel = () => {
  cancelRequestedRef.current = true;
  controllerRef.current?.abort();
};

const handleSubmit = async () => {
  controllerRef.current = new AbortController();
  cancelRequestedRef.current = false;
  let response: BroadcastCreateResponse | null = null;
  try {
    response = await createBroadcast(payload, controllerRef.current.signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Orphan bake on server; nothing more we can do.
      onDismiss();
      return;
    }
    throw err;
  }
  if (cancelRequestedRef.current && response.manifest.broadcastId) {
    // Race resolved against us: response landed before abort took effect.
    abortBake(response.manifest.broadcastId);
    onDismiss();
    return;
  }
  navigateToPlayer(response);
};
```

Dismiss interception: wire `handleCancel()` into the existing back-button / swipe-down / backdrop-tap handlers when `isLoading === true`. When `isLoading === false`, those gestures dismiss normally without firing abort.

## Error handling and edge cases

| Case | Behavior |
|---|---|
| DELETE on unknown broadcastId | 404 |
| DELETE by non-owner | 404 (don't leak existence) |
| DELETE on curator-baked broadcast | 404 (strict ownership; no curator carveout) |
| DELETE on already-aborted broadcast | 204 (idempotent) |
| DELETE on already-completed broadcast | 204 (no-op; nothing pending) |
| Two DELETEs in rapid succession | First flips the flag; second is a no-op; both return 204 |
| Cancel-tap during slot 0 (POST in flight) | AbortController.abort(); fetch rejects; orphan bake on server |
| Cancel-tap as POST resolves (race) | Fetch resolves with broadcastId; client fires DELETE; background slots short-circuit |
| Cancel-tap after navigate to `/player` | Cannot happen — no cancel UI on `/player` |
| App backgrounded mid-bake | No DELETE; background bake continues |
| Cold-open TTS in flight at abort time | Finishes naturally; slot 0 is still `'ready'`; remaining slots are `'aborted'` |

## Testing

### Server unit tests (`server/__tests__/broadcast/`)

- `BroadcastOrchestrator.abort.test.ts`
  - `abortBake marks pending slots as 'aborted' and exits background workers`
  - `abortBake is idempotent across multiple calls`
  - `abortBake on completed broadcast returns false; manifest unchanged`
  - `abortBake on unknown broadcastId returns false`
  - `in-flight TTS call completes naturally — its slot ends 'ready' even after abort`
  - `aborted Set is cleaned up by .finally after worker exit`
  - `telemetry endBake fires with status='aborted' when abort triggered`

- `routes/broadcast.delete.test.ts`
  - `DELETE returns 401 without auth`
  - `DELETE returns 404 for unknown id`
  - `DELETE returns 404 for non-owner uid`
  - `DELETE returns 404 for curator-baked broadcast even when authenticated`
  - `DELETE returns 204 on successful abort`
  - `DELETE returns 204 idempotently on already-aborted broadcast`
  - `DELETE returns 204 on already-completed broadcast`

### Client unit tests

- `src/components/broadcast/__tests__/SetupSheet.cancel.test.tsx` (or wherever component tests live)
  - `cancel button hidden during initial 500ms; visible after`
  - `cancel button tap aborts in-flight fetch and dismisses without error`
  - `cancel-then-fast-response fires DELETE with returned broadcastId`
  - `back-button dismiss during loading triggers cancel flow`
  - `swipe-down / backdrop dismiss during loading triggers cancel flow`
  - `non-loading dismiss does not fire abort`

### Manual / smoke

- Real device: tap Build with a 9-track playlist; tap Cancel mid-wait; verify SetupSheet dismisses, no error toast, no orphan in `/player`.
- Real device: tap Build; immediately swipe down; same outcome.
- Server log inspection: confirm `[bake id=…]` lines for an aborted bake stop after the in-flight slot, no `slot N failed` messages for slots that should have been aborted (they should never have been attempted).

## Telemetry

Existing `BakeTelemetry` already supports `status: 'aborted'` in `BakeEndInput`. The branch in the `backgroundP` chain (above) is the only new emission. No new event types needed.

The ratio of `bake.status='aborted'` to `bake.status='completed'` is a useful product signal — a high abort rate suggests SetupSheet UX problems or insufficient cold-cache response speed. Track in Sentry as a follow-up; not gating Phase 1.

## Migration / backward compatibility

- The slot status enum gains a value but pre-upgrade clients that only know `'pending' | 'ready' | 'failed'` will see `'aborted'` as an unknown string. Defensive client handling (`status !== 'ready'` skips it) means stale clients silently treat aborted slots as non-playable, which is correct behavior. No version gate needed.
- `Manifest` shape unchanged.
- Existing tests continue to pass — no enum value is removed.

## Done when

- [ ] `DELETE /broadcast/:id` implemented + tested
- [ ] Slot status `'aborted'` propagates to client manifest
- [ ] SetupSheet cancel button + dismiss interception live
- [ ] AbortController on create fetch + race-resolved DELETE on response
- [ ] Broadcast history removes aborted entries on next focus _(already true today — `BROADCAST_HISTORY` only contains entries written after a successful `/player` navigation; aborted bakes never reach `/player`, so no history-eviction code is needed)_
- [ ] No leak of pending workers after abort (verified by `aborted.size === 0` after Promise.all settles)
- [ ] Test matrix above passes

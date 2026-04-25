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

```text
DELETE /broadcast/:id
  ├─ ownership gate (req.uid === manifest.userId; curator → 404)
  ├─ orchestrator.abortBake(id):
  │     ├─ if !inFlight.has(id) → no-op (return false; route returns 204)
  │     ├─ aborted.add(id)
  │     └─ store.markPendingSlotsAborted(id)
  └─ 204 No Content
```

The 4-worker pool's `runWorker` loop checks `this.aborted.has(broadcastId)` at the top of each iteration. On flag set, every worker exits cleanly on its next iteration. `Promise.all(workers)` resolves; the existing `.finally(() => this.inFlight.delete(id))` runs paired with `this.aborted.delete(id)` so the Set doesn't grow.

In-flight TTS calls finish naturally (CosyVoice/F5 are blocked on their wrapper `asyncio.Lock`; we don't interrupt them — we just let them complete on the LAN box and discard the result). `generateSlot` carries a second abort check after `generator.generateVariants` returns: if the broadcast was aborted while the TTS was in flight, the slot stays `'aborted'` (set by `markPendingSlotsAborted`) and the would-be `'ready'` write is skipped. From the client's perspective, abort is binary — every pending slot at the moment the user tapped cancel becomes `'aborted'`, none accidentally flips back to `'ready'`. The cost of the in-flight TTS call is paid (we can't refund it once the request hit the LAN box) but the result never makes it into the manifest.

### Client flow

```text
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

The race-window DELETE matters — a fast warm-cache response can land between the user's tap and the abort taking effect. Without it, the background bake of slots 1..N would run uselessly. With it, slot 0 has already been delivered as part of the response (the user paid for it whether they navigate or not), and every subsequent pending slot becomes `'aborted'` regardless of whether its TTS was already in flight when abort fired.

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
| `src/engines/BroadcastManifestClient.ts` | New `abortBake(broadcastId)` fire-and-forget DELETE call; `createBroadcast(req, signal?)` accepts an optional `AbortSignal` |
| `src/utils/retry.ts` | `withRetry` re-throws `AbortError` immediately rather than retrying — required so `controller.abort()` propagates without spawning duplicate POSTs or burning the backoff sleep |
| `src/screens/home/HomeBroadcastScreen.tsx` | Per-bake `AbortController` + `cancelRequestedRef`; `playUserSourced` rewritten to swallow `AbortError`, fire race-window `abortBake(broadcastId)` if the response landed before abort took effect, and skip navigation in either cancel path |
| `src/components/broadcast/TuningInOverlay.tsx` | `onCancel` prop's JSDoc updated — the existing "TAKE IT BACK" button is now wired through `HomeBroadcastScreen.playUserSourced`'s AbortController, so hiding the overlay actually aborts the server-side bake. (Originally the spec named `SetupSheet.tsx` here; the loading state lives in `HomeBroadcastScreen` + `TuningInOverlay` instead, so SetupSheet is untouched.) |

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

### Worker-loop check + post-TTS guard

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

A second guard inside `generateSlot`, after the TTS call returns and before the success-path `store.updateSlot({ status: 'ready', ... })` write:

```ts
const urls = await this.generator.generateVariants({ ... });
if (this.aborted.has(manifest.broadcastId)) return urls;  // ← new
this.store.updateSlot(manifest.broadcastId, slotIndex, {
  status: 'ready',
  audioUrls: urls,
});
```

Why both guards are needed: with `SEGMENT_CONCURRENCY=4` and a small bake (e.g., 5 tracks → 3 background slots), all 3 workers grab their slot indices on their first loop iteration before the abort flag is set. If the only check is at the top of the loop, every worker still finishes its first iteration — TTS resolves, `updateSlot({ status: 'ready' })` overwrites the `'aborted'` that `markPendingSlotsAborted` had set. The post-TTS guard catches that race and ensures the in-flight slot also stays `'aborted'`.

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

### Client cancel UI: `HomeBroadcastScreen` + `TuningInOverlay`

Cancel ownership lives in `HomeBroadcastScreen`, not `SetupSheet`. The flow:

1. User taps the final SetupSheet CTA. `SetupSheet` calls `onSubmit({ playlistId, vibe, length })` — its only job is to bubble the result up.
2. `HomeBroadcastScreen.onSheetSubmit` immediately closes the sheet (`setSheetOpen(false)`) and invokes `playUserSourced(result)`.
3. `playUserSourced` sets `tuning = true`, which mounts `<TuningInOverlay visible onCancel={…} />`. The overlay is full-bleed (`StyleSheet.absoluteFillObject`, `pointerEvents='auto'`) so it covers the home screen until cancel or response.
4. The overlay already renders a Pressable labeled "TAKE IT BACK" whenever `onCancel` is provided. That same Pressable now fires the abort.

There is **no backdrop-tap, swipe-down, or back-button dismiss interception**. The overlay does not surface those gestures; the explicit button tap is the only user-driven cancel trigger.

#### Per-attempt state isolation

A naive single-shared-controller design is unsafe across consecutive bake attempts. After the user taps "TAKE IT BACK", the overlay starts fading (`pointerEvents='none'` immediately when `visible=false`) so the user can tap underneath and start another bake before the original fetch has actually rejected with AbortError. Without isolation, two failure modes appear:

- **Stale-finally clobber:** attempt A's `finally` block, firing seconds later when its slow network call finally rejects, would hide attempt B's overlay (`setTuning(false)`) and null out B's controller (`abortControllerRef.current = null`). B becomes uncancellable.
- **Race-check inversion:** if A's response had already resolved server-side before `.abort()` took effect (raced past the abort), and the user has since reset shared cancel state by starting B, A's race check would read "not cancelled" and navigate to `/player` with A's manifest — yanking the user out of B.

The fix: capture the `AbortController` in a local `const controller` per attempt, not just in the shared ref. Use `controller.signal.aborted` (per-controller, set synchronously by `.abort()`) as the cancel-intent flag instead of a separate shared `cancelRequestedRef`. Add identity guards in the outer catch and the `finally` so a stale attempt's resolution never touches shared UI state.

```tsx
const abortControllerRef = useRef<AbortController | null>(null);

const playUserSourced = useCallback(async (result: SetupResult) => {
  // Local — captured in this closure so a newer attempt that overwrites
  // abortControllerRef can't change which signal *this* fetch is bound to.
  const controller = new AbortController();
  abortControllerRef.current = controller;
  setTuning(true);
  try {
    // ... fetchPlaylistTracks, sanitize, length-check ...
    let response;
    try {
      response = await client.createBroadcast(payload, controller.signal);
    } catch (err) {
      // AbortError from controller.abort(). Server-side bake may continue
      // as an orphan — accepted tradeoff. We don't reference DOMException
      // directly because Hermes / older RN can lack the global; the Error
      // check covers both spec-compliant DOMException (extends Error) and
      // the plain-Error AbortError thrown by the whatwg-fetch polyfill.
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    }
    // Race: response landed before .abort() took effect. controller.signal
    // .aborted is set synchronously by .abort(), so this is reliable even
    // when the resolved-response microtask was queued before abort fired.
    if (controller.signal.aborted) {
      void client.abortBake(response.manifest.broadcastId);
      return;
    }
    // Stale-attempt guard: a newer attempt has superseded this one. Don't
    // navigate over its overlay; clean up server-side and exit silently.
    if (abortControllerRef.current !== controller) {
      void client.abortBake(response.manifest.broadcastId);
      return;
    }
    router.push('/(main)/(broadcast)/player');
    broadcastPlayer.start(response.manifest, response.firstSegmentUrls);
  } catch (err) {
    // Stale-attempt: don't surface Alerts that would pop over a newer attempt.
    if (abortControllerRef.current !== controller) return;
    // ... existing playable-tracks / generic-error Alerts ...
  } finally {
    // Only the active attempt may clear shared state.
    if (abortControllerRef.current === controller) {
      setTuning(false);
      abortControllerRef.current = null;
    }
  }
}, [router, openSheetAt]);
```

The overlay's `onCancel` handler is now two lines — `signal.aborted` is set synchronously by `.abort()`, so no separate intent-flag bookkeeping is needed:

```tsx
<TuningInOverlay
  visible={tuning}
  onCancel={() => {
    abortControllerRef.current?.abort();
    setTuning(false);
  }}
/>
```

A single `err instanceof Error && err.name === 'AbortError'` check covers both fetch implementations: native fetch's DOMException extends Error in spec-compliant runtimes, and the whatwg-fetch polyfill throws a plain Error with `name === 'AbortError'`. Referencing `DOMException` directly is avoided because Hermes / older RN can lack the global, which would make the `instanceof DOMException` line throw `ReferenceError` before the check could run. The same guard pattern lives in `src/utils/retry.ts` so `withRetry` doesn't burn through 1s+2s+4s of backoff sleeps before propagating the cancel.

`TuningInOverlay` itself was not restructured. Only its `onCancel` prop's JSDoc was updated to point readers at `HomeBroadcastScreen.playUserSourced` for the actual abort wiring; the overlay is unchanged otherwise.

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
| Cold-open TTS in flight at abort time | Cannot happen — slot 0 is awaited synchronously inside `POST /broadcast/create` and returns to the client before the broadcastId is known. There is no DELETE path that can fire during slot 0. |
| Background-slot TTS in flight at abort time | TTS call completes naturally on the LAN box (we don't interrupt it), but the result is discarded — the post-TTS guard skips the `'ready'` write and the slot stays `'aborted'`. |

## Testing

### Server unit tests (`server/__tests__/broadcast/`)

- `BroadcastOrchestrator.abort.test.ts`
  - `abortBake marks pending slots as 'aborted' and exits background workers`
  - `abortBake is idempotent across multiple calls`
  - `abortBake on completed broadcast returns false; manifest unchanged`
  - `abortBake on unknown broadcastId returns false`
  - `in-flight TTS call completes naturally on the LAN box but its result is discarded — slot stays 'aborted'`
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

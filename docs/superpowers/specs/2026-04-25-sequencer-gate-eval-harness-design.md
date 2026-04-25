# Sequencer Gate-Eval Harness — Design

**Date:** 2026-04-25
**Status:** Brainstorm-approved; awaiting user spec review
**Roadmap link:** [`2026-04-24-onay-roadmap-design.md`](2026-04-24-onay-roadmap-design.md) → Phase 1 → item 5 (ReccoBeats integration; this harness is the evaluation mechanism)
**Issue:** [bworthy89/cleo#29](https://github.com/bworthy89/cleo/issues/29)
**Gates:** [bworthy89/cleo#20](https://github.com/bworthy89/cleo/issues/20) (Phase 1 GATE — `meanDistance < 0.5` across all 7 vibes)

---

## Why

Phase 1 closes when the deterministic sequencer hits `meanDistance < 0.5` across all 7 vibes. Today the only signal is `sequencer.result` Sentry telemetry from production traffic, which:

- Hasn't accumulated yet (telemetry only live since 2026-04-25 via PR #21)
- May not exercise all 7 vibes evenly in normal usage
- Doesn't run on demand when we need a Phase 1 → Phase 2 transition decision

The sequencer is **deterministic given fixed inputs** (tracks + vibe + length + broadcastId seed), so a synthetic harness with representative track pools is a valid evaluation. It gives reproducible, on-demand answers that don't depend on production traffic patterns.

This is observational tooling, not a behavioral change. The shipped sequencer is unchanged; only the result type gains a field that's already computed.

## Scope

**In scope:**
- 4 new fixture pools at `server/__tests__/fixtures/sequencer-goldens/` for the 4 missing vibes (`focus`, `workout`, `feelGood`, `melancholy`).
- One length per missing vibe, chosen by production-likelihood: `focus=long`, `workout=standard`, `feelGood=standard`, `melancholy=quick`.
- Promote `meanDistance` from internal logging to `SequenceResult` (one new numeric field; the value is already computed).
- Driver script `server/scripts/eval-sequencer-gate.ts` runnable via `npx ts-node`. Loads all 7 fixtures, runs each through the deterministic sequencer, prints per-vibe meanDistance, exits 0 if all `< 0.5`, 1 if any `≥ 0.5`.
- One new unit test verifying `meanDistance` lands on the result.
- Existing `sequencer-goldens.test.ts` automatically picks up the 4 new fixtures (it `readdirSync`s the directory) — no test code changes needed for regression coverage.

**Out of scope:**
- New sequencer behavior. Pure read-only evaluation.
- Replacing the production telemetry. Both signals coexist; the harness is on-demand, telemetry is continuous.
- CI integration. The gate threshold (`< 0.5`) is a Phase 1 → Phase 2 decision criterion, not a per-PR criterion. Adding it as a CI gate now would block any sequencer experiment that nudges meanDistance toward 0.49 even though it's still healthy.
- JSON output / flags. The script has a single mode; add structured output if a CI consumer needs it.
- 21 fixtures (all 7 vibes × all 3 lengths). Length is not the dominant input to meanDistance; the vibe curve is.
- Tuning the sequencer if a fixture lands `≥ 0.5`. That's a separate decision (escalate to the user before committing such a fixture).

## Approach

**Fixture authoring loop (one fixture per missing vibe):**

1. Read `VIBE_CURVES[vibe]` to understand the target arc (open/body/peak/close keyframes + per-feature weights).
2. Design a 12–16 track pool with realistic feature spread that exercises the curve. The morning fixture's 88→124 BPM ramp + 0.32→0.78 energy progression is the template — the pool should have tracks plausibly near each keyframe target plus a few outliers so the top-K selection (`K=2/3/3` for quick/standard/long) has something to discriminate.
3. Run the sequencer locally with that pool. Capture both `orderedTracks.map(t => t.id)` (becomes the fixture's `expectedOrder`) and `meanDistance`.
4. If `meanDistance ≥ 0.5`: stop. Don't paper over it by tuning features until the test passes — the harness exists to catch this. Escalate to the user; the finding is the answer Phase 1 GATE was looking for.

**`SequenceResult` API change:**

```ts
// server/src/services/broadcast/DeterministicTrackSequencer.ts
export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'deterministic';
  meanDistance: number;   // ← new
}
```

The value is computed at line 127 (`const meanDistance = totalDistance / result.length`); this promotes it from a local variable to a returned field. The existing `recordSequencerResult` telemetry call is unchanged. Callers that ignore the field continue to work; the only consumer that reads it (today) is the harness driver.

**Driver script:**

`server/scripts/eval-sequencer-gate.ts` — runnable via `npx ts-node server/scripts/eval-sequencer-gate.ts` from the repo root. Output:

```
[gate] Running 7 vibe fixtures...
  morning      (standard,  9 tracks)  meanDistance=0.42  ✓
  focus        (long,     15 tracks)  meanDistance=0.38  ✓
  workout      (standard,  9 tracks)  meanDistance=0.51  ✗ (>=0.5)
  feelGood     (standard,  9 tracks)  meanDistance=0.44  ✓
  lateNight    (quick,     5 tracks)  meanDistance=0.46  ✓
  melancholy   (quick,     5 tracks)  meanDistance=0.48  ✓
  party        (long,     15 tracks)  meanDistance=0.43  ✓
[gate] FAIL — 1 vibe(s) above threshold
```

Internals:
- Reads all `pool-*.json` files from `server/__tests__/fixtures/sequencer-goldens/`.
- For each fixture, builds the same minimal `chain` + `cache` stubs that `sequencer-goldens.test.ts` uses (the `chain` returns the fixture's per-track features pre-marked as `source: 'reccobeats'`; the `cache` is a stub that returns `null`).
- Instantiates `DeterministicTrackSequencer`, calls `.sequence({ pool, vibe, length, broadcastId, userContext })`.
- Reads `result.meanDistance`, compares to `0.5`, formats the line.
- After all fixtures run: prints summary, exits 0 (all pass) or 1 (any fail).

Threshold `0.5` is hardcoded (matches `recordSequencerResult`'s `poor_fit` tag boundary in `BakeTelemetry.ts`). If we need to tune the threshold later, change it in one place.

**Length-per-vibe rationale:**

| Vibe | Length | Why |
|---|---|---|
| focus | long | Study/deep-work sessions are long-form (60–90 min); meanDistance drift is most observable across the longer slot count. |
| workout | standard | Typical workout length; matches the median use case. |
| feelGood | standard | Catch-all default; no strong length affinity. |
| melancholy | quick | Mood doesn't sustain across long-form; quick is the realistic case. |

Combined with the existing 3 (morning-standard, lateNight-quick, party-long), final coverage: 3 standard, 2 quick, 2 long.

## Files touched

- **Modify** `server/src/services/broadcast/DeterministicTrackSequencer.ts` — add `meanDistance` to `SequenceResult` and the function's return shape.
- **Modify** `server/__tests__/broadcast/DeterministicTrackSequencer.test.ts` — add one assertion that `meanDistance` is exposed on the result (positive number for a known input).
- **Create** `server/__tests__/fixtures/sequencer-goldens/pool-focus-long.json`
- **Create** `server/__tests__/fixtures/sequencer-goldens/pool-workout-standard.json`
- **Create** `server/__tests__/fixtures/sequencer-goldens/pool-feelGood-standard.json`
- **Create** `server/__tests__/fixtures/sequencer-goldens/pool-melancholy-quick.json`
- **Create** `server/scripts/eval-sequencer-gate.ts` — the driver.
- **Modify** `server/package.json` — add `"eval-sequencer-gate": "ts-node scripts/eval-sequencer-gate.ts"` to `scripts`.

## Test strategy

- **`SequenceResult.meanDistance` exposure unit test**: one new `it` in `DeterministicTrackSequencer.test.ts` runs the sequencer with a small pool and asserts `result.meanDistance > 0` and is finite. Don't pin a specific value — the math is already covered by `scoring.test.ts`.
- **Regression coverage of the new fixtures**: free, via the existing `sequencer-goldens.test.ts` `readdirSync` loop. Each new fixture's `expectedOrder` becomes a regression test automatically.
- **Driver smoke test**: not landed in this PR. Run the driver manually before opening the PR; capture the output in the PR description. Add a Jest-driven smoke test in a follow-up if the driver script grows enough to warrant one.

## Failure modes considered

- **Fixture lands `meanDistance ≥ 0.5`.** That's a real finding, not a bug to fix. Escalate to the user; decide whether to (a) accept as-is and open a sequencer-redesign issue, (b) re-pool the fixture (only justified if the original pool was non-representative), or (c) tune the vibe curve. Do not silently re-pool until it passes — that defeats the harness's purpose.
- **Adding `meanDistance` to `SequenceResult` breaks an unknown caller.** `SequenceResult` is server-internal; the only callers are inside the broadcast pipeline (`BroadcastOrchestrator`, the goldens test). Adding a field is purely additive — TypeScript structural typing accepts unknown extra fields silently. No deprecation cycle needed.
- **Existing `sequencer-goldens.test.ts` rejects the new fixtures.** It currently asserts `r.orderedTracks.map(t => t.id)).toEqual(g.expectedOrder)` — works for any fixture matching the schema. The new fixtures will be regression-tested automatically with no test-code changes.
- **`ts-node` version mismatch.** `server/package.json` already depends on `ts-node` for existing scripts (e.g. `bake-featured.ts`). The new script reuses the existing toolchain.

## Open questions

None at design time. If any new fixture lands `≥ 0.5`, that's the gate's answer; we then escalate to the sequencer-redesign decision.

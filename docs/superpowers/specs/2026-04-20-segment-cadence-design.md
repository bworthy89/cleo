# Segment Cadence Redesign

**Date:** 2026-04-20
**Branch:** pre-baked-broadcast
**Related:** bake-time optimization (post-F5TTS migration)

## Problem

On the 6700XT, F5-TTS inference averages ~7s per segment at `nfe_step=12`. A
5-song broadcast fans out 6 segments (cold_open + 4 transitions + sign_off) and
serializes through the F5 server's asyncio.Lock, producing ~42s total wallclock.
Tune-in latency (slot 0) is ~7-8s.

The bake is a visible delay the user waits through. We want a structural cut —
not a tuning pass — that reduces how much voice audio needs to be generated per
broadcast without sacrificing ONAY's personality.

Secondary problem: current transitions pack multiple enrichment facts (producer,
year, sample, notable facts) into every prompt. The LLM tries to weave all of
them and defaults to producer-led openings across the entire broadcast. Output
feels formulaic.

## Goals

- Cut segment count per broadcast by ~33-44% depending on length.
- Keep ONAY's voice personal in every spoken moment — no rushed announcer feel.
- Break the "producer produced this" default by restricting the LLM to one fact.

## Non-goals

- Client-side player architecture changes beyond the loop iteration tweak.
- Changes to `cold_open` or `sign_off` budgets. Bookends stay as-is.
- Changes to `deep_dive` tier or the `featureSlots` override path.

## Design

### Segment placement

For `N` tracks, the manifest produces:

- `cold_open` at slot 0 (intros `track[0]`)
- A transition before each `track[i]` where `i ∈ {2, 4, 6, …}` and `i < N`
- `sign_off` at the final slot (after `track[N-1]`)

The transition before `track[i]` plays after `track[i-1]` ends.

| Length preset | Tracks | Today's segments | New segments |
|---|---|---|---|
| quick | 5 | 6 | 4 |
| standard | 9 | 10 | 6 |
| long | 15 | 16 | 9 |

All three presets are odd `N`, so the final track always sits at an introduced
position (its intro comes from the transition before it, then it plays, then
`sign_off`). For even `N` — not a preset today, but the code should handle it —
the final track enters without its own transition, and `sign_off` delivers
ONAY's only reference to it. The hybrid editorial rule (below) already accepts
this.

### Hybrid editorial rule

Transitions only reference the **incoming** track. The outgoing track played
without narration (ONAY never introduced it), so there's nothing to acknowledge.
This frees the transition from the "that was X, now here's Y" two-track
structure that inflates word counts.

### Two-tier transition alternation

Transitions alternate between two tiers, starting with the richer one. The
first transition in a broadcast is `fact_bridge`; the second is `tight_bridge`;
the third is `fact_bridge`; and so on.

| Tier | Budget | Shape |
|---|---|---|
| `fact_bridge` | 45-55 words | One concrete fact and one perceptual note. End by naming the incoming track. |
| `tight_bridge` | 30-40 words | One hook — a concrete fact OR a perceptual note, not both. Name the incoming track. No filler. |

`featureSlots` overrides to `deep_dive` (80-120 words) as it does today. When a
slot is nominated for deep-dive, it replaces whatever the alternation would
have produced.

### Enrichment discipline

The system prompt gains a single new rule:

> Pick the single most interesting fact from the enrichment. Don't try to weave
> multiple.

The enrichment block still ships all available fields (producer, year, sample,
notable facts, artist bio, Wikipedia summary). The LLM decides which one lands
best for each track. Variety across segments emerges from the data — when one
track's sample story is rich and another's is thin, the LLM will naturally
lead with different things. When a playlist is producer-heavy across the
board, producer will repeat, and that reflects the playlist.

We considered forced rotation (server picks one enrichment category per slot)
but rejected it because it removes the "best fact wins" signal. Determinism
isn't worth the quality cost when the LLM's own judgment is usually better.

## Component changes

### `server/src/services/broadcast/types.ts`

Add `'tight_bridge'` to the `SegmentTier` union.

### `server/src/services/broadcast/ManifestBuilder.ts`

Replace the `for (let i = 0; i < tracks.length - 1; i++)` transition loop with
a loop over `i = 2, 4, 6, …`, pushing a transition slot with
`afterTrackId = tracks[i - 1].id` and `beforeTrackId = tracks[i].id`.

Tier assignment within the new loop: track a counter that flips between
`fact_bridge` and `tight_bridge` (starting with `fact_bridge`). `featureSlots`
still wins when it matches a slot index.

### `server/src/services/broadcast/SegmentScriptBuilder.ts`

- Update `TIER_SHAPES.fact_bridge`: budget `45-55 words`, shape reworded to
  emphasize single fact + single feel, hybrid rule (no outgoing reference).
- Add `TIER_SHAPES.tight_bridge`: budget `30-40 words`, shape "one hook —
  either a concrete fact or a perceptual note. Tight, no filler."
- Add one line to `buildSystemPrompt`'s FACT DISCIPLINE section: "Pick the
  single most interesting fact from the enrichment. Don't try to weave
  multiple."
- Update the transition user-prompt builder to drop the outgoing-track line.
  Today: `Outgoing: <track>\nIncoming: <track>`. New: `Incoming: <track>`.

### `src/engines/BroadcastPlayer.ts`

Today's main loop assumes a segment before every track. New loop: walk
`manifest.segmentSlots` in order, and for each slot, play the segment audio
(if present), then play the track matching `slot.beforeTrackId` (if set).
After the final transition's track, play `sign_off`.

Pseudocode:

```ts
for (const slot of manifest.segmentSlots) {
  if (slot.kind === 'sign_off') {
    await runSegmentAt(slot.index);
    break;
  }
  await runSegmentAt(slot.index);
  if (slot.beforeTrackId) {
    await runTrackById(slot.beforeTrackId);
  }
  // After playing track linked to this slot, continue to next slot.
  // If the next slot is another transition, any tracks between the
  // current track and that slot's beforeTrackId play back-to-back here.
}
```

The "play tracks between segments" part needs care: after `runTrackById`, if
the next segment's `beforeTrackId` is more than one index ahead in
`manifest.tracks`, play the intermediate tracks in order before running the
next segment. This handles the "silent boundaries" between adjacent tracks
that don't have a transition.

### Tests

- `ManifestBuilder.test.ts` — new cases: 5-track manifest has 4 slots; 9-track
  has 6; 15-track has 9. Slot tiers alternate `fact_bridge → tight_bridge → …`.
  `featureSlots` still overrides.
- `SegmentScriptBuilder.test.ts` — new test: `tight_bridge` produces a
  30-40-word budget instruction in the user prompt. Verify the "pick one fact"
  rule is in the system prompt. Verify transition user-prompt no longer
  includes the outgoing-track line.
- `BroadcastPlayer` tests — update any cases that hard-code N+1 segments. Add
  a case: manifest with `tracks.length=5` and 2 transitions plays all 5 tracks
  in order, with segment audio only at slots 0, 1, 2, 3 (cold_open, trans 1,
  trans 2, sign_off).

## Data flow

```
POST /broadcast/create
  → TrackSequencer.sequence()            [unchanged]
  → ManifestBuilder.buildManifest()      [CHANGED: slot count + tier mix]
  → SegmentScriptBuilder.buildSegmentPrompts()
                                         [CHANGED: tight_bridge shape,
                                          fact discipline rule, transition
                                          user prompt]
  → SegmentGenerator → LLM → TTS → R2    [unchanged]
  → manifest shipped to client

Client BroadcastPlayer
  → walks segmentSlots                    [CHANGED: loop shape]
  → runs each segment + matching track
```

## Rollout

- No env changes.
- No schema changes — manifest JSON shape is identical; fewer segment entries
  and new `tier` values are backwards-compatible with the existing client
  resumer (which iterates whatever's in the array).
- In-flight broadcasts in `BroadcastStore` (2h TTL) were baked under old rules
  and keep their old shape. New bakes start producing the new shape
  immediately.
- Client-side MMKV resume manifests from pre-deploy continue to work — the
  player's new loop handles both shapes (it iterates segmentSlots by
  `beforeTrackId` / `afterTrackId` rather than assuming a fixed count).

## Risks

- **Player loop regression.** Current tests assume 1-segment-per-track shape;
  rewriting the loop risks introducing playback stalls. Mitigate with
  explicit unit tests for the new shape and a manual TestFlight run before
  declaring done.
- **Voice feels sparser than expected.** Fewer transitions means longer
  stretches of music without host presence. Could feel "unattended" on long
  broadcasts (15 songs, 7 transitions means ~2-minute gaps). If feedback says
  this, we can add a `deep_dive` at slot ~midpoint via `featureSlots` to
  create a "breath" moment.
- **`tight_bridge` feels rushed despite the 30-40 word floor.** If early
  output lands closer to 30 than 40, we can nudge the floor up or rewrite the
  shape instruction.

## Open questions

None — all editorial decisions landed in brainstorming.

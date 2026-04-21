# Playlist Algorithm Redesign — Design Spec

**Status:** Approved, pending implementation plan
**Branch:** `playlist-algorithm`
**Author:** Bakari + Claude (brainstormed 2026-04-21)
**Supersedes:** LLM-based `TrackSequencer` (introduced 2026-04-12)
**Related spec to follow:** LLM provider swap (Gemini → Groq) — separate doc

---

## Problem

A user-reported bug: same Apple Music playlist baked under different vibes (e.g., `party` vs `morning`) produces the **exact same track order**. The first track of the playlist always lands at position 0, regardless of vibe.

**Root cause (confirmed from production PM2 logs):** `TrackSequencer.attemptSequence` makes a Gemini call to order tracks. Gemini regularly fails in three recurring modes:

1. Returns JSON containing `//` inline comments → `parseResponse` throws `Unexpected token '/'`.
2. Free-tier 20 RPM quota exhausted → HTTP 429.
3. Hallucinated track IDs not in the pool.

On second retry failure, the sequencer silently falls back to `pool.slice(0, N)` — which is literally the playlist's input order. The fallback is indistinguishable from a successful ordering in the response shape, so the user sees a "working" bake with identity-ordered tracks. Different vibes take the same path and hit the same fallback, producing identical output.

## Goal

Replace the LLM-based ordering pipeline with a **deterministic numeric scoring algorithm** that:

1. Produces genuinely different orders for different vibes on the same pool.
2. Produces genuinely different orders across bakes of the same (pool, vibe) — so repeat listens of "Late Night Soul + lateNight vibe" don't replay the identical set.
3. Is reproducible within a single bake (for debugging).
4. Never silently degenerates to input order.
5. Operates within the existing server architecture without touching the commentary-generation pipeline.

## Non-goals

- Replacing Gemini for commentary generation (covered by a separate upcoming spec for a Groq LLM provider).
- Modifying the Apple MusicKit search/playlist flow.
- Improving track enrichment quality beyond adding the new audio-features source.
- Cross-broadcast playlist curation ("don't repeat tracks from last week"). Deferred as v2.

---

## Approach — pure deterministic scoring with seeded top-K sampling

Each track carries a numeric `AudioFeatures` vector. Each vibe defines a target trajectory — 4 keyframes (open, body, peak, close) with target feature values at each. For each slot, the algorithm:

1. Computes the slot's fractional position `p = i / (N − 1)`.
2. Interpolates the target vector from the surrounding keyframes.
3. Scores every remaining pool track by weighted L2 distance from the target, plus adjacency penalties for same-artist/same-album repetition.
4. Takes the top-K best-scoring candidates (K scales with broadcast length).
5. Picks one via a PRNG seeded on `broadcastId`, removing it from the pool.
6. Advances to the next slot.

This is fully deterministic given the inputs (pool, vibe, length, broadcastId). Different `broadcastId`s produce different top-K selections and therefore different orders. Different vibes produce different target curves and therefore different candidate rankings.

No LLM is involved in ordering. The LLM retains responsibility for commentary only.

### Rejected alternatives

- **Rule-based on existing enrichment only (no ReccoBeats)** — coarse signal; can't distinguish "120 BPM dance-pop" from "120 BPM metalcore"; wouldn't meaningfully fix the bug.
- **Hybrid features + genre rules** — adds a second weighting scheme that double-penalizes tracks and makes debugging harder ("was it the features or the genre filter?"). Features-only is clean.
- **Deterministic-first with LLM as last-resort fallback** — reintroduces the failure modes (JSON parse, quota) we're trying to escape. Pure shuffle-with-adjacency-repair is a safer final fallback.
- **Top-K sampling + recently-aired suppression** — would give extra natural variation but requires new per-user persisted state. Deferred to v2 — solve the stated bug first with the simpler mechanism.

---

## Architecture

### New modules

| Path | Responsibility |
|---|---|
| `server/src/services/enrichment/fetchers/ReccoBeatsFetcher.ts` | ISRC-keyed audio-features lookup. Batch endpoint (~10 ISRCs/call), ~2 req/s rate limit. |
| `server/src/services/enrichment/fetchers/DeezerFeaturesFetcher.ts` | `GET /track/isrc:{ISRC}` — returns `bpm`, `gain` (loudness). Tier-2 fallback. |
| `server/src/services/broadcast/feature-synth.ts` | Pure functions that synthesize a complete `AudioFeatures` vector from whatever signals are available (tier ladder). |
| `server/src/services/broadcast/vibe-curves.ts` | Keyframe-based numeric curves per vibe (4 keyframes × 7 vibes × 7 features). Data, not code. |
| `server/src/services/broadcast/DeterministicTrackSequencer.ts` | The new sequencer. Implements score-and-place with top-K seeded sampling. |

### Modified modules

| Path | Change |
|---|---|
| `server/src/services/enrichment/EnrichmentCache.ts` | Extend `EnrichmentRecord` with optional `isrc`, `features`, `featuresSource`, `featuresAt`, `featuresVersion` fields. |
| `server/src/services/enrichment/BackgroundEnricher.ts` | Add `fetchFeatures` stage that runs after Genius/MusicBrainz/Wikipedia/LastFm. Merges into existing cache writes. |
| `server/src/services/broadcast/TrackSequencer.ts` | Renamed `LLMTrackSequencer`. Kept temporarily behind feature flag; deleted after rollout soak. |
| `server/src/services/broadcast/vibe-arcs.ts` | No change to prose (still used by commentary prompt). Sibling `vibe-curves.ts` added. |
| `server/src/services/broadcast/BroadcastOrchestrator.ts` | Picks sequencer based on `SEQUENCER_MODE` env var. |
| `server/src/routes/broadcast.ts` | Zod `trackSchema` gains `isrc: z.string().length(12).optional()`. Same in `server/src/routes/featured.ts`. |
| `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` | `Song.isrc` included in serialized playlist tracks. |
| `modules/expo-music-kit/index.ts` | `MusicTrack` interface gains `isrc?: string`. |
| `src/engines/BroadcastManifestClient.ts` | `sanitizeTracksForBake` passes `isrc` through when present. |

### Removed modules

- `server/src/services/broadcast/SequenceCache.ts` — deleted. Scoring is microseconds; caching is incompatible with per-bake seeded variation.
- `sequence-repair.ts`'s LLM-era repair loop (`MAX_PASSES = 5`) — the simpler adjacency *penalty* in scoring replaces the swap/retry loop. The file's `removeDuplicates` helper stays; the iterative repair logic goes.

### Unchanged

- `SegmentGenerator`, `SegmentScriptBuilder`, `ManifestBuilder`, `BroadcastOrchestrator`'s overall flow (slot 0 race with enrichment drain, background slots 1..N).
- `VIBE_ARCS` prose (used by `SegmentScriptBuilder.systemPrompt`).
- `GenreFamily` (used for feature synthesis fallback + commentary).
- Client-side `BroadcastPlayer`, caching, resume behavior.

---

## Data model

### `AudioFeatures`

```ts
interface AudioFeatures {
  tempo: number;           // BPM, 40-200
  energy: number;          // 0-1
  valence: number;         // 0-1 (sad → happy)
  danceability: number;    // 0-1
  acousticness: number;    // 0-1
  loudness: number;        // normalized to 0-1 from dB scale (dB+60)/60
  instrumentalness: number;// 0-1
}
```

All fields required on the in-memory struct. Partial data from external APIs gets completed via synthesis before storing.

### Extended `EnrichmentRecord`

```ts
interface EnrichmentRecord {
  // existing fields retained
  genre?: string;
  moodTags?: string[];
  releaseYear?: string;
  producer?: string;
  sample?: string;
  wikipediaSummary?: string;
  notableFacts?: string[];
  artistBio?: string;
  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'wikipedia' | 'lastfm' | 'hybrid' | 'reccobeats';

  // new fields
  isrc?: string;
  features?: AudioFeatures;
  featuresSource?: 'reccobeats' | 'synthesized' | 'defaults';
  featuresAt?: number;
  featuresVersion?: number;  // starts at 1; bump to invalidate cached features
}
```

### `VibeCurve`

```ts
interface Keyframe {
  position: number;                    // fixed at 0.0, 0.33, 0.67, 1.0
  targets: AudioFeatures;              // all fields required
}

interface AudioFeatureWeights {
  tempo: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  loudness: number;
  instrumentalness: number;
}

interface VibeCurve {
  keyframes: [Keyframe, Keyframe, Keyframe, Keyframe];  // always 4
  weights: AudioFeatureWeights;         // normalized to sum 1.0
}

const VIBE_CURVES: Record<Vibe, VibeCurve> = {
  lateNight: { /* 4 keyframes, weights */ },
  // … 6 more
};
```

Initial values hand-authored from the existing prose in `vibe-arcs.ts`; curves are data, editable without a refactor.

### Cache key strategy

- **Primary key:** ISRC — one cache entry shared globally across all users and storefronts for the same recording.
- **Fallback key:** existing `normalizeKey(title, artist)` — used when a track lacks ISRC (library items, some indie releases).
- **Alias write:** when a track is first fetched under its ISRC, also write an alias entry under its title|artist key so subsequent no-ISRC lookups hit.

### ISRC plumbing

- Native: `Song.isrc` → Swift `serializePlaylistTrack` includes `isrc`.
- JS bridge: `MusicTrack` interface gains `isrc?: string`.
- Client: `sanitizeTracksForBake` preserves `isrc` when present (no filtering based on it).
- Server Zod: `isrc: z.string().length(12).optional()`.

---

## Scoring algorithm

```text
function sequence(pool, vibe, length, broadcastId):
  N = LENGTH_TO_N[length]
  if pool.length < N: throw 'insufficient tracks'

  # Ensure every track has a full feature vector.
  for track in pool:
    track.features = getOrFetchFeatures(track)    # fallback ladder guarantees non-null

  curve = VIBE_CURVES[vibe]
  result = []
  remaining = [...pool]
  rng = mulberry32(hash(broadcastId))

  for i in 0..N-1:
    p = i / (N - 1)
    target = interpolateKeyframes(curve.keyframes, p)

    scored = remaining.map(t => ({
      track: t,
      score: weightedDistance(t.features, target, curve.weights)
             + adjacencyPenalty(t, result[-1])
    }))

    scored.sort(ascending by score)              # lower = better fit
    k = min(K_FOR_LENGTH[length], remaining.length)
    topK = scored.slice(0, k)
    picked = topK[rng.pickIndex(topK.length)]

    result.push(picked.track)
    remaining.remove(picked.track)

  featureSlots = nominateDeepDives(result, enrichmentCache)
  return { orderedTracks: result, featureSlots, source: 'deterministic' }
```

### `weightedDistance`

Per-feature normalized to 0-1 (`tempo` by `(bpm - 40) / 160`, `loudness` by `(dB + 60) / 60`, others already 0-1). Squared differences weighted by `curve.weights`, square-rooted. Returns 0-1.

### `adjacencyPenalty`

- `+0.15` if track's artist matches `result[-1].artist`
- `+0.30` if track's album matches `result[-1].album`
- `0` otherwise

Soft penalty, not hard exclusion. A strongly-fitting same-artist track can still win if no alternative fits the arc. Replaces the iterative swap-loop repair.

### `K_FOR_LENGTH`

```ts
{ quick: 2, standard: 3, long: 3 }
```

K dynamically caps at `min(K, remaining.length)` so the final slots get tighter selection. Opening and closing slots naturally have stronger fit (more candidates). Middle slots vary most across bakes.

### Seeded PRNG

`mulberry32(seed)` — small, fast, zero-dependency. Seed derived from `hash(broadcastId)` (e.g., `sha256(broadcastId).slice(0, 8)` interpreted as uint32).

### `nominateDeepDives`

Rank transitions by enrichment richness of the *incoming track* (count of non-empty fields among producer, sample, wikipediaSummary, notableFacts; each counts 1). Mark the top `ceil((N - 1) / 4)` transitions as `deep_dive`. Deterministic given the same enrichment snapshot.

---

## Fallback ladder

Every track ends with a complete `AudioFeatures` vector. Tiers attempted in order; first success wins.

### Tier 1 — ReccoBeats (primary)
- `POST https://api.reccobeats.com/v1/audio-features?ids[]=…` — multi-ISRC batch endpoint (~10 ISRCs per call).
- Returns full feature vector.
- Sequential batches with 500ms gap to respect ~2 req/s rate limit.
- On 500 / timeout: one retry with 1s backoff, then fall through.
- `featuresSource: 'reccobeats'`.

### Tier 2 — Deezer
- `GET https://api.deezer.com/track/isrc:{ISRC}` — returns `bpm`, `gain`.
- Maps to `tempo`, `loudness`. Other fields synthesized via tier 3 logic.
- `featuresSource: 'synthesized'`.

### Tier 3 — Last.fm + genre heuristics
- `track.getTopTags` — pulls mood-adjacent tags.
- Tag-to-feature mapping table (hand-authored, lives in `feature-synth.ts`):
  - `chill` → `{energy: 0.3, valence: 0.4}`
  - `energetic` → `{energy: 0.75}`
  - `upbeat` → `{valence: 0.75}`
  - `melancholy` → `{valence: 0.25, energy: 0.35}`
  - (table grows as tag coverage is observed)
- Combined with `GenreFamily` for coarse defaults: `ambient → {instrumentalness: 0.8, tempo: 75}`, `rock → {tempo: 120, energy: 0.65}`, `hip-hop → {tempo: 90, danceability: 0.7}`, etc.
- `featuresSource: 'synthesized'`.

### Tier 4 — Genre-family defaults only
- `GenreFamily` alone. Coarsest signal.
- `featuresSource: 'synthesized'`.

### Tier 5 — Neutral defaults
- `{ tempo: 100, energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.4, loudness: 0.5, instrumentalness: 0.2 }`.
- Track participates but is indistinguishable by features. Selection driven by adjacency penalty + seeded sampling.
- `featuresSource: 'defaults'`.

---

## Error handling & edge cases

| Case | Behavior |
|---|---|
| ReccoBeats API 500 / timeout | One retry at 1s backoff; fall through to tier 2 on second failure. |
| Deezer / Last.fm down | Skip to next tier. No retries (fallback already signals degradation). |
| All APIs unreachable | Every track lands at tier 4 or 5. Bake still succeeds with coarse scoring. Warning log: `[features] all external APIs unreachable, using defaults`. |
| Pool size < N | Throw `insufficient tracks`. HTTP 400. (Current behavior preserved.) |
| Pool size === N | K degenerates to 1 at final slots. Last slot has no choice. Documented, not an error. |
| All tracks have identical features | Tie; top-K picks arbitrarily via seed. Order varies across bakes, fit is constant. Acceptable. |
| Track missing ISRC | Fall back to `normalizeKey(title, artist)` cache key. Skip ReccoBeats (ISRC-only); start at tier 2. |
| ReccoBeats returns partial data | Missing fields filled via tier 3 logic. `featuresSource` stays `'reccobeats'`; log a `partialFeatures: true` flag for observability. |
| `featuresVersion` mismatch in cache | Re-fetch; overwrite. |
| Feature cache write fails | Log + continue. Scoring uses in-memory features for this bake. Next bake re-fetches. |
| Last.fm returns totally absent tags | Tier 3 skips to tier 4 (genre-only). |
| Pool-vibe mismatch (user picks `workout` on ballad playlist) | Scoring picks least-bad tracks. If mean selected-score > 0.7, emit warning log `[Sequencer] poor vibe fit (mean distance X)`. Non-blocking. |

---

## Observability

Emitted per bake (after sequencing completes):

```text
[Sequencer] source=deterministic vibe=lateNight N=5 poolSize=20
  features: reccobeats=15 synthesized=4 defaults=1
  meanDistance=0.42 topScoreDistance=0.28 lastScoreDistance=0.61
  deepDiveCount=1 deepDiveSlots=[3]
```

Pool-vibe-mismatch warning (separate line, only when triggered):

```text
[Sequencer] poor vibe fit (mean distance 0.74)
```

Feature fetch tier breakdown per enrichment drain:

```text
[BackgroundEnricher] features tiers: reccobeats=38 deezer=2 lastfm=0 defaults=0 (40 tracks)
```

These logs go to PM2 / prod logs; no new dashboards required initially. Can be aggregated post-launch to tune curves.

---

## Testing strategy

### Unit tests (server/__tests__/broadcast/)
- `weightedDistance` — symmetric, bounded 0-1, zero when vectors match, weighted correctly.
- `interpolateKeyframes` — position at keyframe returns keyframe target; position between lerps; out-of-bounds clamps.
- `nominateDeepDives` — ranks by enrichment richness, caps at `ceil((N-1)/4)`.
- `adjacencyPenalty` — 0.15 same artist, 0.30 same album, 0 otherwise.
- `mulberry32` — identical sequences across runs for same seed.

### Fallback ladder tests
- Mock ReccoBeats 500 → Deezer called → features populate with `featuresSource: 'synthesized'`.
- Mock all externals fail → features populate from genre defaults → bake succeeds.
- Mock partial ReccoBeats response → missing fields filled from genre heuristics; `partialFeatures: true` logged.

### Integration tests
- `sequence({ pool, vibe: 'lateNight', length: 'quick', broadcastId: 'test-A' })` → deterministic result. Same inputs → byte-identical output across runs.
- Same call with different `broadcastId` → different result (provided pool has feature diversity).
- Same call with different `vibe` → different result. **This is the bug regression test — assert inequality.**
- Every vibe × every length × two broadcast IDs combination runs without throwing.

### Golden tests
- 3-5 hand-picked `{ pool, vibe, length, broadcastId }` inputs; expected `orderedTracks[].id` arrays stored in JSON fixtures under `server/__tests__/fixtures/sequencer-goldens/`.
- Tests assert exact match. Intentional tuning changes require running `jest --updateSnapshot` and committing the new goldens.
- Locks in "the algorithm picks a sensible lateNight set from this known pool" as a contract.

### Performance
- `sequence()` on a 40-track pool completes in < 10ms. Pure math; no I/O during sequencing (enrichment is separate).

---

## Migration & rollback

### Feature flag

```bash
SEQUENCER_MODE=deterministic   # default
# or
SEQUENCER_MODE=llm             # old path, kept one deploy cycle
```

In `BroadcastOrchestrator`:

```ts
const mode = process.env.SEQUENCER_MODE ?? 'deterministic';
this.sequencer = mode === 'llm'
  ? new LLMTrackSequencer(llm, sequenceCache, enrichmentCache)
  : new DeterministicTrackSequencer(enrichmentCache, featureFetcher);
```

### Rollout

1. Merge with flag defaulted to `deterministic`. Deploy.
2. Bake test broadcasts across all 7 vibes on prod env. Listen.
3. Monitor logs: feature-source mix, mean-distance distribution, poor-vibe-fit warnings.
4. After ~2 weeks of clean prod data: delete `LLMTrackSequencer`, `SequenceCache`, the LLM-era repair loop in `sequence-repair.ts`, `SYSTEM_PROMPT`, `parseResponse`, and the env flag branch. Collapse `BroadcastOrchestrator.sequencer` to a single type.
5. Remove the env flag from docs.

### Rollback

Set `SEQUENCER_MODE=llm` in server `.env`; PM2 reload. Full revert in < 60s.

### Data migration

None. New fields on `EnrichmentRecord` are all optional; existing cached records remain valid and populate the new fields lazily as tracks are re-fetched.

---

## Open questions for implementation

- **Initial keyframe values** — written by hand from existing prose arcs during implementation. Empirical refinement deferred to a post-launch tuning round once we have telemetry.
- **Last.fm tag-to-feature table** — starts small (chill/energetic/upbeat/melancholy/etc.) and grows as we observe which tags actually appear in production for fallback-path tracks.
- **ReccoBeats batch size** — target 10 ISRCs per call; adjust based on observed API behavior.
- **`hash(broadcastId)` choice** — use first 8 hex chars of `sha256(broadcastId)` as uint32. Any stable mapping works.

---

## Success criteria

1. Same playlist baked under `morning` vs `party` produces **measurably different orders** — verified by integration test + manual A/B listening.
2. Same playlist + same vibe baked twice produces **different orders** (via broadcastId seed) — verified by test.
3. No production log lines of `[Sequencer] source=fallback` (the old silent-fallback marker).
4. Feature-source telemetry shows > 70% tier-1 (ReccoBeats) coverage on typical playlists.
5. Rollback path tested — setting `SEQUENCER_MODE=llm` restores prior behavior without code change.

---

## Follow-up specs

- **LLM provider swap (Gemini → Groq `llama-3.3-70b-versatile`)** — architecturally independent; sequences and commentary are separate pipelines after this redesign. Planned as the next spec.
- **Recently-aired suppression** — per-user persisted "aired in last N days" state to reduce repeat tracks across bakes. v2 enhancement.
- **Data-derived vibe curves** — once we have telemetry on real bakes, compute feature centroids from reference playlists to refine hand-authored keyframes. v2 tuning.

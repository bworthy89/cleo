# Pre-Baked Broadcast — Curation Redesign

**Date:** 2026-04-16
**Status:** Design approved, awaiting implementation plan

## Problem

`ManifestBuilder.buildManifest()` currently does `tracks.slice(0, trackCount)` — the user's vibe selection never influences which tracks play or in what order. Broadcasts feel arbitrary; the 12 vibes are effectively cosmetic labels with no curation behind them. Users report the experience as "random" — no worse than a standard shuffle, no better than Pandora or Spotify.

Goal: make vibe selection meaningful. The user picks `lateNight` and the broadcast actually *feels* like lateNight — specific tracks from their playlist, in a specific order, with a specific emotional trajectory. The product's differentiator is editorial intent; this design puts that intent into the pipeline.

## Scope decisions

| Question | Decision |
|---|---|
| What is the sequencer's job? | Select + reorder + skip mismatches. User's playlist is a **source pool**, not a literal tracklist. Pick the best N tracks for the vibe, arrange them. |
| How are vibes defined? | Hand-written editorial arcs, stored as prose in `vibe-arcs.ts`. One-time authoring pass, committed as reference data. |
| Where do per-track attributes come from? | LLM reasoning (primary) + background-cached enrichment (accumulates over time). No upfront enrichment blocking the bake. |
| How does the sequencer fail? | Retry once, then silent fallback to deterministic `pool.slice(0, N)`. Never refuse a bake. |
| Same playlist + same vibe, re-bake behavior? | Deterministic within 24h TTL — cache serves instantly for same-day replays, fresh sequence tomorrow. |
| How strict is genre filtering? | Preferred/avoid lists are **soft signals only**. A hip-hop-only user picking lateNight gets the most lateNight-adjacent hip-hop, arranged into the hushed arc. Never exclude a track because its genre is "wrong." |
| Preflight warning on bad combos? | None. Trust the user. A real radio host works with what they've got. |
| How many vibes? | 7: `morning`, `focus`, `workout`, `feelGood`, `lateNight`, `melancholy`, `party`. Down from 12. "General" and overlap vibes dropped. |

## Architecture

New server-side stage, `TrackSequencer`, sits between the client request and `ManifestBuilder.buildManifest()` inside `BroadcastOrchestrator.create()`. Pure class with DI for LLM caller and cache adapters (same pattern as `SegmentGenerator`).

### Updated request flow

```
POST /broadcast/create
  ↓
Orchestrator.create(request):
  1. sequence = await TrackSequencer.sequence({
       pool: request.tracks,
       vibe, length, userContext,
     })
     ├─ cache hit? → return cached sequence
     ├─ LLM call with arc + pool → JSON array of N track IDs
     ├─ validate + locally repair constraint violations
     ├─ write to cache (24h TTL)
     └─ on failure: retry once, then fall back to pool.slice(0, N)
  2. manifest = ManifestBuilder.buildManifest({
       ...request, tracks: sequence.orderedTracks
     })
  3. store.put(manifest)
  4. SYNC: generateSlot(0)
  5. ASYNC: Promise.allSettled(generateSlot(1..N))
  6. ASYNC: backgroundEnrichTracks(sequence.orderedTracks)
  7. return { manifest, firstSegmentUrls }
```

`ManifestBuilder` is dumb — it lays out slots around whatever tracks it receives. All curation intelligence lives in `TrackSequencer`.

### Files added

- `server/src/services/broadcast/TrackSequencer.ts` — pure class
- `server/src/services/broadcast/vibe-arcs.ts` — the 7 arc definitions
- `server/src/services/broadcast/SequenceCache.ts` — in-memory LRU, 24h TTL, max 500 entries
- `server/src/services/broadcast/sequence-repair.ts` — hard-constraint checker + swap-repair
- `server/src/services/enrichment/EnrichmentCache.ts` — persistent JSON-file-backed track metadata cache
- `server/src/services/enrichment/BackgroundEnricher.ts` — serial queue worker

### Files modified

- `server/src/services/broadcast/BroadcastOrchestrator.ts` — inject sequencer, call before ManifestBuilder, fire background enrichment after sync response
- `server/src/services/broadcast/ManifestBuilder.ts` — remove slice logic, expect pre-sequenced tracks
- `server/src/services/broadcast/types.ts` — `Vibe` union → 7 vibes
- `server/src/middleware/validate.ts` — Zod vibe enum updated
- `server/src/services/broadcast/SegmentScriptBuilder.ts` — consume producer/sample from enrichment cache for commentary flavor
- `src/engines/BroadcastPlayer.types.ts` — mirror `Vibe` type
- `src/tokens/design-tokens.ts` — `Colors.vibe` map + `getVibeAccent()` shrink to 7
- `src/components/broadcast/SetupSheet.tsx` — vibe picker collapses to single screen of 7 rows with descriptors

## Vibe arcs

Each vibe has: prose shape (opening → body → peak → descent → close), preferred genres/qualities, avoid list. Preferred/avoid are **aesthetic hints**, not filters — never exclude a track from consideration. Drafts below are starting points; refinement is a one-time authoring pass before launch.

### `morning` · *sun's up, gentle forward motion*
Opens fresh and clear — a song that sounds like a window opening. Mid-tempo, major key. Picks up steadily but never sprints; the day is starting, not a workout. Peak is a gently uplifting mid-tempo anthem, never club energy. Close leaves the listener ready to move — not sleepy, not peaked-out.
- **Preferred:** folk-pop, sunny indie, alt-pop, soul-adjacent pop, warm acoustic.
- **Avoid:** heavy bass, trap, anything that sounds like 2am.

### `focus` · *head-down, unobtrusive momentum*
Opens textural and undemanding — instrumental or near-instrumental track 1, no vocal hooks that pull you out of what you're doing. Body stays in lane; variation comes from timbral shifts, not dynamic swings. No traditional peak — a mid-session plateau at best. Close suggests a natural stopping point.
- **Preferred:** ambient, lo-fi, post-rock instrumental, instrumental hip-hop, minimal techno, neoclassical piano.
- **Avoid:** lyric-heavy storytelling, loud dynamic shifts, aggressive genres.

### `workout` · *sustained drive*
Arrives running — immediate energy, clear pulse, 120+ BPM, no easing in. Body holds the plateau; every track keeps the pulse up, no mid-session breathers. Peak is the hardest-hitting cut in the pool, late-middle. Descent is minimal until the last track, which comes down but keeps momentum — a finish line, not a collapse.
- **Preferred:** hip-hop, hard dance, EDM, rock, high-energy pop, drum & bass.
- **Avoid:** acoustic ballads, downtempo, anything under 100 BPM except the final track.

### `feelGood` · *warm, uplifting, communal*
Opens instantly warm — a groove you can nod to from the first bar. Major key, hook-forward. Body builds generosity, each track slightly more engaging than the last. Peak is the track in the pool that makes people sing along — big hook, obvious joy. Descent stays warm. Close leaves a smile.
- **Preferred:** classic soul, Motown, funk, reggae, upbeat Afrobeats, sunshine pop, R&B grooves.
- **Avoid:** melancholy, moody, ironic detachment, trap.

### `lateNight` · *intimate, hushed, drifting*
Opens low-lit — slow-burn vocal or spare R&B, 75-90 BPM, feels like a single lamp on. Tracks 2-3 add texture in the same register — warmth builds, volume doesn't. Peak is a groove, never a banger — deep and restrained, 2am college radio. Descent comes way down. Close is hushed: solo piano, acoustic, or a vocal with space around it.
- **Preferred:** neo-soul, downtempo, smooth R&B, vocal jazz, quiet storm, ambient vocals.
- **Avoid:** four-on-the-floor, shouting, club energy.

### `melancholy` · *reflective, sad in a good way*
Opens slow without wallowing — piano, strings, or spare vocal that sits with the listener. Body deepens the feeling without rushing. Peak is emotional, not energetic — the track that hits hardest, usually minor key or unresolved. Descent stays in register — no forced upswing. Close leaves the listener held, not dropped. Quiet resolve.
- **Preferred:** indie folk, singer-songwriter, chamber pop, slowcore, sad R&B, ambient with vocal texture.
- **Avoid:** uplifting resolutions, pop-positive choruses, energetic tempos.

### `party` · *Saturday night, social, builds and releases*
Arrives confident but not peaked — a groove that pulls people into the room, 100-115 BPM. Body climbs steadily, each track slightly harder than the last. Peak is mid-to-late — the biggest track in the pool, most-played, most-danceable. Brief descent drops to released communal energy — everyone-singing-along. Close leaves the room elevated, not exhausted.
- **Preferred:** hip-hop, dance-pop, Afrobeats, house, funk, disco revivals.
- **Avoid:** slow ballads, introspective cuts, anything that kills momentum.

### Arc file shape

```ts
// server/src/services/broadcast/vibe-arcs.ts
export interface VibeArc {
  vibe: Vibe;
  descriptor: string;   // one-line, UI-facing (e.g. "hushed, warm, drifting")
  arc: string;          // full prose for LLM prompt
  preferred: string[];
  avoid: string[];
}

export const VIBE_ARCS: Record<Vibe, VibeArc>;
```

`TrackSequencer` reads `arc`, `preferred`, `avoid`. `SetupSheet` reads `descriptor` for the UI. `getVibeAccent()` in `design-tokens.ts` is the only separate map (colors are aesthetic, not editorial).

## Sequencer prompt

```
SYSTEM:
You are a radio programmer arranging a broadcast. You receive a pool of
tracks and a target arc. Return a JSON array of N track IDs in the order
they should play, chosen to best fit the arc using the pool provided.

Preferred and avoid lists are aesthetic hints, not rules. If the pool has
few tracks matching preferred, adapt — find tracks closest to the arc's
feel. Never refuse. Your job is to make the best <VIBE> broadcast possible
from THESE tracks, whatever they are.

Hard constraints:
- Output is valid JSON, exactly { "ordered": ["trackId", ...] }
- Every ID must exist in the pool (no hallucination)
- Length is exactly N
- No track appears twice

USER:
Vibe: <vibe>
Arc: <arc prose>
Preferred: <list>
Avoid: <list>
Session length: N tracks
User context: <timeOfDay, dayOfWeek>

Pool (<poolSize> tracks):
[
  { id, title, artistName, genre, releaseYear, duration, enrichment?: { moodTags, producer, sample } },
  ...
]
```

Per-track `enrichment` is populated only if `EnrichmentCache` has a record. On first bake for most tracks it's absent — the LLM infers features from title/artist/genre/year.

### Pool cap

Max 40 tracks sent to the LLM. If the user's playlist has more, take the first 40 in input order (users often front-load favorites). If fewer than the length target, fail fast with a 400 — no broadcast possible.

### Validation and repair

After the LLM responds:

1. **JSON parse** → fail → retry
2. **Shape check** — `{ ordered: string[] }`, length === N → fail → retry
3. **ID validity** — every returned ID exists in the pool → fail → retry (hallucination)
4. **Uniqueness** — no duplicates → repair locally (drop dup, fill with closest unused pool track)

Then the repair pass fires (local, no LLM involvement):

| Constraint | Repair action |
|---|---|
| Same-artist back-to-back | Swap position with nearest non-conflicting slot |
| Same-album back-to-back | Same swap logic |
| Duplicate IDs (caught above) | Drop duplicate, backfill closest unused pool track |

Repair runs at most 5 passes before accepting whatever's left. Failed repair is not a retry trigger — a mildly-off sequence ships rather than a deterministic fallback.

**Deferred repair rules.** Adjacent-BPM-delta and close-slot-peak-character rules were considered but require per-track feature tags we don't yet persist (BPM is not reliably returned by Genius or MusicBrainz; "peak character" is a subjective tag with no source). These stay as future work once we have a reliable BPM/feature source — either by asking the LLM to return estimates alongside the ordering, or by integrating a different enrichment provider.

### Retry budget

One retry on LLM/validation failure (Ollama → Gemini → one more attempt). Second failure → silent fallback to `pool.slice(0, N)` in input order.

## Caches

### `SequenceCache` (ephemeral, in-memory)

| Property | Value |
|---|---|
| Key | `sha256(trackIds.sorted().join('|')) + '|' + vibe + '|' + length` |
| Value | `{ ordered: string[] }` |
| TTL | 24h, lazy eviction on read |
| Capacity | 500 entries (LRU) |
| Persistence | None |

Same-day re-bakes hit instantly. Sorting track IDs before hashing makes the key stable when the user's playlist hasn't changed even if Apple Music returns tracks in a slightly different order.

### `EnrichmentCache` (persistent)

| Property | Value |
|---|---|
| Storage | `server/.enrichment-cache/tracks.json` |
| Write | Atomic tmp + rename, malformed-JSON tolerant |
| Key | `normalize(title) + '|' + normalize(artist)` — lowercase, collapse whitespace, strip `(feat. X)`, `(Remastered YYYY)`, `- Deluxe Edition` suffixes |
| Value | `EnrichmentRecord` (see below) |
| Re-enrichment threshold | 30 days since `lastEnrichedAt` |

```ts
interface EnrichmentRecord {
  genre?: string;           // MB top tag
  moodTags?: string[];      // MB tags filtered to mood words
  releaseYear?: string;     // MB first-release-date or Genius release_date
  producer?: string;        // Genius
  sample?: string;          // Genius — "Samples X by Y"
  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'hybrid';
}
```

**Deliberately not persisted:** BPM (neither Genius nor MB reliably returns it), LLM inferences (kept ephemeral to avoid feedback loops).

### `BackgroundEnricher`

Server-wide serial queue, concurrency 1, reuses 1.1s/request rate limiting (Genius + MusicBrainz). Triggered fire-and-forget from `BroadcastOrchestrator` after the sync response ships. Per track:

1. Check cache — if `lastEnrichedAt` is within 30 days, skip.
2. Call Genius + MusicBrainz in sequence.
3. Merge results into one record, write to cache.

Worker survives request lifecycle but not server restart. Pending enrichments after restart are lost; next bake re-triggers them.

### Commentary payoff

`SegmentScriptBuilder` gains access to `EnrichmentCache`. When a track has `producer` or `sample`, the host prompt gets the option to surface it:

> *"Next one's produced by Madlib…"*
> *"You might hear the sample on this — it's flipped from a 1972 Bobby Womack cut…"*

Sequencing gets a second quality ramp: better curation *and* more textured commentary on repeat listens.

## Migration from 12 vibes to 7

Clean cutover — no production users means no compat layer.

| Removed vibe | Replacement rationale |
|---|---|
| `chill` | Collapsed into `lateNight` — overlap was near-total for evening use |
| `general` | Removed entirely — the cop-out default vibe. Every broadcast now has intent. |
| `sunday` | Collapsed into `morning` — same energy band, same use case |
| `throwback` | Removed — era is a filter axis, not a vibe. Better handled as an orthogonal option later if needed. |
| `elevated` | Collapsed into `feelGood` — near-duplicate semantics |

Breaking changes:
- `Vibe` type union updated in both server and client
- `Colors.vibe` map + `getVibeAccent()` shrink to 7
- Zod vibe enum in validation middleware
- `server/featured-broadcasts/*.json` re-tagged where using dropped vibes; `registry.json` wiped on first deploy
- UI copy in `SetupSheet.tsx` collapses to a single-screen picker of 7 rows, each showing `descriptor` beneath the vibe name

## Edge cases

### Playlist has fewer tracks than length target
Fail fast with `400 Broadcast unavailable`. No silent fallback — client shows a clear error.

### Playlist has exactly N tracks
Sequencer still runs — ordering matters even when there's no selection to make.

### User picks a vibe radically mismatched with their pool (e.g. `party` + all-ambient)
Design deliberately does not surface a warning. Sequencer adapts as best it can (most-rhythmic ambient, ordered by tempo). Result will feel wrong; user learns from the experience and picks a better pairing next time. Matches the radio-host aesthetic — a DJ doesn't second-guess a request.

### LLM returns close-to-valid but slightly broken output
Repair pass handles mechanical issues (duplicates, adjacency violations). No LLM retry for these — local fix is faster and deterministic.

### Enrichment cache corruption
`EnrichmentCache.load()` wraps `JSON.parse` in try/catch and starts with empty state on parse failure. One malformed write doesn't poison future bakes.

### Server restart mid-enrichment
Pending queue is lost. Next bake that includes the track re-triggers enrichment. Not worth disk-persisting the queue for this edge case.

## Testing

### Unit tests (Jest, `server/__tests__/`)

| File | Coverage |
|---|---|
| `TrackSequencer.test.ts` | Cache hit skips LLM • cache miss calls LLM • JSON parse error retries • hallucinated ID retries • wrong-length retries • second failure → deterministic fallback • prompt includes arc, preferred, avoid, soft-signal framing • pool capped at 40 when larger • fails fast when pool < N |
| `sequence-repair.test.ts` | Same-artist adjacent → swap • same-album adjacent → swap • duplicate ID → dropped + backfilled • 5-pass limit • unrepairable accepted not rejected |
| `SequenceCache.test.ts` | Hit/miss • 24h TTL • LRU at 500 • key stable under track reorder |
| `EnrichmentCache.test.ts` | Atomic write • malformed-JSON tolerance • 30-day re-enrichment threshold • key normalization: `(feat. X)`, `(Remastered YYYY)`, `- Deluxe` suffixes collide correctly |
| `BroadcastOrchestrator.test.ts` (extend) | Sequencer called before ManifestBuilder • ManifestBuilder receives sequenced tracks • background enrichment fires after sync response, doesn't block it |
| `vibe-arcs.test.ts` | All 7 vibes have non-empty arc, descriptor, preferred, avoid • no vibe references dropped types |

LLM responses mocked in all tests. Real LLM behavior validated in manual device tests, not CI.

### Manual device tests (pre-launch checklist)

- Each of the 7 vibes with a real Apple Music playlist. Verify the broadcast feels like "an intentional `<vibe>` show" vs. the old random slice.
- Re-bake same playlist + same vibe within 5 minutes → same order, near-instant response (cache hit).
- Bake playlist A + vibe X. Wait 5 min. Re-bake. Check server logs for background enrichment completing. Third bake: does commentary pick up producer/sample flavor text?
- Bad-pair pressure test: `workout` + jazz-only playlist; `party` + lo-fi pool. Broadcast ships coherently, no crash, no stall.
- Network-failure sim: kill Ollama mid-bake → fallback to Gemini. Kill both → deterministic fallback, no user-facing error.

### Performance budgets

- Sequencer LLM call: p50 ≤ 4s, p95 ≤ 8s on Ollama
- Cache hit: ≤ 200ms end-to-end on `Orchestrator.create`
- Background enrichment: does not delay sync response (mock enrichment 10s sleep, verify response in <8s)

## Out of scope

- **Cross-user sequence sharing.** Two users with the same playlist + same vibe get independent cache entries. Sharing would require content-addressable storage and raises privacy questions (what's in their playlist). Future work.
- **Sequence explanations for the user.** No "here's why track 5 is where it is" UI. Radio, not Spotify.
- **Per-user preference learning.** No adjustment to sequencing based on what a user skipped (the product doesn't allow skips anyway) or what they've replayed. Future work if listening patterns emerge.
- **Dynamic re-sequencing mid-broadcast.** The manifest is locked at bake time. No reactive reordering.
- **Genre/era filter UI.** The `throwback` vibe was dropped; era is not exposed as a user-facing dimension. If requested later, era is a filter applied to the pool *before* sequencing, not a vibe variant.

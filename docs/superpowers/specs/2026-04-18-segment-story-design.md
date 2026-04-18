# Segment Story Upgrade — Design

**Date:** 2026-04-18
**Status:** Design, pre-implementation
**Related:** 2026-04-12-pre-baked-broadcast-design.md, 2026-04-16-curation-design.md

## Context

The current pre-baked broadcast pipeline generates ONAY's between-track commentary using
per-slot prompts in `SegmentScriptBuilder.ts`. Transitions are capped at 25-40 words,
cold opens at 40-55, sign-offs at 30-45. Each segment is generated independently, with
the only injected factual context being `producer` and `sample` pulled from the Genius
enrichment cache — and that cache is usually empty on first bake because enrichment
runs fire-and-forget *after* segment generation starts.

The result: segments sound like bridges ("we flow from X into Y") rather than stories.
They rarely name a year, a producer, a lyric, a recording circumstance. ONAY sounds the
same whether the track is jazz or trap. And on first bake of any playlist, segments are
at their thinnest because no enrichment data is available yet.

## Goals

1. Every transition carries texture — a fact, a sonic note, a lyric callout, or a
   perceptual observation. No more pure "bridge" segments.
2. A meaningful share of transitions (~25%) go deep — 80-120 words of anecdote,
   session lore, or cultural moment. Real DJ shows do this; ours doesn't yet.
3. ONAY's voice shifts with genre. A jazz track gets jazz vocabulary and reference
   pool; a hip-hop track gets hip-hop vocabulary and reference pool. Nine recognized
   families plus a generic fallback — ten in total.
4. First-bake content is as rich as re-bake content. Enrichment drains before segment
   generation, not after.
5. Expanded factual coverage. Add Wikipedia, Spotify audio features, and Last.fm to
   the existing Genius + MusicBrainz sources.
6. No per-bake cost for the richness — all factual data caches permanently (music facts
   don't change); first enrichment of a track is one-time forever.

## Non-Goals

- Cross-segment continuity / through-line. Each segment still generates independently.
  Adding an evolving thread across a broadcast is a natural follow-up.
- Search-enabled LLM as fallback for empty-enrichment deep-dive slots. The expanded
  structured sources should cover 90%+ of realistic tracks; a live search path can be
  added later if gaps persist.
- Discogs as a source. Wikipedia + Last.fm + Spotify should cover the gap Discogs fills;
  Discogs is on the shelf for a follow-up if needed.
- Multi-variant segments. Manifest supports variants but we generate 1 per slot today
  and will continue doing so.
- Per-tier TTS prosody tuning (slower pace for deep dives, etc.). Tempting but out of
  scope; a future tuning opportunity.
- Client UI changes beyond a small Tuning In progress hint.

## Architecture Overview

Two structural changes drive the upgrade:

1. **Pipeline reshape to truly pre-bake.** Today the orchestrator generates slot 0
   synchronously, fires slots 1..N in parallel with no wait, and fires enrichment
   fire-and-forget. In the new pipeline, the sequencer runs first (using any cached
   enrichment as hints), then enrichment drains for the *chosen N tracks only* (not
   the whole 40-track pool), then all segments generate in parallel with a concurrency
   cap, and *only then* does the response return. Total tuning-in time becomes
   ~25-35s on a cold bake, ~15-20s on a warm bake. The silent failure mode where the
   player reaches a slot that hasn't finished baking is eliminated.

2. **Segment tiering.** Transitions split into two tiers: *fact bridge* (40-60 words,
   ~75% of slots) and *deep dive* (80-120 words, ~25%). The sequencer picks which slots
   are which, using arc position + enrichment richness as signals. Cold opens and
   sign-offs remain single-shape but get slightly larger word budgets (55-80 and 35-55
   respectively).

Supporting changes: genre-aware voice via a small per-family playbook embedded in the
system prompt, a data-discipline guardrail ("don't invent specifics"), expanded
enrichment sources, and a restructured enricher that parallelizes across tracks
instead of serializing.

## Pipeline

### New orchestrator flow

```
1. Normalize tracks — client passes Apple Music genreNames through ManifestTrack
2. TrackSequencer
   - Input: pool, vibe, length, userContext, enrichmentCache (hints if any cached)
   - Output: { ordered: string[], featureSlots: number[] }
   - featureSlots are transition indices to be generated as deep dives
   - Sequencer prompt tells the LLM to prefer tracks marked `rich: true` for deep
     dives, or structural arc positions (peak, pivot, resolution)
   - On first bake, enrichment may be empty — sequencer still orders using title/artist;
     the `rich` flag defaults to false and the LLM falls back on arc position alone
   - Cache: SequenceCache stores { ordered, featureSlots } keyed by tracks+vibe+length
3. Enrichment drain — chosen N tracks only (not the full pool)
   - Per track: Promise.all over all sources (Genius, MB, Wikipedia, Last.fm, Spotify)
   - Per source: rate-limited queue bucketed per API, shared across the track batch
   - Per-call timeout: 10s on every HTTP fetch; expired fetches skip that source
   - Failure mode: any source failure logged and skipped; other sources still populate
   - Drain time: N × (max rate-limit interval) worst case — 5-17s for N=5..15,
     ~0s warm (all cache hits)
   - Skips tracks already cached within the 30-day refresh window
4. ManifestBuilder
   - Records tier on each transition slot based on featureSlots membership
5. Parallel segment generation
   - Concurrency cap: 4 (tunable via config)
   - All 16 segments (cold open + 14 transitions + sign-off for a 15-track broadcast)
     generate in parallel subject to the cap
   - Each segment gets: slot, tier, manifest (with enrichment), genre family, userContext
6. Response returns with all segment audioUrls populated
```

### Timing budget

| Phase | Cold | Warm |
|---|---|---|
| Sequencer | 3-5s | 0s (SequenceCache hit) or 3-5s |
| Enrichment drain (N tracks) | 5-17s (scales with length) | ~0s (cache hit) |
| Parallel segment gen (16 segments, cap 4) | 15-20s | 15-20s |
| **Total tuning-in** | **~25-40s** | **~15-20s** |

Enrichment drain is bounded by the slowest source's rate limit × track count. For
`long` (N=15): Genius 1.1s × 15 ≈ 17s, MusicBrainz 1.1s × 15 ≈ 17s (run in parallel,
so ~17s total). For `quick` (N=5): ~5-6s.

### Failure tolerance

- Any enrichment source failure: log, skip that source, proceed with others.
- Any segment generation failure: mark slot `failed`, player skips silently at playback.
- Cold open failure still aborts the bake (same as today).

### Removed / simplified

- `BroadcastOrchestrator.inFlight` map and `Promise.allSettled` over slots 1..N — no
  longer needed; segment gen is awaited before response.
- `BroadcastPlayer.schedulePolling` / `pollManifestOnce` / slot-status polling — no
  longer needed, manifest is always complete. Candidate for a follow-up cleanup commit;
  not strictly required for shipping.
- `BroadcastPlayer.runSegmentAt`'s silent-skip-on-pending path stays (defense in depth)
  but in practice will never trigger.

## Enrichment Expansion

### EnrichmentRecord schema additions

```ts
interface EnrichmentRecord {
  // existing
  genre?: string;             // MusicBrainz primary, Apple Music fallback
  moodTags?: string[];        // MusicBrainz + Last.fm merged
  releaseYear?: string;       // Genius or MusicBrainz
  producer?: string;          // Genius
  sample?: string;            // Genius

  // new
  wikipediaSummary?: string;  // first 1-2 sentences of the most relevant article
  notableFacts?: string[];    // extracted paragraphs from Wikipedia Background/Recording
  artistBio?: string;         // Last.fm bio snippet, ~1 paragraph
  audioFeatures?: {
    tempo: number;            // BPM
    valence: number;          // 0-1, musical positivity
    energy: number;           // 0-1
    danceability: number;     // 0-1
    key: number;              // pitch class 0-11
    mode: number;             // 0 minor, 1 major
  };

  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'wikipedia' | 'lastfm' | 'spotify' | 'hybrid';
}
```

All additions are optional. Existing cached records remain valid without migration.

### Fetcher architecture

`DefaultEnrichmentFetcher` becomes a composite. Each source has a small class with a
consistent interface:

```ts
interface SingleSourceFetcher {
  fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
}
```

New source fetchers:

- **`WikipediaFetcher`** — No auth. Single search-then-fetch pattern per track:
  `/api/rest_v1/search/title?q=<title artist>` returns best-match page → one fetch
  to `/api/rest_v1/page/summary/<page>` → one fetch to the article HTML for section
  mining (Background / Recording / Composition / Release). Two or three calls per
  track total, all fast. Rate limit is generous (~200 req/s); treat as unlimited
  for our scale.
- **`LastFmFetcher`** — `track.getInfo` + `artist.getInfo`. Requires
  `LASTFM_API_KEY` env var. Graceful skip if unset. Rate limit 5/sec.
- **`SpotifyFetcher`** — client credentials flow (server-to-server auth) using
  `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`. Graceful skip if unset. Two-step:
  `/v1/search?q=track:X+artist:Y&type=track&limit=1` → `/v1/audio-features/{id}`.
  Rate limit is generous (>100/sec).

Existing `GeniusFetcher` and `MusicBrainzFetcher` are unchanged; they get extracted
into their own files for consistency.

### Enricher restructure

Today (serial tracks, parallel per-track APIs):
```
for (const track of tracks) {
  queue = queue.then(() => enrichOne(track));
}
```

New (parallel tracks, per-API rate-limited buckets):
```
await Promise.all(tracks.map(track => enrichOne(track)));
// inside enrichOne, the per-track Promise.all fans across all sources
// each source fetcher's internal rate limiter queues its own calls across the batch
```

Per-API rate limiters live in each fetcher, shared across all tracks in the batch.
Genius has a 1.1s minimum interval between calls (existing), so 15 tracks serialize
to ~17s worst case. MusicBrainz has the same 1.1s interval (1 req/sec limit per
their guidelines); serialized to ~17s. Wikipedia and Spotify are effectively
unlimited for our scale. Last.fm at 5 req/sec means ~3s for 15 tracks. All API
queues run in parallel with each other; the slowest one sets the drain time — ~17s
for N=15.

Every HTTP fetch gets a 10s timeout via `AbortController`. Expired fetches count as
a source failure for that track: logged, skipped, other sources still populate.

### Caching and refresh

- Cache file: `server/.enrichment-cache/tracks.json` (existing).
- Key: normalized `title|artist` (existing).
- 30-day refresh threshold (existing).
- Atomic tmp+rename writes, malformed-JSON tolerant (existing).
- New fields merge additively; old records are still valid.

### New env vars

```
LASTFM_API_KEY          # required to enable Last.fm source; skipped if absent
SPOTIFY_CLIENT_ID       # required to enable Spotify source; skipped if absent
SPOTIFY_CLIENT_SECRET   # required with SPOTIFY_CLIENT_ID
```

Wikipedia needs no auth.

## Sequencer Changes

### Response schema

```
{ "ordered": ["trackId", ...], "featureSlots": [3, 7, 11] }
```

`featureSlots` are transition slot indices marked for deep-dive treatment. For a
broadcast of N tracks, the segment slots are indexed `0..N`: slot 0 is the cold
open, slots `1..N-1` are the N-1 transitions between adjacent tracks, and slot N is
the sign-off. Valid featureSlot range is therefore `1..N-1` inclusive. Cold open
(0) and sign-off (N) are never in this list — they have their own shapes.

### Feature slot allocation

Count per length (rule: ~1 deep dive per 4 transitions, round up):
- `quick` (5 tracks → 4 transitions): 1 deep dive
- `standard` (9 tracks → 8 transitions): 2 deep dives
- `long` (15 tracks → 14 transitions): 3-4 deep dives (LLM choice within range)

System prompt addendum (appended to existing `SYSTEM_PROMPT` in TrackSequencer.ts):

> In addition to ordering, nominate transitions for deep-dive treatment. Pick roughly
> 1 per 4 transitions, rounded up (4 transitions = 1, 8 = 2, 14 = 3-4). Prefer
> transitions into tracks marked `rich: true` (at least 2 enrichment fields) OR
> transitions at structural moments in the arc — peak, pivot, resolution. Deep-dive
> slots get longer, more narrative host commentary; fact bridges get the rest. Output
> schema includes a `featureSlots` array of transition slot indices (between 1 and
> N-1 inclusive, where N is the track count).

### User prompt updates

Per-track `enrichment` hints now include all populated EnrichmentRecord fields
(producer, genre, moodTags, releaseYear, wikipediaSummary first sentence) plus a
derived `rich: boolean` (true when at least 2 non-empty fields). The prompt already
sanitizes all enrichment strings via `sanitizeHint`; that continues for new fields.

### SequenceCache extension

Cache value becomes `{ ordered: string[], featureSlots: number[] }`. Cache key
unchanged (sorted track IDs + vibe + length, sha256). Entries without `featureSlots`
miss and regenerate on the next bake — no migration job needed.

### Hallucinated/invalid featureSlots handling

- Index out of range → drop that index.
- Duplicate indices → dedupe.
- Count exceeds bound (e.g. 6 deep dives for 9 tracks) → truncate to max for the
  length.
- Count below minimum (0 deep dives requested) → force 1 at the arc peak (middle slot).

These are post-parse fixups inside `TrackSequencer.attemptSequence`.

## Segment Prompting

### Tier definitions

```
cold_open     | 55-80 words.  Anchors vibe + time, names first track. Can reference one
              |               concrete detail if known.
fact_bridge   | 40-60 words.  One concrete fact (year/producer/sample/lyric/chart
              |               position/sonic note) + one perceptual note. Ends naming
              |               incoming track. ~75% of transitions.
deep_dive     | 80-120 words. Anecdote, session lore, cultural moment, or backstory
              |               thread. Leads with a hook, expands one idea, lands on
              |               the track name. Can bridge outgoing and incoming tracks
              |               if they share a thread. ~25% of transitions.
sign_off      | 35-55 words.  References the closer (fact + feel), sends off warmly,
              |               teases coming back.
```

### SegmentScriptBuilder input

`buildSegmentPrompts` input gains:

- `tier: SegmentTier` — determined by caller (orchestrator) from `featureSlots`
  membership for transitions, or literal `'cold_open' | 'sign_off'` for the end
  slots.
- Expanded `EnrichmentCache` interface return type (full record, not just
  `{ producer, sample }`).
- Incoming track's normalized genre family (`GenreFamily`) — computed once per track
  before buildSegmentPrompts is called.

### System prompt shape

Composed per-segment:

```
[Persona: ONAY, she/her, DJ authority — existing lines]

BROADCAST VIBE: [VIBE_DESCRIPTIONS[vibe]]

GENRE VOICE (incoming track is [family]): [playbook snippet for family]

FACT DISCIPLINE: When you state specifics — producer credits, year, chart positions,
personnel, lyrical references, sessions — use ONLY what's in the enrichment block
or what you know with high confidence from your training. If you're not certain
about a fact, don't invent one. Pivot to the perceptual instead: how it feels,
what the sonics do, what's about to shift. Never fabricate names, dates, or credits.

STYLE RULES: [existing — first person, no stage directions, no meta, curly quotes,
em-dashes welcome, end on a beat that hands to the track]

TIER: [cold_open | fact_bridge | deep_dive | sign_off]
Word budget: [range per tier]
Shape: [tier-specific instruction]
```

### Shape instructions per tier

- `cold_open`: *"Anchor the time and vibe first, then name the opening track. If a
  concrete detail about the track is in the enrichment, weave it in naturally. Land
  on the track name so the music can come in."*
- `fact_bridge`: *"One concrete fact (year, producer, sample, lyric, chart, or
  studio) and one perceptual note (how it lands, what's about to change). End by
  naming the incoming track. Tight — no filler."*
- `deep_dive`: *"Lead with a hook — a detail that makes the listener lean in. Expand
  one thread — the person, the moment, the sonic element. If a thread connects
  outgoing and incoming tracks, use it. Land on the track name."*
- `sign_off`: *"Reference the closing track with one fact and one feel. Send the
  listener off with warmth. Optional: tease coming back."*

### User prompt shape

```
[Scene lines: time, day, listener context — existing]

Outgoing: "[title]" by [artist]
Incoming: "[title]" by [artist] — [genre family]

Enrichment (verified facts you may cite):
- Producer: [if known]
- Year: [if known]
- Samples: [if known]
- About the track: [wikipediaSummary, 1-2 sentences]
- Notable facts: [notableFacts items, bulleted, max 3]
- Artist bio: [artistBio snippet, truncated to ~200 chars]
- Sonics: [formatted audioFeatures line]

Write ONAY's [tier]. [word-budget line]. End by naming the incoming track.
```

Cold open omits the "Outgoing" line (there's none). Sign-off omits "Incoming"
(broadcast ends).

### Audio features formatting helper

Raw Spotify numbers are useless to the LLM. A pure helper formats them to prose:

```ts
function formatAudioFeatures(f: AudioFeatures): string {
  // tempo  → "72 BPM"  or  "(slow)" / "(mid-tempo)" / "(uptempo)"
  // key+mode → "A minor" (pitch-class map)
  // valence → "downcast" / "reflective" / "warm" / "bright" (banded)
  // energy → "restrained" / "steady" / "driving" (banded)
  // returns single comma-separated line
}
```

Example output: `"72 BPM, A minor, downcast mood, restrained energy"`.

### Sanitization

All enrichment strings continue to flow through `sanitizeForPrompt` (strip control
chars, role-hijack markers, backticks, length cap). Wikipedia summaries and
notableFacts are longer-form but still get the same treatment with a larger max
(~400 chars per notable fact, ~600 chars for the summary).

## Genre Playbook

Ten families: `jazz`, `hipHop`, `rnb`, `rock`, `electronic`, `folk`, `pop`, `global`,
`gospel`, `generic`.

```
jazz       | Speak with quiet authority. Name sidemen, labels, sessions. Use "changes,"
           | "voicing," "modal." Reference eras — Blue Note, post-bop, spiritual,
           | fusion. Respect craft over hype.

hipHop     | Know the producers. Know the samples. Know the region. Use "beat," "flip,"
           | "pocket," "bars." Distinguish boom-bap from trap from drill when relevant.
           | Credit where it's due — this genre runs on lineage.

rnb        | Linger on voice. Name the run, the vamp, the break. Reference the lineage
           | — Motown, Stax, Philly, quiet storm, neo-soul. Groove talk, not chart talk.

rock       | Riffs, gear, session work, scenes. Distinguish classic rock from indie
           | from punk from alternative. Talk like someone who's been to the shows.

electronic | Know the sub-genre (deep house ≠ UK garage ≠ dnb ≠ ambient). Talk build
           | and drop, pad, arpeggio, sample. Reference the scene — Detroit, Berlin,
           | Chicago, London.

folk       | Songwriting craft. Fingerpicking, arrangement, lyrical economy. Respect
           | the tradition without turning it into a history lesson.

pop        | Hooks and songwriters. Acknowledge the craft — pop is hard. Name
           | producers and co-writers when known. Era-aware (Max Martin decade, solo
           | era, K-pop wave).

global     | Lead with respect. Use the culture's own vocabulary (Afrobeats,
           | reggaeton, cumbia, highlife, bossa). Never exoticize. Name-check the
           | lineage within the tradition, not from outside.

gospel     | Reverent but alive. Name the tradition — quartet, contemporary, praise &
           | worship, choir. Use the vocabulary: testimony, shout, call-and-response,
           | spirit. Respect the lineage from Thomas Dorsey and Mahalia through Kirk
           | Franklin and Fred Hammond without flattening it.

generic    | Thoughtful, curious, warm. Lean on the perceptual when you don't know
           | the lore.
```

### Genre normalization

`normalizeGenreFamily(raw)` — keyword matching. Priority matters: gospel before rnb,
electronic before pop for "pop-electro" crossovers, hipHop before rnb for "hip-hop
soul":

```ts
function normalizeGenreFamily(raw?: string | string[]): GenreFamily {
  if (!raw) return 'generic';
  const s = (Array.isArray(raw) ? raw.join(' ') : raw).toLowerCase();
  if (/gospel|spirituals?|praise.+worship|quartet.+gospel/.test(s)) return 'gospel';
  if (/jazz|bebop|bossa|fusion|big band|post[- ]?bop/.test(s)) return 'jazz';
  if (/hip[- ]?hop|rap|trap|drill|boom[- ]?bap/.test(s)) return 'hipHop';
  if (/r&?b|soul|motown|quiet storm|neo[- ]?soul|funk/.test(s)) return 'rnb';
  if (/electronic|edm|house|techno|trance|dnb|drum.?and.?bass|dubstep|garage|ambient|idm/.test(s)) return 'electronic';
  if (/afrobeat|reggae|reggaeton|cumbia|samba|latin|highlife|global|world/.test(s)) return 'global';
  if (/folk|country|bluegrass|americana|singer.?songwriter/.test(s)) return 'folk';
  if (/rock|punk|grunge|indie|alternative|metal/.test(s)) return 'rock';
  if (/pop|k-?pop|j-?pop/.test(s)) return 'pop';
  return 'generic';
}
```

### Source priority for genre signal

1. MusicBrainz `genre` (most specific)
2. Apple Music `genreNames` (reliable fallback, coarser)
3. Last.fm top tag
4. `'generic'` fallback

Applied as a fall-through chain in a small helper; the first source that yields a
non-`'generic'` family wins.

## Migration

- `EnrichmentRecord` schema additions are backward-compatible. Old cached records
  remain valid and usable.
- `SequenceCache` entries without `featureSlots` miss and regenerate naturally.
- Three new env vars (`LASTFM_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`).
  Missing vars = the relevant source is skipped. Bake succeeds without them; content
  is just less rich.
- Client `ManifestTrack` gains optional `genreNames: string[]`. Server accepts old
  payloads during rollout.
- `fetchPlaylistTracks` in `MusicKitPlayer` needs to surface `genreNames` from the
  native bridge. Native `ExpoMusicKitModule.swift` needs to include `genreNames` in
  the serialized track dict.
- Client `BroadcastPlayer.schedulePolling` / `pollManifestOnce` become dead code.
  Removing is safe but not required — can be a follow-up commit.
- `TuningInOverlay.tsx` gains a cycling status label: `Curating → Enriching →
  Writing segments → Tuning in`. Cycles every ~5s; defaults to a generic label if
  elapsed time can't be correlated with phase.

## Testing

- Per-fetcher unit tests with mocked `fetch`.
- `BackgroundEnricher` tests: parallel across tracks, per-API rate bucketing,
  failure tolerance (one source down doesn't break others), empty-input safety.
- `TrackSequencer` tests: `featureSlots` in response, invalid-slot fixups, cache
  round-trip with the new field, prompt includes enrichment hints when populated.
- `SegmentScriptBuilder` tests: tier routing (cold_open/fact_bridge/deep_dive/sign_off
  each produce the right system prompt + user prompt), genre playbook injection,
  guardrail presence in system prompt, audio features formatting, sanitization of
  Wikipedia/Last.fm free-form fields.
- `BroadcastOrchestrator` integration test: new pipeline order (enrichment →
  sequence → segments → response), all-sync segment gen, `inFlight` map removal
  doesn't break `waitForCompletion` shape.
- End-to-end bake test against a fixed playlist fixture, snapshotting manifest
  shape (not the segment text — LLM output isn't deterministic).
- Scope check: single spec, no decomposition needed.

## File Impact

```
server/src/services/enrichment/
  EnrichmentCache.ts             — schema additions
  BackgroundEnricher.ts           — parallelize track loop, drain() returns promise
  DefaultEnrichmentFetcher.ts     — becomes composite; orchestrates source fetchers
  fetchers/
    GeniusFetcher.ts              — extracted from DefaultEnrichmentFetcher
    MusicBrainzFetcher.ts         — extracted from DefaultEnrichmentFetcher
    WikipediaFetcher.ts           — new
    LastFmFetcher.ts              — new
    SpotifyFetcher.ts             — new

server/src/services/broadcast/
  types.ts                        — ManifestTrack.genreNames (optional),
                                    Manifest.featureSlots (optional), SegmentTier type,
                                    SegmentSlot.tier (optional)
  GenreFamily.ts                  — new: type, normalizer, playbook dictionary
  TrackSequencer.ts               — response schema + prompt + featureSlots fixups
  SequenceCache.ts                — persist featureSlots
  SegmentScriptBuilder.ts         — tier routing, playbook injection, guardrail,
                                    richer user prompt, audio features formatter
  ManifestBuilder.ts              — records tier on slots based on featureSlots
  BroadcastOrchestrator.ts        — new pipeline order, all-sync segment gen,
                                    concurrency-capped parallel gen

server/src/routes/
  broadcast.ts                    — Zod schema extension for genreNames

server/__tests__/                 — new + extended test files per above

src/engines/
  BroadcastPlayer.types.ts        — mirror schema additions (genreNames, featureSlots,
                                    tier)
  BroadcastPlayer.ts              — optional cleanup: remove schedulePolling /
                                    pollManifestOnce (follow-up commit OK)

src/services/
  MusicKitPlayer.ts               — surface genreNames from native bridge

modules/expo-music-kit/
  index.ts                        — type surface for genreNames
  ios/ExpoMusicKitModule.swift    — include genreNames in serialized track dict

src/components/broadcast/
  TuningInOverlay.tsx             — cycling status label

server/.env.example               — add new env var placeholders
```

## Open Questions

None blocking. Concurrency cap starts at 4 and gets tuned after first observation. If
Ollama handles more concurrent LLM calls cleanly, raise it. If it chokes, lower it.

## Success Criteria

- First-bake segments demonstrably cite concrete facts (year, producer, sample,
  lyric, or sonic note) on ~75%+ of transitions for any playlist with moderately
  well-known tracks.
- Deep-dive segments read as narrative, not list-of-facts. 3-4 per 15-track bake.
- Genre-aware voice is audible — a jazz track and a hip-hop track in the same
  broadcast produce recognizably different host commentary styles.
- No "segment skipped silently at playback" failures in post-launch logs.
- Cold-bake tuning-in stays under 40s; warm-bake under 25s.
- Zero fabricated facts in spot-checked sample segments (the guardrail holds).

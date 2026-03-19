# Cleo Commentary Tuning — "Smart Radio Host"

**Date**: 2026-03-19
**Approach**: B — Smart Radio Host
**Scope**: Enrichment pipeline, vibe-aware voice, smart timing, segment length variation, Gemini optimizations

---

## Problem Statement

Cleo's commentary system has solid architecture but three core issues:

1. **Empty storytelling** — Genius only fetches a URL (no producer/songwriter/sample data). MusicBrainz tags and year are fetched but never passed to Gemini. The VERIFIED TRACK FACTS block in the prompt is always empty. Cleo has no real data to tell stories with.
2. **Vibe-deaf voice** — ElevenLabs receives identical settings (stability 0.35, style 0.55) regardless of vibe. A late-night intimate set and a workout playlist get the same vocal delivery.
3. **Dumb timing** — Post-song drops use random 8-12s delays. Mid-song drops fire even when music is paused. No awareness of track duration or playback state.

---

## 1. Enrichment Pipeline

### 1a. Complete Genius Metadata Extraction

**File**: `server/src/routes/enrichment.ts`

The current `/enrich-track` endpoint returns only a Genius search result URL. After the search hit, make a second call to the Genius API song endpoint (`/songs/{id}`) to extract structured metadata.

**Rate limiting**: Add 1100ms minimum interval between Genius API calls (same approach as MusicBrainz). The second call is conditional — only made when the search returns a hit.

**Error handling**: If the song endpoint returns 404 or is missing fields, store whatever is available. Partial data is still useful (e.g., producer but no sample info).

**Cache invalidation**: Existing MMKV cache entries that only contain `geniusUrl` (stale format) must be re-enriched. Add a `cacheVersion` field to `TrackProfile`. On load, if `cacheVersion` is missing or outdated, re-enrich that track. This ensures old URL-only entries get upgraded to full metadata.

Fields to extract:

- `song.producer_artists[].name` → producer credits
- `song.writer_artists[].name` → songwriter credits
- `song.description.plain` → editorial context (first ~150 chars)
- `song.recording_location` → studio info
- `song.release_date_for_display` → release context
- `song.song_relationships[]` where `type === 'samples'` or `type === 'sampled_in'` → sample chain

Return structured `enrichedFacts`:

```typescript
{
  producer?: string,        // "Produced by Pharrell Williams"
  songwriter?: string,      // "Written by Andre 3000, Big Boi"
  sample?: string,          // "Samples 'Funky Drummer' by James Brown"
  context?: string,         // First ~150 chars of Genius description
  recordingLocation?: string,
  releaseYear?: string
}
```

### 1b. Pass MusicBrainz Data to Gemini

**File**: `src/services/TrackEnrichmentService.ts`

Currently `profile.tags` and `profile.year` are stored on `TrackProfile` but never passed downstream. The `EnrichedFacts` interface needs new optional fields:

```typescript
interface EnrichedFacts {
  // Existing (from Genius)
  producer?: string;
  songwriter?: string;
  sample?: string;
  context?: string;
  geniusUrl?: string;
  recordingLocation?: string;
  releaseYear?: string;
  // New (from MusicBrainz)
  tags?: string[];
  year?: string;
}
```

In `TrackEnrichmentService.enrichTrack()`, merge MusicBrainz data into `enrichedFacts` after both API calls complete. This ensures `CleoScriptGenerator.buildDynamicPrompt()` can access everything through `context.enrichedFacts` without additional plumbing.

In the prompt, these appear as:
- `tags` → `Genre tags: hip-hop, neo-soul, funk`
- `year` → `First released: 2003`

### 1c. Enrichment-Before-Queue-Planning

**File**: `src/engines/QueueManager.ts`

Currently enrichment runs in background (`enrichInBackground`) and `planQueue` may execute before enrichment finishes.

**Approach**: Split enrichment into two phases:
1. **Fast phase (MusicBrainz only)** — runs first, awaited before `planQueue`. MusicBrainz calls are fast (~1s each with rate limiting). For a 20-track playlist, this adds ~22s but runs while the first track is already playing.
2. **Slow phase (Genius metadata)** — runs in background after queue planning. Genius calls are slower and non-critical for sequencing.

This preserves the "fast path to first playback" architecture — playback starts immediately, MusicBrainz enrichment runs during the first song, queue planning uses the enriched tags/year, and Genius metadata arrives in time for Cleo's commentary on later tracks.

### 1d. Prompt Gets Real Data

**File**: `src/services/CleoScriptGenerator.ts`

The existing `VERIFIED TRACK FACTS` block in `buildDynamicPrompt()` already handles these fields — it just needs populated data. Once enrichment is complete, Gemini sees:

```
VERIFIED TRACK FACTS (use only what is provided — never invent)
- Producer: Pharrell Williams
- Written by: Andre 3000, Big Boi
- Sample: Samples 'Funky Drummer' by James Brown
- Context: Recorded at Stankonia Studios in Atlanta during a late-night session...
- Genre tags: hip-hop, southern rap, funk
- First released: 2003
```

---

## 2. Vibe-Aware Voice

### 2a. Vibe Voice Profiles

**File**: `src/services/CleoVoiceEngine.ts`

Define per-vibe ElevenLabs parameter sets:

| Vibe | Stability | Style | Speed | Character |
|------|-----------|-------|-------|-----------|
| morning | 0.40 | 0.50 | 1.0 | Warm, steady, coffee-shop host |
| chill | 0.30 | 0.45 | 0.95 | Relaxed, unhurried, low key |
| workout | 0.45 | 0.65 | 1.08 | Punchy, forward energy |
| lateNight | 0.25 | 0.40 | 0.92 | Intimate, breathy, FM radio at 2am |
| party | 0.50 | 0.70 | 1.05 | Confident, bold, hype |
| focus | 0.50 | 0.35 | 0.98 | Minimal, calm, get out of the way |
| feelGood | 0.35 | 0.60 | 1.02 | Bright, smiling delivery |
| throwback | 0.35 | 0.55 | 0.98 | Nostalgic warmth, storyteller |
| elevated | 0.30 | 0.50 | 0.95 | Measured, sophisticated |
| melancholy | 0.25 | 0.40 | 0.93 | Soft, reflective, gentle |
| sunday | 0.30 | 0.45 | 0.93 | Slow, domestic, like talking to a friend |
| general | 0.35 | 0.55 | 1.0 | Current defaults |

`synthesizeAndPlay()` accepts the current vibe and looks up the profile.

**API contract change**: The `/synthesize-voice` endpoint currently receives `{ text }`. Update to accept `{ text, stability, style, speed }` so the client sends vibe-resolved parameters. The server applies them to the ElevenLabs API call instead of hardcoded values. This keeps vibe logic on the client side where vibe state already lives.

### 2b. Delivery Cues from Gemini

**File**: `src/services/CleoScriptGenerator.ts` (prompt), `src/services/CleoVoiceEngine.ts` (processing)

Gemini outputs a lightweight delivery tag at the start of the script:

```
[warm] That transition from Erykah to D'Angelo... you feel that, right?
```

Limited set of tags: `[warm]`, `[hype]`, `[quiet]`, `[playful]`, `[reflective]`, `[matter-of-fact]`

Each tag maps to a small parameter nudge on top of the vibe profile:
- `[warm]` → stability -0.05
- `[hype]` → style +0.10
- `[quiet]` → speed -0.03
- `[playful]` → style +0.05, stability -0.05
- `[reflective]` → speed -0.02, stability -0.05
- `[matter-of-fact]` → stability +0.05

`formatForSpeech()` strips the tag before sending text to ElevenLabs.

### 2c. TTS Text Formatting Enhancements

**File**: `src/services/CleoVoiceEngine.ts`

Enhance `formatForSpeech()` to improve TTS delivery:
- CAPS on key words Gemini wants to emphasize (add instruction to Gemini prompt: "Capitalize ONE key word per segment for vocal emphasis")
- Keep ellipses for trailing thought pauses (already supported)
- `<break time="0.8s" />` tags after sentences that should hang — **note**: test on `eleven_turbo_v2_5` first. If break tags are read as literal text, fall back to double-period (`..`) or long ellipsis for pauses instead.
- `<lexeme>` tags for artist name pronunciation if mispronounced

**Edge cases for delivery cue parsing** (Section 2b):
- If Gemini omits the delivery tag → no parameter nudge, use vibe profile as-is
- If Gemini outputs an unknown tag → ignore it, strip it, use vibe profile as-is
- Delivery tag is stripped before word counting for length tier enforcement

---

## 3. Smart Timing

### 3a. Pause-Aware Guards

**File**: `src/engines/AudioCoordinator.ts`

Before any mid-song or post-song timer callback fires, check playback state via `getPlaybackStatus()`:
- If paused/stopped → don't speak, discard the pending segment
- Post-song timer: if paused during the wait, discard on resume (context is stale)
- Mid-song timer: if paused, cancel entirely

### 3b. Duration-Aware Post-Song Timing

**File**: `src/engines/AudioCoordinator.ts`

Replace fixed 8-12s random delay with percentage-based timing relative to track duration:

| Track Length | Drop Window | Approximate Range |
|-------------|-------------|-------------------|
| Short (< 3 min) | 8-15% of duration | ~15-25s |
| Medium (3-5 min) | 5-10% of duration | ~10-25s |
| Long (5+ min) | 4-8% of duration | ~15-30s |

### 3c. Smarter Mid-Song Drops

**File**: `src/engines/AudioCoordinator.ts`

- **Timing**: Drop at 35-50% of track duration instead of fixed 45-90s. Targets verse 2 / bridge area.
- **Vibe-dependent chance**:
  - `focus`, `chill`, `lateNight`, `melancholy`: 20%
  - `general`, `morning`, `sunday`, `elevated`, `throwback`, `feelGood`: 40%
  - `workout`, `party`: 15% (momentum matters most — mid-song commentary breaks the energy flow that these vibes depend on)
- **Minimum track length**: Raise from 180s to 210s (3.5 min)

### 3d. Skip-Some-Tracks Logic

**File**: `src/engines/AudioCoordinator.ts` or `src/engines/SegmentController.ts`

New state variables in `SegmentController`:
- `consecutiveSpokenSegments: number` — incremented when Cleo speaks, reset to 0 when she stays silent. Counts spoken segments, not track changes.
- `lastWasMidSongDrop: boolean` — set true after a mid-song drop, reset on next track change.

Rules:
- After 3 consecutive *spoken* segments, 30% chance Cleo stays silent on the next track change (resets counter to 0 on silence)
- If `lastWasMidSongDrop` is true, suppress the next track's pre_song segment (she just spoke recently)
- `focus` and `workout` vibes: 40% silence chance (overrides the 30% default)

### 3e. Track Transition Control

**File**: `src/engines/AudioCoordinator.ts`

For pre_song segments on natural track transitions:
- Duck music immediately when `onTrackChanged` fires (don't wait for TTS to be ready)
- Generate + synthesize in parallel while listener hears the new track intro at ducked volume
- Cleo speaks over the softly playing intro
- Music rises to full volume via existing crossfade when Cleo finishes
- **8s generation timeout**: If Gemini + ElevenLabs takes more than 8s, skip the segment and unduck — restore music to full volume immediately. The listener hears the intro at low volume for up to 8s, then music rises. This is preferable to the current behavior where Cleo talks 10+ seconds into a song. If generation consistently hits the timeout, the fallback system (pre-written lines from `fallbacks.ts`) should kick in faster — consider triggering fallback at 6s and reserving the remaining 2s for TTS synthesis only.

For manual skip transitions:
- Shorten initial delay from 3.5s to 1.5s
- `AudioCoordinator` passes a `isManualSkip` flag to `SegmentController.generateNext()`, which constrains segment type selection to shorter types (`station_id`, `song_intro`) and forces `brief` length tier

---

## 4. Segment Length Variation

### 4a. Three Tiers

**File**: `src/engines/SegmentController.ts`, `src/services/CleoScriptGenerator.ts`

| Tier | Words | Duration | When |
|------|-------|----------|------|
| Brief | 15-30 | ~4-6s | Mid-song drops, `station_id`, `focus`/`workout` vibes |
| Standard | 40-75 | ~8-12s | Default for most segments |
| Extended | 90-130 | ~18-25s | Rich storytelling moments |

### 4b. Extended Segment Triggers

- `track_story` with actual enrichment data (producer, sample chain, recording story)
- `genre_bridge` when tags show a significant genre shift
- Session phase `mid` (segments 4-8)
- Max frequency: 1 per every 4-5 segments. Use a `segmentsSinceExtended` counter in `SegmentController` — incremented on every segment, reset to 0 after an extended segment. Extended is only eligible when counter >= 4. No back-to-back extended segments.

### 4c. Brief Enforcement

- `focus` and `workout` vibes: always brief or standard, never extended
- After an extended segment, next 2 segments must be standard or brief
- Mid-song drops: always brief

### 4d. Dynamic Prompt Word Count

**File**: `src/services/CleoScriptGenerator.ts`

Word count instruction in `buildDynamicPrompt()` changes per tier:

```
Brief:    "15-30 words. One thought. In and out."
Standard: "40-75 words. Natural and flowing."
Extended: "90-130 words. Tell the story. Take your time — you have room to breathe."
```

---

## 5. Gemini Optimizations

### 5a. Disable Thinking

**File**: `server/src/routes/segment.ts`

Set `thinkingConfig: { thinkingBudget: 0 }` in the Gemini API call. Creative radio scripts don't need chain-of-thought reasoning. This means all of `maxOutputTokens` goes to actual output, allowing us to lower it from 8192 to ~2048, reducing latency and cost.

### 5b. Fix Temperature

**File**: `server/src/routes/segment.ts`

Change temperature from 0.9 → 1.0. Gemini 2.5 Flash documentation recommends keeping temperature at default 1.0 — lower values can cause looping or degraded performance.

### 5c. Few-Shot Examples

**File**: `src/cleo/static-core.ts`

Add 2-3 example segments per delivery mode to the system prompt so Gemini hears Cleo's voice, not just rules:

```
EXAMPLE (pre_song, standard):
[warm] Erykah into D'Angelo — that's not a playlist, that's a lineage. This one's off Voodoo, and you can hear the whole Neo-Soul family tree in the first eight bars.

EXAMPLE (post_song, brief):
[quiet] This bassline. Pino Palladino. Nobody else moves like that.

EXAMPLE (track_story, extended):
[reflective] So here's the thing about this record — Pharrell produced it in a single afternoon at Stankonia Studios. Andre walked in with the hook already in his head, hummed the melody to the engineer, and laid his verse in one take. Big Boi heard the playback and wrote his part on the spot. The sample underneath is James Brown's Funky Drummer — the same break that built half of hip-hop. Three generations of Black music living in one record. And that bridge? That's where you hear the gospel roots creeping in, the church training neither of them ever talks about. Four minutes. An entire lineage. That's what you're listening to right now.
```

### 5d. Update Static Core Word Limit

**File**: `src/cleo/static-core.ts`

The current system prompt says "Never speak longer than 75 words per segment" in the WHAT YOU NEVER DO section. This contradicts the Extended tier (90-130 words). Update to: "Follow the word count given in each segment brief. Default is 40-75 words." This lets the dynamic prompt control length per-segment while keeping the system prompt as the authority.

Also update CLAUDE.md's `maxOutputTokens` convention note to reflect that `thinkingBudget: 0` makes the 8192 requirement obsolete.

### 5e. Data-Informed Rotation

**File**: `src/engines/SegmentController.ts`

Instead of rigidly following the 13-step rotation, allow data to influence segment type selection:
- If current track has rich enrichment data (producer, sample, context) → prefer `track_story`
- If MusicBrainz tags show a significant genre shift from previous track → prefer `genre_bridge`
- If no enrichment data available → skip `track_story`, use `artist_context` or `song_intro`

The rotation remains the base pattern but can be overridden when data signals a better choice.

---

## Bug Fixes

### Mid-Song Drops Fire When Paused

**File**: `src/engines/AudioCoordinator.ts`

`scheduleMidSongDrop` timer callback (line 208) checks `isSpeaking`, `pendingPostSongTimer`, and cooldown, but never checks if music is paused. Add `getPlaybackStatus()` check — if paused or stopped, cancel the drop.

### Enrichment Data Never Reaches Gemini

**Files**: `server/src/routes/enrichment.ts`, `src/services/TrackEnrichmentService.ts`

The VERIFIED TRACK FACTS block in the prompt handles the fields but they're never populated. Completing the Genius metadata extraction (Section 1a) and passing MusicBrainz data (Section 1b) fixes this.

---

## Files Modified

| File | Changes |
|------|---------|
| `server/src/routes/enrichment.ts` | Complete Genius song endpoint integration |
| `server/src/routes/segment.ts` | thinkingBudget: 0, temperature: 1.0, lower maxOutputTokens |
| `server/src/routes/voice.ts` | Accept stability/style/speed from client instead of hardcoded values |
| `src/services/TrackEnrichmentService.ts` | Pass MusicBrainz tags/year to enrichedFacts |
| `src/services/CleoScriptGenerator.ts` | Dynamic word count, delivery cue instructions, enrichment in prompt |
| `src/services/CleoVoiceEngine.ts` | Vibe voice profiles, delivery cue processing, break tags |
| `src/engines/AudioCoordinator.ts` | Pause guards, duration-aware timing, transition control, skip logic |
| `src/engines/SegmentController.ts` | Length tiers, data-informed rotation, silence logic |
| `src/engines/QueueManager.ts` | Enrichment-before-planning ordering |
| `src/cleo/static-core.ts` | Few-shot examples per delivery mode, update 75-word cap to dynamic |
| `CLAUDE.md` | Update maxOutputTokens convention note |

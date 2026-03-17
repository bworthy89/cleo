# Cleo Polish Design — Moment-to-Moment DJ Experience

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Voice tuning, temporal context fix, pre/post delivery modes, storytelling, vibe expansion, session variety, prompt quality

---

## Overview

Cleo's core radio loop works. This spec dials in the moment-to-moment experience so it feels like a real radio host — not a playlist with commentary. Five areas of improvement: voice settings, temporal context, storytelling, vibe expansion, and prompt/script quality.

---

## 1. Voice Tuning

### ElevenLabs Settings
Change `server/src/routes/voice.ts` voice settings:

```
stability: 0.30          // was 0.50 — more natural variation, less robotic evenness
similarity_boost: 0.85   // was 0.75 — stays true to Cleo's voice character
style: 0.20              // was 0.40 — removes performative over-enunciation
use_speaker_boost: true  // unchanged
model_id: eleven_multilingual_v2  // unchanged
```

**Rationale:** Lower stability is the primary lever. It's the difference between a voice that sounds generated and one that sounds like a person thinking as they speak. Style drop removes the slight exaggeration that makes TTS sound artificial.

### Speech Formatting Layer
A lightweight post-process function (`formatForSpeech`) runs on all Gemini output before it reaches ElevenLabs. Lives in `CleoVoiceEngine.ts`:
- Em-dashes (`—`) inserted at natural clause breaks for pause cues
- Ellipses (`...`) for trailing thoughts
- Strips any accidental quotation marks or stage directions

This is ~15 lines — a finishing touch on top of a better voice, not a crutch.

---

## 2. Temporal Context + Pre/Post Delivery Modes

### The Bug
`onTrackChanged` fires when a new track starts. AudioCoordinator waits 1.5s then generates a segment. The prompt has no temporal awareness, so Cleo says "here comes..." about a song that has been playing for 2 seconds.

### The Fix: Two Delivery Modes

**`pre_song` mode (~60% of segments)**
- Timing: between tracks — Cleo speaks before the next song starts
- Context: `previousTrack` = song that just finished, `currentTrack` = song about to play
- Cleo reflects on what was just heard and/or bridges to what's next
- Prompt: "The listener just finished hearing [previousTrack]. [currentTrack] is about to play."

**`post_song` mode (~40% of segments)**
- Timing: 8–12 seconds into the current track (randomized in that range)
- Context: `currentTrack` = song currently playing
- Cleo commentates on what the listener is hearing right now
- Prompt: "The listener is currently hearing [currentTrack]. Comment naturally, as if dropping in mid-listen."
- Feels like a real DJ dropping in while the music plays

### Call Site: Track Buffering
AudioCoordinator maintains `private previousTrack: TrackInfo | null`. On each `onTrackChanged(newTrack)` call:
1. `previousTrack` is set to whatever was stored from the last call
2. `currentTrack` = `newTrack`
3. Mode is determined, then the appropriate timing path runs

This gives `pre_song` access to the just-finished track without requiring the call site (HomeScreen) to track it. **HomeScreen does not need to change** — it passes the single current track as it does today.

### `isSpeaking` Guard Lifecycle for Both Modes

**`pre_song`:** `isSpeaking = true` is set immediately when `handleTrackChange` is called. The 1.5s delay runs, segment is generated and played, then `isSpeaking = false`. Same as today.

**`post_song`:** `isSpeaking = true` is set immediately when `handleTrackChange` is called, before the timer starts. A `pendingPostSongTimer: ReturnType<typeof setTimeout> | null` is stored on the class. If `handleTrackChange` is called again while the timer is pending (user skips), the pending timer is cancelled via `clearTimeout`, `isSpeaking` is reset to `false`, and the new call proceeds fresh. This prevents stale segments from firing after a skip.

### Mode Selection Logic
- Determined in `SegmentController.getDeliveryMode(segmentType)` based on:
  - `song_intro` → always `pre_song`
  - `genre_bridge` → always `pre_song`
  - `post_track_reflection` → always `post_song`
  - `track_story`, `artist_context` → prefer `post_song`, but fall back to `pre_song` if last mode was `post_song` (never two in a row)
  - All others → `pre_song` unless rotation allows `post_song`
- Never two `post_song` in a row
- Never more than three `pre_song` in a row

### Pre-load Buffer + Delivery Mode
The pre-load buffer stores both `text` and `deliveryMode`. Mode is determined at pre-load time using the same `getDeliveryMode` logic. At consume time, if the mode constraint has changed (e.g. previous segment was `post_song` and the buffer also has `post_song`), the buffer is discarded and a fresh segment is generated. This ensures mode constraints are always respected.

```typescript
interface BufferedSegment {
  text: string;
  type: SegmentType;
  deliveryMode: DeliveryMode;
}
```

---

## 3. Storytelling

### Session Narrative Arc
Sessions have three phases based on segment count:
- **Opening** (segments 1–3): warm, inviting, scene-setting
- **Mid** (segments 4–8): deeper, richer — track stories, artist context, callbacks
- **Late** (segments 9+): reflective, acknowledges the journey

`sessionPhase: 'opening' | 'mid' | 'late'` is computed in SegmentController and passed to CleoScriptGenerator.

### Cross-Track Callbacks
SegmentController maintains `tracksReferenced: string[]` — a deduplicated, growing list of `artistName` values from every track played this session. Populated by adding `currentTrack.artistName` to the list each time a segment is generated (deduplicated). Passed to the dynamic prompt so Cleo can make organic callbacks: "Earlier we were in Frank Ocean territory — this takes it somewhere different."

### New Segment Types

**`genre_bridge`**
- Triggered when consecutive tracks differ significantly in genre
- Always `pre_song` mode
- Narrates the musical shift: "We've been deep in soul — this next one pulls that thread somewhere unexpected."
- Added to rotation between `artist_context` and `session_checkin`

**`post_track_reflection`**
- Exclusively `post_song` mode
- Cleo reflects on what the listener is hearing, mid-song
- "That one earns the silence after it."
- Added to rotation after mid-session begins

Both new types must be added to the `SegmentType` union in `fallbacks.ts` **first**, with at least one fallback entry each, before being added to the rotation array.

### Updated Rotation
```typescript
const ROTATION: SegmentType[] = [
  'song_intro',
  'artist_context',
  'station_id',
  'song_intro',
  'track_story',
  'genre_bridge',
  'song_intro',
  'post_track_reflection',
  'artist_context',
  'session_checkin',
  'song_intro',
  'post_track_reflection',
  'listener_shoutout',
];
```

---

## 4. Vibes Expansion

### Type Changes (do first)
The `Vibe` union in `fallbacks.ts` must be expanded before any new vibe is used anywhere. New vibes follow the existing camelCase pattern:

```typescript
export type Vibe =
  | 'morning' | 'chill' | 'workout' | 'lateNight' | 'party'  // existing
  | 'general' | 'focus' | 'feelGood' | 'throwback' | 'elevated' | 'melancholy' | 'sunday';  // new
```

The `vibeLabel` record in `CleoScriptGenerator.ts` must be updated with display strings for all 7 new vibes.

### New Vibes

| Vibe | Feel | Commentary Style |
|---|---|---|
| `general` | Neutral, no imposed mood — Cleo lets the music lead | Understated, present, warm |
| `focus` | Deep work, minimal interruption | Sparse, short, non-intrusive |
| `feelGood` | Upbeat, warm, celebratory | Bright, energetic without being hype |
| `throwback` | Nostalgic, storytelling-heavy | "Remember when" energy, rich context |
| `elevated` | Sophisticated, late-evening | Measured, slightly jazzy/soulful tone |
| `melancholy` | Introspective, honest | Quieter, more poetic, less quippy |
| `sunday` | Slow, unhurried, domestic | Relaxed, no urgency, warm |

Each new vibe gets:
- Cold open pool: 6 lines
- Fallback lines for each segment type
- Tone directive in dynamic prompt

### Session Variety Fixes

**`sameDayReturn`** grows from 1 line to 6 lines:
- Some playful ("Back already? Respect.")
- Some brief ("Good. Let's keep going.")
- Some that don't acknowledge the return at all — just pick up

**Per-vibe cold open pools** grow from 3 lines to 6 lines each. Selection logic already avoids repeating last used index — 6 options meaningfully reduces repetition.

**`session_checkin`** becomes vibe-aware (4–5 lines per vibe) and phase-aware (mid vs. late session checkins feel different).

---

## 5. Prompt & Script Quality

### Static-Core Rewrite
Replace the existing "End every segment with a natural handoff to the next song or silence" line (which conflicts with `post_song` mode) with mode-conditional guidance. The full `WHAT YOU ALWAYS DO` section becomes:

```
WHAT YOU ALWAYS DO
- Honor the music first. You exist to serve the listening experience.
- Match your energy to the session vibe you are given.
- Reference segment history to avoid repetition.
- When introducing the next track (pre_song), end with a natural handoff or bridge.
- When commentating mid-listen (post_song), end naturally — no forced handoff needed.
```

Add new sections:

```
STORYTELLING
- Each segment is one sentence in a longer story. Write toward something.
- Write for the ear, not the eye. Short clauses. Natural breath points.
- Never end a segment on a weak word (a, the, it, and).
- Emotional specificity over generic praise. Never say "great track" or "amazing artist."
  Say something specific or say nothing.
- If session memory contains prior artists, weave them in naturally when it serves the moment.

SESSION AWARENESS
- Opening segments (1-3): warm and inviting. You're setting a scene.
- Mid-session segments (4-8): go deeper. This is where the real storytelling lives.
- Late-session segments (9+): acknowledge the journey. The listener has been with you.
```

### Dynamic Prompt Additions
Add to `buildDynamicPrompt` in `CleoScriptGenerator.ts`:
- `sessionPhase` field
- `deliveryMode` field with explicit per-mode instruction (see section 2)
- `tracksReferenced` list: "Artists heard so far this session: [list]"
- Per-segment-type 1-sentence creative brief

### Fallback Library Audit
All existing fallback lines audited against one test: does it sound like something a person would actually say out loud? Lines that sound written get rewritten or cut. New types (`genre_bridge`, `post_track_reflection`) and all new vibes get fallback entries before launch.

### Per-Segment Creative Briefs (added to dynamic prompt)
```
song_intro              → Tease or bridge. Create anticipation without over-explaining.
track_story             → Drop one specific detail that makes the listener lean in.
artist_context          → One true thing about this artist that most people haven't considered.
station_id              → Brief, warm, present. Cleo is here. Nothing more needed.
genre_bridge            → Narrate the musical shift like a journey, not a playlist change.
post_track_reflection   → One honest reaction to what the listener is currently hearing. No recap.
listener_shoutout       → Specific, not generic. Make someone feel seen.
session_checkin         → Acknowledge the time spent together. Where are we in this journey?
```

---

## Files to Modify

**Order matters — update types before using them:**

| Order | File | Changes |
|---|---|---|
| 1 | `src/cleo/fallbacks.ts` | Add `genre_bridge` + `post_track_reflection` to `SegmentType` union; add new vibes to `Vibe` union; audit + expand all fallback lines |
| 2 | `src/services/CleoScriptGenerator.ts` | Update `vibeLabel` map; extend `SegmentContext` interface with `sessionPhase`, `deliveryMode`, and `tracksReferenced` fields; add those fields to `buildDynamicPrompt` along with creative briefs |
| 3 | `src/cleo/static-core.ts` | Rewrite `WHAT YOU ALWAYS DO`; add `STORYTELLING` and `SESSION AWARENESS` sections |
| 4 | `src/cleo/cold-opens.ts` | Add 7 new vibe pools (6 lines each); expand existing pools to 6; expand `sameDayReturn` to 6 lines |
| 5 | `src/engines/SegmentController.ts` | Define and export `DeliveryMode = 'pre_song' \| 'post_song'` type from this file (imported by AudioCoordinator); add `sessionPhase`, `tracksReferenced`, `getDeliveryMode()`, updated rotation, `BufferedSegment` with mode |
| 6 | `src/engines/AudioCoordinator.ts` | Add `previousTrack` buffer, `pendingPostSongTimer`, pre/post timing paths, timer cancellation on skip |
| 7 | `server/src/routes/voice.ts` | Update ElevenLabs voice settings |
| 8 | `src/services/CleoVoiceEngine.ts` | Add `formatForSpeech()` post-process pass |

---

## Success Criteria

- Cleo never says "here comes..." about a song already playing
- `post_song` segments feel like a DJ naturally dropping in, not an interruption
- After 3+ sessions on the same vibe, cold opens don't repeat
- Voice sounds like a person, not a voice model
- Segments build across a session — late-session commentary references the journey
- New vibes have distinct tonal feels in both prompt and cold opens
- Skipping a track while a `post_song` timer is pending correctly cancels the pending segment

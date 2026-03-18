# Voice Naturalness Design

**Date:** 2026-03-18
**Goal:** Make Cleo's voice delivery sound more natural — fix flat emphasis, monotone pacing, and robotic reading on longer segments.

---

## Problem

Cleo sounds nearly perfect on short segments but loses naturalness on longer ones. Two specific issues:

1. **Flat emphasis** — every word gets the same weight, no vocal stress on words that matter
2. **No speed variation** — rushes through at a constant pace, no breathing room on meaningful moments

Root causes:
- `eleven_turbo_v2_5` model prioritizes speed over prosody quality
- Stability at 0.15 is too low — voice wanders randomly instead of following emotional arcs
- Long, evenly-structured sentences give the TTS no cues to vary delivery
- No prompt guidance pushing Gemini toward breath-friendly sentence lengths

---

## Changes

### 1. ElevenLabs Model + Voice Settings

**File:** `server/src/routes/voice.ts`

Switch model and tune settings:
- Model: `eleven_turbo_v2_5` → `eleven_multilingual_v2`
- `stability`: 0.15 → 0.35 (controlled expression, not chaotic)
- `similarity_boost`: 0.80 (unchanged — keeping voice identity consistent)
- `style`: 0.40 → 0.55 (more emotional responsiveness to text content)
- `use_speaker_boost`: true (unchanged)

### 2. Text Formatting for Prosody

**File:** `src/services/CleoVoiceEngine.ts`

Upgrade `formatForSpeech()` to shape text for better TTS delivery:

- **Sentence length limiter** — split sentences over ~15 words at natural clause boundaries. Only splits at commas that follow 4+ words (avoids fracturing artist names like "Earth, Wind & Fire" or short introductory phrases). Does not treat periods after single capital letters or common abbreviations (feat., vs., etc.) as sentence boundaries.
- **Breath mark injection** — add subtle pause cues (`...`, `—`) between sentences that end a complete thought, so Cleo doesn't rush between ideas.
- **Emphasis preservation** — leave short fragments (1-3 words + period) untouched. TTS handles these well already.

Does NOT use SSML or word-level markup. Restructures punctuation and clause boundaries only.

Edge cases handled:
- Artist names with commas/ampersands — only split after commas preceded by 4+ words
- Abbreviations with periods (feat., J. Cole, Dr. Dre) — skip period-splitting for single uppercase letter + period patterns and known abbreviations
- Already-short sentences — no-op if sentence is already under the word threshold

Example:
```
Before: "That bassline carries the whole track and if you listen closely
         you can hear the original sample from the seventies underneath
         everything."

After:  "That bassline carries the whole track. Listen closely —
         you can hear the original sample from the seventies...
         underneath everything."
```

### 3. Prompt Adjustments for Spoken Cadence

**File:** `src/cleo/static-core.ts`

Add two rules to the VOICE RULES section:

- "Vary sentence length deliberately. Mix 3-word fragments with longer thoughts. Never write three sentences of similar length in a row."
- "Write for breath. Each sentence should be speakable in one natural breath. If you'd need to pause mid-sentence to breathe, it's too long."

These reinforce the existing "Write for the ear, not the eye" rule with specific, actionable constraints.

### 4. Timeout Fallback to Turbo Model

**File:** `server/src/routes/voice.ts`

Handle latency risk from the slower multilingual model:

- 10-second timeout on the ElevenLabs API call (multilingual v2 can take 3-8s on ElevenLabs' side for segments up to 75 words, plus network transit)
- On timeout, retry once with `eleven_turbo_v2_5` (same voice settings), with its own 8-second timeout
- Log which model was used for monitoring (`[TTS] Model: multilingual_v2` vs `[TTS] Fallback: turbo_v2_5`)
- If both fail, return 500 — `CleoVoiceEngine.ts` already handles this silently (logs error, Cleo just doesn't speak). This is acceptable: silence is better than a broken experience.

---

## Files Changed

| File | Change |
|------|--------|
| `server/src/routes/voice.ts` | Model swap, voice settings, timeout fallback |
| `src/services/CleoVoiceEngine.ts` | `formatForSpeech()` prosody upgrades |
| `src/cleo/static-core.ts` | Two new VOICE RULES for cadence |
| `CLAUDE.md` | Update ElevenLabs convention to reflect new model and settings |

---

## What This Does NOT Change

- No new segment types or delivery modes
- No changes to AudioCoordinator timing or crossfade
- No changes to creative briefs or dynamic prompt structure
- No SSML or ElevenLabs-specific markup
- No changes to fallback segment library

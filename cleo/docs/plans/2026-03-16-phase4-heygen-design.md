# Phase 4 — HeyGen Avatar Integration Design

**Goal:** Cleo's avatar speaks generated lines as lip-synced video in the app.

**Architecture:** CleoVideoManager orchestrates the pipeline: Google TTS → upload audio to backend → HeyGen video generation → poll until ready → play via react-native-video. Videos cached in MMKV by segment text for reuse. On-demand generation only (no pre-generation for now). Falls back to static image + audio when video isn't ready.

## Pipeline Flow

1. Generate Cleo script (already working — Gemini)
2. Synthesize TTS audio (already working — Google TTS)
3. Upload base64 audio to backend → returns public URL
4. Send audio URL + avatar ID to HeyGen → returns video ID
5. Poll HeyGen every 2.5s until video complete (~15-40s)
6. Cache video URL in MMKV keyed by segment text
7. Play video via react-native-video in CleoDisplay component

## New Backend Route

- `POST /upload-audio` — accepts base64 MP3, saves to temp file, serves publicly, returns URL

## Client Services

- `CleoVideoManager`: generateVideo(), pollUntilReady(), cache lookup
- `CleoDisplay` component: react-native-video player with static image fallback, magazine inset positioning

## Fallback Strategy

- If video not ready: play audio-only with static Cleo image
- If HeyGen down: audio-only mode gracefully

## Voice Quality

- Current Google TTS Journey-F sounds robotic — acceptable for MVP
- Voice upgrade planned for Phase 10 polish (ElevenLabs or SSML tuning)

## Milestone

Cleo's avatar speaks a generated line as a video in the app.

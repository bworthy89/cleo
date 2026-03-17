# Phase 3 — Backend Proxy & AI Voice Design

**Goal:** Build a Node.js backend proxy that keeps API keys server-side, and client services that generate Cleo's script via Gemini and speak it via Google Cloud TTS.

**Architecture:** Express server in `server/` directory with 5 proxy routes. Two client services (`CleoScriptGenerator`, `CleoVoiceEngine`) call the backend. Static core prompt and fallback library created from PRD content.

## Backend

- Node.js + Express + TypeScript in `server/`
- 5 routes: `/generate-segment` (Gemini), `/synthesize-voice` (Google TTS), `/generate-cleo-video` (HeyGen), `/cleo-video-status/:id` (HeyGen), `/enrich-track` (Genius)
- `express-rate-limit` for per-IP limiting
- CORS enabled, port 3001
- All API keys from `process.env`
- Build locally first, deploy to Railway later

## Client Services

- `CleoScriptGenerator`: assembles static core + dynamic context, POSTs to `/generate-segment`, 3500ms timeout with fallback
- `CleoVoiceEngine`: POSTs text to `/synthesize-voice`, plays base64 audio via expo-av
- `API_BASE_URL` constant for dev/prod switching
- Static core prompt: `src/cleo/static-core.ts`
- Fallback library: `src/cleo/fallbacks.ts`

## Google TTS Config

- Voice: en-US-Journey-F
- Speaking rate: 0.93
- Pitch: -1.5

## Milestone

App generates a Cleo script from Gemini and plays it as audio on the device speaker.

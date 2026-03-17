# CLAUDE.md — Cleo AI Radio App

## Project Overview
React Native / Expo SDK 55 iOS app. AI radio host named Cleo plays Apple Music
playlists with dynamic host commentary between tracks. Every session feels
like a personalized radio broadcast — not a playlist shuffler.

---

## Tech Stack

### Mobile
- React Native 0.83 + Expo SDK 55
- TypeScript throughout
- Custom `expo-music-kit` native module — wraps Apple MusicKit (auth, playlists, playback, track detection, audio ducking, TTS playback)
- react-native-video — video playback (installed, not yet used)
- react-native-mmkv — local storage
- @expo-google-fonts — Playfair Display, Work Sans, EB Garamond, DM Mono
- expo-font — custom font loading

### AI & Voice
- Gemini 2.5 Flash API — host script generation
- ElevenLabs TTS (custom Cleo voice) — voice synthesis
- ~~HeyGen API~~ — deferred, not needed for MVP

### Data & Enrichment
- MusicBrainz API — producer/songwriter/recording data (no key needed)
- Genius API — song annotations, behind-the-scenes context

### Backend
- Node.js + Express — proxy server (keeps API keys server-side)
- Runs locally on port 3001 during development
- Railway — deployment (free tier, not yet deployed)

---

## Project Structure

```
cleo/
├── CLAUDE.md
├── app.json                      ← Expo config, MusicKit entitlement, iOS 16+ deployment target
├── App.tsx                       ← Root component, font loading, splash screen
├── docs/
│   ├── cleo-prd.md               ← full PRD (in parent directory)
│   └── plans/                    ← design docs and implementation plans
├── modules/
│   └── expo-music-kit/           ← custom native module
│       ├── expo-module.config.json
│       ├── index.ts              ← TypeScript API (auth, playlists, playback, ducking, TTS audio)
│       ├── src/ExpoMusicKitModule.ts
│       └── ios/
│           ├── ExpoMusicKitModule.swift  ← MusicKit + AVAudioSession + AVAudioPlayer
│           └── ExpoMusicKit.podspec
├── server/
│   ├── .env                      ← API keys (gitignored)
│   ├── package.json
│   └── src/
│       ├── index.ts              ← Express app, CORS, rate limiting
│       └── routes/
│           ├── segment.ts        ← POST /generate-segment (Gemini 2.5 Flash)
│           ├── voice.ts          ← POST /synthesize-voice (ElevenLabs)
│           ├── video.ts          ← POST /generate-cleo-video + GET /cleo-video-status/:id (HeyGen)
│           └── enrichment.ts     ← POST /enrich-track (Genius)
├── assets/
│   ├── fonts/                    ← .gitkeep (fonts loaded via @expo-google-fonts packages)
│   └── cleo/                    ← Cleo character images (empty, HeyGen deferred)
├── src/
│   ├── tokens/
│   │   └── design-tokens.ts      ← single source of truth for all UI values
│   ├── engines/
│   │   ├── SegmentController.ts  ← segment type rotation, history, pre-loading buffer
│   │   └── AudioCoordinator.ts   ← duck→speak→resume handoff sequence
│   ├── cleo/
│   │   ├── static-core.ts        ← Cleo's permanent system prompt
│   │   └── fallbacks.ts          ← pre-written fallback segment library
│   ├── services/
│   │   ├── api.ts                ← API_BASE_URL config (dev/prod)
│   │   ├── MusicKitPlayer.ts     ← Apple Music wrapper (singleton)
│   │   ├── CleoScriptGenerator.ts← Gemini integration + 10s timeout + fallback
│   │   ├── CleoVoiceEngine.ts    ← ElevenLabs TTS via backend + native audio playback
│   │   └── Storage.ts            ← MMKV typed helpers (user, stations, recently played)
│   ├── screens/
│   │   ├── home/
│   │   │   └── HomeScreen.tsx    ← playlist picker, station cards, now playing, auto Cleo trigger
│   │   ├── onboarding/           ← empty (Phase 9)
│   │   ├── player/               ← empty (Phase 8-9)
│   │   └── settings/             ← empty (Phase 9)
│   └── components/
│       └── StationCard.tsx       ← 2:3 portrait card with artwork + label
```

---

## What's Built (Phases 1-5 Complete)

### Phase 1 — Foundation
- Expo project with TypeScript, folder structure, design tokens
- Google Fonts loaded (Playfair Display, Work Sans, EB Garamond, DM Mono)

### Phase 2 — Apple Music
- Custom `expo-music-kit` native module wrapping MusicKit Swift framework
- Authorization, playlist fetching (with catalog artwork), playback control
- Song-end detection via queue observation
- HomeScreen with station cards and playlist picker
- MMKV storage for stations and recently played

### Phase 3 — Backend + AI Voice
- Node.js Express server with 5 proxy routes (Gemini, ElevenLabs, HeyGen, Genius)
- CleoScriptGenerator: static core prompt + dynamic context → Gemini 2.5 Flash
- CleoVoiceEngine: ElevenLabs TTS → native AVAudioPlayer playback
- 10s timeout with fallback to pre-written library

### Phase 4 — HeyGen Avatar (DEFERRED)
- Skipped to focus on core radio experience
- Will revisit after working app is complete

### Phase 5 — Audio Coordination
- SegmentController: segment type rotation, history tracking (last 3), pre-load buffer
- AudioCoordinator: automatic duck→speak→resume on track change
- AVAudioSession with mixWithOthers + duckOthers for music ducking
- Full radio loop: song ends → 1.5s delay → Cleo speaks → music resumes

---

## The Audio Handoff Sequence (Current Implementation)

```
1. onTrackChanged fires
2. 1.5s natural delay
3. SegmentController picks type from rotation, generates via Gemini (or uses buffer)
4. AVAudioSession activates with .mixWithOthers + .duckOthers
5. AVAudioPlayer plays ElevenLabs TTS audio (music ducks automatically)
6. Audio finishes → deactivate ducking → resume MusicKit at full volume
7. Pre-load next segment into buffer
```

---

## Build Environment

- **Path constraint**: React Native pod scripts fail with spaces in paths.
  Native builds use `/Users/kari/Documents/cleo-app/` (rsync copy), then sync back.
- **Ruby**: rbenv + Ruby 3.2.4 at ~/.rbenv/ (system Ruby 2.6 too old for CocoaPods)
- **CocoaPods**: Installed via gem under rbenv Ruby 3.2.4
- **iOS deployment target**: 16.0 (MusicLibraryRequest requirement)
- **Apple Developer Team**: 8F2VWCN5KF
- **Signing**: Apple Development: bworthy89@gmail.com

---

## Environment Variables

All sensitive keys live in `server/.env` (gitignored). Never commit keys.

```
HEYGEN_API_KEY
CLEO_AVATAR_ID
GOOGLE_TTS_API_KEY
GEMINI_API_KEY
GENIUS_ACCESS_TOKEN
ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID
```

---

## Remaining Build Phases

```
Phase 6  — Session engine + queue intelligence
Phase 7  — Track enrichment + storytelling
Phase 8  — Pull quote + word-by-word subtitles
Phase 9  — Onboarding + full navigation
Phase 10 — Polish + TestFlight
```

---

## Important Conventions

- All components use TypeScript with strict mode
- No inline styles — all values from design-tokens.ts
- All API calls go through the backend proxy — never direct from client
- MusicBrainz: max 1 request/second — use a queue with 1100ms minimum interval
- Segment generation: 10s timeout → fallback on loss
- MMKV for all local persistence — never AsyncStorage
- Native builds must use no-spaces path (`/Users/kari/Documents/cleo-app/`)
- Every phase ends with a working milestone test on physical device

---

## Full Documentation

Read docs/cleo-prd.md (in parent directory `/Users/kari/Documents/DJ App/cleo-prd.md`) for:
- Complete system prompt architecture
- Full cold open library (15 variants)
- Full fallback segment library (47 lines)
- Song scoring algorithm details
- Genre bridge system
- Complete session arc phases
- All screen layouts and navigation map

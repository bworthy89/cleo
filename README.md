# ONAY

An AI radio host for your Apple Music library. Pick a playlist, pick a vibe, pick a length — the server bakes an entire broadcast (track order + host commentary) up front, and the client plays the locked episode end to end like a real radio show.

> Host was renamed from "Cleo" to "ONAY" (pronounced *Oh-Nay*) on 2026-03-20. The bundle ID (`com.worthymedia.cleo`) and repo name still carry the old name.

---

## What it is

ONAY is a React Native / Expo iOS app plus a Node/Express broadcast server. Unlike live-generation radio apps, ONAY commits to an episode before playback starts:

1. User picks a playlist, a vibe (late night, focus, feel good, workout, …), and a length (quick / standard / long).
2. Server sequences the tracks with an LLM, writes host scripts per segment, synthesizes TTS audio, and uploads everything to object storage.
3. Client receives a manifest, plays segment → track → segment → track through to the sign-off.

The architecture is deliberate. Earlier live-generation attempts ran LLM + TTS in the 48s / 60s iOS background CPU window between tracks and failed when the window was tight. Pre-baking trades a few seconds of setup latency for reliable playback.

---

## Features

- **Your Broadcast** — bake a personalized episode from any Apple Music playlist.
- **Tonight on ONAY** — editorial / featured broadcasts curated and baked by hand or via the in-app curator flow.
- **Ask ONAY** — conversational playlist curator: describe a mood, ONAY drafts a tracklist, resolves each track against the Apple Music catalog on-device, and offers to take it live as a broadcast.
- **Multi-vibe host voice** — Cartesia `sonic-3` primary, ElevenLabs `eleven_turbo_v2_5` fallback, Orpheus tertiary. TTS cache dedupes identical host lines across bakes.
- **Self-hosted LLM** — Ollama behind a Pangolin tunnel; Gemini 2.5 Flash fallback.
- **Resume after terminate** — 2-hour resume window via a persisted MMKV manifest.

---

## Tech Stack

### Mobile (`/`, `app/`, `src/`, `modules/`)
- React Native 0.83, Expo SDK 55, TypeScript strict
- Expo Router (file-based routing), Firebase Auth
- Custom `expo-music-kit` native module wrapping Apple MusicKit + `AVAudioSession`
- `react-native-mmkv` for local state
- `expo-blur`, `expo-linear-gradient`, `expo-haptics` for UI
- Design system: Playfair Display / Inter / EB Garamond / DM Mono over a black base + gold accent (`#C8832A`)

### Server (`server/`)
- Node.js + Express, TypeScript
- Firebase JWT auth middleware; curator allowlist for editorial publishes
- Zod validation on all routes
- Jest + ts-jest test suite
- Storage: local filesystem in dev, Cloudflare R2 (7-day presigned URLs) in production
- Managed in production by PM2 behind Caddy on a Hostinger VPS

### AI / Voice
- **LLM** — Ollama (primary) → Gemini 2.5 Flash (fallback)
- **TTS** — Cartesia (primary) → ElevenLabs (fallback) → Orpheus (tertiary)
- **Enrichment** — Genius + MusicBrainz, cached on disk for 30 days

---

## Project Structure

```
cleo-app/
├── app/                         Expo Router routes (auth, onboarding, main tabs)
│   └── (main)/(broadcast)/      home, player, ask-onay
├── src/
│   ├── engines/                 BroadcastPlayer, curation client, segment cache
│   ├── screens/                 home, curate, onboarding, settings
│   ├── components/              shared + broadcast-specific UI
│   ├── services/                API client, AuthService, MusicKitPlayer, Storage
│   ├── tokens/design-tokens.ts  colors, typography, spacing, vibe accents
│   └── config/curators.ts       client-side curator allowlist (UX only)
├── modules/expo-music-kit/      native module (TS surface + Swift implementation)
├── server/
│   ├── src/
│   │   ├── routes/              broadcast, featured, enrichment, curation, segment, voice
│   │   ├── services/
│   │   │   ├── broadcast/       orchestrator, manifest builder, sequencer, registry
│   │   │   └── storage/         ObjectStorage adapters (local fs + R2)
│   │   ├── providers/llm, tts/  pluggable provider factories
│   │   └── middleware/          auth (requireAuth, requireCurator), validate
│   └── featured-broadcasts/     JSON configs for hand-curated episodes
└── docs/superpowers/            specs + implementation plans
```

---

## Getting Started

### Prerequisites

- macOS with Xcode 16+ and the iOS SDK matching your test device
- Node.js 20+, npm
- Ruby via rbenv (for CocoaPods) — project uses rbenv 3.2.4
- An Apple Developer team for signing (iOS deployment target is 16.0 due to `MusicLibraryRequest`)
- A Firebase project (Auth) with Apple + Google sign-in configured
- API keys for: Gemini, Cartesia, ElevenLabs, Genius (optional: Ollama host, Orpheus host)

### 1. Clone and install

```bash
git clone <this-repo>
cd cleo-app
npm install
cd server && npm install && cd ..
```

### 2. Configure environment

Project root `.env`:
```
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3001
EXPO_PUBLIC_SENTRY_DSN=<optional>
```

`server/.env`:
```
# LLM
OLLAMA_BASE_URL=<optional self-hosted ollama>
OLLAMA_MODEL=<e.g. llama3.1:70b>
GEMINI_API_KEY=<fallback>

# TTS
CARTESIA_API_KEY=
CARTESIA_VOICE_ID=
CARTESIA_MODEL_ID=sonic-3
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ORPHEUS_BASE_URL=<optional>
ORPHEUS_VOICE=
ORPHEUS_MAX_TOKENS=

# Enrichment
GENIUS_ACCESS_TOKEN=

# Broadcast asset URLs (dev only — your LAN IP so the device can reach the MP3s)
BROADCAST_ASSET_BASE_URL=http://<your-lan-ip>:3001

# Curator allowlist (comma-separated emails)
CURATOR_EMAILS=

# Optional health checks
HEALTH_CHECK_INTERVAL_MS=
HEALTH_CHECK_TIMEOUT_MS=
```

Drop your Firebase configs (`GoogleService-Info.plist`, etc.) per the Firebase iOS setup guide.

### 3. Run the dev server

```bash
cd server
npm run dev    # port 3001
```

### 4. Run the iOS app

```bash
# From the project root
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device
```

First run: open the `.xcworkspace` in Xcode, select the target, enable **Automatically manage signing** under Signing & Capabilities, and set the team (`8F2VWCN5KF` for the Worthy Media dev build).

---

## Scripts

### Mobile
```bash
npm start              # Metro bundler
npm run ios            # build + run on iOS
npm run typecheck      # tsc --noEmit
npm run lint           # eslint over src/ and server/src/
npm run format         # prettier write
npm test               # jest (server + shared)
```

### Server
```bash
cd server
npm run dev            # ts-node-dev on :3001
npm test               # Jest (~233 tests across broadcast + routes)
npm run bake-featured  # CLI: bake a featured-broadcasts/<id>.json and register it
```

---

## The Broadcast Pipeline (high level)

### Client
1. User picks playlist + vibe + length in `SetupSheet`.
2. Client fetches playlist tracks via the native `expo-music-kit` module.
3. `POST /broadcast/create` → receives `{ manifest, firstSegmentUrls }` in ~5–8 s.
4. `BroadcastPlayer` plays segment 0 (cold open) → track 0 → segment 1 (transition) → … → sign-off.
5. Between every TTS segment and the next MusicKit track, the player calls `releaseAudioSession` natively so MusicKit can reclaim exclusive session control.

### Server (`BroadcastOrchestrator.create`)
1. `TrackSequencer` orders the pool via LLM using per-vibe narrative arcs, then runs a local repair pass for same-artist / same-album adjacency.
2. `ManifestBuilder` lays out slots: `cold_open`, `transition × (N-1)`, `sign_off`.
3. **Synchronously** generate slot 0 and return the manifest + first segment URLs.
4. **Asynchronously** fire off the remaining slots via `Promise.allSettled`; clean up `inFlight` in `.finally`.
5. **Asynchronously** enrich tracks via Genius + MusicBrainz (rate-limited, cached on disk).

### Caches
- `SequenceCache` — in-memory, 24 h TTL, keyed on `sha256(sortedTrackIds)|vibe|length`
- `CachingTTSProvider` — hashes text + voice params, dedupes identical lines across bakes
- `EnrichmentCache` — on-disk, 30-day threshold, atomic tmp+rename writes
- `BroadcastStore` — in-memory manifests, 2 h TTL, lazy eviction
- Client `BroadcastSegmentCache` — in-memory base64 per slot/variant

---

## Deployment

Production is an Express broadcast server at **`api.worthymedia.tech`**, running on a Hostinger VPS at `/home/cleo/cleo-broadcast/` on port 3102, managed by PM2 behind Caddy, with `STORAGE_BACKEND=r2` pointing at the Cloudflare R2 bucket `cleo-broadcast-segments`.

Full runbook: `server/DEPLOY.md`.

A legacy Fastify server (`cleo-api`, port 3100) is still running as a rollback lane. A one-line `sed` on the Caddyfile swaps traffic back if the new server breaks. Scheduled for decommission after a 1-week soak.

---

## Testing

```bash
cd server && npm test
```

Covers the broadcast orchestrator, sequencer, manifest builder, script builder (including prompt-injection sanitization), featured registry, and all HTTP routes.

---

## Design System

"Sonic Ether" Gold Edition. Black base + `#C8832A` gold accent. Typography roles:

| Role        | Font            | Used for                          |
|-------------|-----------------|-----------------------------------|
| Display     | Playfair        | Screen titles, track names        |
| Body        | Inter 400/500/600 | Descriptions, secondary        |
| Mono        | DM Mono         | ALL-CAPS labels, metadata, buttons|
| ONAY Voice  | EB Garamond Italic | Spoken-line captions           |

All colors, spacing, radii, gradients, and per-vibe accents live in `src/tokens/design-tokens.ts`. No inline styles.

---

## Documentation

- `CLAUDE.md` — full working context for the pre-baked architecture and all conventions
- `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md` — design spec
- `docs/superpowers/specs/2026-04-16-curation-design.md` — curation / Ask ONAY spec
- `docs/superpowers/plans/2026-04-12-pre-baked-broadcast-plan-{1..4}-*.md` — implementation plans
- `server/DEPLOY.md` — production deploy runbook

---

## License

All rights reserved. This repository is private / not open source.

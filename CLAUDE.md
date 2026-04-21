# CLAUDE.md — ONAY AI Radio App

## Project Overview
React Native / Expo SDK 55 iOS app. AI radio host named **ONAY** (pronounced "Oh-Nay"). The
product model is a **pre-baked broadcast episode**: user picks a playlist + vibe + length,
the server generates the entire broadcast (track order + host commentary audio) before
playback begins, and the client plays the locked episode beginning to end — no skips, no
live reactions. This architecture replaces the prior live-generation model, which failed
the iOS 48s/60s background CPU budget when LLM + TTS ran between tracks.

**Branding note:** The host was renamed from "Cleo" to "ONAY" on 2026-03-20. Bundle ID
(`com.worthymedia.cleo`) and git repo name remain unchanged.

**Current plan state:** Plans 1–4 (server bake pipeline → client player → home + curation
pipeline → cleanup/migration) are all tagged as complete on the `pre-baked-broadcast`
branch. The Express broadcast server is deployed to production at
`api.worthymedia.tech` (VPS, `/home/cleo/cleo-broadcast/`, port 3102 behind Caddy) with
R2 storage live. The old Fastify server at `/home/cleo/cleo-api/` on port 3100 is kept
running as a rollback safety net — Caddy routes away from it.

---

## Tech Stack

### Mobile
- React Native 0.83 + Expo SDK 55, TypeScript strict mode
- Custom `expo-music-kit` native module — wraps Apple MusicKit (auth, playlists, playback,
  track detection, catalog search, catalog lookup by ID, audio session control, TTS
  playback via AVAudioPlayer)
- `react-native-mmkv` — local storage (persisted manifest, user profile, host volume)
- `expo-blur`, `expo-linear-gradient`, `expo-haptics` — UI primitives
- `@expo-google-fonts` — Playfair Display, Inter, EB Garamond, DM Mono

### AI & Voice (server-side only)
- Gemini 2.5 Flash — LLM (was fallback; now primary since Ollama disabled)
- Ollama — **disabled in prod**, GPU reserved for CosyVoice + F5. `OLLAMA_BASE_URL`
  is now a required env var; leaving it unset → Ollama provider fails to construct,
  Gemini becomes the active primary.
- **Fun-CosyVoice3-0.5B** (self-hosted FastAPI wrapper on the Linux box,
  port 8001, proxied via `f5tts.worthymedia.online/cosy/*`) — **primary TTS**
  as of 2026-04-20. System prompt `"You are ONAY, a warm radio DJ."` baked into
  the wrapper (winning variant from A/B testing). Startup warmup runs 3
  representative inferences (short/medium/long shapes) to prime MIOpen kernels;
  adds ~47s to boot but saves ~15s on first user bake.
- **F5-TTS** (same Linux box, port 8000, `f5tts.worthymedia.online`) — **fallback
  TTS**. Settings: NFE=20, CFG=2.3, speed=1.05. Leading-silence trim patched
  into the wrapper since F5's `remove_silence=True` is a no-op unless `file_wave`
  is provided (our wrapper writes to buffer instead). F5 wrapper also hosts the
  `/cosy/*` proxy endpoints forwarding to CosyVoice on port 8001 — reuses the
  single Pangolin tunnel rather than adding a second.
- Cartesia (`sonic-3`) — tertiary TTS (paid API, used only when both self-hosted
  providers fail health checks).
- ElevenLabs (`eleven_turbo_v2_5`) — quaternary
- Orpheus (self-hosted) — quinternary (kept in the provider list for now)
- `TTS_PRIMARY=cosyvoice TTS_FALLBACK=f5tts` → chain is cosyvoice → f5tts →
  cartesia. `TTS_FALLBACK` is a new explicit override that lets self-hosted
  primaries chain to another self-hosted provider before hitting a paid API.
- **CosyVoice "empty generation" failure** (intermittent): model occasionally
  yields no `tts_speech` chunks for some texts. Wrapper returns HTTP 502; the
  factory fallback chain picks up that segment with F5. Silent quality
  degradation, not a user-visible failure.
- Filesystem TTS cache at `~/.cache/cleo-tts` (falls back from `TTS_CACHE_DIR`
  env) dedupes identical text across bakes. Must be cleared whenever TTS
  settings or reference changes — otherwise stale audio gets served.
- **Pronunciation dict** ported from Cartesia's server-side dict to
  `server/src/providers/tts/pronunciations.json` (146 entries). Applied locally
  in `preprocessForTTS`. **All hyphens stripped from substitutions** as of
  2026-04-20 — F5 and CosyVoice both read hyphens as sharp syllable breaks that
  distort prosody. Entries concatenate instead: `Bee-yon-say → Beeyonsay`,
  `Boss Man D-Low → Boss Man DLow`.

### Backend
- **Local dev:** Node.js + Express (`server/`) on port 3001. Jest + ts-jest test suite
  (258 tests). `STORAGE_BACKEND` env unset → `LocalFilesystemStorage` under
  `server/.broadcast-cache/`; segments served via `/broadcast-asset/*`.
- **Production:** Express broadcast server at `api.worthymedia.tech` (Hostinger VPS ID
  1434111, IP 187.124.69.95), running at `/home/cleo/cleo-broadcast/` on port 3102
  behind Caddy, managed by PM2 (app name `cleo-broadcast`). `STORAGE_BACKEND=r2` →
  Cloudflare R2 bucket `cleo-broadcast-segments`; segment URLs are 7-day presigned
  GetObject links embedded in the manifest. Deploy runbook: `server/DEPLOY.md`.
- **Rollback lane:** old Fastify server still running at `/home/cleo/cleo-api/` on port
  3100. Caddy routes `api.worthymedia.tech` to `:3102`; a one-line `sed` on the
  Caddyfile swaps back to `:3100` if the new server breaks. Scheduled for `pm2 delete`
  after a 1-week soak — until then, don't assume it's gone.
- Firebase JWT auth middleware (`requireAuth`) gates all routes. Ownership gate on
  `GET /broadcast/:id/manifest` + `/broadcast-asset/*` — both return 404 unless
  `manifest.userId === req.uid` or `manifest.userId === 'curator'` (featured broadcasts
  are globally accessible).
- Curator-only publish route (`POST /broadcast/featured/publish`) gated by
  `requireCurator` middleware against `CURATOR_EMAILS` env allowlist.

---

## Project Structure

```
cleo-app/
├── CLAUDE.md
├── app.json                      ← Expo config, iOS 16+ deployment target
├── app/
│   ├── _layout.tsx               ← Root Stack, font loading, splash screen
│   ├── index.tsx                 ← Auth routing gateway
│   ├── (auth)/login.tsx
│   ├── (onboarding)/             ← welcome → music-auth → cleo-setup
│   └── (main)/
│       ├── _layout.tsx           ← Tabs with CustomTabBar (2 tabs: Broadcast + ONAY)
│       ├── (broadcast)/
│       │   ├── _layout.tsx
│       │   ├── index.tsx         ← HomeBroadcastScreen entry
│       │   ├── player.tsx        ← Now Playing screen (artwork + progress + controls)
│       │   └── ask-onay.tsx      ← Ask ONAY curation chat
│       └── (cleo)/
│           ├── _layout.tsx
│           └── index.tsx         ← ProfileScreen (settings)
├── docs/
│   └── superpowers/
│       ├── specs/2026-04-12-pre-baked-broadcast-design.md
│       └── plans/2026-04-12-pre-baked-broadcast-plan-{1..4}-*.md
├── modules/
│   └── expo-music-kit/
│       ├── index.ts              ← TS surface (auth, playlists, playback, duck/release,
│       │                           playAudioFromBase64, searchCatalog)
│       └── ios/
│           └── ExpoMusicKitModule.swift  ← MusicKit + AVAudioSession. play() self-hydrates
│                                           cachedSongs via MusicCatalogResourceRequest
│                                           when cache misses. Legacy eject code still
│                                           sits here as dead weight (Plan 4 didn't strip
│                                           Swift — pending future native pass).
├── server/
│   ├── .env                      ← API keys (gitignored)
│   ├── featured-broadcasts/
│   │   ├── late-night-soul.json  ← example config (tracked)
│   │   └── registry.json         ← baked records (gitignored)
│   ├── .broadcast-cache/         ← baked segment MP3s (gitignored)
│   ├── package.json              ← scripts: dev, test, bake-featured
│   ├── __tests__/                ← Jest suite (~53 tests across broadcast + routes)
│   └── src/
│       ├── index.ts              ← Express app, rate limiter with path-scoped skip()
│       ├── middleware/
│       │   ├── auth.ts           ← requireAuth + requireCurator (exposes req.uid, req.email)
│       │   └── validate.ts       ← Zod schemas for shared routes
│       ├── providers/
│       │   ├── llm/              ← Gemini (primary, since Ollama requires explicit
│       │   │                       OLLAMA_BASE_URL and isn't configured in prod)
│       │   └── tts/              ← CosyVoice3 primary / F5 fallback / Cartesia
│       │                           tertiary (reorderable via TTS_PRIMARY +
│       │                           TTS_FALLBACK env), wrapped in CachingTTSProvider.
│       │                           pronunciations.json holds 146 artist-name entries
│       │                           (hyphens stripped from all values so F5/CosyVoice
│       │                           don't read them as stress markers)
│       ├── routes/
│       │   ├── broadcast.ts      ← POST /broadcast/create, GET /broadcast/:id/manifest
│       │   ├── featured.ts       ← GET /broadcast/featured, POST /broadcast/featured/publish
│       │   ├── segment.ts        ← legacy /generate-segment (still mounted, may be
│       │                           dropped after production deploy)
│       │   ├── voice.ts          ← legacy /synthesize-voice
│       │   ├── enrichment.ts     ← /enrich-track via Genius
│       │   ├── musicbrainz.ts    ← /enrich-mb
│       │   └── curation.ts       ← /curate-playlist (used by Ask ONAY)
│       ├── services/
│       │   ├── broadcast/
│       │   │   ├── types.ts                    ← Manifest, SegmentSlot, BroadcastCreateRequest
│       │   │   ├── ManifestBuilder.ts          ← deterministic track slice + slot layout
│       │   │   ├── SegmentScriptBuilder.ts     ← prompt builder per slot (cold_open /
│       │   │   │                                 transition / sign_off), sanitizes
│       │   │   │                                 injection-prone metadata
│       │   │   ├── SegmentGenerator.ts         ← LLM → TTS → ObjectStorage per variant
│       │   │   │                                 (parallel variant generation)
│       │   │   ├── BroadcastStore.ts           ← in-memory 2h-TTL manifest state
│       │   │   ├── BroadcastOrchestrator.ts    ← slot 0 + drainNow race in parallel;
│       │   │   │                                 HTTP response gated on both. Slots
│       │   │   │                                 1..N fan out as a 4-worker background
│       │   │   │                                 pool; inFlight map tracks the promise
│       │   │   │                                 for waitForCompletion / isInFlight
│       │   │   ├── FeaturedBroadcastRegistry.ts← JSON-file-backed (atomic tmp+rename),
│       │   │   │                                 malformed-JSON tolerant
│       │   │   └── bakeFeatured.ts             ← CLI job: config → orchestrator → registry
│       │   └── storage/
│       │       └── ObjectStorage.ts            ← LocalFilesystemStorage adapter
│       └── scripts/
│           └── bake-featured.ts  ← CLI entry point
├── src/
│   ├── config/
│   │   └── curators.ts           ← client-side curator email allowlist (UI visibility;
│   │                               server has authoritative gate)
│   ├── hooks/
│   │   └── useAppActive.ts       ← pauses animations/work when backgrounded
│   ├── tokens/
│   │   └── design-tokens.ts      ← Colors, Surface, TextColors, Typography, Spacing,
│   │                               Radius, Gradient, Glow, Animation, getVibeAccent()
│   ├── engines/
│   │   ├── BroadcastPlayer.ts           ← pure state-machine class (DI: music, native,
│   │   │                                   manifestClient, stingers). Polls MusicKit
│   │   │                                   status every 1s during track playback.
│   │   │                                   Pause parks main loop; resume wakes it.
│   │   ├── BroadcastPlayer.singleton.ts ← wires the class to real deps at module load
│   │   │                                   (kept separate so tests don't pull Firebase)
│   │   ├── BroadcastPlayer.types.ts     ← Manifest, SegmentSlot, PlayerStatus (mirror
│   │   │                                   of server types)
│   │   ├── BroadcastSegmentCache.ts     ← in-memory cache: slot → variant → base64
│   │   ├── BroadcastManifestClient.ts   ← HTTP client; strips origin from full URLs
│   │   │                                   before passing to authenticatedFetch
│   │   ├── BroadcastCurationClient.ts   ← listFeatured + publishFeatured
│   │   ├── BroadcastResumer.ts          ← 2h resume window via persisted MMKV manifest
│   │   ├── BroadcastStingers.ts         ← stubbed (returns null); pending sound design
│   │   └── PlaylistCurator.ts           ← Ask ONAY: LLM tracklist → on-device
│   │                                       catalog search → resolved tracks
│   ├── services/
│   │   ├── api.ts                ← API_BASE_URL + authenticatedFetch (throws on null
│   │   │                           Firebase token; prepends API_BASE_URL to the path
│   │   │                           parameter — always pass a relative path)
│   │   ├── AuthService.ts
│   │   ├── MusicKitPlayer.ts     ← Apple Music wrapper singleton
│   │   ├── Storage.ts            ← MMKV helpers: setUser/getUser, CachedPlaylists,
│   │   │                           OnaySuggestion, PersistedBroadcast
│   │   └── TrackEnrichmentService.ts
│   ├── screens/
│   │   ├── home/
│   │   │   └── HomeBroadcastScreen.tsx  ← two-stack: Your Broadcast (primary gradient
│   │   │                                   CTA) + Tonight on ONAY (editorial cards)
│   │   ├── curate/
│   │   │   └── AskOnayScreen.tsx        ← LLM-curated playlist chat + Publish-as-Featured
│   │   │                                   (curator-only) + Take-It-Live (bake as user
│   │   │                                   broadcast)
│   │   ├── onboarding/
│   │   │   └── CleoOnboarding.tsx
│   │   └── settings/
│   │       └── ProfileScreen.tsx
│   └── components/
│       ├── AppHeader.tsx
│       ├── TabBar.tsx                    ← 2 tabs: Broadcast + ONAY
│       ├── TabIcon.tsx
│       ├── OnayCharacter.tsx
│       ├── CleoOrb.tsx, CleoPulseDot.tsx
│       ├── VibePicker.tsx
│       ├── OfflineBanner.tsx
│       ├── ErrorBoundary.tsx, ErrorState.tsx
│       └── broadcast/
│           ├── FeaturedBroadcastCard.tsx
│           ├── YourBroadcastSetup.tsx   ← exports primary CTA + AskOnayButton
│           ├── SetupSheet.tsx           ← 3-step modal: playlist → vibe → length
│           ├── TuningInOverlay.tsx      ← pulsing ring + "TUNING IN"
│           └── (player.tsx lives under app/(main)/(broadcast)/)
```

---

## UI Design System — "Sonic Ether" Gold Edition

- **Black base** (`Colors.base.black`) + **gold accent** (`Colors.accent = #C8832A`).
- **Typography roles:**
  - Display (Playfair) — screen titles, track names
  - Body (Inter 400/500/600) — descriptions, secondary
  - Mono (DM Mono) — ALL CAPS labels, metadata, button text, wide tracking
  - ONAY Voice (EB Garamond Italic) — spoken captions ("Between the tracks…")
- **Gold-edge cards** (2px `Colors.accent` borderLeft on `Surface.container`) for
  secondary cards. **Primary CTA** uses `Gradient.cta` + `Glow.ctaShadow` with an icon
  and chevron.
- **Vibe accents** per vibe (`Colors.vibe.lateNight.accent` etc.) — used for the player's
  progress bar, status orb, and vibe color chips in the setup sheet. Get via
  `getVibeAccent(vibe)`.
- **Section labels** — DM Mono 10px letterSpacing 2.5, `Colors.accent`, with a 2×40 gold
  bar underneath. Editorial sections add a pulsing gold `LiveDot` next to the label.
- **Press feedback** — Pressable style callbacks returning `opacity: 0.75` (or 0.85 for
  colored buttons). Haptic feedback on every tap via `expo-haptics`.
- **Animations** must respect `useAppActive()` — loops pause when backgrounded.

---

## The Pre-Baked Broadcast Pipeline

### Client flow — user-sourced broadcast
1. User taps "Build your broadcast" on the home screen → `SetupSheet` opens
2. 3 steps: pick playlist (from Apple Music) → pick vibe → pick length (quick/standard/long)
3. Client calls `musicKitPlayer.fetchPlaylistTracks(playlistId)` to get track metadata
4. Tracks run through `sanitizeTracksForBake` (drop 0-duration / empty-title / bad-URL
   tracks; clamp overlong strings) so the Zod schema on the server doesn't reject the
   request. If <5 playable tracks remain, surface a clear "need at least 5" error
   instead of letting the server return an opaque 400.
5. Client `POST /broadcast/create` with `{ playlistId, vibe, length, userContext, tracks }`
6. Server responds after **slot 0 + enrichment drain** are both complete (~11-19s
   wallclock depending on enrichment cache warmth) with `{ manifest, firstSegmentUrls }`.
   Slots 1..N are still `pending`; the client picks them up via polling.
7. Client navigates to `/player`, starts `broadcastPlayer.start(manifest, firstSegmentUrls)`
8. `TuningInCanvas` shows on the player screen while the cold open is fetched
9. **Sparse-cadence main loop**: iterate `manifest.segmentSlots` in order, advancing
   `nextSegmentIdx` only when a slot targets the upcoming track. For 5 tracks that's
   `cold_open → t0 → t1 → trans(→t2) → t2 → t3 → trans(→t4) → t4 → sign_off`. Tracks
   without a matching segment play back-to-back. Each segment plays via
   `playAudioFromBase64` (duck MusicKit → play TTS → release audio session). Each
   track plays via `musicKitPlayer.play([trackId])`.
10. Between `playAudioFromBase64` and `musicKitPlayer.play`, the player calls
    `releaseAudioSession` natively so MusicKit can reclaim exclusive session control.
11. `schedulePolling()` fires every 3s while any slot is `pending`, GETting
    `/broadcast/:id/manifest` and triggering `kickBackgroundFetch` for newly-ready
    audio URLs. Stops automatically when every slot is non-pending (ready or failed).
12. `waitForTrackEnd` watches both `getPlaybackStatus()` and `getPlaybackTime()` once
    per second (and via the 0.5s `onPlaybackStateChanged` event). Ends the wait when
    `playbackTime >= duration - 0.5` OR `status === 'stopped'` — but only after
    `status === 'playing'` has been observed at least once for the current track
    (gates out pre-playback flicker during TTS→MusicKit session handoff). `paused` is
    explicitly excluded so user pauses don't advance to the next segment. Positional
    detection is the primary signal; `ApplicationMusicPlayer` with a single-track queue
    doesn't reliably emit `stopped` at track end.

### Server flow — BroadcastOrchestrator
```
create(input):
  1. TrackSequencer.sequence({ pool, vibe, length, userContext })
     → cache hit? return cached order (24h TTL, keyed on sorted trackIds+vibe+length)
     → otherwise LLM call with VIBE_ARCS[vibe] prose + preferred/avoid + enrichment
       hints; JSON output validated (shape, length, ids exist, no dupes); local
       repair pass for same-artist/same-album adjacency (≤5 passes)
     → one retry on failure; silent fallback to pool.slice(0, N) on second failure
  2. ManifestBuilder.buildManifest(input.tracks = seq.orderedTracks)
     → SPARSE CADENCE: cold_open + transitions before tracks at even indices
       (2, 4, 6, …) + sign_off. Transition tiers alternate fact_bridge (45-55 words)
       → tight_bridge (30-40 words), starting with fact_bridge. For 5 tracks: 4 slots.
       For 9: 6. For 15: 9. featureSlots overrides specific indices to deep_dive.
  3. store.put(manifest)
  4. Kick drainNow (Genius+MB+Wiki+LastFm parallel per track, serialized per-API
     at 1.1s by rate limiter) and generateSlot(0) IN PARALLEL. Slot 0 is cold_open
     — works fine with empty enrichment, so drainNow doesn't block slot 0's LLM.
  5. await Promise.all([drainP, slot0P]) — HTTP response gated on BOTH completing.
     Waiting for drainNow means the shared EnrichmentCache is populated in time
     for slots 1..N to pull producer/sample hints.
  6. Fire-and-forget: generateSlotsBackground(slots 1..N) with a 4-worker pool
     (SEGMENT_CONCURRENCY=4). Each slot: SegmentScriptBuilder → LLM → TTS →
     ObjectStorage. Failures mark slot 'failed' but don't abort peers. Promise
     stored in inFlight map; deleted via .finally() when all workers return.
  7. Return { manifest: store.get(id) [slot 0 ready, 1..N pending],
              firstSegmentUrls: slot0Urls }

BroadcastOrchestrator.waitForCompletion(id) — awaits the inFlight promise (used
  by bakeFeatured, featured publish route, tests). isInFlight(id) checks the map.
```

### Curation sequencer (`DeterministicTrackSequencer`)

- Deterministic numeric sequencing replaced the LLM-based `TrackSequencer` on
  2026-04-21. The old path is preserved as `LLMTrackSequencer` behind env
  `SEQUENCER_MODE=llm` for rollback; slated for deletion after soak.
- Each track carries `AudioFeatures` (`tempo/energy/valence/danceability/
  acousticness/loudness/instrumentalness`). Features fetched by
  `FeatureFetchChain` with the ladder:
  ReccoBeats (ISRC-keyed) → Deezer (BPM+loudness) → Last.fm tags + genre
  synth → genre-only defaults → neutrals. Populated in `BackgroundEnricher`'s
  drainNow stage; persisted in `EnrichmentCache` alongside existing fields.
- Vibe curves live in `server/src/services/broadcast/vibe-curves.ts` — 4
  keyframes (open/body/peak/close at fractional positions 0.0/0.33/0.67/1.0)
  × 7 vibes × 7 features, plus per-feature weights. Hand-authored from the
  prose in `vibe-arcs.ts`; data, not code.
- For each slot, the sequencer interpolates the target vector at fractional
  position `i/(N-1)`, scores every remaining track by weighted L2 distance +
  adjacency penalty (+0.15 same artist, +0.30 same album), takes top-K
  candidates (K=2 for quick, K=3 for standard/long), and picks one via a
  `mulberry32` PRNG seeded on `broadcastId`.
- **Deterministic within a bake** (same broadcastId → byte-identical output);
  **varies across bakes** (different broadcastId → different top-K pick).
- No LLM involvement in ordering. Sequencer output always valid — fallback
  ladder guarantees every track has a complete feature vector; no `pool.slice`
  silent fallback.
- `SequenceCache` is deleted; sequencing is ~microseconds so caching is
  incompatible with per-bake seeded variation anyway.
- `nominateDeepDives` ranks transitions by incoming-track enrichment richness
  (count of non-empty fields among producer/sample/wikipediaSummary/
  notableFacts) and caps picks at `ceil((N-1)/4)`. Deterministic.

**Telemetry:** each bake logs
`[Sequencer] source=deterministic vibe=X N=Y poolSize=Z firstId=... lastId=...
meanDistance=0.XX features: reccobeats=n synthesized=m defaults=k`.
Poor-fit warning (`[Sequencer] poor vibe fit (mean distance 0.XX)`) fires
when mean distance exceeds 0.7 — indicates the pool doesn't match the vibe.

### Featured (editorial) flow
- `bakeFeatured(config)` reads a config JSON with `{ id, title, description, vibe,
  length, tracks[] }` where tracks have real Apple Music IDs.
- Runs through `BroadcastOrchestrator.create(userId: 'curator', playlistId: null)`,
  waits for completion, re-reads the final manifest via `orchestrator.getManifest(id)`,
  and persists it to `FeaturedBroadcastRegistry` as `baked: true`.
- In-app path: curators hit `POST /broadcast/featured/publish` via the Ask ONAY
  Publish-as-Featured button. The LLM curates tracks, client resolves via
  `searchCatalog`, server bakes + registers.
- Home screen fetches `GET /broadcast/featured` and renders `FeaturedBroadcastCard`s
  with freshness timestamps.

### Caches
- **`server/.broadcast-cache/broadcast/<id>/segment/<slot>/v<v>.mp3`** — persists on disk
  indefinitely; gitignored. No automatic cleanup yet.
- **`~/.cache/cleo-tts/`** — `CachingTTSProvider` hashes text + voice params;
  dedupes identical TTS calls across bakes. Default location (override with
  `TTS_CACHE_DIR`). Must be cleared whenever TTS settings, reference audio, or
  transcript change — otherwise stale audio under old settings gets served
  indefinitely. Cleared most recently on 2026-04-20.
- **`server/.enrichment-cache/tracks.json`** — persistent `EnrichmentCache`, keyed on
  normalized `title|artist` (strips `(feat. X)` / `(Remastered YYYY)` / `- Deluxe`),
  values are `EnrichmentRecord { genre, moodTags, releaseYear, producer, sample,
  lastEnrichedAt, source }`. Atomic tmp+rename writes, malformed-JSON tolerant, 30-day
  re-enrichment threshold. Used by `TrackSequencer` prompt and `SegmentScriptBuilder`
  for producer/sample commentary flavor on repeat listens.
- **`SequenceCache`** — in-memory LRU, 24h TTL, max 500 entries. Keyed on
  `sha256(sortedTrackIds)|vibe|length` so key is stable if Apple Music returns tracks
  in a different order. Same-day re-bakes skip the LLM entirely.
- **`server/featured-broadcasts/registry.json`** — gitignored; holds baked featured
  records. Atomic write via `.tmp` + rename.
- **`BroadcastStore`** — in-memory, 2h TTL, lazy eviction on access.
- **Client `BroadcastSegmentCache`** — in-memory base64 cache, cleared on `start`/`end`.
- **MMKV `CURRENT_BROADCAST`** — persisted manifest for resume-after-terminate
  (2h window via `BroadcastResumer`).

### Native audio session discipline
- `activateDuckingSession` — `.playback + .mixWithOthers + .duckOthers`, setActive(true)
- `deactivateDuckingSession` — removes `.duckOthers` but keeps `.mixWithOthers`
- `releaseAudioSession` — plain `.playback`, setActive(false). Essential between a
  segment and the next track or MusicKit can't take exclusive session control.
- Never `setActive(false)` while AVAudioPlayer is playing — it kills the TTS.

---

## Build Environment

- **Working directory**: `/Users/kari/Documents/cleo-app/` — no rsync.
- **Dev server**: `cd server && npm run dev` on port 3001.
- **Laptop IP**: set `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3001` in project root `.env` and
  `BROADCAST_ASSET_BASE_URL=http://<LAN-IP>:3001` in `server/.env` so the device can
  reach both the API and the segment MP3s.
- **TestFlight builds**: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`.
  First-time signing must be auto-managed in Xcode (Signing & Capabilities tab) with
  team `8F2VWCN5KF`. iOS platform SDK must match the device's iOS version.
- **Apple Developer Team**: 8F2VWCN5KF (project sometimes shows `5MQ5ZR66YN` — fix in
  Xcode project > target > Signing & Capabilities).
- **iOS deployment target**: 16.0 (MusicLibraryRequest requirement).
- **Ruby / CocoaPods**: rbenv 3.2.4; `pod` at `~/.rbenv/shims/pod`.

---

## Environment Variables

`server/.env` (gitignored):
```env
GEMINI_API_KEY
CARTESIA_API_KEY, CARTESIA_VOICE_ID, CARTESIA_MODEL_ID
CARTESIA_PRONUNCIATION_DICT_ID            ← source dict; synced locally to
                                            providers/tts/pronunciations.json
ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_PRONUNCIATION_DICT_ID/_VERSION
OLLAMA_BASE_URL, OLLAMA_MODEL             ← leave unset in prod; unset → Ollama
                                            provider unavailable, Gemini promoted
ORPHEUS_BASE_URL, ORPHEUS_VOICE, ORPHEUS_MAX_TOKENS
GENIUS_ACCESS_TOKEN
HEALTH_CHECK_INTERVAL_MS, HEALTH_CHECK_TIMEOUT_MS
BROADCAST_ASSET_BASE_URL                  ← dev: http://<LAN-IP>:3001
CURATOR_EMAILS                            ← comma-separated; authoritative publish gate

# TTS provider chain. TTS_PRIMARY = first try; TTS_FALLBACK = second try
# (new env var for self-hosted → self-hosted fallback before paid API).
TTS_PRIMARY=cosyvoice
TTS_FALLBACK=f5tts

# Sequencer — default 'deterministic' (ReccoBeats-based). 'llm' keeps the
# old LLM-based path for rollback. Flag removed after 2-week soak.
SEQUENCER_MODE=deterministic

# CosyVoice3 (self-hosted on Linux box:8001, proxied via F5 tunnel /cosy/*)
COSYVOICE_BASE_URL=https://f5tts.worthymedia.online/cosy
COSYVOICE_VOICE_REF=onay-cartesia         ← ref audio + transcript shared with F5
COSYVOICE_SPEED=1.0
COSYVOICE_TIMEOUT_MS=180000

# F5-TTS (same Linux box, port 8000)
F5TTS_BASE_URL=https://f5tts.worthymedia.online
F5TTS_VOICE_REF=onay-cartesia             ← ref audio + transcript saved on the server
F5TTS_NFE_STEP=20                         ← paper-tested floor; 12 was below range and
                                            produced inconsistent output
F5TTS_CFG_STRENGTH=2.3                    ← stability bump from default 2.0 after
                                            A/B listening (2.0 was too expressive)
F5TTS_SPEED=1.05                          ← faster pace; 0.9 was too slow
F5TTS_TIMEOUT_MS=180000                   ← lifted from 60s so async slot 1..N queue
                                            doesn't flip to Cartesia under the asyncio
                                            serialize lock

# Cloudflare R2 (prod only; STORAGE_BACKEND=r2)
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
```

Project root `.env`:
```env
EXPO_PUBLIC_API_URL           ← dev: http://<LAN-IP>:3001; prod: https://api.worthymedia.tech
EXPO_PUBLIC_SENTRY_DSN
```

---

## Important Conventions

- All components TypeScript strict mode; no inline styles (everything from `design-tokens.ts`).
- **All API calls go through `authenticatedFetch`** — attaches Firebase JWT, prepends
  `API_BASE_URL`. Always pass a relative path (e.g. `/broadcast/create`); passing a
  full URL creates a malformed `${API_BASE_URL}http://...` request.
- **`authenticatedFetch` throws on null token** — never silently sends unauthenticated
  requests. Callers handle the auth-not-ready state.
- **All server routes validated via Zod.** Length-cap all client-supplied strings that
  flow into LLM prompts (`title`, `artistName`, `albumTitle` ≤ 200, URLs ≤ 2048).
  Sanitize prompt-injection markers in `SegmentScriptBuilder.sanitizeForPrompt` before
  interpolation.
- **Rate limiter scoping**: `generationLimiter` in `server/src/index.ts` uses a `skip`
  filter keyed on path (`GENERATION_PATHS` regex). Mounted via `app.use(mw, router)`
  without a path would otherwise apply to every request — skip filter is the scoping
  mechanism.
- **MMKV** for all local persistence — never AsyncStorage. Method is `storage.remove(key)`,
  not `storage.delete(key)`.
- **`JSON.parse` on MMKV** must be try/catch-wrapped — `getObject` in Storage.ts handles
  this for typed callers.
- **`clearUserData` must preserve `StorageKeys.USER`** — removing it would re-route
  returning users through onboarding.
- **Pressable, not TouchableOpacity.** All interactive elements need `accessibilityLabel`
  + `accessibilityRole`.
- **`setTimeout` / `setInterval` in React components** must be stored in `useRef` and
  cleared on unmount / before next effect.
- **`Animated.loop` must pause when backgrounded** via `useAppActive()`. iOS background
  CPU budget is 48s per 60s window; looping animations at 120Hz ProMotion blow it fast.
- **Native MusicKit listeners** must be wrapped in try/catch (`MusicKitPlayer.ensureSubscriptions`)
  so one throwing listener doesn't abort subsequent dispatches.
- **Native `play()` self-hydrates** — if `trackIds` aren't in `cachedSongs`, it issues
  `MusicCatalogResourceRequest<Song>` to fetch them before queueing. This is what makes
  featured broadcasts (which never call `fetchPlaylistTracks`) playable.
- **`releaseAudioSession` must run between every segment and the next track.** Otherwise
  MusicKit can't reclaim exclusive session control and `music.play()` silently fails.
- **`BroadcastPlayer.pause()` parks the main loop via `waitIfPaused`.** Don't
  hard-stop in-flight segment TTS (AVAudioPlayer has no gapless pause). `resume()`
  wakes the parked loop; `end()` wakes it first so the loop exits cleanly.
- **`waitForTrackEnd` polls `getPlaybackStatus()` every 1s** and only advances on
  `stopped` (not `paused`). Polling is more reliable than events — events drop during
  Metro reconnects and when backgrounded.
- **Server `BroadcastOrchestrator.inFlight` map must delete on completion** (via
  `.finally(() => inFlight.delete(id))`) — otherwise grows unbounded.
- **Sparse segment cadence.** `ManifestBuilder` places transitions only before tracks
  at indices 2, 4, 6, … (even, nonzero). Tracks between transitions play back-to-back.
  Tier alternation `fact_bridge` → `tight_bridge`, starting with `fact_bridge`;
  `featureSlots` overrides specific indices to `deep_dive` and consumes an alternation
  step. Client `BroadcastPlayer` uses the `nextSegmentIdx` dual-cursor walk that
  only advances on `beforeTrackId` match — don't regress to the old `i+1` lockstep.
- **Tier shapes live in `SegmentScriptBuilder.TIER_SHAPES`** — `cold_open` 35-50
  words (shrunk from 55-80 on 2026-04-20 to reduce cold-open TTFT under CosyVoice's
  RTF ~2), `fact_bridge` 45-55, `tight_bridge` 30-40, `deep_dive` 80-120, `sign_off`
  35-55. The FACT DISCIPLINE rule forbids weaving multiple enrichment facts:
  "Pick the single most interesting fact. Don't try to weave multiple."
- **Transition prompts are hybrid-editorial** — drop the `Outgoing: …` line; only
  reference the incoming track. Listener already heard the outgoing track without
  narration (ONAY never introduced it), so acknowledging it reads as redundant.
- **Client must run `sanitizeTracksForBake` before `POST /broadcast/create`** —
  Apple Music occasionally returns tracks with `duration === 0`, empty titles, or
  malformed artwork URLs. Unsanitized, these trigger the server's Zod schema and
  return an opaque 400. Helper lives in `src/engines/BroadcastManifestClient.ts`.
- **Track-based monotonic progress bar.** `BroadcastPlayer.computeProgress()` uses
  `(currentTrackIndex + 1) / (tracks + 1)` with the last tick reserved for sign_off.
  Don't revert to the old "tracks + segments" denominator — under sparse cadence
  it produced visible 25-30% jumps as segments start/end.
- **Curator gate is two-layer**: client UI hides the button unless email is in
  `src/config/curators.ts`; server rejects non-curators with 403 via `requireCurator`.
  UI filter is UX-only; server is authoritative.
- **Tab group `_layout.tsx` required** — Expo Router throws "not handled by any
  navigator" without one.
- **Unicode escapes in JSX text**: `{'\u2014'}` inside a `{}` expression works;
  `\u2014` in raw JSX tag children renders literally. Use literal characters
  (`—`, `…`, `·`) or wrap in braces.
- **Safe-area insets** required on all root screens — the tab bar + status bar don't
  provide them automatically for ScrollView content.
- **Host voice is female.** `SegmentScriptBuilder.systemPrompt` explicitly sets ONAY as
  a woman using she/her pronouns and forbids masculine DJ phrasing ("your boy", "my
  man", "the homie", "this guy"). When tuning voice or prompts, don't remove these
  guards.
- **Host name phonetic substitution.** `preprocessForTTS` rewrites
  `\bONAY\b → Ohnay` (no hyphen, as of 2026-04-20) on LLM script text before handing
  to TTS. The hyphen caused F5/CosyVoice to read the name as two emphatic
  syllables. Word-bounded so `BALONAY` / `ONAYS` aren't touched.
  `SegmentScriptBuilder` system prompt also says `(pronounced "Ohnay")` so Gemini
  writes the unhyphenated form in scripts. If we ever rename the host again,
  update the regex, the system prompt hint, and the reference transcript in
  lockstep.
- **Never add hyphens to phonetic substitutions for F5 or CosyVoice.** F5's
  character-level tokenizer and CosyVoice's tokenizer both treat `-` as a stress
  marker — `Bee-yon-say` reads as three emphatic syllables (staccato / "excited").
  `pronunciations.json` entries are all hyphen-free now; don't re-add them.
- **TrackSequencer prompt hints are sanitized.** Enrichment fields (`genre`,
  `moodTags`, `producer`) come from third-party APIs — always run through
  `sanitizeHint` before interpolation, mirroring `sanitizeForPrompt`'s control-char /
  role-hijack / backtick stripping. Never embed raw Genius/MB strings into the
  sequencer prompt.
- **`OllamaProvider` constructor throws when `OLLAMA_BASE_URL` is unset.** The
  factory catches and falls back to Gemini as primary. Don't re-introduce a
  `localhost:11434` default — it creates 502 noise every 30s on the health check
  cycle when Ollama isn't actually running.
- **F5-TTS is not thread-safe.** The FastAPI wrapper uses a module-level
  `asyncio.Lock` to serialize all `MODEL.infer(...)` calls. Concurrent calls
  without the lock produce `"Sizes of tensors must match"` errors. Don't scale
  by running multiple uvicorn workers — on the 6700XT the GPU is compute-bound
  and time-slicing across workers doesn't help; each worker also has its own
  MODEL instance, bypassing the lock.
- **F5 `remove_silence=True` is a no-op in our wrapper.** F5's api.py only calls
  `remove_silence_for_generated_wav` inside `export_wav`, which only runs when
  `file_wave` is provided. Our wrapper writes via `sf.write` to a buffer, skipping
  `export_wav` entirely. Fix is an in-wrapper `_trim_silence` numpy step before
  encoding — takes ~60ms leading + ~120ms trailing, drops from 528ms leading
  silence down to 60ms.
- **CosyVoice wrapper also `asyncio.Lock`-serialized** for the same reason.
  First call after boot pays MIOpen tuner cost (~30s cold); wrapper runs a
  3-shape startup warmup to amortize. MIOpen tuner cache persists to
  `~/.cache/miopen/` across restarts.
- **F5 wrapper exposes `/cosy/*` proxy endpoints.** `GET /cosy/health` and
  `POST /cosy/tts` forward to `127.0.0.1:8001` via an httpx async client so
  only one Pangolin tunnel is needed. The proxy uses `Request.json()` instead
  of a typed body param — `from __future__ import annotations` stringifies
  type hints and FastAPI can't resolve `TTSRequest` at route-registration time.
- **`preprocessForTTS` strips markdown emphasis.** Gemini occasionally emits
  `*word*` or `**word**` as prosody hints. F5/CosyVoice read them literally
  (either pronouncing the asterisks or distorting prosody), which reads as
  "too excited" delivery. Strip regex lives in `SegmentGenerator.preprocessForTTS`.
  Also normalizes curly double quotes `""` → `"` (F5's tokenizer mishandles
  U+201C/U+201D).

---

## Known Issues & Gotchas

### Audio session & MusicKit
- **Never `setActive(false)` while AVAudioPlayer is playing** — kills the TTS.
- **AVAudioPlayer.stop() does not fire the delegate** — pending promises must be
  resolved manually in the native external-pause handler and `stopAudio`.
- **Post-segment audio session handoff**: TTS playback puts the session in
  `mixWithOthers`; without `releaseAudioSession`, MusicKit's `play()` resolves but
  no audio plays (no state transition events either). The fix is always call
  `releaseAudioSession` in `BroadcastPlayer.runSegmentAt`'s finally block.
- **MusicKit `objectWillChange` must be throttled** to 1/sec in `startObserving()` —
  unthrottled observation causes 96% background CPU usage.
- **Native 0.5s playback timer pauses when backgrounded** via
  `didEnterBackgroundNotification` observer.
- **Native cache self-hydration on `play()`**: required for featured broadcasts where
  `fetchPlaylistTracks` was never called. Uses `MusicCatalogResourceRequest<Song>`
  matching `\.id`. Takes ~300-500ms first time; cached after.

### Broadcast pipeline
- **Gemini free tier quota**: 20 requests/minute. A 9-song standard broadcast under
  sparse cadence = 1 sequencer + 6 segment calls = 7 LLM calls, so two bakes in a
  minute still comes in at 14 — under the cap but tight. Long broadcasts (15 songs
  = 9 segments) run 10 LLM calls each; two back-to-back longs will 429.
- **`generationLimiter` would apply globally without path scoping**. `app.use(mw, router)`
  without a path prefix runs the middleware on every request, not just the router's
  routes. Fix is the `skip` filter in the limiter config.
- **Pause must not trigger the next transition**. `waitForTrackEnd`'s status poll only
  advances on `stopped`; `paused` is explicitly excluded.
- **Featured `publish` endpoint shares the generation rate limit with user bakes.**
  No per-curator budget cap yet. A runaway curator account could exhaust the quota.
- **BroadcastStore TTL is lazy-only** — entries evict on `get()` but never proactively.
  Long-running server accumulates expired broadcasts until accessed.
- **Featured manifest payload is full** — `GET /broadcast/featured` returns every
  broadcast's complete manifest including all `audioUrls`. Doesn't scale past ~10
  featured broadcasts.

### Client player
- **`listener` and `runTrackAt` must be wrapped in try/catch.** `runTrackAt` catches
  `music.play` rejections and returns early instead of stalling the broadcast.
- **`waitForTrackEnd` safety timeout** is `duration + 30s`. If MusicKit never
  transitions to `playing`, the loop exits rather than hanging forever.
- **`BroadcastPlayer.singleton.ts` is separate from the class** so tests can import the
  pure class without pulling Firebase / native module dependencies.
- **Persisted manifest is cleared on `end()`** so resume doesn't offer a finished
  session.
- **`BroadcastResumer.check()` now verifies freshness.** As of 2026-04-20 it
  pings `/broadcast/:id/manifest` before returning the cached manifest; 404
  clears the persisted record and returns null (no misleading "Resume?" prompt).
  Non-404 errors (network/timeout) keep the cached manifest — don't want to
  destroy a legit resume on a flaky connection.
- **Earlier Tonight list verifies on focus.** `HomeBroadcastScreen` `useFocusEffect`
  renders the cached `BROADCAST_HISTORY` immediately, then hits
  `/broadcast/:id/manifest` for each entry in parallel and prunes 404s via
  `removeBroadcastFromHistory()`. Playback tap also re-verifies (handles tap-
  during-verify race).

### Build / deployment
- **Xcode team ID drift**: project file sometimes shows `5MQ5ZR66YN` instead of
  `8F2VWCN5KF`. Fix in Xcode GUI with automatic signing enabled.
- **Sentry source-map upload fails** without org config — always build with
  `SENTRY_DISABLE_AUTO_UPLOAD=true`.
- **iOS platform SDK** must match the device's iOS version. New iOS releases require
  Xcode > Settings > Platforms download (~8GB) before `expo run:ios --device` works.
- **`react-native-feed-media-audio-player` (adaptr)** was experimented with and removed.
  Any references in stashed git state should be discarded.
- **Stale `cleo/` top-level directory** (nested parallel copy of the whole repo) exists
  at the project root from an old rsync. Dead weight; safe to delete.

### Prompt injection
- **Track metadata is user-supplied and flows into LLM prompts.** `title`, `artistName`,
  `albumTitle` capped at 200 chars by Zod. `SegmentScriptBuilder.sanitizeForPrompt`
  strips control chars, newlines, role-hijack markers (`system:`, `assistant:`,
  `user:`), triple-backticks, and truncates to 120 chars per span.

### Deprecated / stripped (legacy warnings)
- The old live-generation engines (`QueueManager`, `SessionEngine`,
  `TransitionPreloader`, `SegmentController`, `AudioCoordinator`, `QueuePlanner`,
  `LocalQueuePlanner`, `RulesEngine`), services (`CleoScriptGenerator`,
  `CleoVoiceEngine`, `SessionMemory`), and prompt library (`src/cleo/*`) have all
  been deleted. Features that referenced them (Session Arc tab, Archive tab, old home
  screen, old player, "Take It Live" via queueManager) are gone or rewired.
- Native Swift `playEjectTransition`, `cancelEjectTransition`, `onEjectTrackChanged`
  are still compiled in but unreferenced from TS. Candidate for a native cleanup pass.
- `SequenceCache` kept temporarily behind `SEQUENCER_MODE=llm` (used only by
  `LLMTrackSequencer`); slated for deletion after the 2-week rollout soak
  together with `LLMTrackSequencer` itself.
- `LLMTrackSequencer` (formerly `TrackSequencer`) kept behind `SEQUENCER_MODE=llm`
  for rollback; new bakes use `DeterministicTrackSequencer` by default.

---

## What's Left (not yet shipped)

- **Bake abort endpoint** — no `DELETE /broadcast/:id`. User canceling mid-bake still
  pays for all remaining LLM + TTS calls.
- **Scheduled/autonomous featured bakes** (cron "Monday Reset" etc.) — requires server
  Apple Music developer token setup.
- **Native Swift cleanup** — eject code and `beginTTSBackgroundTask` / `silencePlayer`
  leftovers.
- **Rollback Fastify decommission** — `pm2 delete cleo-api` after the new server
  proves stable on TestFlight for ~1 week.
- **R2 presign TTL tightening** — currently 7 days; could be tightened to match the
  `BroadcastStore` 2h TTL to reduce blast radius if a manifest ever leaks.

---

## Full Documentation

Spec: `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md`
Curation spec (2026-04-16): `docs/superpowers/specs/2026-04-16-curation-design.md`
Segment cadence spec (2026-04-20): `docs/superpowers/specs/2026-04-20-segment-cadence-design.md`
Plans: `docs/superpowers/plans/2026-04-12-pre-baked-broadcast-plan-{1..4}-*.md`
Curation plan: `docs/superpowers/plans/2026-04-16-curation-implementation.md`
Segment cadence plan: `docs/superpowers/plans/2026-04-20-segment-cadence.md`
**TTS tuning log (2026-04-20): `docs/f5-tts-tuning-log.md`** — living record of
F5 parameter tuning, reference audio changes, CosyVoice3 integration, and the
A/B listening rounds that locked in the current voice recipe. Includes rollback
one-liners and all backup filenames for safe revert.
Legacy PRD: `cleo-prd.md` at repo root — predates the pre-baked pivot; reference only
for vibe/fallback library content that still informs `SegmentScriptBuilder`.

---

## Self-hosted TTS infrastructure (Linux box at 192.168.8.229)

Separate from the Hostinger VPS. Hosts both F5 and CosyVoice3.

- **SSH:** `ssh kari@192.168.8.229` — AMD 6700XT GPU via ROCm 6.2
- **F5-TTS wrapper:** `~/f5tts-server/` — systemd unit `f5tts`, port 8000,
  managed service. Patched 2026-04-20 with leading-silence trim and `/cosy/*`
  reverse-proxy endpoints.
- **CosyVoice3 wrapper:** `~/cosyvoice-server/` — currently runs via `nohup`
  uvicorn on port 8001; systemd unit staged at `~/cosyvoice-server/cosyvoice.service`
  but not installed (needs sudo: `sudo cp ... && sudo systemctl enable --now`).
  Restarts are manual until the unit is installed.
- **Shared reference:** `~/f5tts-server/refs/onay-cartesia.wav` + `.txt` is the
  canonical voice. CosyVoice symlinks it from `~/cosyvoice-server/refs/`.
  Audio is 9.56s (cropped 2026-04-20 to remove self-introduction — reference no
  longer says "Oh-nay").
- **Pangolin tunnel:** `f5tts.worthymedia.online` → port 8000 on this host.
  CosyVoice reached via `f5tts.worthymedia.online/cosy/*` proxy rather than a
  second tunnel rule.
- **ROCm quirk:** both services need `HSA_OVERRIDE_GFX_VERSION=10.3.0` set
  (the 6700XT reports as gfx1031 but ROCm wheels were built for gfx1030).
- **MIOpen tuner cache:** `~/.cache/miopen/` persists kernel selections across
  restarts. CosyVoice wrapper runs a 3-shape startup warmup to prime the cache
  before serving real traffic.

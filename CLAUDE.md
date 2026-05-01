# CLAUDE.md — ONAY AI Radio App

## Current Status
**Phase 2 of 6 — Parity Sprint** (weeks 4–9, 2026-04-25 → 2026-06-26): "ONAY does everything Yoodio/Radiant do that genuinely matters."
- Roadmap source of truth: [`docs/superpowers/specs/2026-04-24-onay-roadmap-design.md`](docs/superpowers/specs/2026-04-24-onay-roadmap-design.md)
- Active milestone: `Phase 2: Parity Sprint` (issues #33–#38 on bworthy89/cleo)
- Phase 1 closed 2026-04-25, gate GREEN (sequencer meanDistance 0.019–0.061 across all 7 vibes)
- Next decision gate: D1 → D7 retention measurably improved after Phase 2 ships (#38; observational, ≥14 days of post-ship data needed)

## Project Overview
React Native / Expo SDK 55 iOS app. AI radio host named **ONAY** (pronounced "Oh-Nay"). The
product model is a **pre-baked broadcast episode**: user picks a playlist + vibe + length,
the server generates the entire broadcast (track order + host commentary audio) before
playback begins, and the client plays the locked episode beginning to end — no skips, no
live reactions. This replaces the prior live-generation model, which failed the iOS
48s/60s background CPU budget when LLM + TTS ran between tracks.

Production: Express broadcast server at `api.worthymedia.tech`. Deploy runbook:
`server/DEPLOY.md`.

---

## Tech Stack

### Mobile
- React Native 0.83 + Expo SDK 55, TypeScript strict mode
- Custom `expo-music-kit` native module — wraps Apple MusicKit (auth, playlists, playback,
  track detection, catalog search, catalog lookup by ID, audio session control, TTS
  playback via AVAudioPlayer). `fetchPlaylists()` returns playlists sorted by Apple's
  `lastPlayedDate` (most-recent first) — used for first-listen onboarding personalization.
- `react-native-mmkv` — local storage (persisted manifest, user profile, host volume)
- `expo-blur`, `expo-linear-gradient`, `expo-haptics` — UI primitives
- `@expo-google-fonts` — Playfair Display, Inter, EB Garamond, DM Mono

### AI & Voice (server-side only)
- **LLM:** Gemini 2.5 Flash. Ollama disabled in prod — `OLLAMA_BASE_URL` unset
  means the provider fails to construct and Gemini is promoted.
- **TTS chain:** `TTS_PRIMARY=voxcpm` → `TTS_FALLBACK=cartesia` → ElevenLabs → Orpheus.
  `TTS_FALLBACK` lets the self-hosted primary skip ahead to a chosen paid API instead
  of relying on the default ordering.
- **VoxCPM2** (primary) runs on the Linux box (192.168.8.229) on port 8003, exposed via
  Pangolin at `voxnano.worthymedia.online`. F5-TTS and CosyVoice were retired
  2026-04-27 after VoxCPM landed cleaner audio + a workable latency profile (see
  tuning log Change #10).
- **Filesystem TTS cache** at `~/.cache/cleo-tts` (override via `TTS_CACHE_DIR`) dedupes
  identical text across bakes. Must be cleared whenever TTS settings, reference audio,
  or transcript change — stale audio gets served indefinitely otherwise.
- **Pronunciation dict** at `server/src/providers/tts/pronunciations.json` (146 entries).
  Applied in `preprocessForTTS`. All entries are hyphen-free — see the "never add hyphens"
  rule under Conventions.

### Backend
- **Local dev:** Node.js + Express (`server/`) on port 3001. Jest + ts-jest suite.
  `STORAGE_BACKEND` unset → `LocalFilesystemStorage` under `server/.broadcast-cache/`;
  segments served via `/broadcast-asset/*`.
- **Production:** Express at `api.worthymedia.tech` (Hostinger VPS, port 3102 behind
  Caddy, PM2 app `cleo-broadcast`). `STORAGE_BACKEND=r2` → Cloudflare R2 bucket
  `cleo-broadcast-segments`; segment URLs are 7-day presigned links in the manifest.
- **Staging:** Express at `staging.api.worthymedia.tech` (same VPS, port 3103 behind
  Caddy, PM2 app `cleo-broadcast-staging`, git clone at `/home/cleo/cleo-broadcast-staging`,
  tracks `main` branch). Same Firebase project, same Sentry, separate R2 bucket
  `cleo-broadcast-segments-staging`, `CURATOR_PUBLISH_CAP=20` (vs prod's 3). Used as
  pre-prod validation gate AND as the always-on dev backend that local-device installs
  point at. Design + plan: [`docs/superpowers/specs/2026-05-01-staging-server-design.md`](docs/superpowers/specs/2026-05-01-staging-server-design.md).
- Firebase JWT auth (`requireAuth`) gates all routes. Ownership gate on
  `GET /broadcast/:id/manifest` + `/broadcast-asset/*` — both 404 unless
  `manifest.userId === req.uid` or `manifest.userId === 'curator'`.
- Curator publish route (`POST /broadcast/featured/publish`) gated by `requireCurator`
  against `CURATOR_EMAILS` allowlist.

---

## Project Structure

```
cleo-app/
├── CLAUDE.md
├── app.json
├── app/
│   ├── _layout.tsx
│   ├── index.tsx                ← auth routing gateway
│   ├── (auth)/login.tsx
│   ├── (onboarding)/            ← welcome → music-auth → first-listen → /(main)
│   │                                └─ first-listen skipped on returning users
│   │                                   (gated on hasAnyBroadcastHistory())
│   └── (main)/
│       ├── _layout.tsx          ← 2-tab CustomTabBar (Broadcast + ONAY)
│       ├── (broadcast)/
│       │   ├── index.tsx        ← HomeBroadcastScreen entry
│       │   ├── player.tsx       ← Now Playing
│       │   └── ask-onay.tsx     ← Ask ONAY curation chat
│       └── (cleo)/index.tsx     ← ProfileScreen (settings)
├── docs/superpowers/            ← specs + plans
├── modules/expo-music-kit/
│   ├── index.ts
│   └── ios/ExpoMusicKitModule.swift
├── server/
│   ├── .env                     ← gitignored
│   ├── featured-broadcasts/
│   ├── .broadcast-cache/        ← gitignored
│   ├── __tests__/
│   └── src/
│       ├── index.ts             ← Express app, path-scoped rate limiter
│       ├── middleware/          ← auth.ts (requireAuth + requireCurator), validate.ts
│       ├── providers/
│       │   ├── llm/             ← Gemini, Ollama
│       │   └── tts/             ← VoxCPM / Cartesia / ElevenLabs / Orpheus / Chatterbox
│       ├── routes/              ← broadcast, featured, segment, voice, enrichment,
│       │                          musicbrainz, curation
│       ├── services/
│       │   ├── broadcast/       ← ManifestBuilder, SegmentScriptBuilder,
│       │   │                      SegmentGenerator, BroadcastStore,
│       │   │                      BroadcastOrchestrator, FeaturedBroadcastRegistry,
│       │   │                      bakeFeatured, DeterministicTrackSequencer,
│       │   │                      vibe-curves, vibe-arcs
│       │   └── storage/ObjectStorage.ts
│       └── scripts/bake-featured.ts
├── src/
│   ├── config/curators.ts       ← client-side curator allowlist (UI only)
│   ├── hooks/useAppActive.ts
│   ├── tokens/design-tokens.ts
│   ├── engines/
│   │   ├── BroadcastPlayer.ts           ← pure state-machine class
│   │   ├── BroadcastPlayer.singleton.ts ← wires real deps (kept separate for tests)
│   │   ├── BroadcastPlayer.types.ts
│   │   ├── BroadcastSegmentCache.ts
│   │   ├── BroadcastManifestClient.ts
│   │   ├── BroadcastCurationClient.ts
│   │   ├── BroadcastResumer.ts
│   │   ├── BroadcastStingers.ts         ← stubbed
│   │   └── PlaylistCurator.ts
│   ├── services/
│   │   ├── api.ts                       ← API_BASE_URL + authenticatedFetch
│   │   ├── AuthService.ts
│   │   ├── MusicKitPlayer.ts
│   │   ├── Storage.ts                   ← MMKV helpers
│   │   └── TrackEnrichmentService.ts
│   ├── screens/
│   │   ├── home/HomeBroadcastScreen.tsx
│   │   ├── curate/AskOnayScreen.tsx
│   │   ├── onboarding/CleoOnboarding.tsx
│   │   └── settings/ProfileScreen.tsx
│   └── components/
│       ├── AppHeader.tsx, TabBar.tsx
│       ├── AmberCTA.tsx, BroadcastBackdrop.tsx, Grain.tsx
│       ├── HairlineRow.tsx, NowPlayingBar.tsx, OnAirIndicator.tsx
│       ├── OfflineBanner.tsx, ErrorBoundary.tsx
│       ├── crate/               ← shared Crate Digger chrome:
│       │                          Tick, StampButton, SectionMarker, CatalogRow,
│       │                          LinerNotes, SleeveArt, SpinningRecord, Halftone,
│       │                          VUMeter, StatusStrip, SettingsCog
│       └── broadcast/           ← FeaturedBroadcastCard, FeaturedRailCard,
│                                   SetupSheet, SettingsDrawer, TuningInOverlay,
│                                   SlotPlaceholderCard, PublishFeaturedSheet
```

---

## UI Design System — "Crate Digger" (late-night record-shop)

Evolved from the earlier "Sonic Ether Gold" → "Analog Midnight" → "Crate Digger"
overhaul (commit `7d96f3be`). All tokens in `src/tokens/design-tokens.ts`. No inline
styles — everything flows from tokens. Rule still stands: components use `AM` /
`Fonts` / `TypeScale` / `Space` directly. Legacy aliases (`Colors`, `Typography`,
`Surface`, `Spacing`, `TextColors`, `Radius`) are `@deprecated` shims that remap to
`AM` — fine for unmigrated surfaces, don't use in new code.

- **Palette (`AM`):**
  - `bg: #0B0907`, `bgDeep: #050403` — warm black base (not pure black)
  - `ink: #F4ECDC` (cream) + `inkMid / inkDim / inkGhost` at 0.80 / 0.58 / 0.20
  - `amber: #E8A24B` + `amberDim / amberFaint` — secondary signal accent
  - `oxblood: #A43A2E` + `oxbloodDim` — primary editorial stamp (record-label red)
  - `cream: #F4ECDC` / `paper: #F2E7CF` / `paperInk: #2A1510` — inverted surfaces
    (library-card plate etc.)
  - `rule / ruleStrong` — 26% / 50% cream hairlines
- **Typography roles (`Fonts`):**
  - Display — **Anton** (condensed poster face). Screen titles, section headers,
    CTA labels, big numerals. UPPERCASE with `letterSpacing` 0.5–2. Anton's
    cap-height clips tight line-boxes on iOS; always set `lineHeight ≈ 1.2× fontSize`.
  - Liner-notes voice — **Fraunces italic** (400 and 300 Light). ONAY's spoken
    captions, soft-editorial copy, sheet titles.
  - Mono — **JetBrains Mono** (400 + 500). ALL-CAPS labels, catalog numbers,
    metadata, timestamps, buttons' sub-labels, kickers. Wide tracking.
- **Scales:** `TypeScale` (s8–s76), `Space` (s2–s72), `Radius` (mostly 0 — primary
  surfaces are sharp-cornered). `AMGlow` for amber/oxblood shadows, `AMBloom`
  for the radial amber gradient, `Halftone` + `GrainOpacity = 0.06` for the
  film-grain + dot-pattern overlays.
- **Shared chrome components (`src/components/crate/`):**
  - `Tick` — corner-mark for stamp-plate framing (4 corners on a `StampButton`)
  - `StampButton` — primary CTA. Outlined rectangle + 4 corner Ticks + Anton label +
    mono sub-label + arrow. Two kinds: `amber` (default) / `oxblood`. The filled
    "DROP THE NEEDLE" play strip is a bespoke variant, not a StampButton.
  - `SectionMarker` — numbered catalog-style section header. `num` prop (e.g.
    `"B·01"`) in amber-dim mono + Anton title + hairline rule + right-side mono
    label. This is the ONLY way to title a section — do not reintroduce the old
    "small-caps amber label + 2×40 gold bar" pattern.
  - `CatalogRow` — tappable row item in catalog style
  - `LinerNotes` — Fraunces-italic block for ONAY's voice
  - `SleeveArt` / `SpinningRecord` — album-art + rotating vinyl treatments
  - `Halftone` — dot-pattern overlay (inline SVG data-URI from `HALFTONE_SVG`),
    typically laid under oxblood plates for editorial grit
  - `VUMeter`, `StatusStrip`, `SettingsCog`
- **Backdrop chrome:** `BroadcastBackdrop` stacks warm-black `bg` + `AMBloom`
  radial amber + `Grain` noise at 0.06. Most screens sit on top of this — do
  not paint a solid background that covers it.
- **Vibes.** Per-vibe accents were deleted in commit `d7193096` ("delete vibe
  color system, unify on amber"). Every vibe surface uses amber now. Do NOT
  reintroduce `Colors.vibe.*` or `getVibeAccent()`. Taxonomy shrank 12 → 7 vibes
  in commit `9804f997`.
- **Press feedback** — `Pressable` with `style={({ pressed }) => ...}` returning
  `opacity: 0.8` for stamp/outlined CTAs, `0.6-0.7` for ghost/text. Haptics on
  every tap via `expo-haptics`.
- **Animations** must respect `useAppActive()` — loops pause when backgrounded.

---

## The Pre-Baked Broadcast Pipeline

### Client flow — user-sourced broadcast
1. User taps "Build your broadcast" → `SetupSheet` opens
2. 3 steps: playlist → vibe → length (quick/standard/long)
3. Client calls `musicKitPlayer.fetchPlaylistTracks(playlistId)`
4. Tracks run through `sanitizeTracksForBake` (drop 0-duration / empty-title / bad-URL
   tracks; clamp overlong strings). If <5 playable tracks remain, surface a clear
   "need at least 5" error instead of letting the server return an opaque 400.
5. Client `POST /broadcast/create` with `{ playlistId, vibe, length, userContext, tracks }`.
   `userContext` optionally includes `weatherCoords` (from Profile's weather-enabled setting);
   if provided, the server fetches a brief weather hint and injects it into the cold_open
   prompt's scene block.
6. Server responds as soon as slot 0 audio is baked (~3-5s VoxCPM warm cache)
   with `{ manifest, firstSegmentUrls }`. Enrichment drain runs in parallel and
   gates slots 1..N, not the response — cold open works on empty enrichment.
   Slots 1..N are `pending`; client polls for them.
7. Client navigates to `/player`, starts `broadcastPlayer.start(manifest, firstSegmentUrls)`.
   `TuningInCanvas` shows while cold open is fetched.
8. **Sparse-cadence main loop**: iterate `manifest.segmentSlots` in order, advancing
   `nextSegmentIdx` only when a slot targets the upcoming track. For 5 tracks:
   `cold_open → t0 → t1 → trans(→t2) → t2 → t3 → trans(→t4) → t4 → sign_off`. Tracks
   without a matching segment play back-to-back. Segments: `playAudioFromBase64` (duck
   MusicKit → play TTS → release session). Tracks: `musicKitPlayer.play([trackId])`.
9. Between segment and next track, call `releaseAudioSession` so MusicKit can reclaim
   exclusive session control.
10. `schedulePolling()` fires every 3s while any slot is `pending`, GETting the manifest
    and triggering `kickBackgroundFetch` for newly-ready audio URLs. Stops when every
    slot is non-pending.
11. `waitForTrackEnd` watches `getPlaybackStatus()` + `getPlaybackTime()` once per second
    (plus the 0.5s `onPlaybackStateChanged` event). Ends when
    `playbackTime >= duration - 0.5` OR `status === 'stopped'` — but only after
    `status === 'playing'` has been seen at least once (gates out pre-playback flicker).
    `paused` is explicitly excluded so user pauses don't advance.

### Server flow — BroadcastOrchestrator
```text
create(input):
  1. Sequence tracks via DeterministicTrackSequencer (or LLMTrackSequencer if
     SEQUENCER_MODE=llm).
  2. ManifestBuilder.buildManifest — sparse cadence: cold_open + transitions before
     tracks at even indices (2, 4, 6, …) + sign_off. Tier alternation fact_bridge →
     tight_bridge starting with fact_bridge; featureSlots overrides to deep_dive.
  3. In parallel: kick drainNow (Genius + MB + Wiki + LastFm per track, serialized
     per-API at 1.1s) and generateSlot(0). Slot 0 is cold_open and works with empty
     enrichment.
  4. await slot0P only — response is gated on slot 0 audio, NOT on the drain.
     The drain serves slots 1..N, not slot 0; blocking the response on it
     would serialize ~10-20s of cold-cache fan-out into tune-in for no reason.
  5. Fire-and-forget drainP.then(() => generateSlotsBackground(1..N)) with a
     4-worker pool (SEGMENT_CONCURRENCY=4). The drainP.then chain preserves
     the contract that EnrichmentCache is populated before slots 1..N run.
     Promise stored in inFlight; deleted via .finally().
  6. Return { manifest [slot 0 ready, 1..N pending], firstSegmentUrls }.

waitForCompletion(id) awaits the inFlight promise (bakeFeatured, featured publish
route, tests). isInFlight(id) checks the map.
```

### Curation sequencer (`DeterministicTrackSequencer`)

- Each track carries `AudioFeatures` (`tempo/energy/valence/danceability/
  acousticness/loudness/instrumentalness`). `FeatureFetchChain` ladder:
  ReccoBeats (ISRC) → Deezer (BPM+loudness) → Last.fm tags + genre synth →
  genre defaults → neutrals. Populated in `BackgroundEnricher.drainNow`, persisted
  in `EnrichmentCache`.
- Vibe curves at `server/src/services/broadcast/vibe-curves.ts` — 4 keyframes
  (0.0/0.33/0.67/1.0) × 7 vibes × 7 features + per-feature weights.
- Per slot: interpolate target vector at `i/(N-1)`, score remaining tracks by weighted
  L2 + adjacency penalty (+0.15 same artist, +0.30 same album), pick from top-K
  (K=2 quick, K=3 standard/long) via `mulberry32` PRNG seeded on `broadcastId`.
- Deterministic within a bake; varies across bakes. Fallback ladder guarantees every
  track has a complete feature vector — no silent `pool.slice` fallback.
- `nominateDeepDives` ranks transitions by incoming-track enrichment richness and caps
  picks at `ceil((N-1)/4)`.
- Deterministic by default; LLM path retained behind `SEQUENCER_MODE=llm` until
  soak ends.

Telemetry per bake: `[Sequencer] source=deterministic vibe=X N=Y poolSize=Z ...
meanDistance=0.XX features: reccobeats=n synthesized=m defaults=k`. Poor-fit warning
fires at meanDistance > 0.7.

### Featured (editorial) flow
- `bakeFeatured(config)` reads `{ id, title, description, vibe, length, tracks[] }`
  with real Apple Music IDs, runs through `BroadcastOrchestrator.create(userId:
  'curator')`, waits for completion, persists to `FeaturedBroadcastRegistry`.
- In-app: curators hit `POST /broadcast/featured/publish` via Ask ONAY → LLM curates,
  client resolves via `searchCatalog`, server bakes + registers.
- Home fetches `GET /broadcast/featured` and renders `FeaturedBroadcastCard`s.

### Profile — weather context
- **ProfileScreen** gains an opt-in "Weather context" toggle + city input field.
- City resolves via `POST /weather/geocode` (OpenWeatherMap free tier, server-side); resolves
  to `{ lat, lon }` and persists to MMKV as `{ enabled, coords, resolvedLabel }`.
- When enabled, `POST /broadcast/create` includes `userContext.weatherCoords` as
  `{ lat, lon, cityName }` — the server uses `cityName` verbatim in the hint sentence
  rather than re-resolving it. Server fetches the hint from OWM's `/weather` endpoint
  and injects it into the cold_open segment prompt's scene-setting block. When
  `OPENWEATHER_API_KEY` is unset the `WeatherProvider` is never instantiated and
  `/weather/geocode` is not mounted — the feature silently degrades (UI toggle remains
  visible but a city lookup will hit a 404).

### Caches
- `server/.broadcast-cache/broadcast/<id>/segment/<slot>/v<v>.mp3` — indefinite, gitignored.
- `server/.enrichment-cache/tracks.json` — `EnrichmentCache`, keyed on normalized
  `title|artist` (strips `(feat. X)` / `(Remastered YYYY)` / `- Deluxe`). Atomic
  tmp+rename, malformed-JSON tolerant, 30-day re-enrichment threshold.
- `SequenceCache` — LLM path only. In-memory LRU, 24h TTL, 500 entries. Keyed on
  `sha256(sortedTrackIds)|vibe|length`.
- `server/featured-broadcasts/registry.json` — gitignored, atomic write.
- `BroadcastStore` — in-memory, 24h TTL, lazy eviction.
- Client `BroadcastSegmentCache` — in-memory base64, cleared on `start`/`end`.
- MMKV `CURRENT_BROADCAST` — persisted manifest for 24h resume window via
  `BroadcastResumer`.

### Personal Last.fm scrobble (#37)

Distinct from the server-side `LastFmFetcher` enrichment use. Per-user OAuth
flow on `ProfileScreen` (CONNECT button → in-app Safari → `cleo://lastfm-callback`).
Session keys persisted to Firestore `users/{uid}/integrations/lastfm`; the
client never sees the sessionKey after OAuth.

Client emission (`src/engines/Scrobbler.ts`):
- `onTrackStarted(track)` after `music.play` resolves → `POST /lastfm/now-playing`
- `onElapsedTick(track, elapsed)` from the 1Hz pump fires `POST /lastfm/scrobble`
  the moment elapsed crosses `min(0.5 × duration, 240s)`. Tracks <30s never
  scrobble. Threshold-on-tick (not at-track-end) so app-kill mid-track still
  scrobbles.

Server signs requests via `LastFmClient` and POSTs to
`ws.audioscrobbler.com/2.0`. On Last.fm error code 4 or 9 (sticky auth
revocation), server flips `users/{uid}/integrations/lastfm.needsReconnect = true`
and the row swaps to "RECONNECT" via the Firestore subscription.

Best-effort, online-only — no offline queue. Adding `firebase-admin` for
server-side Firestore writes was a hard prereq.

### Native audio session discipline
- `activateDuckingSession` — `.playback + .mixWithOthers + .duckOthers`, setActive(true)
- `deactivateDuckingSession` — removes `.duckOthers` but keeps `.mixWithOthers`
- `releaseAudioSession` — plain `.playback`, setActive(false). Essential between a
  segment and the next track.
- Never `setActive(false)` while AVAudioPlayer is playing — kills the TTS.

---

## Build Environment

- **Working directory**: `/Users/kari/Documents/cleo-app/`.
- **Dev server**: `cd server && npm run dev` on port 3001.
- **LAN setup**: set `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3001` in project root `.env`
  and `BROADCAST_ASSET_BASE_URL=http://<LAN-IP>:3001` in `server/.env`.
- **Bare workflow — `ios/` is tracked in git.** Committed in build-59 cleanup after
  discovering that EAS cloud builds never received the `ONAYWidgets` target (Live
  Activities) because the directory had been blanket-ignored. Excludes
  `ios/Pods/`, `ios/build/`, `ios/**/xcuserdata/`, `*.xcuserstate`, and
  `ios/.xcode.env.local` (user-specific NODE_BINARY path).
- **Local-device install**: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`.
  Auto-managed signing, team `8F2VWCN5KF`. iOS platform SDK must match device iOS.
- **Mobile testing against staging**: create `.env.local` at project root with
  `EXPO_PUBLIC_API_URL=https://staging.api.worthymedia.tech`, then run the local-device
  install command above. `EXPO_PUBLIC_*` vars MUST be in `.env`/`.env.local` files —
  Expo SDK 55 does NOT honor them from shell env at build time. The binary then targets
  staging from anywhere (LAN-independent). Delete `.env.local` to revert to prod URL
  from `.env` on the next install. Same bundle ID means this overwrites a TestFlight
  install (and vice versa); only one at a time.
- **TestFlight submission (EAS)**:
  1. Bump versions atomically: `npm run bump:build` (default = build number only,
     for TestFlight iteration) or `npm run bump:build -- --release patch|minor|major`
     (when adding native deps; bumps `expo.version` + `expo.runtimeVersion` in
     `app.json` AND `EXUpdatesRuntimeVersion` in `Expo.plist` in lockstep with the
     build number). Five sources stay in sync: pbxproj×4 + app.json buildNumber +
     app.json version + app.json runtimeVersion + Expo.plist EXUpdatesRuntimeVersion.
     Pre-flight validation refuses to run if any are out of sync (`--force` overrides).
     Never edit them by hand — bare workflow can't use auto-bump policies (see OTA
     section below), so the script is the only safe atomic operation.
  2. `eas build --profile production --platform ios [--non-interactive]` —
     first time per new target needs interactive mode so EAS can provision the
     Apple App ID for the widget extension (`com.worthymedia.cleo.ONAYWidgets`);
     subsequent builds can use `--non-interactive`.
  3. `eas submit --profile production --platform ios --latest` — uploads the
     .ipa to App Store Connect (ASC app ID `6760923768`, team `8F2VWCN5KF`).
- **OTA push (JS-only changes)**: `npm run update:prod -- --message "..."` (full
  rollout) or `npm run update:prod:safe -- --message "..."` (25% rollout). Both go
  through `scripts/guard-update.mjs` which compares working tree `expo.runtimeVersion`
  against the runtimeVersion of the latest finished production EAS build — refuses
  the push if they differ (means you've made native-bumping changes since last build
  and an OTA would crash old binaries). `update:prod:noguard` exists as the
  emergency escape hatch but should almost never be needed. `--platform ios` is
  baked into all three scripts; without it `eas update` defaults to `--platform all`
  and tries to export web (which we don't have wired). Bare workflow forces literal
  `runtimeVersion` in app.json — no `policy: "fingerprint"` or `policy: "appVersion"`
  (EAS errors out). The bump script enforces the lockstep that policy objects would
  have automated.
- **OTA rollback**: `eas update:list --branch production --platform ios` to find
  the previous group ID, then `eas update:republish --group <prev-id> --platform ios`
  (do NOT pass `--branch` — EAS rejects the combo). Republished group becomes the
  new latest; testers get it on next cold-launch (or sooner via the foreground hook
  in `app/_layout.tsx`, which only reloads when no broadcast is playing so it never
  interrupts audio).
- **Icon + splash sync**: after editing `assets/icon.png` directly run
  `npm run icons:sync` to copy the PNG into `ios/ONAY/Images.xcassets` slots.
  After editing `scripts/icons/master.html` run `npm run icons` for the full
  puppeteer render + sync. Skipping this ships stale artwork — the asset catalog
  is the source of truth for bare-workflow builds; `app.json` `expo.icon` is
  only consulted by `expo prebuild`, which no longer runs in EAS.
- **Team ID drift**: project file sometimes shows `5MQ5ZR66YN` — fix in Xcode >
  target > Signing & Capabilities.
- **iOS deployment target**: 16.2 (MusicLibraryRequest requirement + Live
  Activities + iOS 16.2-gated APIs in ONAYWidgets).
- **Scheduled remote checks**: weekly OTA pipeline health check runs every
  Monday 9am EDT (`trig_01EFnDkAktM8Z8DENByshKTZ`,
  https://claude.ai/code/routines/trig_01EFnDkAktM8Z8DENByshKTZ). Read-only;
  validates the bump-script lockstep, looks for native-bumping commits since
  the last `runtimeVersion` bump, verifies guard + scripts + eas.json config,
  reports Sentry source-map status. Output is a single Status / Findings /
  Recommended-actions markdown report in the routine dashboard. To add new
  routines, see `https://claude.ai/code/routines`.

---

## Environment Variables

`server/.env` (gitignored):
```env
GEMINI_API_KEY
CARTESIA_API_KEY, CARTESIA_VOICE_ID, CARTESIA_MODEL_ID, CARTESIA_PRONUNCIATION_DICT_ID
ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_PRONUNCIATION_DICT_ID/_VERSION
OLLAMA_BASE_URL, OLLAMA_MODEL             # leave unset in prod
ORPHEUS_BASE_URL, ORPHEUS_VOICE, ORPHEUS_MAX_TOKENS
GENIUS_ACCESS_TOKEN
LASTFM_API_KEY                            # NOTE: also used by enrichment LastFmFetcher;
LASTFM_API_SECRET                         # required for /lastfm/scrobble personal flow
GOOGLE_APPLICATION_CREDENTIALS            # path to firebase-admin service-account JSON
HEALTH_CHECK_INTERVAL_MS, HEALTH_CHECK_TIMEOUT_MS
BROADCAST_ASSET_BASE_URL                  # dev: http://<LAN-IP>:3001
CURATOR_EMAILS                            # comma-separated
CURATOR_PUBLISH_CAP                       # default 3 (per-curator daily publish cap)
CURATOR_PUBLISH_WINDOW_MS                 # default 86400000 (24h rolling window)
ADMIN_BEARER_TOKEN                        # optional; ≥16 chars unlocks
                                          # X-Admin-Token header auth on /admin/*
OPENWEATHER_API_KEY                       # OpenWeatherMap free tier; unset → weather hints disabled

TTS_PRIMARY=voxcpm
TTS_FALLBACK=cartesia

SEQUENCER_MODE=deterministic              # or 'llm' for rollback

VOXCPM_BASE_URL=https://voxnano.worthymedia.online
VOXCPM_VOICE_REF=onay-cartesia-clean      # ZipEnhancer pre-cleaned reference
VOXCPM_STYLE_PREFIX=                       # empty under nano-vllm (no paren-style parser); stock VoxCPM2 used "(slow, measured pace, late-night radio)"
VOXCPM_INFERENCE_TIMESTEPS=10             # 4-30; lower = faster, less prosody
VOXCPM_CFG_VALUE=2.0                      # 1.0-3.0 guidance scale
VOXCPM_DENOISE=0                          # set 1 only if ref isn't pre-cleaned
VOXCPM_USE_PROMPT_MODE=1                  # ultimate-cloning mode (ref + prompt)
VOXCPM_TIMEOUT_MS=180000

# R2 (prod only; STORAGE_BACKEND=r2)
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
```

Tuning rationale for TTS params lives in `docs/f5-tts-tuning-log.md`.

Project root `.env`:
```env
EXPO_PUBLIC_API_URL           # dev: http://<LAN-IP>:3001; prod: https://api.worthymedia.tech
EXPO_PUBLIC_SENTRY_DSN
```

---

## Important Conventions

- **Workflow + Definition of Done — see [`DOD.md`](DOD.md).** One-branch-at-a-time rule, single-mode-session preference, and per-change-type DOD checklists (server / client JS / native iOS) live there. Check before declaring a change done.
- All components TypeScript strict mode; no inline styles (everything from `design-tokens.ts`).
- **All API calls go through `authenticatedFetch`** — attaches Firebase JWT, prepends
  `API_BASE_URL`. Always pass a relative path; passing a full URL creates a malformed
  `${API_BASE_URL}http://...` request.
- **`authenticatedFetch` throws on null token** — never silently sends unauthenticated
  requests. Callers handle the auth-not-ready state.
- **All server routes validated via Zod.** Length-cap client-supplied strings flowing
  into LLM prompts (`title`, `artistName`, `albumTitle` ≤ 200, URLs ≤ 2048). Sanitize
  prompt-injection markers in `SegmentScriptBuilder.sanitizeForPrompt` before interpolation.
- **Track metadata is user-supplied.** `sanitizeForPrompt` strips control chars,
  newlines, role-hijack markers (`system:`, `assistant:`, `user:`), triple-backticks,
  truncates to 120 chars per span. `TrackSequencer` enrichment hints (`genre`,
  `moodTags`, `producer`) from third-party APIs must go through `sanitizeHint` — mirror
  of `sanitizeForPrompt`. Never embed raw Genius/MB strings into prompts.
- **Rate limiter scoping**: `generationLimiter` in `server/src/index.ts` uses a `skip`
  filter keyed on path (`GENERATION_PATHS` regex). `app.use(mw, router)` without a path
  prefix would otherwise apply middleware to every request.
- **MMKV** for all local persistence — never AsyncStorage. Method is `storage.remove(key)`,
  not `storage.delete(key)`.
- **Last.fm session keys live in Firestore, never MMKV.** They're long-lived
  bearer tokens for a personal account. Server-only writes (Firestore rule
  `allow write: if false`); client subscribes via `useLastFmIntegration`.
- **`JSON.parse` on MMKV** must be try/catch-wrapped — `getObject` in Storage.ts handles
  this for typed callers.
- **`clearUserData` must preserve `StorageKeys.USER`** — removing it re-routes returning
  users through onboarding.
- **Pressable, not TouchableOpacity.** All interactive elements need `accessibilityLabel`
  + `accessibilityRole`.
- **`setTimeout` / `setInterval` in React components** must be stored in `useRef` and
  cleared on unmount / before next effect.
- **`Animated.loop` must pause when backgrounded** via `useAppActive()`. iOS background
  CPU budget is 48s per 60s window; 120Hz ProMotion loops blow it fast.
- **Native MusicKit listeners** wrapped in try/catch (`MusicKitPlayer.ensureSubscriptions`)
  so one throwing listener doesn't abort subsequent dispatches.
- **Native `play()` self-hydrates** — if `trackIds` aren't in `cachedSongs`, it issues
  `MusicCatalogResourceRequest<Song>` before queueing. This is what makes featured
  broadcasts (which never call `fetchPlaylistTracks`) playable.
- **`releaseAudioSession` must run between every segment and the next track.** Otherwise
  MusicKit can't reclaim exclusive session control and `music.play()` silently fails.
- **`BroadcastPlayer.pause()` parks the main loop via `waitIfPaused`.** Don't hard-stop
  in-flight segment TTS (AVAudioPlayer has no gapless pause). `resume()` wakes the
  parked loop; `end()` wakes it first so the loop exits cleanly.
- **`waitForTrackEnd` polls `getPlaybackStatus()` every 1s** and only advances on
  `stopped` (not `paused`). Polling is more reliable than events — events drop during
  Metro reconnects and when backgrounded.
- **MusicKit `objectWillChange` throttled to 1/sec** in `startObserving()` —
  unthrottled observation causes 96% background CPU.
- **Server `BroadcastOrchestrator.inFlight` map must delete on completion** via
  `.finally(() => inFlight.delete(id))` — otherwise grows unbounded.
- **Sparse segment cadence.** `ManifestBuilder` places transitions only before tracks
  at indices 2, 4, 6, …. Tracks between transitions play back-to-back. Tier alternation
  `fact_bridge` → `tight_bridge` starting with `fact_bridge`; `featureSlots` overrides
  to `deep_dive` and consumes an alternation step. Client uses the `nextSegmentIdx`
  dual-cursor walk that advances only on `beforeTrackId` match — don't regress to the
  old `i+1` lockstep.
- **Tier shapes live in `SegmentScriptBuilder.TIER_SHAPES`** — `cold_open` 35-50,
  `fact_bridge` 45-55, `tight_bridge` 30-40, `deep_dive` 80-120, `sign_off` 35-55 words.
  FACT DISCIPLINE rule: "Pick the single most interesting fact. Don't try to weave
  multiple."
- **Transition prompts are hybrid-editorial** — drop the `Outgoing: …` line; only
  reference the incoming track. Listener already heard the outgoing track without
  narration.
- **Client must run `sanitizeTracksForBake` before `POST /broadcast/create`** —
  helper in `src/engines/BroadcastManifestClient.ts`.
- **Track-based monotonic progress bar.** `BroadcastPlayer.computeProgress()` uses
  `(currentTrackIndex + 1) / (tracks + 1)` with last tick reserved for sign_off.
  Don't revert to the old "tracks + segments" denominator — under sparse cadence it
  produced 25-30% jumps.
- **Curator gate is two-layer**: client UI hides the button unless email is in
  `src/config/curators.ts`; server rejects with 403 via `requireCurator`. UI filter is
  UX-only; server is authoritative.
- **Tab group `_layout.tsx` required** — Expo Router throws "not handled by any
  navigator" without one.
- **Unicode escapes in JSX text**: `{'—'}` in a `{}` expression works; `—` in
  raw JSX children renders literally. Use literal characters (`—`, `…`, `·`) or wrap in
  braces.
- **Safe-area insets** required on all root screens.
- **Host voice is female.** `SegmentScriptBuilder.systemPrompt` explicitly sets ONAY as
  a woman using she/her pronouns and forbids masculine DJ phrasing ("your boy", "my
  man", "the homie", "this guy"). Don't remove these guards.
- **Host name phonetic substitution.** `preprocessForTTS` rewrites `\bONAY\b → Ohnay`
  (no hyphen) before TTS. Word-bounded so `BALONAY` / `ONAYS` aren't touched. The
  system prompt also says `(pronounced "Ohnay")` so Gemini writes the unhyphenated form.
  If the host is ever renamed, update the regex, system prompt hint, and reference
  transcript in lockstep.
- **Never add hyphens to phonetic substitutions in `pronunciations.json`.** Neural
  TTS treats `-` as a stress marker — `Bee-yon-say` reads as three emphatic syllables.
  Existing entries are all hyphen-free; don't re-add them.
- **`OllamaProvider` constructor throws when `OLLAMA_BASE_URL` is unset.** The factory
  catches and falls back to Gemini as primary. Don't re-introduce a `localhost:11434`
  default — creates 502 noise every 30s on the health check when Ollama isn't running.
- **VoxCPM2 inference is not thread-safe.** Wrapper uses a module-level `asyncio.Lock`
  to serialize all `MODEL.generate(...)` calls. The model holds prompt-cache state
  on the underlying tts_model during inference; concurrent calls would race.
- **VoxCPM `optimize=True` (torch.compile) is broken on Blackwell sm_120 + torch
  2.11+cu128.** Auto-warmup completes successfully but real inference asserts.
  Wrapper boots with `VOXCPM_OPTIMIZE=0`. Revisit when torch ships better Blackwell
  support; estimated 30-50% latency win when it works.
- **VoxCPM style prefix is provider-side, not LLM-side.** `VoxCpmProvider.applyStylePrefix`
  prepends `(slow, measured pace, late-night radio)` to the text before sending —
  Gemini doesn't author it, and other providers (Cartesia/ElevenLabs) don't see it.
  If a caller authors their own `(...)` prefix, the provider respects it.
- **VoxCPM reference is pre-denoised at install time.** `~/voxcpm-server/refs/onay-cartesia-clean.wav`
  is the canonical ref (ZipEnhancer-cleaned 16 kHz). Per-call `denoise:true` is the
  same operation done lazily — saves ~3s per request to use the pre-clean.
- **`preprocessForTTS` strips markdown emphasis** (`*word*`, `**word**`) — Gemini
  occasionally emits them as prosody hints and neural TTS reads them literally. Also
  normalizes curly double quotes `""` → `"` (some tokenizers mishandle U+201C/U+201D).

---

## Known Issues & Gotchas

### Audio session & MusicKit
- **AVAudioPlayer.stop() does not fire the delegate** — pending promises must be
  resolved manually in the native external-pause handler and `stopAudio`.
- **Post-segment audio session handoff**: TTS puts the session in `mixWithOthers`;
  without `releaseAudioSession`, MusicKit's `play()` resolves but no audio plays (no
  state transition events either). Fix: always call `releaseAudioSession` in
  `BroadcastPlayer.runSegmentAt`'s finally block.
- **Native 0.5s playback timer pauses when backgrounded** via
  `didEnterBackgroundNotification` observer.
- **Native cache self-hydration on `play()`** takes ~300-500ms first time; cached after.

### Broadcast pipeline
- **Gemini free tier quota**: 20 requests/minute. 9-song standard = 1 sequencer +
  6 segment = 7 LLM calls; two bakes/min → 14 (under cap but tight). 15-song long
  = 10 calls; two back-to-back will 429.
- **BroadcastStore TTL is lazy-only** — entries evict on `get()` but never proactively.
  Long-running server accumulates expired broadcasts until accessed.
- **Featured manifest payload is full** — `GET /broadcast/featured` returns every
  broadcast's complete manifest including all `audioUrls`. Doesn't scale past ~10
  featured broadcasts.

### Client player
- **`listener` and `runTrackAt` must be wrapped in try/catch.** `runTrackAt` catches
  `music.play` rejections and returns early instead of stalling the broadcast.
- **`waitForTrackEnd` safety timeout** is `duration + 30s`. If MusicKit never transitions
  to `playing`, the loop exits rather than hanging forever.
- **`BroadcastPlayer.singleton.ts` is separate from the class** so tests can import the
  pure class without pulling Firebase / native module dependencies.
- **Persisted manifest is cleared on `end()`** so resume doesn't offer a finished session.
- **`BroadcastResumer.check()` verifies freshness**: pings `/broadcast/:id/manifest`
  before returning the cached manifest; 404 clears the persisted record. Non-404 errors
  (network/timeout) keep the cached manifest — don't destroy a legit resume on a flaky
  connection.
- **Earlier Tonight list verifies on focus.** `HomeBroadcastScreen` renders cached
  `BROADCAST_HISTORY` immediately, then GETs each manifest in parallel and prunes 404s
  via `removeBroadcastFromHistory()`. Playback tap re-verifies.

### Build / deployment
- **Sentry source-map upload — partly wired, not yet verified end-to-end as of
  2026-05-01.** EAS production builds are configured to upload via `SENTRY_AUTH_TOKEN`
  + `SENTRY_ORG` + `SENTRY_PROJECT` EAS secrets; `SENTRY_DISABLE_AUTO_UPLOAD` is
  set to `"false"` in `eas.json` production profile (was `"true"` before OTA work).
  But sentry.io shows zero releases for the project after build 64 went out, meaning
  the upload step likely failed silently. Diagnose by reading the EAS build log
  for `sentry-cli` lines. Local-device builds (`expo run:ios --device`) still need
  the override `SENTRY_DISABLE_AUTO_UPLOAD=true` because they can't read EAS secrets.
  Separate gap: `eas update` does NOT auto-upload OTA bundle source maps — needs a
  post-update `sentry-expo-upload-sourcemaps` script. Both fixes are LATER items
  in `docs/index.md`.
- **R2 API tokens are bucket-scoped by default.** When standing up staging (separate
  R2 bucket per design), the prod token returned `403 AccessDenied` against the new
  `cleo-broadcast-segments-staging` bucket — silently failing all segment uploads,
  500'ing `/broadcast/create`, and stopping background slot generation cold (chain
  doesn't fire when storage upload throws). The fix is to widen the existing R2 token's
  bucket scope in the Cloudflare dashboard (R2 → Manage R2 API Tokens → Edit) to
  cover both buckets, or move it to "All buckets" / account scope. New buckets
  inheriting account scope automatically.
- **`EXPO_PUBLIC_*` shell env vars are ignored at build time.** Expo SDK 55 only
  reads them from `.env` / `.env.local` files. `EXPO_PUBLIC_API_URL=... npx expo run:ios`
  silently uses whatever's in `.env` — set the value in `.env.local` instead (gitignored,
  takes precedence over `.env`). Confirmed via the `[APIDiag]` console.log baked into
  `src/services/api.ts`.
- **iOS platform SDK** must match device iOS version. New iOS releases require Xcode >
  Settings > Platforms download (~8GB) before `expo run:ios --device` works.
- **pbxproj `objectVersion = 56` pin.** Xcode 26 writes `objectVersion = 70`, but
  EAS's CocoaPods 1.16.2 (xcodeproj gem 1.27.0) can only parse up to 56 ("Unable
  to find compatibility version string for object version 70"). If a local Xcode
  run bumps it back to 70, re-pin to 56 before committing — the pbxproj schema
  is backward-compatible even with the lower version marker.
- **`CURRENT_PROJECT_VERSION` is the build-number source of truth.** Since `ios/`
  is tracked + `eas.json` uses `appVersionSource: "local"`, EAS reads pbxproj
  directly. `Info.plist` uses `$(CURRENT_PROJECT_VERSION)` / `$(MARKETING_VERSION)`
  substitution so a single pbxproj edit propagates. Bumping only `app.json`
  silently ships the old build number — ASC then rejects the duplicate.
- **Widget extension provisioning** (`com.worthymedia.cleo.ONAYWidgets`) lives on
  EAS credentials alongside the main app. First-time setup per machine needs an
  interactive `eas build` so EAS can mint the Apple App ID + profile; after that,
  non-interactive builds succeed from the cached credentials.
- **Stale iOS asset catalog** ships when editing `assets/icon.png` without running
  `npm run icons:sync`. Symptom: TestFlight build carries the old/scaffold icon
  even though `assets/icon.png` is correct. The asset catalog PNGs
  (`ios/ONAY/Images.xcassets/AppIcon.appiconset/...` and the three
  `SplashScreenLegacy.imageset/image*.png` files) are the actual source of truth
  for the compiled app; `expo prebuild` no longer runs on EAS to regenerate them.

### Deprecated / stripped
Don't reintroduce: live-generation engines (`QueueManager`, `SessionEngine`,
`TransitionPreloader`, `SegmentController`, `AudioCoordinator`, `QueuePlanner`,
`LocalQueuePlanner`, `RulesEngine`), services (`CleoScriptGenerator`, `CleoVoiceEngine`,
`SessionMemory`), prompt library (`src/cleo/*`), Session Arc / Archive tabs. Native
Swift `playEjectTransition` / `cancelEjectTransition` / `onEjectTrackChanged` still
compiled in but unreferenced — candidate for native cleanup pass. `SequenceCache` +
`LLMTrackSequencer` pending deletion after sequencer soak.

---

## What's Left (not yet shipped)

- **OTA Sentry source-map upload** — wired in EAS profile but build-64 release
  never landed on sentry.io; needs diagnosis of the EAS build log + a separate
  post-`eas update` script for OTA bundles. Beta blocker (every JS crash unmapped
  until fixed). Tracked in `docs/index.md` LATER.
- **Bake abort endpoint** — no `DELETE /broadcast/:id`. User canceling mid-bake still
  pays for all remaining LLM + TTS calls.
- **Scheduled/autonomous featured bakes** (cron "Monday Reset" etc.) — requires server
  Apple Music developer token setup.
- **Native Swift cleanup** — eject code and `beginTTSBackgroundTask` / `silencePlayer`
  leftovers.
- **Rollback Fastify decommission** — `pm2 delete cleo-api` once new server is stable.
- **R2 presign TTL tightening** — currently 7 days; could match `BroadcastStore` 24h.

---

## Full Documentation

- Spec: `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md`
- Curation spec: `docs/superpowers/specs/2026-04-16-curation-design.md`
- Segment cadence spec: `docs/superpowers/specs/2026-04-20-segment-cadence-design.md`
- Plans: `docs/superpowers/plans/2026-04-12-pre-baked-broadcast-plan-{1..4}-*.md`,
  `2026-04-16-curation-implementation.md`, `2026-04-20-segment-cadence.md`
- **TTS tuning log**: `docs/f5-tts-tuning-log.md` — F5 parameter tuning,
  CosyVoice3 integration, VoxCPM2 install + recipe (Change #10), A/B listening
  rounds. Historical entries kept for context after F5/Cosy retirement.
  Rollback one-liners + backup filenames.
- Legacy PRD: `cleo-prd.md` — predates the pre-baked pivot; reference only for
  vibe/fallback library content that informs `SegmentScriptBuilder`.

---

## Self-hosted TTS infrastructure (Linux box at 192.168.8.229)

Separate from the Hostinger VPS. Hosts VoxCPM2.

- **SSH:** `ssh kari@192.168.8.229` — NVIDIA 5060 Ti 16 GB (Blackwell, sm_120).
  GPU swapped from AMD 6700XT 2026-04-27.
- **VoxCPM2 wrapper:** `~/voxcpm-server/`, systemd unit `voxcpm`, port 8003 (exposed publicly as `voxnano`; internal install dir + unit name kept as `voxcpm`).
  Boots with `VOXCPM_LOAD_DENOISER=1` (ZipEnhancer for reference cleanup) and
  `VOXCPM_OPTIMIZE=0` (torch.compile asserts on Blackwell + torch 2.11+cu128;
  re-enable when supported). Restart-on-failure, auto-start on boot, journal
  logging via `journalctl -u voxcpm`.
- **References in `~/voxcpm-server/refs/`:**
  - `onay-cartesia.wav` (24 kHz, 9.56s) — symlink to original. Cartesia-TTS-generated.
  - `onay-cartesia-clean.wav` (16 kHz, 9.56s) — **canonical** pre-denoised ref.
    Generated once at install via VoxCPM's ZipEnhancer; eliminates per-call denoise
    cost (~3s saved per request).
- **Pangolin tunnel:** `voxnano.worthymedia.online` → port 8003.
- **PyTorch:** torch 2.11.0+cu128 — Blackwell sm_120 requires CUDA 12.8 wheels
  (`pip install torch --index-url https://download.pytorch.org/whl/cu128`).
- **Retired services:** `~/f5tts-server/` and `~/cosyvoice-server/` directories
  remain on disk (~10 GB) as a 1-hour escape hatch but the systemd units are
  disabled. Delete the dirs once VoxCPM has been stable in prod for ~14 days.

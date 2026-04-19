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
- Ollama (self-hosted via Pangolin tunnel at `ollama.worthymedia.online`) — primary LLM
- Gemini 2.5 Flash — fallback LLM
- Cartesia (`sonic-3`) — primary TTS
- ElevenLabs (`eleven_turbo_v2_5`) — fallback TTS
- Orpheus (self-hosted) — tertiary TTS
- Filesystem TTS cache dedupes identical text across bakes

### Backend
- **Local dev:** Node.js + Express (`server/`) on port 3001. Jest + ts-jest test suite
  (233 tests). `STORAGE_BACKEND` env unset → `LocalFilesystemStorage` under
  `server/.broadcast-cache/`; segments served via `/broadcast-asset/*`.
- **Production:** Express broadcast server at `api.worthymedia.tech` (Hostinger VPS ID
  <HOSTINGER_ID>, IP <VPS_HOST>), running at `/home/cleo/cleo-broadcast/` on port 3102
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
│       │   ├── llm/              ← Ollama primary + Gemini fallback factory
│       │   └── tts/              ← Cartesia primary + ElevenLabs fallback + Orpheus
│       │                           tertiary factory, wrapped in CachingTTSProvider
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
│       │   │   ├── BroadcastOrchestrator.ts    ← sync slot 0 + async Promise.allSettled
│       │   │   │                                 over remaining slots; cleans up inFlight
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
4. Client `POST /broadcast/create` with `{ playlistId, vibe, length, userContext, tracks }`
5. Server responds synchronously with `{ manifest, firstSegmentUrls }` — target ~5-8s
6. Client navigates to `/player`, starts `broadcastPlayer.start(manifest, firstSegmentUrls)`
7. `TuningInCanvas` shows on the player screen while the cold open is fetched
8. Main loop: `runSegmentAt(0)` (cold open) → `runTrackAt(0)` → `runSegmentAt(1)` →
   `runTrackAt(1)` → … → `runSegmentAt(N)` (sign off). Each segment plays via
   `playAudioFromBase64` (duck MusicKit → play TTS → release audio session). Each
   track plays via `musicKitPlayer.play([trackId])`.
9. Between `playAudioFromBase64` and `musicKitPlayer.play`, the player calls
   `releaseAudioSession` natively so MusicKit can reclaim exclusive session control.
10. `waitForTrackEnd` watches both `getPlaybackStatus()` and `getPlaybackTime()` once
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
     → cold_open, transition×(N-1), sign_off; variantCount=1 for all
  3. store.put(manifest)
  4. SYNC: generateSlot(0) — SegmentScriptBuilder → LLM → TTS → ObjectStorage
  5. ASYNC (fire-and-forget, Promise.allSettled):
       generateSlot(1..N) — each in parallel, failures mark slot 'failed'
       .finally(() => inFlight.delete(manifest.broadcastId))
  6. ASYNC: backgroundEnricher.enqueue(seq.orderedTracks) — Genius + MusicBrainz,
     serialized per-API at 1.1s, writes EnrichmentCache; does not block the response
  7. Return { manifest: store.get(id), firstSegmentUrls: slot0Urls }
```

### Curation sequencer (TrackSequencer)
- Arcs live in `server/src/services/broadcast/vibe-arcs.ts` — 7 vibes (morning, focus,
  workout, feelGood, lateNight, melancholy, party), each with `descriptor`, prose
  `arc`, `preferred[]`, `avoid[]`. Preferred/avoid are **soft signals**, not filters —
  the LLM is told to adapt when the pool doesn't match.
- Pool cap: 40 tracks. Larger playlists take first 40 in input order.
- Fails fast (`/insufficient tracks/`) when pool.length < N.
- Enrichment hints passed to the LLM are length-capped and sanitized via `sanitizeHint`
  (mirrors `sanitizeForPrompt`) since third-party APIs (Genius/MB) are not trusted
  input surfaces.
- Fallback path logs via `console.warn`; background enrichment errors log per-track.

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
- **`server/.tts-cache/`** — pre-existing `CachingTTSProvider` hashes text + voice
  params; dedupes identical TTS calls across bakes.
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
```
GEMINI_API_KEY
CARTESIA_API_KEY, CARTESIA_VOICE_ID, CARTESIA_MODEL_ID
ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_PRONUNCIATION_DICT_ID/_VERSION
OLLAMA_BASE_URL, OLLAMA_MODEL
ORPHEUS_BASE_URL, ORPHEUS_VOICE, ORPHEUS_MAX_TOKENS
GENIUS_ACCESS_TOKEN
HEALTH_CHECK_INTERVAL_MS, HEALTH_CHECK_TIMEOUT_MS
BROADCAST_ASSET_BASE_URL      ← dev: http://<LAN-IP>:3001
CURATOR_EMAILS                ← comma-separated; authoritative publish gate
```

Project root `.env`:
```
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
- **Host name phonetic substitution.** `SegmentGenerator.phoneticizeHostName` rewrites
  `\bONAY\b → Oh-nay` on the LLM script text before handing it to TTS, so Cartesia /
  ElevenLabs pronounce it correctly. Word-bounded so `BALONAY` / `ONAYS` aren't
  touched. If we ever rename the host again, update both the regex and the system
  prompt in lockstep.
- **TrackSequencer prompt hints are sanitized.** Enrichment fields (`genre`,
  `moodTags`, `producer`) come from third-party APIs — always run through
  `sanitizeHint` before interpolation, mirroring `sanitizeForPrompt`'s control-char /
  role-hijack / backtick stripping. Never embed raw Genius/MB strings into the
  sequencer prompt.

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
- **Gemini free tier quota**: 20 requests/minute. A standard broadcast = ~10 LLM calls.
  If Ollama goes down and the app falls back to Gemini, two bakes in a minute will 429.
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
- **Resume manifest URLs can 404** if the server restarted or the 2h TTL evicted the
  backing files. `BroadcastResumer.check()` doesn't verify URL freshness.

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
Plans: `docs/superpowers/plans/2026-04-12-pre-baked-broadcast-plan-{1..4}-*.md`
Curation plan: `docs/superpowers/plans/2026-04-16-curation-implementation.md`
Legacy PRD: `cleo-prd.md` at repo root — predates the pre-baked pivot; reference only
for vibe/fallback library content that still informs `SegmentScriptBuilder`.

# CLAUDE.md — ONAY AI Radio App

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
  playback via AVAudioPlayer)
- `react-native-mmkv` — local storage (persisted manifest, user profile, host volume)
- `expo-blur`, `expo-linear-gradient`, `expo-haptics` — UI primitives
- `@expo-google-fonts` — Playfair Display, Inter, EB Garamond, DM Mono

### AI & Voice (server-side only)
- **LLM:** Gemini 2.5 Flash. Ollama disabled in prod — `OLLAMA_BASE_URL` unset
  means the provider fails to construct and Gemini is promoted.
- **TTS chain:** `TTS_PRIMARY=cosyvoice` → `TTS_FALLBACK=f5tts` → Cartesia → ElevenLabs
  → Orpheus. `TTS_FALLBACK` lets a self-hosted primary chain to another self-hosted
  provider before hitting a paid API.
- **CosyVoice3** (primary) and **F5-TTS** (fallback) run on the Linux box (192.168.8.229).
  CosyVoice on port 8001, F5 on port 8000. CosyVoice is proxied via
  `f5tts.worthymedia.online/cosy/*` so only one Pangolin tunnel is needed.
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
│   ├── (onboarding)/            ← welcome → music-auth → cleo-setup
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
│       │   └── tts/             ← CosyVoice / F5 / Cartesia / ElevenLabs / Orpheus
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
│       ├── AppHeader.tsx, TabBar.tsx, TabIcon.tsx
│       ├── OnayCharacter.tsx, CleoOrb.tsx, CleoPulseDot.tsx
│       ├── VibePicker.tsx
│       ├── OfflineBanner.tsx, ErrorBoundary.tsx, ErrorState.tsx
│       └── broadcast/           ← FeaturedBroadcastCard, YourBroadcastSetup,
│                                   SetupSheet, TuningInOverlay
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
  secondary cards. **Primary CTA** uses `Gradient.cta` + `Glow.ctaShadow` with icon
  and chevron.
- **Vibe accents** per vibe (`Colors.vibe.lateNight.accent` etc.) — progress bar,
  status orb, setup sheet chips. Get via `getVibeAccent(vibe)`.
- **Section labels** — DM Mono 10px letterSpacing 2.5, `Colors.accent`, 2×40 gold
  bar underneath. Editorial sections add a pulsing gold `LiveDot`.
- **Press feedback** — Pressable style callbacks returning `opacity: 0.75` (0.85 for
  colored buttons). Haptic feedback on every tap via `expo-haptics`.
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
5. Client `POST /broadcast/create` with `{ playlistId, vibe, length, userContext, tracks }`
6. Server responds after slot 0 + enrichment drain complete (~11-19s depending on
   cache warmth) with `{ manifest, firstSegmentUrls }`. Slots 1..N are `pending`;
   client polls for them.
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
  4. await Promise.all([drainP, slot0P]) — response gated on BOTH, so
     EnrichmentCache is populated before slots 1..N run.
  5. Fire-and-forget generateSlotsBackground(1..N) with a 4-worker pool
     (SEGMENT_CONCURRENCY=4). Promise stored in inFlight; deleted via .finally().
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
- **TestFlight builds**: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`.
  Auto-managed signing, team `8F2VWCN5KF`. iOS platform SDK must match device iOS.
- **Team ID drift**: project file sometimes shows `5MQ5ZR66YN` — fix in Xcode >
  target > Signing & Capabilities.
- **iOS deployment target**: 16.0 (MusicLibraryRequest requirement).

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
HEALTH_CHECK_INTERVAL_MS, HEALTH_CHECK_TIMEOUT_MS
BROADCAST_ASSET_BASE_URL                  # dev: http://<LAN-IP>:3001
CURATOR_EMAILS                            # comma-separated

TTS_PRIMARY=cosyvoice
TTS_FALLBACK=f5tts

SEQUENCER_MODE=deterministic              # or 'llm' for rollback

COSYVOICE_BASE_URL=https://f5tts.worthymedia.online/cosy
COSYVOICE_VOICE_REF=onay-cartesia
COSYVOICE_SPEED=1.0
COSYVOICE_TIMEOUT_MS=180000

F5TTS_BASE_URL=https://f5tts.worthymedia.online
F5TTS_VOICE_REF=onay-cartesia
F5TTS_NFE_STEP=20
F5TTS_CFG_STRENGTH=2.3
F5TTS_SPEED=1.05
F5TTS_TIMEOUT_MS=180000

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
- **Never add hyphens to phonetic substitutions for F5 or CosyVoice.** Both treat `-`
  as a stress marker — `Bee-yon-say` reads as three emphatic syllables.
  `pronunciations.json` entries are all hyphen-free; don't re-add them.
- **`OllamaProvider` constructor throws when `OLLAMA_BASE_URL` is unset.** The factory
  catches and falls back to Gemini as primary. Don't re-introduce a `localhost:11434`
  default — creates 502 noise every 30s on the health check when Ollama isn't running.
- **F5-TTS is not thread-safe.** FastAPI wrapper uses a module-level `asyncio.Lock` to
  serialize all `MODEL.infer(...)` calls. Concurrent calls without the lock produce
  `"Sizes of tensors must match"`. Don't scale by running multiple uvicorn workers —
  the 6700XT is compute-bound and each worker has its own MODEL instance bypassing
  the lock.
- **F5 `remove_silence=True` is a no-op in our wrapper.** F5's api.py only trims when
  `file_wave` is provided; our wrapper writes to a buffer. In-wrapper `_trim_silence`
  numpy step runs before encoding.
- **CosyVoice wrapper also `asyncio.Lock`-serialized.** First call after boot pays
  MIOpen tuner cost (~30s); wrapper runs a 3-shape startup warmup to amortize. MIOpen
  cache persists to `~/.cache/miopen/`.
- **F5 wrapper exposes `/cosy/*` proxy endpoints** that forward to `127.0.0.1:8001` via
  httpx. Proxy uses `Request.json()` rather than a typed body param — `from __future__
  import annotations` stringifies type hints and FastAPI can't resolve `TTSRequest` at
  route-registration time.
- **`preprocessForTTS` strips markdown emphasis** (`*word*`, `**word**`) — Gemini
  occasionally emits them as prosody hints and F5/CosyVoice read them literally. Also
  normalizes curly double quotes `""` → `"` (F5's tokenizer mishandles U+201C/U+201D).

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
- **Sentry source-map upload fails** without org config — always build with
  `SENTRY_DISABLE_AUTO_UPLOAD=true`.
- **iOS platform SDK** must match device iOS version. New iOS releases require Xcode >
  Settings > Platforms download (~8GB) before `expo run:ios --device` works.

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

- **Bake abort endpoint** — no `DELETE /broadcast/:id`. User canceling mid-bake still
  pays for all remaining LLM + TTS calls.
- **Scheduled/autonomous featured bakes** (cron "Monday Reset" etc.) — requires server
  Apple Music developer token setup.
- **Native Swift cleanup** — eject code and `beginTTSBackgroundTask` / `silencePlayer`
  leftovers.
- **Rollback Fastify decommission** — `pm2 delete cleo-api` once new server is stable.
- **R2 presign TTL tightening** — currently 7 days; could match `BroadcastStore` 24h.
- **Per-curator publish budget** — featured publish shares the generation rate limit;
  a runaway curator account could exhaust quota.
- **CosyVoice systemd unit** — staged at `~/cosyvoice-server/cosyvoice.service` but not
  installed. Currently runs via `nohup` uvicorn; restarts are manual.

---

## Full Documentation

- Spec: `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md`
- Curation spec: `docs/superpowers/specs/2026-04-16-curation-design.md`
- Segment cadence spec: `docs/superpowers/specs/2026-04-20-segment-cadence-design.md`
- Plans: `docs/superpowers/plans/2026-04-12-pre-baked-broadcast-plan-{1..4}-*.md`,
  `2026-04-16-curation-implementation.md`, `2026-04-20-segment-cadence.md`
- **TTS tuning log**: `docs/f5-tts-tuning-log.md` — F5 parameter tuning, reference audio
  changes, CosyVoice3 integration, A/B listening rounds. Rollback one-liners + backup
  filenames.
- Legacy PRD: `cleo-prd.md` — predates the pre-baked pivot; reference only for
  vibe/fallback library content that informs `SegmentScriptBuilder`.

---

## Self-hosted TTS infrastructure (Linux box at 192.168.8.229)

Separate from the Hostinger VPS. Hosts F5 and CosyVoice3.

- **SSH:** `ssh kari@192.168.8.229` — AMD 6700XT GPU via ROCm 6.2.
- **F5-TTS wrapper:** `~/f5tts-server/`, systemd unit `f5tts`, port 8000. Patched with
  leading-silence trim and `/cosy/*` reverse-proxy endpoints.
- **CosyVoice3 wrapper:** `~/cosyvoice-server/`, port 8001.
- **Shared reference:** `~/f5tts-server/refs/onay-cartesia.wav` + `.txt` — canonical
  voice, 9.56s. CosyVoice symlinks from `~/cosyvoice-server/refs/`.
- **Pangolin tunnel:** `f5tts.worthymedia.online` → port 8000. CosyVoice reached via
  `/cosy/*` proxy rather than a second tunnel rule.
- **ROCm quirk:** both services need `HSA_OVERRIDE_GFX_VERSION=10.3.0` (the 6700XT
  reports as gfx1031 but ROCm wheels were built for gfx1030).
- **MIOpen tuner cache:** `~/.cache/miopen/` persists kernel selections across restarts.

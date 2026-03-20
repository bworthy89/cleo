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
- Custom `expo-music-kit` native module — wraps Apple MusicKit (auth, playlists, playback, track detection, audio ducking, TTS playback, crossfade, eject transitions, queue inspection)
- react-native-video — video playback (installed, not yet used)
- react-native-mmkv — local storage
- @expo-google-fonts — Playfair Display, Inter, EB Garamond, DM Mono
- expo-font — custom font loading

### AI & Voice
- Gemini 2.5 Flash API — host script generation (maxOutputTokens: 8192 — thinking tokens consume budget)
- ElevenLabs TTS (`eleven_turbo_v2_5`, custom Cleo voice) — voice synthesis
- ~~HeyGen API~~ — deferred, not needed for MVP

### Data & Enrichment
- MusicBrainz API — producer/songwriter/recording data (no key needed)
- Genius API — song annotations, behind-the-scenes context

### Backend
- Node.js + Express — proxy server (keeps API keys server-side)
- All routes protected by Firebase JWT auth middleware (`requireAuth`)
- Runs locally on port 3001 during development
- Railway — deployed at `feisty-exploration-production-064e.up.railway.app` (auto-deploys from GitHub main)

---

## Project Structure

```
cleo/
├── CLAUDE.md
├── app.json                      ← Expo config, iOS 16+ deployment target
├── app/
│   ├── _layout.tsx               ← Root Stack, font loading, splash screen
│   ├── index.tsx                 ← Auth routing gateway (Firebase → login/onboarding/main)
│   ├── (auth)/
│   │   ├── _layout.tsx           ← Stack
│   │   └── login.tsx             ← "Enter the Frequency" editorial login
│   ├── (onboarding)/
│   │   ├── _layout.tsx           ← Stack with slide_from_right
│   │   ├── welcome.tsx           ← Tagline + CTA
│   │   ├── music-auth.tsx        ← Apple Music authorization + skip option
│   │   └── cleo-setup.tsx        ← Mood/Goal/Genre onboarding (→ CleoOnboarding)
│   └── (main)/
│       ├── _layout.tsx           ← Tabs with CustomTabBar
│       ├── (broadcast)/
│       │   ├── _layout.tsx       ← Stack
│       │   ├── index.tsx         ← HomeScreenRedesign
│       │   └── player.tsx        ← BroadcastScreen (slide_from_bottom)
│       ├── (arc)/
│       │   ├── _layout.tsx       ← Stack
│       │   └── index.tsx         ← SessionArcScreen
│       ├── (archive)/
│       │   ├── _layout.tsx       ← Stack
│       │   └── index.tsx         ← ArchiveScreen
│       └── (cleo)/
│           ├── _layout.tsx       ← Stack
│           └── index.tsx         ← ProfileScreen
├── docs/
│   ├── cleo-prd.md               ← full PRD
│   ├── stitch/                   ← Stitch Gold Edition design HTML + screenshots
│   └── superpowers/
│       ├── specs/                ← design specs
│       └── plans/                ← implementation plans
├── modules/
│   └── expo-music-kit/           ← custom native module
│       ├── expo-module.config.json
│       ├── index.ts              ← TypeScript API (auth, playlists, playback, ducking, TTS audio, eject transitions, getNextInQueue)
│       ├── src/ExpoMusicKitModule.ts
│       └── ios/
│           ├── ExpoMusicKitModule.swift  ← MusicKit + AVAudioSession + AVAudioPlayer + crossfade + eject transitions
│           └── ExpoMusicKit.podspec
├── server/
│   ├── .env                      ← API keys (gitignored)
│   ├── package.json
│   └── src/
│       ├── index.ts              ← Express app, CORS, rate limiting, requireAuth on all routes
│       ├── middleware/auth.ts    ← Firebase JWT verification
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
│   │   ├── SegmentController.ts  ← segment type rotation, delivery modes, mid-song drops, eject transitions, session memory
│   │   ├── AudioCoordinator.ts   ← duck→speak→resume, pre/post timing, mid-song scheduling, generationId, eject preloader wiring
│   │   ├── TransitionPreloader.ts← eject window pre-gen engine (state machine, genre-based timing, TTS caching, retry logic)
│   │   ├── QueuePlanner.ts       ← AI-powered track sequencing via Gemini (uses authenticatedFetch)
│   │   ├── QueueManager.ts       ← queue state, track profiles, session initialization
│   │   └── SessionEngine.ts      ← session lifecycle, phase progression, track history
│   ├── cleo/
│   │   ├── static-core.ts        ← Cleo's permanent system prompt (storytelling, session awareness)
│   │   ├── fallbacks.ts          ← pre-written fallback segment library (9 types, 12 vibes)
│   │   └── cold-opens.ts         ← per-vibe cold open pools (6 lines each), sameDayReturn variety
│   ├── services/
│   │   ├── api.ts                ← API_BASE_URL + authenticatedFetch (attaches Firebase JWT)
│   │   ├── AuthService.ts        ← Firebase Auth (email, Google, Apple sign-in, getIdToken)
│   │   ├── MusicKitPlayer.ts     ← Apple Music wrapper (singleton)
│   │   ├── CleoScriptGenerator.ts← Gemini integration + delivery mode + session phase + creative briefs
│   │   ├── CleoVoiceEngine.ts    ← ElevenLabs TTS + formatForSpeech post-process
│   │   ├── SessionMemory.ts      ← MMKV persistence for cross-session continuity
│   │   └── Storage.ts            ← MMKV typed helpers (user, stations, recently played)
│   ├── screens/
│   │   ├── home/
│   │   │   └── HomeScreenRedesign.tsx ← station picker, playlists, now playing, vibe picker
│   │   ├── onboarding/
│   │   │   └── CleoOnboarding.tsx     ← mood/goal/genre picker
│   │   ├── player/
│   │   │   └── BroadcastScreen.tsx    ← full player with artwork, controls, editorial insight
│   │   ├── arc/
│   │   │   └── SessionArcScreen.tsx   ← live session visualization, upcoming manifest
│   │   ├── archive/
│   │   │   └── ArchiveScreen.tsx      ← broadcast history with filter tabs
│   │   └── settings/
│   │       └── ProfileScreen.tsx      ← AI personality, voice profile, account
│   └── components/
│       ├── AppHeader.tsx          ← floating blur header with logo
│       ├── TabBar.tsx             ← custom 4-tab bottom bar (Broadcast, Arc, Archive, Cleo)
│       ├── VibePicker.tsx         ← bottom sheet vibe selector (12 vibes, persists to station)
│       ├── GlassCard.tsx          ← frosted glass container (legacy, being replaced by gold-edge cards)
│       ├── StationCard.tsx        ← 2:3 portrait card with artwork + label
│       ├── CleoOrb.tsx            ← gradient circular avatar
│       ├── CleoSpeakingOverlay.tsx← full-screen transmission effect with glitch animations
│       ├── WaveformBars.tsx       ← animated audio visualization bars
│       ├── SectionLabel.tsx       ← mono uppercase label (legacy, screens now use inline labels)
│       ├── TabIcon.tsx            ← custom SVG icons for tab bar
│       ├── CleoPulseDot.tsx       ← animated pulse indicator on Cleo tab
│       └── ErrorState.tsx         ← error message + retry button
```

---

## UI Design System — "Sonic Ether" Gold Edition

All screens follow the Stitch Gold Edition editorial design language:

### Design Patterns
- **Gold left-edge cards**: 2px `Colors.accent` border on left side of `Surface.container` cards — used for Now Playing, Editorial Insight, Synchronized Next, current track, Cleo suggestions
- **Mono gold section labels**: `DM Mono`, 10px, letterSpacing 2.5, `Colors.accent` — replaces the `SectionLabel` component on all screens
- **No glass borders**: Cards use `Surface.container` background with `Radius.sm` corners, no `Glass.borderSubtle` borders
- **Sharp editorial corners**: `Radius.sm` (4px) throughout, not `Radius.md` or `Radius.lg`
- **Accent line**: 40px wide, 2px tall gold bar used under headings (login, welcome, home, archive)
- **Editorial headlines**: Playfair Display for titles, left-aligned, with gold-highlighted keywords

### Typography Roles
- **Display (Playfair Display)**: Screen titles, track names, large numbers
- **Body (Inter 400/500/600)**: Content, descriptions, secondary info
- **Mono (DM Mono)**: Section labels, metadata, UI chrome, button text (ALL CAPS, wide tracking)
- **Cleo Voice (EB Garamond Italic)**: Cleo's spoken dialogue, quotes (curly quotes: \u201C \u201D)

### Screen-Specific Labels
- Home: "LIVE BROADCAST", "YOUR STATIONS", "PLAYLISTS", "CLEO SAYS"
- Broadcast: station name label, "EDITORIAL INSIGHT", "LIVE CONNECTION", "SYNCHRONIZED NEXT"
- Session Arc: "LIVE SESSION", "SESSION PULSE", "UPCOMING MANIFEST"
- Archive: "BROADCAST ARCHIVES" with filter tabs (Latest, By Mood, By Date)
- Profile: "AI PERSONALITY", "CONNECTED ECOSYSTEM", "VOICE PROFILE", "ACCOUNT"

---

## What's Built

### Phases 1-5 — Foundation through Audio Coordination
- Expo project, design tokens, Google Fonts
- Custom `expo-music-kit` native module (MusicKit, AVAudioPlayer, ducking)
- Node.js Express server with proxy routes (Gemini, ElevenLabs, Genius)
- Full radio loop: track change → Cleo speaks → music resumes

### Cleo Polish — Voice, Timing & Storytelling
- ElevenLabs voice tuning: `eleven_turbo_v2_5` model, stability 0.35, style 0.55
- `formatForSpeech()` post-process (em-dashes, strip stage directions)
- Delivery modes: `pre_song` (bridges between tracks), `post_song` (drops in 8-12s into track), and `eject_transition` (speaks over outgoing track fade-out)
- `previousTrack` buffering in AudioCoordinator for temporal context
- Session phase: opening (1-3) → mid (4-8) → late (9+) with tone shifts
- `tracksReferenced` for cross-track artist callbacks
- 12 vibes: morning, chill, workout, lateNight, party, general, focus, feelGood, throwback, elevated, melancholy, sunday
- 9 segment types including `genre_bridge` and `post_track_reflection`
- `generationId` system for safe track-skip cancellation
- Cold opens: 6 per vibe, sameDayReturn with 6 variants

### Radio Experience — Presence, Continuity & Crossfade
- Mid-song Cleo drops: 40% chance on 3+ min tracks, 45-90s mark, 25 words max
- Session memory: persists station/vibe/artists/track across app opens via MMKV
- Music crossfade: ducking deactivates 2s before Cleo finishes, music rises under her last words
- `previousSession` context in Gemini prompt for return acknowledgment

### UI Redesign — Gold Edition (Stitch-Aligned)
- All 8 screens restyled to match Stitch Gold Edition design
- Login: "Enter the Frequency" editorial layout with keyboard chaining + iOS AutoFill
- Onboarding: 3-screen flow (welcome → music-auth with skip → mood/goal/genre)
- Home: gold-edge cards, vibe picker bottom sheet on station/playlist tap
- Broadcast: left-aligned track info, editorial insight card, station name display
- Speaking Overlay: chromatic aberration title, gold word highlights
- Session Arc: gold-edge track card, session pulse, upcoming manifest
- Archives: built from scratch with filter tabs and archive cards
- Profile: AI personality cards, sign-out confirmation, surface containers
- Accessibility labels on all interactive elements across all screens

### Eject Window Transitions — Radio-Style Crossfade
- `TransitionPreloader` pre-generates Cleo's transition script + TTS mid-track
- Genre-based eject windows: electronic/ambient/jazz 22s, pop/hip-hop/r&b 13s, rock/indie 16s, default 15s
- State machine: `idle → generating → ready → fired → done` with fallback on missed eject
- Native `playEjectTransition()` handles three-layer crossfade (old track fading out, Cleo voice, new track fading in)
- `getNextInQueue()` native function reads MusicKit's actual queue for accurate next-track naming
- TTS retry with backoff (3s/6s/9s) handles ElevenLabs 429 rate limits during pre-gen
- `onEjectTrackChanged` event suppresses `onTrackChanged` during eject; fallback path uses old timing if eject misses
- `cancelEjectTransition()` properly resolves dangling `playEjectTransition` promise

---

## The Audio Handoff Sequence

### Primary Path — Eject Window (radio-style crossfade)
```
1. Track starts → TransitionPreloader.startForTrack() begins 2s polling
2. At 25s: pre-gen triggers (if Cleo not speaking) → Gemini generates eject_transition script
3. getNextInQueue() reads MusicKit's actual next track for accurate naming
4. TTS synthesized and cached in memory (retry up to 3x on 429)
5. State: ready — waiting for eject point
6. At (duration - genre window): playEjectTransition() fires with cached TTS base64
7. Native: old track fades out, Cleo speaks over it, new track fades in
8. onEjectTrackChanged fires (onTrackChanged suppressed) → UI updates → new preloader starts
```

### Fallback Path — Post-Track-Change (original timing)
```
1. onTrackChanged fires (eject missed or manual skip)
2. Old preloader cancelled, cancelPendingTimer() clears timers + increments generationId
3. 3.5s natural delay (1.5s on manual skip; bail if generationId changed)
4. SegmentController generates via Gemini (delivery mode determines framing)
5. AVAudioSession activates with .mixWithOthers + .duckOthers
6. AVAudioPlayer plays ElevenLabs TTS (music ducks automatically)
7. Crossfade: 2s before audio ends, setCategory removes duckOthers — music rises
8. Audio finishes → new preloader starts for eject window at end of track
9. Schedule mid-song drop if track > 3.5 min (20-40% chance by vibe)
```

**Delivery modes:**
- `pre_song` (~60%): Cleo speaks right after track change, bridges from previous to current
- `post_song` (~40%): Cleo drops in 8-12s into track, comments mid-listen
- `eject_transition`: Cleo speaks over outgoing track's fade-out, bridges into next track

---

## Build Environment

- **Path constraint**: React Native pod scripts fail with spaces in paths.
  Native builds use `/Users/kari/Documents/cleo-app/` (rsync copy), then sync back.
- **rsync command**: `rsync -av --delete --exclude='ios/' --exclude='node_modules/' --exclude='.expo/' --exclude='.git/' /Users/kari/Documents/DJApp/ /Users/kari/Documents/cleo-app/`
- **rsync native module caveat**: The `--exclude='ios/'` also excludes `modules/expo-music-kit/ios/`. After rsync, always sync the native module separately: `rsync -av /Users/kari/Documents/DJApp/modules/expo-music-kit/ios/ /Users/kari/Documents/cleo-app/modules/expo-music-kit/ios/`
- **Git repo lives at cleo-app** — DJApp is the working directory, cleo-app has the git history. Always rsync before committing.
- **Entitlements**: `Cleo.entitlements` must have empty `<dict/>` — `com.apple.developer.musickit` is NOT a valid entitlement (MusicKit uses Info.plist instead)
- **Ruby**: rbenv + Ruby 3.2.4 at ~/.rbenv/ (system Ruby 2.6 too old for CocoaPods)
- **CocoaPods**: Installed via gem under rbenv Ruby 3.2.4 (`~/.rbenv/shims/pod`)
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

## Important Conventions

- All components use TypeScript with strict mode
- No inline styles — all values from design-tokens.ts
- All API calls go through `authenticatedFetch` (in api.ts) — attaches Firebase JWT, never use raw `fetch` for backend calls
- All API routes on the server are protected by `requireAuth` middleware
- MusicBrainz: max 1 request/second — use a queue with 1100ms minimum interval
- Segment generation: 10s timeout → fallback on loss
- Gemini 2.5 Flash: maxOutputTokens must be 8192+ (thinking tokens consume budget)
- ElevenLabs: `eleven_turbo_v2_5` model (stability 0.35, style 0.55) for natural inflection
- MMKV for all local persistence — never AsyncStorage
- Native builds must use no-spaces path (`/Users/kari/Documents/cleo-app/`)
- After rsync to cleo-app, check that `Cleo.entitlements` has empty dict (no musickit key)
- Every phase ends with a working milestone test on physical device
- Preload buffer is disabled — prompts bake in track names, buffer would have stale context
- All Expo Router tab groups must have a `_layout.tsx` file — without it, `navigation.navigate()` fails to find the route
- Use `Pressable` (not `TouchableOpacity`) for all interactive elements
- Add `accessibilityLabel` and `accessibilityRole` to all buttons and interactive elements
- All `JSON.parse` calls on MMKV storage must be wrapped in try/catch — corrupt data from interrupted writes can crash the app
- All `setTimeout` in React components must be stored in `useRef` and cleared in effect cleanup
- Server routes must validate and clamp all client-supplied numeric parameters before forwarding to upstream APIs
- TTS synthesis calls must have an `AbortController` timeout (15s) — hung calls block the eject preloader
- External-origin strings (Genius annotations, user display names) must be sanitized before Gemini prompt injection
- Enrichment loops must include 1100ms delay between iterations to respect MusicBrainz rate limits
- Rate limiters on the server use `req.uid` (Firebase UID) not IP — prevents shared NAT/VPN blocking

---

## Known Issues & Gotchas

- **Gemini token budget**: `thinkingBudget` is set to 0 (disabled) for segment generation since creative scripts don't need chain-of-thought. With thinking disabled, `maxOutputTokens` of 2048 is sufficient. For QueuePlanner (which needs reasoning), `maxOutputTokens` should remain 8192+.
- **Crossfade audio session**: Never call `setActive(false)` while AVAudioPlayer is playing — it kills the audio. Use `setCategory` to remove `duckOthers` instead.
- **MusicKit entitlement**: `com.apple.developer.musickit` is NOT valid in entitlements plist. Remove it if it appears — MusicKit works via Info.plist usage description.
- **rsync overwrites**: rsync from source repo can overwrite Xcode project changes (signing, entitlements). Exclude `ios/` directory or verify after sync.
- **Pod privacy manifests**: After rsync, may need `rm -rf ~/Library/Developer/Xcode/DerivedData/Cleo-*` then `pod install` if CpResource errors appear.
- **Progress bar race condition**: Playback progress polling must run unconditionally on mount (`[]` dependency), not gated by `isPlaying`. When resuming a session, `isPlaying` may not be `true` yet when the effect runs, causing the polling to never start. The poll itself should check playback status each cycle.
- **Backend auth on all fetch calls**: Every `fetch` to the backend must use `authenticatedFetch` from `api.ts`. Raw `fetch` without the Firebase JWT token will get 401 from `requireAuth` middleware. The QueuePlanner was using raw `fetch` and silently falling back to original playlist order.
- **Tab group layouts required**: Every Expo Router tab group directory (e.g., `(arc)/`, `(archive)/`, `(cleo)/`) must contain a `_layout.tsx` exporting a Stack. Without it, `navigation.navigate("(groupName)")` throws "not handled by any navigator."
- **Music-auth must persist authorization**: After successful Apple Music authorization, persist `appleMusicAuthorized: true` to Storage. Otherwise downstream screens read `false`.
- **Avatar logic**: When showing user initials vs fallback icon, check `displayName !== 'Listener'` (the fallback), not `photoURL` which may be null even for named users.
- **ElevenLabs 429 during pre-gen**: The eject preloader's TTS call can hit a 429 if Cleo's intro speech just finished. TransitionPreloader retries up to 3 times with backoff (3s/6s/9s). Don't remove the retry — it's essential for the eject system.
- **Next track accuracy**: Never use `sessionEngine.getNextTrackId()` for content Cleo speaks aloud — the queue plan index drifts from MusicKit's actual queue. Use `getNextInQueue()` which reads MusicKit's `ApplicationMusicPlayer.Queue` directly.
- **Eject preloader lifecycle**: On `onTrackChanged`, always cancel the old preloader and start fresh. `onTrackChanged` only fires when the eject DIDN'T happen, so the preloader is always stale. Never guard `handleTrackStart` behind `isActive()`.
- **handleTrackStart must not overwrite previousTrack**: `handleTrackChangeWithResult` already sets it correctly. Double-writing loses the real previous track context.
- **handleTrackStart must not schedule mid-song drops**: `handleTrackChangeWithResult` already schedules them. Duplicate scheduling causes two Cleo drops on one track.
- **Xcode team ID mismatch**: The project file may have `DEVELOPMENT_TEAM = 5MQ5ZR66YN` instead of `8F2VWCN5KF`. Building from CLI may fail on provisioning — use `-allowProvisioningUpdates` or build from Xcode.
- **AVAudioPlayer.stop() does not fire delegate**: Calling `ttsPlayer.stop()` does NOT trigger `audioPlayerDidFinishPlaying`. Any pending promise must be manually resolved and audio state cleaned up after programmatic `stop()`. This applies to the external-pause handler in the playback polling timer and `cancelEjectTransition`.
- **Post_song Promise must be resolvable on cancel**: `handleTrackChangeWithResult` returns a Promise for post_song delivery. `cancelPendingTimer()` must resolve the stored `pendingPostSongResolve` callback — otherwise callers (BroadcastScreen) hang forever on skip.
- **TransitionPreloader needs generationId**: The preloader's state machine (`idle/generating/ready/fired/done`) is not sufficient to distinguish stale vs current generations. A `generationId` counter must be checked after every async gap (sleep, network call) to detect if `reset()` + `startForTrack()` happened during the gap.
- **Don't advance rotation in generateEjectTransition**: The eject path peeks at the rotation without advancing `rotationIndex`. It only advances after successful generation. This prevents double-advancing when the eject misses and the fallback path's `generateNext()` also runs.
- **Don't consume shouldStaySilent flag in eject path**: `generateEjectTransition` checks `lastWasMidSongDrop` but must NOT consume it (no side effect). If the eject returns null and fallback fires, the flag should still suppress the next `pre_song` in `generateNext`.
- **clearUserData must preserve USER key**: `clearUserData()` on sign-out must NOT remove `StorageKeys.USER`. Removing it causes returning users to be re-routed through onboarding on every sign-in.
- **authenticatedFetch must throw on null token**: Never silently send unauthenticated requests. `authenticatedFetch` throws if no Firebase token is available, forcing callers to handle the auth-not-ready state.
- **Server must validate and clamp client inputs**: `maxTokens` clamped to 256–8192, voice `stability`/`style`/`speed` clamped to valid ranges, `text` capped at 5000 chars, `audioUrl` must be HTTPS, video IDs validated with regex. Never forward raw upstream error bodies to the client.
- **MusicKitPlayer listeners need try/catch**: Each listener callback in `forEach` must be wrapped in try/catch. One throwing listener (e.g., unmounted component state setter) must not abort iteration and silently kill subsequent listeners like AudioCoordinator.
- **BroadcastScreen timers must be ref-tracked**: All `setTimeout` calls for `setCleoSpeaking(false)` must be stored in a `useRef` and cleared on unmount and before each new track. Bare `setTimeout` causes state updates on unmounted components and race conditions on fast skips.
- **fetchPlaylistTracks clears caches**: The native module clears `cachedTracks` and `cachedSongs` at the start of `fetchPlaylistTracks` to prevent unbounded memory growth from browsing multiple playlists.
- **initializeSession must not call advanceTrack eagerly**: The `onTrackChanged` native event is the sole source of truth for queue advancement. Calling `advanceTrack(allTrackIds[0])` in `initializeSession` double-counts the first track if `onTrackChanged` also fires.

---

## Full Documentation

Read docs/cleo-prd.md (in parent directory `/Users/kari/Documents/DJ App/cleo-prd.md`) for:
- Complete system prompt architecture
- Full cold open library
- Full fallback segment library
- Song scoring algorithm details
- Genre bridge system
- Complete session arc phases
- All screen layouts and navigation map

Stitch Gold Edition designs are in `docs/stitch/` — HTML source + screenshots for all 8 screens.

# Pre-Production Test Plan — Cleo AI Radio App

**Date**: 2026-03-19
**Goal**: Comprehensive test coverage before first TestFlight submission
**Approach**: Jest unit/integration tests + manual on-device test script

---

## Part 1: Jest Test Suite

### Setup

- Jest + `@testing-library/react-native` (already available via Expo)
- Mock `react-native-mmkv` with in-memory Map
- Mock `expo-music-kit` native module
- Mock `authenticatedFetch` for API tests
- Test files in `__tests__/` mirroring `src/` structure

---

### Test File 1: `__tests__/engines/SegmentController.test.ts`

**What it tests**: Segment type rotation, delivery mode selection, vibe modulation, silence logic

| Test Case | Expected |
|-----------|----------|
| First segment is always a cold open | `segmentType === 'cold_open'`, `deliveryMode === 'pre_song'` |
| Rotation cycles through all 13 types | After 13 generateNext calls, all rotation types used |
| Rotation wraps at boundary | Segment 14 returns to rotation[0] |
| `pre_song` delivery for ALWAYS_PRE types | `song_intro`, `genre_bridge` → always `pre_song` |
| `post_song` delivery for ALWAYS_POST types | `post_track_reflection` → always `post_song` |
| PREFER_POST triggers after 2+ consecutive `pre_song` | 3rd consecutive → switches to `post_song` |
| Brief length tier on manual skip | `isManualSkip: true` → maxWords ≤ 30 |
| Extended length cooldown (4 segments) | After extended segment, next 4 are standard or brief |
| `track_story` override when `hasRichData` | Track with enrichedFacts → `track_story` replaces rotation pick |
| `shouldStaySilent()` after mid-song drop | `markMidSongDropCompleted()` → next `shouldStaySilent()` returns true |
| `shouldStaySilent()` resets consecutive counter | Returns true → `consecutiveSpokenSegments` → 0 |
| `tracksReferenced` deduplicates artists | Same artist twice → only 1 entry |
| `setVibe()` updates current vibe | Affects delivery mode probabilities and silence chance |
| Session phase progression | opening (0-3), mid (4-8), late (9+) |

---

### Test File 2: `__tests__/engines/SessionEngine.test.ts`

**What it tests**: Session lifecycle, phase computation, skip tracking, queue management

| Test Case | Expected |
|-----------|----------|
| `startSession()` creates valid session | Session has id, stationId, vibe, startTime, empty arrays |
| `getSession()` returns null before start | Returns null |
| `advanceTrack()` adds to tracksPlayed | tracksPlayed grows, currentQueueIndex increments |
| `recordSkip()` adds to skippedTracks | skippedTracks grows, currentQueueIndex unchanged |
| `getConsecutiveSkips()` counts streak | 3 skips in a row → returns 3 |
| `getConsecutiveSkips()` breaks on non-skip | Skip, play, skip → returns 1 |
| `getCurrentPhase()` based on elapsed time | <12min → earlySession, 12-35 → build, 35-50 → peak, 50+ → resolution |
| `getCurrentPhase()` with no session | Returns 'coldOpen' |
| `getNextTrackId()` returns correct track | After setQueuePlan + advanceTrack, returns next in queue |
| `getNextTrackId()` past queue end | Returns null |
| `endSession()` persists to history | Session saved to MMKV, max 20 history |
| `endSession()` with null session | No-ops silently |
| `startSession()` overwrites active session | Second call replaces first without error |
| `setQueuePlan()` stores plan | getNextTrackId reads from stored plan |

---

### Test File 3: `__tests__/engines/QueueManager.test.ts`

**What it tests**: Queue cache, fallback behavior, AI plan merging

| Test Case | Expected |
|-----------|----------|
| Cache miss → calls `planQueue()` | `planQueue` called, result cached in MMKV |
| Cache hit within TTL → skips API | `planQueue` not called, cached plan used |
| Cache expired (>4h) → calls API | `planQueue` called for stale cache |
| Different vibe → separate cache entry | Same playlist, different vibe → cache miss |
| `planQueue()` failure → local plan continues | Error caught, no crash, local plan stays |
| Queue merging preserves played tracks | Already-played tracks keep their position |
| Missing tracks appended at end | If AI plan omits tracks, they're added |

---

### Test File 4: `__tests__/engines/LocalQueuePlanner.test.ts`

**What it tests**: Fisher-Yates shuffle, artist separation, arc shape, role assignment

| Test Case | Expected |
|-----------|----------|
| Empty tracks → empty queue | Returns `{queue: [], arcShape: 'short'}` |
| Single track → opener role | Queue has 1 entry with role 'opener' |
| 2 tracks → opener + closer | First is opener, last is closer |
| Arc shape: <20 → short | 15 tracks → 'short' |
| Arc shape: 20-40 → medium | 25 tracks → 'medium' |
| Arc shape: 40+ → long | 50 tracks → 'long' |
| Artist separation | No adjacent tracks by same artist (when possible) |
| All same artist → still returns valid queue | Doesn't crash, returns all tracks |
| Recently played tracks deprioritized for opener | Opener comes from non-recent pool when available |
| All tracks included | Output queue length === input tracks length |

---

### Test File 5: `__tests__/services/CleoScriptGenerator.test.ts`

**What it tests**: Prompt construction, timeout, fallback behavior

| Test Case | Expected |
|-----------|----------|
| Successful generation returns text | Mock 200 response → returns generated text |
| API timeout → fallback line | 10s+ delay → returns fallback from library |
| API error (500) → fallback line | Mock 500 → returns fallback |
| API rate limit (429) → fallback line | Mock 429 → returns fallback |
| Empty response text → fallback | `{text: ""}` → returns fallback |
| `pre_song` delivery mode framing | Prompt contains "bridge from previous" |
| `post_song` delivery mode framing | Prompt contains "comment mid-listen" |
| Enriched facts injected when present | enrichedFacts with producer → "VERIFIED TRACK FACTS" in prompt |
| No enriched facts → no facts block | enrichedFacts missing → no "VERIFIED" in prompt |
| Word count instructions match length tier | brief → "15-30 words", standard → "40-75 words" |
| Session phase affects tone instruction | opening → different tone than late |
| Previous session context included | previousSession data → "PREVIOUS SESSION" in prompt |

---

### Test File 6: `__tests__/services/CleoVoiceEngine.test.ts`

**What it tests**: Text formatting, delivery cue parsing, voice parameter resolution

| Test Case | Expected |
|-----------|----------|
| `parseDeliveryCue('[warm] Hello')` | Returns `{cue: 'warm', text: 'Hello'}` |
| `parseDeliveryCue('No cue here')` | Returns `{cue: null, text: 'No cue here'}` |
| `parseDeliveryCue('[invalid] text')` | Returns `{cue: null, text: '[invalid] text'}` |
| `formatForSpeech()` strips parentheticals | `"Hello (laughs) world"` → `"Hello world"` |
| `formatForSpeech()` strips stage directions | `"[softly] Hello"` delivery cue preserved, `"[clears throat]"` stripped |
| `formatForSpeech()` preserves abbreviations | `"feat. Drake"` → period not treated as sentence end |
| `formatForSpeech()` splits long sentences | 20-word sentence → split at clause boundary |
| `formatForSpeech()` em-dash transform | `", and "` → `" — and "` |
| `resolveVoiceParams()` clamps values | Extreme nudges → stability/style stay in [0,1], speed in [0.5,2] |
| `resolveVoiceParams()` vibe profiles | Each of 12 vibes → distinct param set |
| `synthesize()` success → returns base64 | Mock 200 with audioContent → returns string |
| `synthesize()` failure → returns null | Mock error → returns null, no crash |

---

### Test File 7: `__tests__/services/Storage.test.ts`

**What it tests**: MMKV typed helpers, user data, stations, playlists cache

| Test Case | Expected |
|-----------|----------|
| `getUser()` when no user → undefined | Returns undefined |
| `setUser()` + `getUser()` roundtrip | Data matches |
| `getStations()` empty → empty array | Returns [] |
| `addStation()` + `getStations()` | Station appears in list |
| `getCachedPlaylists()` → null when empty | Returns null |
| `setCachedPlaylists()` + `getCachedPlaylists()` | Data matches |
| `addRecentlyPlayedTrack()` deduplicates | Same ID twice → appears once |
| `addRecentlyPlayedTrack()` caps at max | Exceeds limit → oldest removed |

---

### Test File 8: `__tests__/cleo/coldOpens.test.ts`

**What it tests**: Cold open selection, priority system, variety

| Test Case | Expected |
|-----------|----------|
| First ever session → firstEver line | `totalSessions === 0` → specific welcome line |
| Same-day return → sameDayReturn pool | Second session same day → sameDayReturn line |
| 3+ day streak → streak3 pool | consecutiveDays ≥ 2 → streak3 line |
| Monday morning → mondayMorning pool | Day 1, hour < 12 → mondayMorning line |
| Friday late night → fridayLateNight pool | Day 5, hour ≥ 21 → fridayLateNight line |
| Default → vibe-matched pool | No special conditions → line from vibe's 6-entry pool |
| No immediate repeats | Call twice → different line (when pool > 1) |
| All 12 vibes have entries | Each vibe key → 6 lines in COLD_OPENS |
| Priority order respected | firstEver > sameDayReturn > streak > day-of-week > vibe |

---

### Test File 9: `__tests__/cleo/fallbacks.test.ts`

**What it tests**: Fallback line selection, vibe matching, recently-used tracking

| Test Case | Expected |
|-----------|----------|
| Known type + vibe → returns string | `getFallbackLine('song_intro', 'chill')` → non-empty string |
| Unknown type → graceful handling | `getFallbackLine('nonexistent')` → doesn't crash |
| Vibe-specific match preferred | 'song_intro' + 'chill' → chill-specific line |
| No vibe match → generic fallback | Vibe with no entries → type-only match |
| No immediate repeats | 6 calls → at least 2 distinct lines |
| Recently-used pool exhaustion → reset | After all lines used → pool resets, still returns |
| All 9 segment types have entries | Each type → at least 1 fallback line |

---

### Mocking Strategy

```typescript
// __mocks__/react-native-mmkv.ts
const store = new Map<string, string>();
export const createMMKV = () => ({
  getString: (key: string) => store.get(key),
  set: (key: string, value: string) => store.set(key, value),
  delete: (key: string) => store.delete(key),
  contains: (key: string) => store.has(key),
  clearAll: () => store.clear(),
});

// __mocks__/expo-music-kit.ts
export const authorize = jest.fn().mockResolvedValue({ status: 'authorized', canPlayCatalog: true });
export const fetchPlaylists = jest.fn().mockResolvedValue([]);
export const fetchPlaylistTracks = jest.fn().mockResolvedValue([]);
export const playAudioFromBase64 = jest.fn().mockResolvedValue(undefined);
export const setTTSVolume = jest.fn();
// ... etc

// __mocks__/authenticatedFetch.ts
export const mockFetch = jest.fn();
jest.mock('../services/api', () => ({
  authenticatedFetch: (...args) => mockFetch(...args),
}));
```

---

## Part 2: Manual On-Device Test Script

### Pre-Flight Checks
- [ ] Clean install on physical device (delete any previous build)
- [ ] Server running and healthy (`/health` returns 200)
- [ ] Apple Music subscription active on test device
- [ ] Device signed into iCloud (required for MusicKit)

### Flow 1: Fresh Install → First Broadcast
- [ ] App launches, splash screen displays, then navigates to login
- [ ] "Enter the Frequency" login screen renders with CLEO branding
- [ ] Email/password login works (create account if needed)
- [ ] Google Sign-In works
- [ ] Apple Sign-In works
- [ ] After login → Welcome screen with "CLEO" title + accent line
- [ ] Tap "Begin" → Music Auth screen
- [ ] "Connect Apple Music" triggers system auth dialog
- [ ] Grant access → proceed to Cleo Setup
- [ ] Deny access → "Skip" option available, returns to home without crash
- [ ] Cleo Setup: mood/goal/genre pickers render, selection persists
- [ ] Tap "Let's Go" → navigates to Home (Broadcast tab)

### Flow 2: Home Screen
- [ ] "LIVE BROADCAST" label + greeting displays (morning/afternoon/evening)
- [ ] Gold accent line renders under greeting
- [ ] "YOUR STATIONS" section shows (empty state if first time)
- [ ] "PLAYLISTS" section loads Apple Music playlists
- [ ] Playlist artwork loads (or shimmer placeholder)
- [ ] Tap playlist → Vibe Picker bottom sheet appears
- [ ] Vibe Picker: 12 vibes display, selection highlights
- [ ] Select vibe → navigates to Player (BroadcastScreen)
- [ ] Station created and appears in "YOUR STATIONS" on return
- [ ] "CLEO SAYS" suggestion card renders with gold edge
- [ ] Avatar button (top right) → navigates to Profile tab

### Flow 3: Core Radio Loop
- [ ] Player screen: artwork loads, track title + artist display
- [ ] Music begins playing within 3-5 seconds
- [ ] After first track loads, Cleo delivers cold open (within ~5s)
- [ ] Music ducks when Cleo speaks (volume noticeably lower)
- [ ] Music resumes smoothly after Cleo finishes (crossfade on segments >3s)
- [ ] Track changes → Cleo speaks again (pre_song or post_song delivery)
- [ ] Speaking overlay appears during Cleo segments with text
- [ ] Track progress bar updates in real-time
- [ ] Play/pause button works
- [ ] Skip forward works (Cleo may comment briefly)
- [ ] Skip backward works
- [ ] 3+ rapid skips → Cleo stays silent (silence logic)
- [ ] "EDITORIAL INSIGHT" card shows (if enrichment data available)
- [ ] "SYNCHRONIZED NEXT" shows upcoming track

### Flow 4: Background Audio
- [ ] Lock device → music continues playing
- [ ] Cleo commentary still fires in background
- [ ] Lock screen shows Now Playing controls (play/pause/skip)
- [ ] Switch to another app → audio continues
- [ ] Return to app → player state matches (correct track, progress)
- [ ] Kill app entirely → reopen → session resumes (track still playing)

### Flow 5: Network Resilience
- [ ] Enable airplane mode during playback → music continues (cached)
- [ ] Cleo segment generation fails → fallback line used (no crash)
- [ ] Disable airplane mode → next segment generates normally
- [ ] Server down → app still plays music, Cleo uses fallbacks
- [ ] Slow network → 10s timeout fires, fallback delivered

### Flow 6: Session Arc Tab
- [ ] Navigate to Arc tab → session visualization renders
- [ ] "LIVE SESSION" label + session duration display
- [ ] "SESSION PULSE" shows current phase
- [ ] "UPCOMING MANIFEST" shows next tracks in queue
- [ ] Current track highlighted with gold edge

### Flow 7: Archive Tab
- [ ] Navigate to Archive tab → "BROADCAST ARCHIVES" label
- [ ] Filter tabs (Latest, By Mood, By Date) respond to taps
- [ ] After ending a session, archive entry appears
- [ ] Empty state displays if no history

### Flow 8: Profile (Cleo) Tab
- [ ] Navigate to Cleo tab → profile renders with avatar
- [ ] User name and email display correctly
- [ ] AI Personality selection works (Curator/Companion/Oracle)
- [ ] Selection persists after leaving and returning
- [ ] Apple Music shows "Connected" status
- [ ] Host Volume Mix slider moves and shows dB value
- [ ] Manage Subscription → "Coming Soon" alert
- [ ] Sign Out → confirmation dialog → returns to login

### Flow 9: Edge Cases
- [ ] Very short track (<1 min) → Cleo handles gracefully (brief or silent)
- [ ] Very long track (>6 min) → mid-song drop fires (~40% chance)
- [ ] Empty playlist (0 tracks) → no crash, handles gracefully
- [ ] Large playlist (100+ tracks) → loads without timeout
- [ ] Rapid tab switching → no render crashes
- [ ] Rotate device (if supported) → layout doesn't break
- [ ] Low battery mode → audio still plays

### Flow 10: App Store Review Risks
- [ ] No login wall before value preview (Apple guideline 3.1.1) — verify user can see what the app does before signing in
- [ ] Privacy manifest present and accurate
- [ ] No references to "beta", "test", or "coming soon" visible in main UI (except Manage Subscription which is in settings)
- [ ] Apple Music usage description is clear and accurate
- [ ] No private API usage warnings in build log
- [ ] App doesn't crash on any screen (test all 4 tabs + player)
- [ ] Background audio works correctly (Apple tests this)

---

## Test Execution Order

1. **Run Jest suite** — fix any failures before device testing
2. **Flow 1** (fresh install) — validates onboarding gate
3. **Flow 2** (home) — validates core navigation
4. **Flow 3** (radio loop) — the heart of the app, test thoroughly
5. **Flow 4** (background) — Apple reviews this carefully
6. **Flow 8** (profile) — validates new controls work
7. **Flow 5** (network) — ensures graceful degradation
8. **Flow 6-7** (arc + archive) — secondary screens
9. **Flow 9** (edge cases) — stress test
10. **Flow 10** (review risks) — final pre-submit check

---

## Success Criteria

- [ ] All Jest tests pass
- [ ] Zero crashes across all manual flows
- [ ] Core radio loop completes 5+ track changes without issue
- [ ] Background audio survives 10+ minutes
- [ ] All 4 tabs render correctly
- [ ] Fallbacks fire on network failure (no silent dead air)
- [ ] No App Store review blockers identified

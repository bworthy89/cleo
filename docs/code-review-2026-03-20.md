# Cleo Code Review — 2026-03-20

## Summary

Comprehensive code review across all layers: engines, services, screens/components, server, native module, and app config. **45 issues found** organized into 5 fix phases by priority.

---

## Phase 1 — Session-Breaking Bugs

These cause stuck state, silent failures, or broken audio during normal listening sessions. Users will notice these.

### 1. AudioCoordinator: `isSpeaking` permanently stuck true
- **File:** `src/engines/AudioCoordinator.ts` (~line 194–213)
- **Severity:** Critical | **Category:** Bug
- When `generationId` is superseded in the pre_song `finally` block, `isSpeaking` is never cleared. This blocks all future Cleo speech for the rest of the session.
- **Fix:** Always set `this.isSpeaking = false` in the `finally` block regardless of whether `myId === this.generationId`.

### 2. AudioCoordinator: post_song Promise never resolves
- **File:** `src/engines/AudioCoordinator.ts` (~line 220–252)
- **Severity:** Critical | **Category:** Bug / Race Condition
- `cancelPendingTimer()` clears the timeout but never resolves the Promise. Any caller awaiting `handleTrackChangeWithResult` in the post_song path hangs forever.
- **Fix:** Store the `resolve` callback externally so `cancelPendingTimer()` can resolve it with `null`.

### 3. TransitionPreloader: TTS retry continues after reset()
- **File:** `src/engines/TransitionPreloader.ts` (~line 245–251)
- **Severity:** Critical | **Category:** Race Condition / Memory Leak
- During sleep intervals in the retry loop, state is not re-checked. Synthesis fires on a stale/reset preloader, potentially corrupting `cachedBase64` for the new track.
- **Fix:** Add `if (this.state !== 'generating') return;` after each sleep in the retry loop.

### 4. SessionEngine: `getConsecutiveSkips()` always returns 0
- **File:** `src/engines/SessionEngine.ts` (~line 99–112)
- **Severity:** Critical | **Category:** Logic Error
- Broken comparison logic (comparing skipped track IDs against played track IDs, which are mutually exclusive). Skip-replanning in `QueueManager.handleSkip()` never triggers.
- **Fix:** Track consecutive skips as a counter that increments on skip and resets to 0 on successful play.

### 5. AudioCoordinator: mid-song drop never ducks music
- **File:** `src/engines/AudioCoordinator.ts` (~line 310–341)
- **Severity:** Critical | **Category:** Bug
- `activateDuckingSession()` is never called before mid-song Cleo speech. Music plays at full volume and drowns out her voice.
- **Fix:** Call `await activateDuckingSession().catch(() => {})` before synthesizing the mid-song drop.

### 9. BroadcastScreen: uncancelled setTimeout timers
- **File:** `src/screens/player/BroadcastScreen.tsx` (~line 250–252, 287)
- **Severity:** Critical | **Category:** Bug
- `setCleoSpeaking(false)` fires on unmounted component or clears speaking state mid-speech on fast skips. Neither timer is stored in a ref or cleared on cleanup.
- **Fix:** Store timer IDs in `useRef`, clear in effect cleanup, and clear at the top of each new track handler.

### 12. ExpoMusicKitModule.swift: `AVAudioPlayer.stop()` never resolves promise
- **File:** `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` (~line 755–764)
- **Severity:** Critical | **Category:** Bug
- External interruption (AirPods pause, lock screen) calls `ttsPlayer.stop()`, but `stop()` does NOT trigger `audioPlayerDidFinishPlaying`. The promise never resolves, leaving AudioCoordinator permanently stuck.
- **Fix:** After calling `stop()`, manually clean up and resolve the pending promise.

### 13. ExpoMusicKitModule.swift: `playEjectTransition` double-call leaks promise
- **File:** `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` (~line 449–575)
- **Severity:** Critical | **Category:** Bug
- If called while another eject is in progress, the old `ejectPromiseResolve` is overwritten without being called. The original caller hangs forever.
- **Fix:** Resolve the dangling promise before overwriting: `self.ejectPromiseResolve?()` before reassignment.

---

## Phase 2 — Security & Cost Control

SSRF, unbounded API costs, and info disclosure. Must fix before wider rollout.

### 6. api.ts: silent unauthenticated requests
- **File:** `src/services/api.ts` (~line 20–22)
- **Severity:** Critical | **Category:** Security / Bug
- `authenticatedFetch` sends requests without auth header when token is null (startup race / signed-out user) instead of throwing. Callers that don't check `response.ok` silently process error data.
- **Fix:** Throw an error when the token is null rather than silently continuing.

### 11. video.ts: SSRF via unvalidated `audioUrl`
- **File:** `server/src/routes/video.ts` (~line 9, 33)
- **Severity:** Critical | **Category:** Security
- Authenticated user can supply an arbitrary URL pointing to internal infrastructure. HeyGen makes the request on your behalf.
- **Fix:** Validate `audioUrl` begins with `https://` and matches an allowlist of trusted hostnames.

### 26. segment.ts: no bounds on `maxTokens` from client
- **File:** `server/src/routes/segment.ts` (~line 8, 33)
- **Severity:** High | **Category:** Security / Cost
- Client can pass `maxTokens: 1000000`, burning Gemini budget. Intended cap per CLAUDE.md is 8192.
- **Fix:** Clamp to `Math.min(Math.max(maxTokens, 256), 8192)`.

### 27. voice.ts: no validation on voice settings or text length
- **File:** `server/src/routes/voice.ts` (~line 55–83)
- **Severity:** High | **Category:** Security / Cost
- `stability`, `style`, `speed` ranges not validated. No upper bound on `text` length — a 100K character string generates an expensive TTS call.
- **Fix:** Clamp all values to valid ranges. Add `text.length > 5000` guard.

### 28. video.ts: no rate limiter on video generation route
- **File:** `server/src/index.ts` (~line 52)
- **Severity:** High | **Category:** Security
- Segment and voice routes have `generationLimiter` (30 req/min) but video route has none. HeyGen is the most expensive API.
- **Fix:** Add `generationLimiter` middleware to video route.

### 29. segment.ts: Gemini error response forwarded verbatim to client
- **File:** `server/src/routes/segment.ts` (~line 47)
- **Severity:** High | **Category:** Security (info disclosure)
- Raw Gemini error body may contain quota details, trace strings, or partial API key references.
- **Fix:** Log the error server-side; return a generic `502 "Upstream generation service error"` to the client.

### 30. enrichment.ts: `geniusRateLimitedFetch` race condition
- **File:** `server/src/routes/enrichment.ts` (~line 5–21)
- **Severity:** High | **Category:** Bug
- Check-then-set on `lastGeniusRequestTime` is not atomic. Two concurrent requests can both pass the rate limit check and fire simultaneously.
- **Fix:** Use a promise-chain queue to serialize Genius requests.

### 31. ExpoMusicKitModule.swift: `resolveArtworkUrl` blocks module queue
- **File:** `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` (~line 666)
- **Severity:** High | **Category:** Performance
- `Data(contentsOf: url)` is a synchronous blocking network call. For 20+ playlists, this serializes into a multi-second block.
- **Fix:** Use async `URLSession.data(from:)` or skip resolution for non-HTTP URLs during list calls.

### 34. video.ts: path traversal in video status route
- **File:** `server/src/routes/video.ts` (~line 56)
- **Severity:** High | **Category:** Security
- `req.params.id` interpolated into HeyGen URL without sanitization. Crafted IDs can inject extra query params.
- **Fix:** Validate with `/^[a-zA-Z0-9_-]{8,64}$/` regex.

---

## Phase 3 — Data Integrity

Corrupt storage crashes, wrong track naming, queue corruption, and re-onboarding loops.

### 7. SessionMemory/Storage: bare `JSON.parse` crashes on corrupt data
- **File:** `src/services/SessionMemory.ts` (~line 24), `src/services/Storage.ts` (~line 42, 93)
- **Severity:** Critical | **Category:** Error Handling
- No try/catch around MMKV reads. Interrupted writes → `SyntaxError` → crash loop.
- **Fix:** Wrap in try/catch, clear corrupt data on parse failure, return null.

### 10. BroadcastScreen: uses `sessionEngine.getNextTrackId()` for spoken content
- **File:** `src/screens/player/BroadcastScreen.tsx` (~line 125–126, 255–256, 292–293)
- **Severity:** Critical | **Category:** Bug (documented known issue)
- Queue plan index drifts from MusicKit's actual queue. Cleo names the wrong upcoming track.
- **Fix:** Replace with `getNextInQueue()` from the native module in all three call sites.

### 18. QueueManager: station switch during 10s delay corrupts new session's queue
- **File:** `src/engines/QueueManager.ts` (~line 103–146)
- **Severity:** High | **Category:** Race Condition
- `upgradeQueueInBackground` wakes up after delay and reads `this.currentPlaylistId` / `this.trackProfiles` which now belong to the new station.
- **Fix:** Capture `playlistId` and profiles snapshot at invocation, bail if they've changed.

### 21. QueueManager: `advanceTrack()` called eagerly in `initializeSession`
- **File:** `src/engines/QueueManager.ts` (~line 72)
- **Severity:** High | **Category:** Logic Error
- Pushes first track into `tracksPlayed` and increments `currentQueueIndex` before playback starts. If `onTrackChanged` also fires, the track is double-counted and queue index skews.
- **Fix:** Remove eager `advanceTrack` call. Let `onTrackChanged` be the sole source of truth.

### 32. app/index.tsx: sign-out forces full re-onboarding on next sign-in
- **File:** `app/index.tsx` (~line 32–34), `src/services/Storage.ts` (~line 101–108)
- **Severity:** Medium | **Category:** Auth / Bug
- `clearUserData()` on sign-out removes the `USER` MMKV key. Next sign-in sees no user → routes to onboarding. Almost certainly unintended for returning users.
- **Fix:** Either don't clear the `USER` key on sign-out, or add a Firebase-persisted flag to detect returning users.

### 33. music-auth.tsx: `as any` cast suppresses type errors on partial UserData
- **File:** `app/(onboarding)/music-auth.tsx` (~line 19–23, 39–44)
- **Severity:** Medium | **Category:** Auth / Bug
- `getUser()` returns `undefined` at this point in onboarding. Spreading `undefined` with `as any` silently produces a partial object that downstream consumers may fail on.
- **Fix:** Remove `as any` and explicitly construct the full `UserData` object.

---

## Phase 4 — Audio Quality

TTS timeouts, rate limit violations, and voice parameter bugs that degrade Cleo's speech quality.

### 8. MusicKitPlayer: one bad listener kills all others
- **File:** `src/services/MusicKitPlayer.ts` (~line 123–135)
- **Severity:** Critical | **Category:** Bug
- `forEach` without try/catch means a throwing callback aborts iteration. If a component's state setter throws, subsequent listeners (including AudioCoordinator) never fire.
- **Fix:** Wrap each listener call in try/catch.

### 15. SegmentController: eject transition double-advances rotation index
- **File:** `src/engines/SegmentController.ts` (~line 292–347)
- **Severity:** High | **Category:** Logic Error
- `generateEjectTransition()` calls `getNextSegmentType()` which increments `rotationIndex`. If fallback also runs, `generateNext()` increments it again, skewing the segment type rotation over time.
- **Fix:** Either don't advance rotation in `generateEjectTransition`, or ensure the same transition never calls both methods.

### 16. QueueManager: `enrichExistingSession` passes stale tracks to Genius
- **File:** `src/engines/QueueManager.ts` (~line 234–263)
- **Severity:** High | **Category:** Bug
- After `enrichMusicBrainzFirst()` replaces `this.trackProfiles`, `enrichGeniusInBackground(tracks)` is called with the pre-enrichment snapshot.
- **Fix:** Pass `this.trackProfiles` (re-read) to `enrichGeniusInBackground` instead of the captured `tracks` variable.

### 17. TransitionPreloader: `onEjectFired` can fire before null `cachedBase64` check
- **File:** `src/engines/TransitionPreloader.ts` (~line 315–343)
- **Severity:** High | **Category:** Bug
- If `state === 'ready'` but `cachedBase64` is somehow null, `fireEject` calls `onEjectFired` and then discovers null audio and calls `onFallback`, leaving AudioCoordinator in a confused state.
- **Fix:** Add early guard: `if (this.state === 'ready' && !this.cachedBase64)` → call fallback and return.

### 19. SegmentController: eject path consumes `lastWasMidSongDrop` flag prematurely
- **File:** `src/engines/SegmentController.ts` (~line 171–187, 297)
- **Severity:** High | **Category:** Logic Error
- `shouldStaySilent()` has a side effect (clears the flag). The eject call consumes it, so when fallback runs, the silence suppression is gone. Cleo speaks when she shouldn't.
- **Fix:** Don't call `shouldStaySilent()` from `generateEjectTransition`, or add a non-destructive check.

### 20. QueuePlanner: fragile JSON repair logic
- **File:** `src/engines/QueuePlanner.ts` (~line 131–144)
- **Severity:** High | **Category:** Bug
- Appending literal strings to mid-object truncated JSON can produce structurally invalid results. Mid-value truncations (inside a `reason` string) are not handled.
- **Fix:** Use a proper incremental JSON parser or battle-tested repair library.

### 22. CleoVoiceEngine: no timeout on `synthesize()`
- **File:** `src/services/CleoVoiceEngine.ts` (~line 174–183)
- **Severity:** High | **Category:** Error Handling
- ElevenLabs TTS can take 3–8s. A hung call blocks the eject preloader from ever reaching `ready` state. No timeout boundary on the TTS leg.
- **Fix:** Add a 15-second `AbortController` timeout around the `authenticatedFetch` call in `synthesize()`.

### 23. CleoScriptGenerator: unsanitized user data in Gemini prompt
- **File:** `src/services/CleoScriptGenerator.ts` (~line 87, 147–151)
- **Severity:** High | **Category:** Security
- `listenerName` (Firebase displayName), Genius annotations, and MMKV-persisted data are interpolated directly into the prompt. Malicious content could inject prompt-injection instructions.
- **Fix:** Sanitize with `value.replace(/[\n\r]/g, ' ').substring(0, 200)` before interpolation.

### 24. TrackEnrichmentService: violates MusicBrainz rate limit
- **File:** `src/services/TrackEnrichmentService.ts` (~line 122–128)
- **Severity:** High | **Category:** Bug
- `enrichTracks` loops over tracks with `await` but no delay between iterations. 20 tracks → 20 rapid requests violating the documented 1 req/sec limit.
- **Fix:** Add `await new Promise(r => setTimeout(r, 1100))` between iterations.

### 25. CleoVoiceEngine: `parseDeliveryCue` only matches cue at string start
- **File:** `src/services/CleoVoiceEngine.ts` (~line 37–41, 125)
- **Severity:** High | **Category:** Bug
- Regex requires `^` so cues mid-text are missed by parsing but then stripped by `formatForSpeech`'s stage-direction regex, losing the voice parameter adjustment entirely.
- **Fix:** Make `parseDeliveryCue` scan the whole text (remove `^` anchor).

---

## Phase 5 — UI Polish & Performance

Performance optimizations, accessibility, and safe area fixes.

### 14. app.json: `userInterfaceStyle: "light"` on dark-themed app
- **File:** `app.json` (~line 8)
- **Severity:** Critical | **Category:** Config
- iOS keyboard, status bar, and system alerts render in light mode against dark backgrounds.
- **Fix:** Change to `"userInterfaceStyle": "dark"`.

### 35. app/_layout.tsx: splash screen never hides if font loading fails
- **File:** `app/_layout.tsx` (~line 19–25)
- **Severity:** Medium | **Category:** Bug / UX
- Only checks `fontsLoaded`, not `fontError`. If font loading fails, splash screen stays forever.
- **Fix:** Check `if (fontsLoaded || fontError)` before hiding splash.

### 36. HomeScreenRedesign: unmemoized functions cause re-renders
- **File:** `src/screens/home/HomeScreenRedesign.tsx` (~line 180–206)
- **Severity:** Medium | **Category:** Performance
- `loadData` and `refreshNowPlaying` create new function refs every render.
- **Fix:** Wrap in `useCallback`.

### 37. SessionArcScreen: 3s poll causes unnecessary MMKV reads
- **File:** `src/screens/arc/SessionArcScreen.tsx` (~line 318–327)
- **Severity:** Medium | **Category:** Performance
- `stationForSession` calls `getStations()` on every render tick. Result is not memoized.
- **Fix:** Wrap `stationForSession(session)` in `useMemo` dependent on `session?.stationId`.

### 38. ArchiveScreen: `handleStationPress` not memoized
- **File:** `src/screens/archive/ArchiveScreen.tsx` (~line 158–168)
- **Severity:** Medium | **Category:** Performance
- Passed as prop inside FlatList `renderItem` without `useCallback`, causing all visible ArchiveCards to re-render on any state change.
- **Fix:** Wrap in `useCallback`.

### 39. CleoSpeakingOverlay: exit animation can leave overlay permanently mounted
- **File:** `src/components/CleoSpeakingOverlay.tsx` (~line 218–237)
- **Severity:** Medium | **Category:** Bug
- If animation is interrupted (rapid skips), `finished` is false and `onDismiss` is never called. `overlayMounted` stays true forever.
- **Fix:** Call `onDismiss` unconditionally, or don't rely on it as sole unmount trigger.

### 40. server/index.ts: rate limit is per-IP, not per-user
- **File:** `server/src/index.ts` (~line 28–42)
- **Severity:** Medium | **Category:** Security
- Shared NAT/VPN users can be blocked by one heavy user. Since `req.uid` is already populated by `requireAuth`, rate limiting per-UID would be more precise.
- **Fix:** Add `keyGenerator: (req) => req.uid ?? req.ip` to rate limiter config.

### 41. TabBar: missing accessibility labels
- **File:** `src/components/TabBar.tsx` (~line 28–40)
- **Severity:** Low | **Category:** Accessibility
- No `accessibilityLabel` or `accessibilityRole` on tab Pressables. Violates explicit project guidelines.
- **Fix:** Add `accessibilityLabel={tab.label}` and `accessibilityRole="tab"`.

### 42. VibePicker: not safe-area-aware
- **File:** `src/components/VibePicker.tsx` (~line 23–24, 159–169)
- **Severity:** Low | **Category:** Bug / UX
- CTA button overlaps home indicator on newer iPhones. Uses hardcoded `paddingBottom` instead of `useSafeAreaInsets`.
- **Fix:** Use `useSafeAreaInsets()` and add `insets.bottom` to padding.

### 43. CleoVoiceEngine: truthy check on nudge values
- **File:** `src/services/CleoVoiceEngine.ts` (~line 47–49)
- **Severity:** Low | **Category:** Bug
- `if (nudge.stability)` skips a value of exactly 0. No current nudge is 0, but the pattern is fragile.
- **Fix:** Use `!== undefined` checks instead of truthy.

### 44. cold-opens.ts: uses raw string key instead of `StorageKeys` constant
- **File:** `src/cleo/cold-opens.ts` (~line 140, 147)
- **Severity:** Low | **Category:** Code Quality
- If `StorageKeys.COLD_OPEN_HISTORY` is ever renamed, `clearUserData()` clears the new key while cold-opens still reads/writes the old one.
- **Fix:** Import and use `StorageKeys.COLD_OPEN_HISTORY`.

### 45. ExpoMusicKitModule.swift: caches grow without bound
- **File:** `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` (~line 16–18)
- **Severity:** Low | **Category:** Performance
- `cachedTracks`, `cachedSongs`, `cachedPlaylists` are never pruned. A user browsing many playlists accumulates thousands of MusicKit objects in memory.
- **Fix:** Clear caches when a new playlist is loaded, or add LRU eviction.

---

## Fix Progress Tracker

- [x] Phase 1 complete (6 real bugs fixed; #1 and #5 were false positives)
  - #1: FALSE POSITIVE — `cancelPendingTimer()` already resets `isSpeaking = false`
  - [x] #2: FIXED — Added `pendingPostSongResolve` callback, resolved in `cancelPendingTimer()`
  - [x] #3: FIXED — Added `generationId` counter to distinguish stale generations, check after sleep
  - [x] #4: FIXED — Replaced broken array comparison with `consecutiveSkipCount` counter
  - #5: FALSE POSITIVE — native `playAudioFromBase64` sets `.duckOthers` internally
  - [x] #9: FIXED — Timer IDs stored in `cleoSpeakingTimerRef`, cleared on cleanup and new track
  - [x] #12: FIXED — Manual cleanup after `ttsPlayer.stop()` resolves promise and resets state
  - [x] #13: FIXED — Old `ejectPromiseResolve` resolved before overwriting in double-call case
- [x] Phase 2 complete (9 items all fixed)
  - [x] #6: FIXED — `authenticatedFetch` now throws when token is null instead of silently continuing
  - [x] #11: FIXED — `audioUrl` validated as HTTPS-only; video status ID validated with regex
  - [x] #26: FIXED — `maxTokens` clamped to 256–8192 range server-side
  - [x] #27: FIXED — voice `stability`/`style`/`speed` clamped to valid ranges; text length capped at 5000 chars
  - [x] #28: FIXED — `generationLimiter` added to video route
  - [x] #29: FIXED — Gemini errors logged server-side, generic 502 returned to client
  - [x] #30: FIXED — Genius rate limiter replaced with promise-chain queue for atomic serialization
  - [x] #31: FIXED — `resolveArtworkUrl` now caches asynchronously via `Task.detached`, returns nil on first miss
  - [x] #34: FIXED — Video status route validates `req.params.id` format before interpolation
- [x] Phase 3 complete (6 items + bonus #16 fixed)
  - [x] #7: FIXED — try/catch around all `JSON.parse` calls in SessionMemory, Storage, and SessionEngine
  - [x] #10: FIXED — `handleTrackStart` now uses `getNextInQueue()` (MusicKit queue) instead of `getNextTrackId()` (plan index)
  - [x] #18: FIXED — `upgradeQueueInBackground` captures `playlistId` at invocation, bails if session changed
  - [x] #21: FIXED — Removed eager `advanceTrack(allTrackIds[0])` from `initializeSession`; `onTrackChanged` is sole source
  - [x] #32: FIXED — `clearUserData()` no longer removes `StorageKeys.USER`, preserving profile across sign-out
  - [x] #33: FIXED — Removed `as any` casts; explicitly construct full `UserData` object in both handlers
  - [x] #16 (bonus): FIXED — `enrichExistingSession` passes `this.trackProfiles` to Genius instead of stale snapshot
- [x] Phase 4 complete (10 items; #16 done in Phase 3, #17 false positive)
  - [x] #8: FIXED — All MusicKitPlayer listener forEach callbacks wrapped in try/catch
  - [x] #15: FIXED — `generateEjectTransition` peeks rotation without advancing; advances only on success
  - #16: Already fixed in Phase 3 (bonus)
  - #17: FALSE POSITIVE — `fireEject()` checks `cachedBase64` null BEFORE calling `onEjectFired`
  - [x] #19: FIXED — Eject path checks `lastWasMidSongDrop` without consuming it (returns early, no side effect)
  - [x] #20: FIXED — JSON repair replaced with regex-based entry extraction (recovers valid entries from truncated JSON)
  - [x] #22: FIXED — `synthesize()` now has 15s AbortController timeout with cleanup
  - [x] #23: FIXED — `sanitize()` helper strips newlines and truncates external strings before prompt injection
  - [x] #24: FIXED — 1100ms delay between `enrichTrack` calls; also protected `getCached` JSON.parse
  - [x] #25: FIXED — `parseDeliveryCue` regex removed `^` anchor; uses `text.replace()` to strip cue from any position
- [x] Phase 5 complete (12 items all fixed)
  - [x] #14: FIXED — `userInterfaceStyle` changed from `"light"` to `"dark"` in app.json
  - [x] #35: FIXED — Splash screen now hides on `fontsLoaded || fontError`
  - [x] #36: FIXED — `loadData` and `refreshNowPlaying` wrapped in `useCallback`
  - [x] #37: FIXED — `stationForSession` result memoized with `useMemo` on `session?.stationId`
  - [x] #38: FIXED — `handleStationPress` wrapped in `useCallback`
  - [x] #39: FIXED — Exit animation calls `finish()` unconditionally (not gated by `finished` flag)
  - [x] #40: FIXED — Rate limiters now use `keyGenerator` based on `req.uid` instead of IP
  - [x] #41: FIXED — Tab `Pressable` items have `accessibilityLabel`, `accessibilityRole="tab"`, and `accessibilityState`
  - [x] #42: FIXED — VibePicker uses `useWindowDimensions` + `useSafeAreaInsets`, adds `insets.bottom` to padding
  - [x] #43: FIXED — Nudge checks use `!== undefined` instead of truthy
  - [x] #44: FIXED — `cold-opens.ts` imports and uses `StorageKeys.COLD_OPEN_HISTORY`
  - [x] #45: REVERTED — Clearing caches at `fetchPlaylistTracks` broke active sessions (caches needed by `setUpcomingQueue`). Needs a smarter approach (clear only when switching playlists, not on re-fetch).

# Radio Experience Design — Presence, Continuity & Crossfade

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Mid-song Cleo drops, session memory persistence, music crossfade under Cleo's voice

---

## Overview

Three improvements that compound to make Cleo feel like a real radio station, not a playlist with commentary. Higher Cleo frequency eliminates dead gaps. Session memory creates continuity across app opens. Music crossfade under Cleo's voice removes the hard cut between speech and music.

---

## 1. Mid-Song Cleo Drops

### Problem
Cleo only speaks on track changes. During a 4-minute song, there's no Cleo presence — the app feels like a regular music player.

### Solution
Add a mid-song trigger for brief Cleo drops during longer tracks.

**Rules:**
- Tracks longer than 3 minutes qualify
- 40% chance of a mid-song drop per qualifying track
- Fires between the 45–90 second mark (randomized within range)
- Max 25 words — brief, non-intrusive
- Segment types allowed: `station_id`, `session_checkin`, `post_track_reflection`
- Delivery mode: always `post_song` (music is playing)
- 30-second cooldown after any Cleo segment — prevents stacking with `pre_song` or `post_song` from a track change
- Skipped if `isSpeaking` is true
- Skipped if `pendingPostSongTimer` is not null (a post-song segment is still pending)

### Implementation

**TrackInfo interface** in both `AudioCoordinator.ts` and `SegmentController.ts` must add `duration?: number`. Callers pass this from `NowPlaying.duration` (already available via `musicKitPlayer.getNowPlaying()`). The `onTrackChanged` event only sends `trackId` — the caller (PlayerScreen) already calls `getNowPlaying()` to get the full track data including duration and passes it to `handleTrackChangeWithResult`.

**AudioCoordinator** gains:
- `pendingMidSongTimer: ReturnType<typeof setTimeout> | null` — separate from `pendingPostSongTimer`
- `lastSegmentEndTime: number` — set to `Date.now()` after any segment finishes playing (in the `finally` blocks of both pre_song and post_song paths)
- `scheduleMidSongDrop(trackInfo: TrackInfo)` method:
  - Called after `handleTrackChangeWithResult` resolves (for `pre_song`) or after the post-song segment plays (for `post_song`)
  - Guards: `trackInfo.duration && trackInfo.duration > 180` — if not, return
  - Rolls `Math.random() < 0.4` — if not, return
  - Picks random delay between 45000–90000ms
  - Sets `pendingMidSongTimer`
  - Timer callback: checks `isSpeaking`, checks cooldown (`Date.now() - lastSegmentEndTime > 30000`), checks `pendingPostSongTimer === null`, generates via `segmentController.generateMidSongDrop(trackInfo)`, plays it

**Cancellation:** `cancelPendingTimer()` clears both `pendingPostSongTimer` and `pendingMidSongTimer`. Track skip cancels all timers.

**SegmentController** gains:
- `generateMidSongDrop(currentTrack: TrackInfo): Promise<SegmentResult>` — standalone generation path that:
  - Picks randomly from `['station_id', 'session_checkin', 'post_track_reflection']`
  - Forces `deliveryMode: 'post_song'`
  - Passes `maxWords: 25` in the `SegmentContext`
  - Does NOT advance the rotation index
  - Does NOT affect `lastDeliveryMode` or `consecutivePreSong` tracking
  - DOES add to `segmentHistory` (to prevent repetition)
  - DOES add `currentTrack.artistName` to `tracksReferenced`
  - DOES increment `segmentCount` (affects session phase)

**CleoScriptGenerator** changes:
- Add `maxWords?: number` to the `SegmentContext` interface
- In `buildDynamicPrompt`, if `context.maxWords` is set, OUTPUT RULES changes from "40 to 75 words maximum" to "15 to [maxWords] words maximum"

---

## 2. Session Memory & Continuity

### Problem
Closing and reopening the app loses all context. Every session feels like the first.

### Solution
Persist session context to MMKV. Use it in the dynamic prompt so Cleo can reference previous sessions naturally.

### What Gets Persisted

New MMKV keys, written after every segment generation:

| Key | Type | Description |
|---|---|---|
| `session.lastStationId` | `string` | Station ID from last session |
| `session.lastVibe` | `string` | Vibe from last session |
| `session.lastArtists` | `string[]` | Last 10 artists heard (FIFO — newest first, drop oldest beyond 10) |
| `session.lastTrackTitle` | `string` | Last track that was playing |
| `session.lastArtistName` | `string` | Artist of last track |
| `session.lastTimestamp` | `number` | `Date.now()` of last segment |
| `session.sessionCount` | `number` | Total sessions started |

### SessionMemory Module

New file: `src/services/SessionMemory.ts`

```typescript
interface SessionMemoryData {
  lastStationId: string;
  lastVibe: string;
  lastArtists: string[];
  lastTrackTitle: string;
  lastArtistName: string;
  lastTimestamp: number;
  sessionCount: number;
}

function save(data: Partial<SessionMemoryData>): void
function load(): SessionMemoryData | null
function getTimeSinceLastSession(): { hours: number; sameDay: boolean; label: string }
function incrementSessionCount(): number
function clear(): void
```

Thin MMKV read/write layer. No business logic — just storage.

`getTimeSinceLastSession().label` returns: "just now" (< 1 hour), "X hours ago" (1–4 hours), "yesterday" (4–24 hours), "X days ago" (> 24 hours).

### Who Writes What

| Field | Written By | When |
|---|---|---|
| `lastStationId` | `SegmentController.startSession(stationId, vibe)` | Session start (new param) |
| `lastVibe` | `SegmentController.startSession(stationId, vibe)` | Session start (new param) |
| `lastArtists` | `SegmentController.generateNext()` / `generateMidSongDrop()` | Every segment generation |
| `lastTrackTitle` | `SegmentController.generateNext()` / `generateMidSongDrop()` | Every segment generation |
| `lastArtistName` | `SegmentController.generateNext()` / `generateMidSongDrop()` | Every segment generation |
| `lastTimestamp` | `SegmentController.generateNext()` / `generateMidSongDrop()` | Every segment generation |
| `sessionCount` | `SegmentController.startSession()` via `incrementSessionCount()` | Session start |

`startSession()` gains two new parameters: `stationId: string` and `vibe: Vibe`. Callers (PlayerScreen) already have both values.

### How Cleo Uses It

`SegmentController.startSession()` reads `SessionMemory.load()` and stores the result. It is passed to `CleoScriptGenerator` via `SegmentContext`.

New optional field on `SegmentContext`:
```typescript
previousSession?: {
  stationName: string;
  vibe: string;
  lastTrack: string;
  lastArtist: string;
  timeSince: string;
  artists: string[];
  sessionNumber: number;
  returningToSameStation: boolean;
  switchedStation: boolean;
};
```

New block added to dynamic prompt when `previousSession` exists:

```
PREVIOUS SESSION
- Last station: [stationName]
- Last vibe: [vibe]
- Last track: "[title]" by [artist]
- Time since: [label]
- Artists from last session: [list]
- Session number: [N]
- Returning to same station: [yes/no]
```

Gemini decides how to use this context. No new hardcoded cold open categories — the existing cold open system fires first, then the dynamic prompt gives Cleo memory to work with in her segment.

### Return Scenarios

| Scenario | Time Gap | Prompt Context |
|---|---|---|
| Same-day return | < 4 hours | Full previous session context. Cleo can reference what was playing. |
| Next-day return | 4–24 hours | Previous session context with "yesterday" framing. |
| Multi-day return | > 24 hours | Lighter context — session count, last vibe only. |
| Same station return | Any | Flag `returningToSameStation: true` so Cleo can acknowledge consistency. |
| Different station | Any | Flag `switchedStation: true` so Cleo can acknowledge the mood change. |

---

## 3. Music Crossfade Under Cleo

### Problem
When Cleo finishes speaking, there's a hard cut to the next song at full volume. Real radio has the music rising under the DJ's last words.

### Solution
At the fade point (~2 seconds before Cleo finishes), deactivate ducking so iOS ramps the music back up naturally. Cleo's last words play over the rising music. Simple, no volume management code needed.

### Approach: Ducking Deactivation at Fade Point

`ApplicationMusicPlayer.shared` does not expose a per-player volume property, and `MPVolumeView` controls system volume (which would affect Cleo's voice too). Instead, we use iOS's built-in ducking ramp: when we call `setActive(false, options: .notifyOthersOnDeactivation)` while music is ducked, iOS ramps the ducked audio back up over ~0.5s. By doing this 2 seconds before Cleo finishes, her last words overlap with the rising music naturally.

### Native Implementation (ExpoMusicKitModule.swift)

**New state on `ExpoMusicKitModule`:**
- `private var crossfadeTimer: Timer?` — the fade point timer
- `private var crossfadeActive: Bool = false` — whether music was already started by the crossfade

**In `playAudioFromBase64`, after `audioPlayer.prepareToPlay()`:**

1. Read `audioPlayer.duration`
2. If `duration > 3.0`:
   - Calculate `fadePoint = duration - 2.0`
   - Schedule `crossfadeTimer` at `fadePoint` seconds
3. When fade timer fires:
   - Guard: `self.audioPlayer?.isPlaying == true` (audio wasn't stopped)
   - Set `crossfadeActive = true`
   - Deactivate ducking: `AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)`
   - Music resumes at natural volume over iOS's built-in ramp (~0.5s)

**In `audioPlayerDidFinishPlaying`:**
- Invalidate `crossfadeTimer` if still pending
- If `crossfadeActive`:
  - Do NOT call `player.play()` (music already resumed from fade point)
  - Do NOT deactivate audio session (already deactivated)
  - Set `crossfadeActive = false`
  - Resolve promise
- If NOT `crossfadeActive` (short segment or crossfade didn't fire):
  - Run existing behavior: deactivate session, call `player.play()`, resolve promise

**If duration ≤ 3.0:** No crossfade timer scheduled. Existing hard-transition behavior.

**In `stopAudio`:** Invalidate `crossfadeTimer`, set `crossfadeActive = false`.

### Edge Cases

- **Short segments (≤ 3s):** No crossfade — hard transition as today
- **User skips during crossfade:** `stopAudio()` kills the fade timer, resets `crossfadeActive`
- **`post_song` mode:** Music is already playing and ducked. No crossfade — Cleo ducks and speaks, then ducking deactivates on finish as today.
- **Mid-song drops:** Same as `post_song` — music already playing, no crossfade needed
- **Crossfade timer fires but audio was stopped:** `audioPlayer?.isPlaying` guard prevents action
- **Crossfade only applies to `pre_song` segments:** The JS layer does not need to signal this — the native module applies crossfade logic to ALL `playAudioFromBase64` calls, but for `post_song`/mid-song, the music is already unducked, so the `setActive(false)` call at fade point is a no-op.

### JS Layer

No changes. The crossfade is entirely native. The `playAudioFromBase64` promise still resolves when Cleo's audio finishes. The calling code doesn't know or care about the crossfade.

---

## Files to Modify

| Order | File | Changes |
|---|---|---|
| 1 | `src/services/SessionMemory.ts` | **New file** — MMKV read/write for session context, `clear()` method |
| 2 | `src/services/CleoScriptGenerator.ts` | Add `maxWords?: number` and `previousSession?` to `SegmentContext`; add PREVIOUS SESSION block and variable word limit to dynamic prompt |
| 3 | `src/engines/SegmentController.ts` | Add `generateMidSongDrop()` (standalone, no rotation/mode side effects); add `duration?: number` to `TrackInfo`; update `startSession(stationId, vibe)` to read/write SessionMemory; write SessionMemory on every `generateNext()` |
| 4 | `src/engines/AudioCoordinator.ts` | Add `duration?: number` to `TrackInfo`; add `scheduleMidSongDrop()`, `pendingMidSongTimer`, `lastSegmentEndTime`; update `cancelPendingTimer()` to clear mid-song timer |
| 5 | `src/screens/player/PlayerScreen.tsx` | Pass `duration` in track info to `handleTrackChangeWithResult`; pass `stationId` and `vibe` to `segmentController.startSession()` |
| 6 | `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` | Add `crossfadeTimer`, `crossfadeActive` flag; add fade-point timer logic in `playAudioFromBase64`; branch `audioPlayerDidFinishPlaying` on crossfade state; update `stopAudio` to clean up crossfade state |

---

## Success Criteria

- Cleo speaks roughly every 1–2 minutes during a session (including mid-song drops)
- Mid-song drops never exceed 25 words and feel like brief asides, not interruptions
- Mid-song drops never collide with pending post-song segments
- Returning to the app after hours/days, Cleo references the previous session naturally
- When Cleo finishes a `pre_song` segment, music rises under her last words — no hard cut to silence then music
- Skipping a track cancels all pending timers (mid-song, post-song, crossfade)
- `post_song` and mid-song segments do not trigger crossfade (music is already playing)
- `generateMidSongDrop` does not corrupt the rotation index or delivery mode tracking

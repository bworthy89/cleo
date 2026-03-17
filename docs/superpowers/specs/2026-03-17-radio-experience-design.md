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

### Implementation

**AudioCoordinator** gains a `scheduleMidSongDrop(trackDuration: number)` method:
- Called after a track change is fully handled (segment played or skipped)
- Checks if `trackDuration > 180` (3 minutes)
- Rolls 40% chance — if no, returns
- Picks random delay between 45000–90000ms
- Sets `pendingMidSongTimer` (new field, separate from `pendingPostSongTimer`)
- Timer fires: checks `isSpeaking`, checks cooldown (`Date.now() - lastSegmentEndTime > 30000`), generates a short segment, plays it

**SegmentController** gains:
- `generateMidSongDrop(currentTrack)` — like `generateNext` but forces `post_song` mode, limits to `station_id | session_checkin | post_track_reflection`, and passes `maxWords: 25` in the context

**CleoScriptGenerator** respects `maxWords` in context:
- If `maxWords` is set, the OUTPUT RULES line changes from "40 to 75 words" to "15 to [maxWords] words"

**Cancellation:**
- `cancelPendingTimer()` also clears `pendingMidSongTimer`
- Track skip cancels mid-song timer (same as post_song timer)

---

## 2. Session Memory & Continuity

### Problem
Closing and reopening the app loses all context. Every session feels like the first.

### Solution
Persist session context to MMKV. Use it in the dynamic prompt so Cleo can reference previous sessions naturally.

### What Gets Persisted

New MMKV keys, written by `SessionMemory.save()` after every segment generation:

| Key | Type | Description |
|---|---|---|
| `session.lastStationId` | `string` | Station ID from last session |
| `session.lastVibe` | `string` | Vibe from last session |
| `session.lastArtists` | `string[]` | Last 10 artists heard (deduplicated) |
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
```

Thin MMKV read/write layer. No business logic — just storage.

### How Cleo Uses It

`SegmentController.startSession()` reads `SessionMemory.load()` and passes relevant context to `CleoScriptGenerator` via the dynamic prompt.

New fields added to dynamic prompt when session memory exists:

```
PREVIOUS SESSION
- Last station: [stationName]
- Last vibe: [vibe]
- Last track: "[title]" by [artist]
- Time since: [X hours ago / yesterday / 3 days ago]
- Artists from last session: [list]
- Session number: [N]
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
Start the next track at low volume during the last ~2 seconds of Cleo's audio, then ramp to full volume over 2.5 seconds.

### Native Implementation (ExpoMusicKitModule.swift)

**In `playAudioFromBase64`:**

1. After `AVAudioPlayer` is created, read `player.duration`
2. If `duration > 3.0` (skip crossfade for very short segments):
   - Calculate `fadePoint = duration - 2.0`
   - Schedule a timer at `fadePoint` seconds
3. When fade timer fires:
   - Call `ApplicationMusicPlayer.shared.play()` (starts next track)
   - Set initial volume to 0.15 via system volume or MusicKit API
   - Start a repeating timer (~50ms interval) that ramps volume from 0.15 → 1.0 over 2.5 seconds
4. When `audioPlayerDidFinishPlaying` fires:
   - Do NOT call `player.play()` again (music is already playing from step 3)
   - Do NOT deactivate the audio session immediately — let the ramp finish
   - Deactivate ducking session after ramp completes

**If duration ≤ 3.0:** Fall back to current behavior (hard transition).

**Volume control:** `ApplicationMusicPlayer.shared` does not expose a volume property directly. Use `MPVolumeView` or adjust the ducking level instead. Alternative: instead of controlling MusicKit volume, gradually reduce the ducking intensity — deactivate ducking at the fade point so music returns to natural volume over its own ramp.

**Simpler alternative if volume control is unavailable:** At the fade point, simply deactivate ducking (`setActive(false, options: .notifyOthersOnDeactivation)`) while Cleo is still speaking. iOS will ramp the ducked audio back up naturally over ~0.5s. Cleo's last words play over the rising music. This achieves 80% of the effect with zero volume management code.

### Edge Cases

- **Short segments (≤ 3s):** No crossfade — hard transition
- **User skips during crossfade:** `cancelPendingTimer()` kills the fade timer, sets volume to 1.0 immediately
- **`post_song` mode:** Music is already playing — no crossfade. Cleo ducks and speaks over it as today.
- **Mid-song drops:** Music is already playing — no crossfade needed
- **Crossfade timer fires but audio was stopped:** Guard with `audioPlayer?.isPlaying` check before starting music

### JS Layer

No changes. The crossfade is entirely native. The `playAudioFromBase64` promise still resolves when Cleo's audio finishes. The calling code doesn't know or care about the crossfade.

---

## Files to Modify

| Order | File | Changes |
|---|---|---|
| 1 | `src/services/SessionMemory.ts` | **New file** — MMKV read/write for session context |
| 2 | `src/services/CleoScriptGenerator.ts` | Add `maxWords` support in OUTPUT RULES; add PREVIOUS SESSION block to dynamic prompt |
| 3 | `src/engines/SegmentController.ts` | Add `generateMidSongDrop()`; read/write `SessionMemory` on session start and segment generation |
| 4 | `src/engines/AudioCoordinator.ts` | Add `scheduleMidSongDrop()`, `pendingMidSongTimer`, cooldown tracking (`lastSegmentEndTime`) |
| 5 | `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` | Add crossfade logic in `playAudioFromBase64` — fade timer, ducking deactivation at fade point |

---

## Success Criteria

- Cleo speaks roughly every 1–2 minutes during a session (including mid-song drops)
- Mid-song drops never exceed 25 words and feel like brief asides, not interruptions
- Returning to the app after hours/days, Cleo references the previous session naturally
- When Cleo finishes a `pre_song` segment, music rises under her last words — no hard cut to silence then music
- Skipping a track cancels all pending timers (mid-song, post-song, crossfade)
- `post_song` and mid-song segments do not trigger crossfade (music is already playing)

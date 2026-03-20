# Eject Window Timing System — Design Spec

## Overview

Replace Cleo's post-track-change timing model with a radio-style "eject window" system. Cleo pre-generates her transition script and TTS audio mid-track, then speaks over the outgoing track's fade-out with a three-layer crossfade (old track fading out, Cleo's voice, new track fading in). On manual skips or pre-generation failure, falls back to the existing post-track-change flow.

## Goals

- **Radio flow**: Cleo talks over the fade-out of the ending track, bridging into the next one like a real DJ
- **Zero dead air**: Pre-generated TTS fires instantly at the eject point, no generation delay
- **Graceful degradation**: Falls back to current behavior when pre-generation misses the window

## Approach

Hybrid Timer (Approach 3): JS handles all decision-making (when to pre-generate, eject window size, fallback logic). The actual crossfade execution is a single atomic native call. Timing logic is easy to tune in JS; the audio-critical crossfade is glitch-free in native.

---

## 1. Pre-Generation Pipeline

A new `TransitionPreloader` class in `src/engines/TransitionPreloader.ts` manages the pre-generation lifecycle per track.

### Pre-Gen Trigger Points (adaptive by track length)

| Track Duration | Trigger Point | Example (4:00 track) |
|---------------|--------------|----------------------|
| < 3 min       | 50%          | 1:15 of 2:30         |
| 3-5 min       | 60%          | 2:24 of 4:00         |
| 5+ min        | 70%          | 4:12 of 6:00         |

### State Machine

```
idle → generating → ready → fired → done
```

- `idle`: Track is playing, waiting for trigger point
- `generating`: Script generation + TTS synthesis in progress
- `ready`: TTS base64 audio cached in memory, waiting for eject window
- `fired`: Native `playEjectTransition()` called
- `done`: Transition complete, ready for reset

### Lifecycle

1. When a track starts, calculate the pre-gen trigger point and eject window based on duration.
2. Listen to existing `onPlaybackStateChanged` events (already fired at 0.5s intervals by the native module's `playbackTimer`). Compare the event's `playbackTime` against the pre-computed trigger threshold (calculated from `TrackInfo.duration` passed into `startForTrack()`). When `playbackTime >= triggerPoint`, begin generation. No additional polling — reuse the existing event stream. Duration comes from the TrackInfo at init time, not from the event.
3. Call `SegmentController.generateNext()` with `deliveryMode: 'eject_transition'`, then synthesize TTS via `CleoVoiceEngine`.
4. Cache the raw base64 TTS audio in memory (not played yet). Mark state as `ready`.
5. If the track ends before reaching `ready`, abandon pre-gen and let fallback handle it.

### Short Track Fallback Rate

For tracks under 3 minutes, the pre-gen trigger is at 50% and the eject window may be only 60s later. If Gemini generation hits the 8s timeout and TTS takes 3-5s, that still leaves ~45s of margin. However, short tracks will have a higher fallback rate than long tracks due to tighter timing. This is acceptable — the fallback path works well for short tracks since there's less "radio flow" expectation on a 2-minute song.

---

## 2. Eject Window & Trigger

The eject window is the time range near the end of a track where Cleo starts speaking.

### Eject Window Size (by genre)

| Genre                    | Window Size | Rationale                    |
|--------------------------|-------------|------------------------------|
| Electronic/Ambient/Jazz  | 20-25s      | Longer instrumental outros   |
| Pop/Hip-Hop/R&B          | 12-15s      | Tighter endings              |
| Rock/Indie               | 15-18s      | Middle ground                |
| Unknown/Other            | 15s         | Safe default                 |

Genre is read from MusicKit's `genreNames` array on the track. Genre matching checks if any element in the array contains a keyword (case-insensitive): "electronic", "ambient", "jazz" → 22s (midpoint); "pop", "hip-hop", "r&b" → 13s (midpoint); "rock", "indie", "alternative" → 16s (midpoint). If `genreNames` is empty or no keywords match, use the 15s default. Values are fixed midpoints of each range — not randomized.

### Trigger Logic

Same `onPlaybackStateChanged` event stream as the pre-gen trigger:

- When `playbackTime >= (duration - ejectWindowSize)` AND state is `ready`:
  - Call `playEjectTransition()` with the cached TTS base64
  - State transitions to `fired`
- If state is `generating` when eject window opens:
  - Wait up to 3s for generation to finish
  - If still not ready after 3s, abandon and let fallback handle it

### Skip Handling

- Manual skip cancels any in-progress pre-gen
- Calls `cancelEjectTransition()` on native side to restore music volume if mid-fade
- Falls back to existing `handleTrackChange()` flow with 1.5s delay

---

## 3. Native Crossfade — `playEjectTransition()`

A new native function in `ExpoMusicKitModule.swift` that executes the three-layer radio crossfade as one atomic operation using AVAudioSession ducking.

### Technical Constraint

`ApplicationMusicPlayer` does not expose a writable `volume` property. The only way to lower MusicKit playback volume from code is via AVAudioSession's `.duckOthers` option, which is what the existing crossfade system already uses. The eject transition leverages this same mechanism but with different *timing* — ducking activates before the track ends rather than after the track changes.

### Signature

```swift
// Uses explicit Promise parameter (not async/await) — same pattern as existing playAudioFromBase64
AsyncFunction("playEjectTransition") { (ttsBase64: String, fadeInDelayMs: Int, promise: Promise) in
```

Note: This uses the explicit `Promise` callback pattern, not the `async` return pattern, matching the existing `playAudioFromBase64` implementation.

### Track Change Suppression

A new `ejectTransitionInProgress` flag on the module. When `true`, the queue observer in `startObserving()` suppresses `onTrackChanged` events. This prevents the JS-side fallback path from firing when `skipToNextEntry()` is called during the eject transition.

- Set to `true` at the start of `playEjectTransition()`
- Set to `false` when the transition completes (TTS finishes) or is cancelled
- The suppressed track change info (new track ID, previous track ID) is stored and emitted as a synthetic `onEjectTrackChanged` event after the transition completes, so the JS side knows which track is now playing without triggering fallback logic

### Sequence

1. **Activate ducking**: Set AVAudioSession category to `.playback` with `[.mixWithOthers, .duckOthers]` and activate. MusicKit's playback volume drops automatically (iOS applies ~12dB reduction). This is the same mechanism as the existing `activateDuckingSession()`.

2. **Play Cleo's TTS**: Start `AVAudioPlayer` with the TTS base64 data at `ttsVolume`. Music is ducked underneath.

3. **Skip to next track**: Call `player.skipToNextEntry()` while Cleo is speaking. Before calling skip, check if the queue's current entry has already changed (natural auto-advance at track end) — if the track already advanced, skip the `skipToNextEntry()` call to avoid double-advancing past the intended next track. The next track starts ducked (`.duckOthers` is still active). Timing: `fadeInDelayMs` after TTS starts (default ~70% through TTS duration, so the new track rises under Cleo's last words).

4. **Crossfade — remove ducking**: At `fadeInDelayMs` (or 2s before TTS ends, whichever is later), remove `.duckOthers` by switching to `[.mixWithOthers]` only. Music rises naturally under Cleo's last words. This is the same technique as the existing crossfade in `playAudioFromBase64`.

5. **TTS finishes**: `AudioPlayerDelegate.audioPlayerDidFinishPlaying` fires. If crossfade already happened (step 4), just resolve. If TTS was too short for crossfade, remove ducking now (hard transition). Clear `ejectTransitionInProgress` flag. Emit synthetic `onEjectTrackChanged` event with stored track info.

6. **Resolve promise**.

### Safety

- If TTS base64 data is invalid, reject early without activating ducking
- Cancel any in-progress eject transition if a manual skip fires
- If `skipToNextEntry()` fails, resolve anyway (music was already playing, just ducked)
- On any error path, remove ducking and clear the `ejectTransitionInProgress` flag
- Never call `setActive(false)` — this would kill MusicKit playback (existing known constraint)

### `cancelEjectTransition()`

A companion native function that:
- Stops any in-progress TTS playback (triggers `audioPlayerDidFinishPlaying`)
- Cancels the crossfade timer
- Removes ducking immediately (`setCategory` with `[.mixWithOthers]` only)
- Clears `ejectTransitionInProgress` flag
- Does NOT emit the synthetic track changed event (the skip handler will manage state)

### Relationship to Existing Audio Functions

- `playEjectTransition()` is a self-contained operation that combines the behavior of `activateDuckingSession()` + `playAudioFromBase64()` + `skipToNextEntry()` + crossfade timing into a single atomic call.
- The existing `playAudioFromBase64()`, `activateDuckingSession()`, and `deactivateDuckingSession()` remain unchanged — they are still used by the fallback path in `AudioCoordinator`.
- The crossfade technique (removing `.duckOthers` before TTS ends) is identical to the existing implementation in `playAudioFromBase64`. The difference is that `playEjectTransition` also triggers the track skip mid-TTS.

---

## 4. AudioCoordinator Changes

### New Flow

```
Track starts
  → AudioCoordinator.handleTrackStart(currentTrack, nextTrack)
  → TransitionPreloader.startForTrack(currentTrack, nextTrack)
  → Pre-gen triggers at adaptive point
  → Eject window triggers at duration - N
  → playEjectTransition() handles the crossfade
  → Next track starts under Cleo's voice
  → TransitionPreloader resets for the new track
```

### What Changes

- `handleTrackChange()` becomes the **fallback path only** — called when pre-gen wasn't ready or on manual skip. Works exactly as it does today.
- New `handleTrackStart()` method — called when a new track begins. Kicks off the `TransitionPreloader`. If there's a fired eject transition in progress (Cleo speaking over the fade), lets it finish naturally.
- `cancelPendingTimer()` also cancels any in-progress pre-gen and calls `cancelEjectTransition()` to restore ducking if mid-transition.

### Entry Point Decision Tree (BroadcastScreen)

The `onTrackChanged` listener in BroadcastScreen decides which path to take:

1. **`onEjectTrackChanged` event** (synthetic, from native): Eject transition completed successfully. Call `handleTrackStart(newTrack, nextTrack)` to begin pre-gen for the new track. Do NOT call `handleTrackChange()`.
2. **`onTrackChanged` event + manual skip detected** (e.g., user tapped skip button): Call `cancelPendingTimer()` on AudioCoordinator, then call `handleTrackChange(newTrack, nextTrack, isManualSkip: true)` — the existing fallback flow.
3. **`onTrackChanged` event + no eject transition in progress** (natural track end, eject wasn't ready): Call `handleTrackChange(newTrack, nextTrack)` — the existing fallback flow.

Note: `onTrackChanged` events are suppressed by the native module while `ejectTransitionInProgress` is true (see Section 3), so case 3 only fires when the eject system didn't handle the transition.

### What Stays the Same

- `generationId` skip-safety system
- `SegmentController` rotation, delivery modes, silence logic
- `synthesizeAndPlay()` still used in the fallback path

### Mid-Song Drop Interaction

Mid-song drops remain unchanged as a separate timing path. They fire at 35-50% of track duration, while pre-gen triggers at 50-70%. If a mid-song drop is actively playing (`isSpeaking === true`) when the pre-gen trigger point is reached, pre-gen generation still proceeds — generation is a background operation that doesn't play audio. However, the eject window trigger checks `isSpeaking` before firing. If a mid-song drop is somehow still playing at the eject point (unlikely given timing), the eject trigger waits until `isSpeaking` clears, with the same 3s timeout before falling back.

---

## 5. SegmentController & Gemini Prompt Changes

### New Delivery Mode: `eject_transition`

Added to `CleoScriptGenerator`'s `DeliveryMode` type union.

### Gemini Prompt for `eject_transition`

Instructs Cleo to:
- Reference the outgoing track (it's still audible, fading under her)
- Tease or introduce the incoming track
- Keep it tight: 20-40 words max (~8-15s of speech)
- Tone: confident, smooth, bridging
- Do NOT say "that was" — the song is still playing

### Generation Parameters

- `deliveryMode: 'eject_transition'`
- `currentTrack` = the track about to end (still playing)
- `nextTrack` = what's coming up (may be `undefined` if queue doesn't expose next entry — in this case, Cleo generates a generic outro/sign-off rather than a bridge to a specific track)
- `previousTrack` = the one before current (for callback context)
- `maxWords: 40` (hard cap to keep TTS short enough for the eject window, yielding ~8-15s of speech)

### Rotation Impact

- Eject transition replaces what would have been the next `pre_song` segment in the rotation. The rotation index still advances.
- If fallback fires instead (eject missed), it uses the normal `pre_song`/`post_song` mode as today.

---

## 6. Full Lifecycle — Success Path

```
Track A starts playing
  │
  ├─ AudioCoordinator.handleTrackStart(trackA, trackB)
  │    └─ TransitionPreloader.startForTrack(trackA, trackB)
  │         └─ state: idle
  │         └─ Calculate pre-gen trigger: 2:24 (60% of 4:00 track)
  │         └─ Calculate eject window: 3:45 (last 15s)
  │         └─ Listen to playbackTime via existing 0.5s onPlaybackStateChanged events
  │
  ├─ [Mid-song drop may fire independently — unchanged]
  │
  ├─ playbackTime hits 2:24
  │    └─ state: idle → generating
  │    └─ SegmentController.generateNext(trackA, trackB, mode: eject_transition)
  │    └─ CleoVoiceEngine synthesizes TTS → cache base64
  │    └─ state: generating → ready
  │
  ├─ playbackTime hits 3:45
  │    └─ state: ready → fired
  │    └─ Native: playEjectTransition(ttsBase64, fadeInDelay)
  │         ├─ Activate ducking — music drops ~12dB
  │         ├─ Cleo TTS plays over ducked music
  │         ├─ Skip to Track B (starts ducked)
  │         └─ Remove ducking 2s before TTS ends — music rises under Cleo's last words
  │
  └─ TTS finishes, native emits onEjectTrackChanged
       └─ BroadcastScreen receives event
            └─ AudioCoordinator.handleTrackStart(trackB, trackC)
                 └─ TransitionPreloader resets, begins cycle for Track B
```

## 7. Failure Paths

| Scenario | Behavior |
|----------|----------|
| Pre-gen not ready at eject window | Wait 3s, then abandon. `handleTrackChange()` fallback fires when Track B starts. |
| Manual skip during Track A | Cancel pre-gen, cancel eject transition, restore volume. `handleTrackChange()` with 1.5s delay. |
| Track A ends naturally before eject window (very short track) | `handleTrackChange()` fallback. |
| TTS base64 invalid | Native rejects, ducking not activated. Fallback fires. |
| Network failure during generation | Generation times out (8s). State stays `idle` or `generating`. Fallback fires. |
| Mid-song drop still playing at eject point | Eject trigger waits for `isSpeaking` to clear (up to 3s), then fires or falls back. |

## Files to Create/Modify

### New Files
- `src/engines/TransitionPreloader.ts` — pre-generation lifecycle, eject window timing, state machine

### Modified Files
- `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` — add `playEjectTransition()`, `cancelEjectTransition()`, `ejectTransitionInProgress` flag, `onEjectTrackChanged` event (must be added to `Events()` registration), suppress `onTrackChanged` during transition
- `modules/expo-music-kit/index.ts` — export new native functions + `addEjectTrackChangedListener()`
- `src/engines/AudioCoordinator.ts` — add `handleTrackStart()`, wire TransitionPreloader, keep existing flow as fallback
- `src/engines/SegmentController.ts` — support `eject_transition` delivery mode
- `src/services/CleoScriptGenerator.ts` — add `eject_transition` to DeliveryMode, add prompt template
- `src/screens/player/BroadcastScreen.tsx` — call `handleTrackStart()` on track change event (primary path)

# Lock-Screen Now Playing Design

**Date:** 2026-04-23
**Status:** Approved for planning
**Related:** Design handoff bundle `ONAY Lock Screen Widget.html`
(claude.ai/design); `CLAUDE.md` audio-session discipline section.

## Problem

When ONAY is playing, the iOS lock screen shows the system Now Playing
tile with whatever metadata MusicKit's `ApplicationMusicPlayer` writes by
default — Apple Music's stock album art and track strings. The ONAY brand
never surfaces. There is no signal that the audio is part of a curated
broadcast, no per-vibe styling, and during ONAY's voice segments the
tile keeps showing the previous track (audibly dishonest — the user
hears ONAY talking but the tile says "Tame the Dragon by Thundercat").

The design handoff bundle (`onay-lock-screen/`) shows lock-screen
accessory widget mockups, but the user's actual intent is to **replace
the existing lock-screen music player** with an ONAY-branded
presentation. Lock-screen widgets sit in a different UI zone from the
Now Playing tile and would be additive, not replacement; the correct
lever is `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`.

## Goals

- Lock-screen tile reflects ONAY's brand (palette, typography, vibe
  accent) for every track and every voice segment in a broadcast.
- Title / artist strings track the audio honestly: real track metadata
  during a track, "Between tracks / ONAY · VIBE" during a voice segment,
  cleared at end of broadcast.
- Play and pause work from the lock screen and route through the
  existing `BroadcastPlayer.pause()` / `resumeFromPause()` semantics
  (tracks pause immediately; segments finish then park).
- Per-track elapsed-time scrubber fills accurately during tracks,
  hidden during segments.
- "No skips by design" enforced at the system level — prev / next
  buttons absent; scrubber drag rejected.
- Zero new Xcode targets, no App Group, no entitlements changes, no
  server work.

## Non-goals

- Lock-screen accessory widgets (the design's circular / inline / "ON
  AIR" rectangular variants in the gallery zone below the clock).
- Live Activities or Dynamic Island overlays.
- CarPlay, macOS Catalyst, watchOS surfaces.
- Broadcast-level (journey) progress on the system scrubber. The
  scrubber stays per-track; episode progress remains an in-app concept.
- Custom lock-screen wallpaper (the dark blurred-avatar treatment shown
  in the design's full-screen mocks is a separate pitch).

## Architecture

Everything lives in the existing native module
(`modules/expo-music-kit/ios/ExpoMusicKitModule.swift`) plus a small
amount of TypeScript in `src/services/MusicKitPlayer.ts` and
`src/engines/BroadcastPlayer.ts`. No new files outside those areas;
no new Xcode targets.

### Native side (Swift)

Two new types added to the existing module:

```swift
final class NowPlayingController {
    private let center = MPNowPlayingInfoCenter.default()
    private let commands = MPRemoteCommandCenter.shared()
    private let renderer = VibeArtworkRenderer()

    func activate(onPlay: @escaping () -> Void,
                  onPause: @escaping () -> Void)
    func setTrack(title: String, artist: String,
                  vibe: String, duration: Double)
    func setSegment(vibe: String, kind: String)
    func setElapsed(_ seconds: Double, playing: Bool)
    func clear()
}

struct VibeArtworkRenderer {
    enum Kind { case track, between }
    func render(vibe: String, kind: Kind) -> UIImage   // LRU-cached
}
```

`activate` registers `MPPlayCommand` and `MPPauseCommand` handlers and
explicitly rejects `MPChangePlaybackPositionCommand`. Skip / prev /
seek commands are intentionally left unregistered so iOS hides those
buttons.

`VibeArtworkRenderer` draws a ~1024×1024 `UIImage` with
`UIGraphicsImageRenderer`. Inputs: vibe (one of the seven existing
vibes) + kind (`track` or `between`). Output is cached by `(vibe, kind)`
so each of the 14 unique images renders at most once per app lifetime.

### Native side — module surface

Four new JS-callable methods:

- `setNowPlayingTrack({ title, artist, vibe, duration })`
- `setNowPlayingSegment({ vibe, kind })` — `kind` ∈ `'cold_open' |
  'transition' | 'sign_off'`
- `setNowPlayingElapsed({ elapsed, playing })`
- `clearNowPlaying()`

Two new events emitted via the module's existing event mechanism:
`onRemotePlay`, `onRemotePause`. Fired when iOS dispatches the
corresponding `MPRemoteCommand` from the lock screen, control center,
headphone controls, or CarPlay.

### RN side

`src/services/MusicKitPlayer.ts` proxies the four new methods one-for-
one and exposes a `subscribeRemoteCommands({ onPlay, onPause })`
wrapper that returns an unsubscribe closure. Same try/catch listener
safety as the existing `onTrackChanged` / `onPlaybackStateChanged`
helpers (per the CLAUDE.md convention: one throwing listener must not
abort subsequent dispatches).

`src/engines/BroadcastPlayer.ts`:

- `MusicDeps` interface gains the four new methods plus
  `onRemotePlay` / `onRemotePause` subscription functions.
  `BroadcastPlayer.singleton.ts` wires these from the native module.
- `initPlayback` subscribes remote-play → `resumeFromPause()` and
  remote-pause → `pause()`. Subscriptions stored alongside the existing
  ones in `this.subscriptions`, unsubscribed in `end()`.
- `runTrackAt` calls `setNowPlayingTrack(...)` **before** `music.play`
  and starts a 1Hz elapsed-time pump that reads `getPlaybackTime()` and
  the player's paused flag to call `setNowPlayingElapsed(...)`. Pump is
  stored in a class field, cleared in every exit path from `runTrackAt`.
- `runSegmentAt` calls `setNowPlayingSegment(...)` **before** the TTS
  plays. No elapsed pump; no duration supplied — scrubber hidden.
- `end()` calls `clearNowPlaying()` after stopping audio. Natural
  completion in `runMainLoop` (after sign_off plays through) also calls
  `clearNowPlaying()`.

## Data flow

| Lifecycle event | RN action | Lock-screen result |
|---|---|---|
| `start()` → `runSegmentAt(0)` (cold_open) | `setNowPlayingSegment({ vibe, kind: 'cold_open' })` | "Cold open / ONAY · VIBE", between-card artwork, no scrubber |
| `runTrackAt(i)` | `setNowPlayingTrack({ title, artist, vibe, duration })` + start 1Hz pump | Track title / artist / vibe-card artwork; scrubber fills |
| `runSegmentAt(i)` (transition) | `setNowPlayingSegment({ vibe, kind: 'transition' })` | "Between tracks / ONAY · VIBE", between-card artwork, no scrubber |
| `runSegmentAt(last)` (sign_off) | `setNowPlayingSegment({ vibe, kind: 'sign_off' })` | "Sign-off / ONAY · VIBE", between-card artwork |
| `runMainLoop` exit (natural end) | `clearNowPlaying()` | Tile disappears |
| User taps `END BROADCAST` → `end()` | `clearNowPlaying()` + unsubscribe | Tile disappears |
| Lock-screen pause tap → `MPPauseCommand` | native emits `onRemotePause` → RN calls `broadcastPlayer.pause()` → `setNowPlayingElapsed({ elapsed, playing: false })` | Play icon flips; track pauses, segment finishes then parks |
| Lock-screen play tap → `MPPlayCommand` | native emits `onRemotePlay` → `resumeFromPause()` → pump resumes with `playing: true` | Play icon flips; scrubber resumes |
| Force quit | iOS tears down the audio session | Tile disappears (no cleanup needed) |

## Error handling

Lock-screen presentation is a UX enhancement, not a critical path.
Default posture: fail quiet, never break playback.

- All four new RN proxies wrapped in `.catch(() => {})` — a failed
  `setNowPlayingTrack` does not stop a track from playing.
- `VibeArtworkRenderer` always returns an image. If the bundled avatar
  fails to load, the card is drawn without it (warm-black + amber
  frame + ONAY wordmark remain).
- Unknown vibe string → coerce to a neutral default (`feelGood`) and
  log a warn (defensive guard against RN/Swift drift).
- Unknown segment kind → treat as `transition`.
- Remote command fires before RN subscribes (only possible on cold
  launch with an active audio session, which is itself pathological):
  event is dropped on the floor. No caching.
- Elapsed pump must clear on every exit path from `runTrackAt` (track
  end, pause, end). Single class-field handle; cleared in a
  finally-style helper to avoid leaks.
- MusicKit's `ApplicationMusicPlayer` writes nowPlayingInfo when it
  starts a track, which can race against our pre-`music.play` write
  and clobber the ONAY card briefly. The 1Hz elapsed pump re-supplies
  the full nowPlayingInfo dict (not just elapsed), so any MusicKit
  overwrite is corrected within a second.
- iOS rejects `nowPlayingInfo` writes when the audio session is
  inactive. Our session is always active during a broadcast (per
  existing audio-session discipline); the `.catch` wrapper absorbs any
  edge case.

## Testing

### Jest (RN)

Extends `__tests__/engines/BroadcastPlayer.test.ts` using the existing
`makeDeps` pattern. Adds mocks for the four new music-dep methods plus
the two new subscription functions, asserts:

- `runTrackAt` calls `setNowPlayingTrack` before `music.play`.
- Elapsed pump invokes `setNowPlayingElapsed` ≥1× over fake-timer
  advance and stops on track end / pause / end.
- `runSegmentAt` calls `setNowPlayingSegment` with the correct `kind`
  for cold_open, transition, and sign_off slots.
- `end()` calls `clearNowPlaying` exactly once and unsubscribes the
  remote-command listeners.
- Natural completion in `runMainLoop` (sign_off plays through) calls
  `clearNowPlaying`.
- `onRemotePause` fires `pause()`; `onRemotePlay` fires
  `resumeFromPause()`.
- Pump tick reads the player's paused flag — a tick firing immediately
  after `pause()` writes `playing: false`, never `true`.

### Swift

No Swift unit tests. The existing module has none; `NowPlayingController`
is thin glue around `MPNowPlayingInfoCenter` state that is not
inspectable in any useful way from a simulator. `VibeArtworkRenderer`
could support image-snapshot tests, but the fixture cost outweighs the
benefit for 14 static renders.

### Manual QA — physical device

Simulator Now Playing rendering differs from device behavior; manual
QA is run on hardware:

1. Start a broadcast; lock the phone during the cold open. Tile shows
   "Cold open / ONAY · VIBE" + between-card artwork.
2. Wake during track 1 → tile shows real track/artist + vibe-accented
   artwork; scrubber advances in real time.
3. Tap pause on the lock screen → BroadcastPlayer pauses; play icon
   flips. (Track pauses immediately; if a segment is in flight, ONAY
   finishes the sentence then parks per existing semantics.)
4. Tap play → resumes; scrubber resumes advancing.
5. Walk through all 7 vibes (one bake each) × track + between-tracks
   states → artwork reflects the per-vibe accent; avatar visible; ONAY
   wordmark legible at glance distance.
6. Tap END BROADCAST in-app → tile disappears within ~1s.
7. Let a broadcast play through sign_off → tile disappears naturally.
8. Confirm no prev / next buttons render; scrubber drag does not seek.
9. Background the app during a track → tile remains and continues
   advancing.

### Regression risks

- Existing audio-session handoff (duck → segment → release) must remain
  unchanged. Added writes to `MPNowPlayingInfoCenter` do not touch
  `AVAudioSession`, but QA pass 2 verifies.
- 1Hz pump must not race with `pause()`. Solved by reading the paused
  flag inside the pump tick rather than capturing it at pump-start.

## Open questions

None at design time. Implementation choices (specific Core Graphics
draw calls, asset bundling for the avatar PNG, Swift file split if
`ExpoMusicKitModule.swift` grows past a comfortable size) belong in
the implementation plan.

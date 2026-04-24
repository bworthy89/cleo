# Lock-Screen Now Playing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default MusicKit-driven Now Playing tile on the iOS lock screen with an ONAY-branded, per-vibe presentation that follows the broadcast's lifecycle (cold open → tracks → transitions → sign-off) and routes lock-screen play/pause through `BroadcastPlayer`.

**Architecture:** All native work lives in the existing `expo-music-kit` Swift module — two new Swift files (`VibeArtworkRenderer.swift`, `NowPlayingController.swift`) plus four new module methods and two new events. RN side adds proxies to `MusicKitPlayer.ts`, extends `BroadcastPlayer.MusicDeps`, wires call sites in `runTrackAt` / `runSegmentAt` / `end()` / `runMainLoop`, and starts a 1Hz elapsed-time pump during tracks. No new Xcode targets, no App Group, no entitlements changes.

**Tech Stack:** Swift / UIKit / Core Graphics / `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` / Expo Modules API · TypeScript / React Native / Jest with fake timers.

**Spec:** `docs/superpowers/specs/2026-04-23-lock-screen-now-playing-design.md`

---

## File structure

NEW
- `modules/expo-music-kit/ios/VibeArtworkRenderer.swift` — pure CG drawing, returns `UIImage` per `(vibe, kind)`. LRU cache. ~140 lines.
- `modules/expo-music-kit/ios/NowPlayingController.swift` — owns `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` plumbing. Typed `setTrack` / `setSegment` / `setElapsed` / `clear` API. ~120 lines.
- `modules/expo-music-kit/ios/Resources/onay-avatar.png` — the avatar bitmap from the design bundle, copied in.

MODIFIED
- `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` — instantiate `NowPlayingController`; declare 4 new `AsyncFunction`s + 2 new `Events`; activate the controller in `OnCreate`.
- `modules/expo-music-kit/index.ts` — export 4 new functions + 2 listener helpers + types.
- `src/services/MusicKitPlayer.ts` — proxy methods + `subscribeRemoteCommands(...)` wrapper.
- `src/engines/BroadcastPlayer.ts` — extend `MusicDeps`; call NowPlaying methods in `initPlayback` / `runTrackAt` / `runSegmentAt` / `end()` / `runMainLoop`; add elapsed pump.
- `src/engines/BroadcastPlayer.singleton.ts` — wire new deps from native module.
- `__tests__/engines/BroadcastPlayer.test.ts` — extend `makeDeps`; new test cases.

---

### Task 1: VibeArtworkRenderer — Swift skeleton + cache

**Files:**
- Create: `modules/expo-music-kit/ios/VibeArtworkRenderer.swift`

- [ ] **Step 1: Create the file with the cache + public API skeleton**

```swift
import UIKit

struct VibeArtworkRenderer {
    enum Kind: String { case track, between }

    private static let cache = NSCache<NSString, UIImage>()

    /// Returns a 1024×1024 UIImage for the given vibe+kind. Cached so each
    /// of the 14 unique combinations renders at most once per process.
    func render(vibe: String, kind: Kind) -> UIImage {
        let key = "\(vibe)|\(kind.rawValue)" as NSString
        if let cached = Self.cache.object(forKey: key) { return cached }
        let img = draw(vibe: vibe, kind: kind)
        Self.cache.setObject(img, forKey: key)
        return img
    }

    private func draw(vibe: String, kind: Kind) -> UIImage {
        let size = CGSize(width: 1024, height: 1024)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            paintBackground(in: ctx.cgContext, size: size, vibe: vibe)
            paintBrand(in: ctx.cgContext, size: size)
            if kind == .track { paintAvatar(in: ctx.cgContext, size: size) }
            else { paintBetweenLabel(in: ctx.cgContext, size: size, vibe: vibe) }
        }
    }
}
```

- [ ] **Step 2: Commit the skeleton**

```bash
git add modules/expo-music-kit/ios/VibeArtworkRenderer.swift
git commit -m "feat(ios): VibeArtworkRenderer skeleton + cache"
```

---

### Task 2: VibeArtworkRenderer — drawing primitives

**Files:**
- Modify: `modules/expo-music-kit/ios/VibeArtworkRenderer.swift`

- [ ] **Step 1: Add the per-vibe accent palette + brand drawing**

```swift
private extension VibeArtworkRenderer {
    static let accent: [String: UIColor] = [
        "morning":    UIColor(red: 0.957, green: 0.780, blue: 0.478, alpha: 1),
        "focus":      UIColor(red: 0.435, green: 0.722, blue: 0.608, alpha: 1),
        "workout":    UIColor(red: 0.769, green: 0.271, blue: 0.192, alpha: 1),
        "feelGood":   UIColor(red: 0.910, green: 0.635, blue: 0.294, alpha: 1),
        "lateNight":  UIColor(red: 0.431, green: 0.310, blue: 0.557, alpha: 1),
        "melancholy": UIColor(red: 0.420, green: 0.482, blue: 0.557, alpha: 1),
        "party":      UIColor(red: 0.878, green: 0.306, blue: 0.518, alpha: 1),
    ]
    static let warmBlack = UIColor(red: 0.043, green: 0.035, blue: 0.027, alpha: 1)
    static let amber     = UIColor(red: 0.910, green: 0.635, blue: 0.294, alpha: 1)
    static let ink       = UIColor(red: 0.957, green: 0.925, blue: 0.863, alpha: 1)

    func vibeAccent(_ vibe: String) -> UIColor {
        Self.accent[vibe] ?? Self.accent["feelGood"]!
    }

    func paintBackground(in ctx: CGContext, size: CGSize, vibe: String) {
        ctx.setFillColor(Self.warmBlack.cgColor)
        ctx.fill(CGRect(origin: .zero, size: size))

        // Bottom radial: vibe-tinted glow
        let accent = vibeAccent(vibe).withAlphaComponent(0.18)
        let cs = CGColorSpaceCreateDeviceRGB()
        let grad = CGGradient(colorsSpace: cs,
            colors: [accent.cgColor, UIColor.clear.cgColor] as CFArray,
            locations: [0.0, 1.0])!
        ctx.drawRadialGradient(grad,
            startCenter: CGPoint(x: size.width / 2, y: size.height),
            startRadius: 0,
            endCenter:   CGPoint(x: size.width / 2, y: size.height),
            endRadius:   size.width * 0.7,
            options:     [])

        // Left amber edge bar — design's "gold-edge cards" cue
        ctx.setFillColor(Self.amber.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: 16, height: size.height))
    }

    func paintBrand(in ctx: CGContext, size: CGSize) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: 56, weight: .medium),
            .foregroundColor: Self.amber,
            .kern: 12.0,
        ]
        let str = NSAttributedString(string: "ONAY", attributes: attrs)
        let bounds = str.boundingRect(
            with: CGSize(width: size.width, height: 80),
            options: [.usesLineFragmentOrigin], context: nil)
        str.draw(at: CGPoint(
            x: (size.width - bounds.width) / 2,
            y: 80))

        // ON-AIR dot to the left of wordmark
        ctx.setFillColor(UIColor(red: 0.643, green: 0.227, blue: 0.180, alpha: 1).cgColor)
        let dotR: CGFloat = 14
        ctx.fillEllipse(in: CGRect(
            x: (size.width - bounds.width) / 2 - dotR * 2.5,
            y: 80 + bounds.height / 2 - dotR / 2,
            width: dotR, height: dotR))
    }
}
```

- [ ] **Step 2: Add the avatar + between-label drawing**

```swift
private extension VibeArtworkRenderer {
    func paintAvatar(in ctx: CGContext, size: CGSize) {
        guard let avatar = UIImage(named: "onay-avatar",
                                   in: Bundle(for: NowPlayingController.self),
                                   with: nil) else {
            // Fallback: draw an amber-bordered placeholder square so the
            // image still has structure if the asset is missing.
            ctx.setStrokeColor(Self.amber.cgColor)
            ctx.setLineWidth(6)
            let rect = CGRect(x: size.width * 0.2, y: size.height * 0.25,
                              width: size.width * 0.6, height: size.height * 0.6)
            ctx.stroke(rect)
            return
        }
        let target = CGRect(x: size.width * 0.18, y: size.height * 0.20,
                            width: size.width * 0.64, height: size.width * 0.64)
        avatar.draw(in: target)
    }

    func paintBetweenLabel(in ctx: CGContext, size: CGSize, vibe: String) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: 36, weight: .regular),
            .foregroundColor: Self.ink,
            .kern: 8.0,
        ]
        let label = NSAttributedString(
            string: "BETWEEN TRACKS",
            attributes: attrs)
        let lb = label.boundingRect(with: CGSize(width: size.width, height: 80),
                                    options: [.usesLineFragmentOrigin], context: nil)
        label.draw(at: CGPoint(x: (size.width - lb.width) / 2,
                               y: size.height / 2 - 40))

        let vibeAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: 28, weight: .medium),
            .foregroundColor: vibeAccent(vibe),
            .kern: 6.0,
        ]
        let vibeStr = NSAttributedString(
            string: vibe.uppercased(),
            attributes: vibeAttrs)
        let vb = vibeStr.boundingRect(with: CGSize(width: size.width, height: 60),
                                      options: [.usesLineFragmentOrigin], context: nil)
        vibeStr.draw(at: CGPoint(x: (size.width - vb.width) / 2,
                                 y: size.height / 2 + 30))
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add modules/expo-music-kit/ios/VibeArtworkRenderer.swift
git commit -m "feat(ios): VibeArtworkRenderer drawing primitives + per-vibe palette"
```

---

### Task 3: Bundle the avatar PNG

**Files:**
- Create: `modules/expo-music-kit/ios/Resources/onay-avatar.png` (binary)

- [ ] **Step 1: Copy the avatar from the design bundle**

```bash
mkdir -p modules/expo-music-kit/ios/Resources
cp /tmp/onay-design/extracted/onay-lock-screen/project/assets/cleo/onay-frame-1.png \
   modules/expo-music-kit/ios/Resources/onay-avatar.png
```

- [ ] **Step 2: Confirm the podspec / Expo module surface picks up the resource**

Open `modules/expo-music-kit/ios/ExpoMusicKit.podspec` and verify `s.resource_bundles` (or a `s.resources` glob) covers `Resources/*.png`. If absent, add:

```ruby
  s.resources = "Resources/**/*"
```

Then re-run `pod install` from `ios/` so the new file is wired into the Xcode workspace.

- [ ] **Step 3: Commit**

```bash
git add modules/expo-music-kit/ios/Resources/onay-avatar.png \
        modules/expo-music-kit/ios/ExpoMusicKit.podspec \
        ios/Podfile.lock
git commit -m "chore(ios): bundle ONAY avatar into expo-music-kit resources"
```

---

### Task 4: NowPlayingController — Swift skeleton + remote commands

**Files:**
- Create: `modules/expo-music-kit/ios/NowPlayingController.swift`

- [ ] **Step 1: Create the controller skeleton**

```swift
import Foundation
import UIKit
import MediaPlayer

final class NowPlayingController {
    private let center = MPNowPlayingInfoCenter.default()
    private let commands = MPRemoteCommandCenter.shared()
    private let renderer = VibeArtworkRenderer()
    private var current: [String: Any] = [:]
    private var lastVibe: String = "feelGood"

    /// Wire iOS remote-command events into RN-emitted callbacks. Call once on
    /// module init. Skip / prev / scrub commands are intentionally left
    /// unregistered so iOS hides those buttons. ChangePlaybackPosition is
    /// explicitly registered + rejected so a drag gesture is a no-op rather
    /// than letting iOS guess.
    func activate(onPlay: @escaping () -> Void,
                  onPause: @escaping () -> Void) {
        commands.playCommand.isEnabled = true
        commands.playCommand.addTarget { _ in onPlay(); return .success }
        commands.pauseCommand.isEnabled = true
        commands.pauseCommand.addTarget { _ in onPause(); return .success }
        commands.changePlaybackPositionCommand.isEnabled = false
        commands.changePlaybackPositionCommand.addTarget { _ in .commandFailed }
    }

    func clear() {
        current.removeAll()
        center.nowPlayingInfo = nil
    }
}
```

- [ ] **Step 2: Add typed setters for track / segment / elapsed**

Append within `final class NowPlayingController`:

```swift
    /// Configure the tile for a real track. Caller (BroadcastPlayer.runTrackAt)
    /// should invoke this BEFORE music.play so the ONAY card paints the moment
    /// the audio session becomes active. The 1Hz elapsed pump re-asserts the
    /// full dict every second to overwrite any MusicKit clobber.
    func setTrack(title: String, artist: String, vibe: String, duration: Double) {
        lastVibe = vibe
        let art = renderer.render(vibe: vibe, kind: .track)
        current = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: "ONAY · \(vibe.uppercased())",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPMediaItemPropertyArtwork: MPMediaItemArtwork(
                boundsSize: art.size, requestHandler: { _ in art }),
        ]
        center.nowPlayingInfo = current
    }

    /// Configure the tile for a voice segment (cold_open, transition, sign_off).
    /// No duration → iOS hides the scrubber (matches the "ONAY is talking, not
    /// scrubbable" intent). Title varies by kind so the user can read the
    /// state at a glance.
    func setSegment(vibe: String, kind: String) {
        lastVibe = vibe
        let normalizedKind: String
        switch kind {
        case "cold_open", "transition", "sign_off": normalizedKind = kind
        default: normalizedKind = "transition"
        }
        let title: String
        switch normalizedKind {
        case "cold_open":  title = "Cold open"
        case "sign_off":   title = "Sign-off"
        default:           title = "Between tracks"
        }
        let art = renderer.render(vibe: vibe, kind: .between)
        current = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "ONAY · \(vibe.uppercased())",
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPMediaItemPropertyArtwork: MPMediaItemArtwork(
                boundsSize: art.size, requestHandler: { _ in art }),
        ]
        center.nowPlayingInfo = current
    }

    /// Push elapsed-time + playing flag without rebuilding the dict. Called
    /// from the RN-side 1Hz pump while a track is in flight, and once on
    /// pause/resume so the lock-screen play icon flips correctly.
    func setElapsed(_ seconds: Double, playing: Bool) {
        guard !current.isEmpty else { return }
        current[MPNowPlayingInfoPropertyElapsedPlaybackTime] = seconds
        current[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        center.nowPlayingInfo = current
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add modules/expo-music-kit/ios/NowPlayingController.swift
git commit -m "feat(ios): NowPlayingController for branded MPNowPlayingInfo + remote commands"
```

---

### Task 5: Wire NowPlayingController into the module

**Files:**
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`

- [ ] **Step 1: Add the controller field and activate it in OnCreate**

In `ExpoMusicKitModule.swift`, add a field below the existing private vars (around line 27):

```swift
  private let nowPlaying = NowPlayingController()
```

Inside `definition()`, change the `Events(...)` call (currently line 32) to include the two new events:

```swift
    Events("onTrackChanged", "onPlaybackStateChanged",
           "onRemotePlay", "onRemotePause")
```

Add an `OnCreate` block immediately after `Events(...)`:

```swift
    OnCreate {
      self.nowPlaying.activate(
        onPlay:  { [weak self] in self?.sendEvent("onRemotePlay",  [:]) },
        onPause: { [weak self] in self?.sendEvent("onRemotePause", [:]) }
      )
    }
```

- [ ] **Step 2: Add the four AsyncFunctions**

Find the `setBroadcastActive` function (~line 563) and insert these new functions immediately after it:

```swift
    AsyncFunction("setNowPlayingTrack") { (payload: [String: Any]) in
      let title    = payload["title"]    as? String ?? ""
      let artist   = payload["artist"]   as? String ?? ""
      let vibe     = payload["vibe"]     as? String ?? "feelGood"
      let duration = payload["duration"] as? Double ?? 0
      DispatchQueue.main.async {
        self.nowPlaying.setTrack(title: title, artist: artist,
                                 vibe: vibe, duration: duration)
      }
    }

    AsyncFunction("setNowPlayingSegment") { (payload: [String: Any]) in
      let vibe = payload["vibe"] as? String ?? "feelGood"
      let kind = payload["kind"] as? String ?? "transition"
      DispatchQueue.main.async {
        self.nowPlaying.setSegment(vibe: vibe, kind: kind)
      }
    }

    AsyncFunction("setNowPlayingElapsed") { (payload: [String: Any]) in
      let elapsed = payload["elapsed"] as? Double ?? 0
      let playing = payload["playing"] as? Bool   ?? true
      DispatchQueue.main.async {
        self.nowPlaying.setElapsed(elapsed, playing: playing)
      }
    }

    AsyncFunction("clearNowPlaying") {
      DispatchQueue.main.async {
        self.nowPlaying.clear()
      }
    }
```

- [ ] **Step 3: Build + verify on device**

Build the iOS app (`SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`) and confirm it launches without runtime errors. There's nothing to call yet — this just confirms the module compiles with the new surface.

- [ ] **Step 4: Commit**

```bash
git add modules/expo-music-kit/ios/ExpoMusicKitModule.swift
git commit -m "feat(ios): expose 4 nowPlaying methods + 2 remote-command events"
```

---

### Task 6: Extend the JS surface for the new module API

**Files:**
- Modify: `modules/expo-music-kit/index.ts`

- [ ] **Step 1: Add types + functions + listener helpers**

At the bottom of `modules/expo-music-kit/index.ts` (after the existing event listeners), add:

```typescript
// ── Now Playing (lock-screen tile) ─────────────────────────────────────

export type NowPlayingTrackPayload = {
  title: string;
  artist: string;
  vibe: string;
  duration: number;
};

export type NowPlayingSegmentPayload = {
  vibe: string;
  kind: 'cold_open' | 'transition' | 'sign_off';
};

export async function setNowPlayingTrack(payload: NowPlayingTrackPayload): Promise<void> {
  return await ExpoMusicKit.setNowPlayingTrack(payload);
}

export async function setNowPlayingSegment(payload: NowPlayingSegmentPayload): Promise<void> {
  return await ExpoMusicKit.setNowPlayingSegment(payload);
}

export async function setNowPlayingElapsed(elapsed: number, playing: boolean): Promise<void> {
  return await ExpoMusicKit.setNowPlayingElapsed({ elapsed, playing });
}

export async function clearNowPlaying(): Promise<void> {
  return await ExpoMusicKit.clearNowPlaying();
}

export function addRemotePlayListener(listener: () => void): EventSubscription {
  return emitter.addListener('onRemotePlay', listener);
}

export function addRemotePauseListener(listener: () => void): EventSubscription {
  return emitter.addListener('onRemotePause', listener);
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/expo-music-kit/index.ts
git commit -m "feat(expo-music-kit): JS surface for nowPlaying methods + remote events"
```

---

### Task 7: MusicKitPlayer proxies + remote-command subscriber

**Files:**
- Modify: `src/services/MusicKitPlayer.ts`

- [ ] **Step 1: Import the new symbols**

Replace the existing import block at top of `MusicKitPlayer.ts` to add:

```typescript
import {
  // ... existing imports unchanged ...
  setNowPlayingTrack,
  setNowPlayingSegment,
  setNowPlayingElapsed,
  clearNowPlaying,
  addRemotePlayListener,
  addRemotePauseListener,
  type NowPlayingTrackPayload,
  type NowPlayingSegmentPayload,
} from '../../modules/expo-music-kit';
```

- [ ] **Step 2: Add proxies + a remote-command subscription wrapper**

Inside the `MusicKitPlayerService` class, add (after `getNextInQueue`):

```typescript
  // ── Now Playing (lock-screen tile) ───────────────────────────────────
  async setNowPlayingTrack(payload: NowPlayingTrackPayload): Promise<void> {
    return setNowPlayingTrack(payload);
  }

  async setNowPlayingSegment(payload: NowPlayingSegmentPayload): Promise<void> {
    return setNowPlayingSegment(payload);
  }

  async setNowPlayingElapsed(elapsed: number, playing: boolean): Promise<void> {
    return setNowPlayingElapsed(elapsed, playing);
  }

  async clearNowPlaying(): Promise<void> {
    return clearNowPlaying();
  }

  /** Subscribe to lock-screen / control-center / headphone play & pause taps.
   *  Returns an unsubscribe closure. Same throwing-listener safety as the
   *  existing track/state subscriptions. */
  subscribeRemoteCommands(handlers: { onPlay: () => void; onPause: () => void }): () => void {
    const playSub = addRemotePlayListener(() => {
      try { handlers.onPlay(); } catch (e) {
        console.error('[MusicKitPlayer] onRemotePlay handler error:', e);
      }
    });
    const pauseSub = addRemotePauseListener(() => {
      try { handlers.onPause(); } catch (e) {
        console.error('[MusicKitPlayer] onRemotePause handler error:', e);
      }
    });
    return () => { playSub.remove(); pauseSub.remove(); };
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/services/MusicKitPlayer.ts
git commit -m "feat(player): MusicKitPlayer proxies for nowPlaying + remote commands"
```

---

### Task 8: Extend `BroadcastPlayer.MusicDeps` + singleton wiring

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts:11-20`
- Modify: `src/engines/BroadcastPlayer.singleton.ts`

- [ ] **Step 1: Extend `MusicDeps` in `BroadcastPlayer.ts`**

Replace the existing `MusicDeps` interface (lines 11–20):

```typescript
export interface MusicDeps {
  play: (ids?: string[]) => Promise<void>;
  pause: () => Promise<void>;
  skip: () => Promise<void>;
  setUpcomingQueue: (ids: string[]) => Promise<void>;
  onTrackChanged: (cb: (e: { trackId?: string }) => void) => () => void;
  onPlaybackStateChanged: (cb: (e: { status: string; playbackTime: number }) => void) => () => void;
  getPlaybackStatus?: () => Promise<string>;
  getPlaybackTime?: () => Promise<number>;
  // Lock-screen NowPlaying tile.
  setNowPlayingTrack: (payload: {
    title: string; artist: string; vibe: string; duration: number;
  }) => Promise<void>;
  setNowPlayingSegment: (payload: {
    vibe: string; kind: 'cold_open' | 'transition' | 'sign_off';
  }) => Promise<void>;
  setNowPlayingElapsed: (elapsed: number, playing: boolean) => Promise<void>;
  clearNowPlaying: () => Promise<void>;
  subscribeRemoteCommands: (handlers: {
    onPlay: () => void; onPause: () => void;
  }) => () => void;
}
```

- [ ] **Step 2: Wire the new deps in the singleton**

Replace `src/engines/BroadcastPlayer.singleton.ts` body (lines 14–24 — the `music: { ... }` block):

```typescript
  {
    play: (ids?: string[]) => musicKitPlayer.play(ids),
    pause: () => musicKitPlayer.pause(),
    skip: () => musicKitPlayer.skip(),
    setUpcomingQueue: (ids: string[]) => musicKitPlayer.setUpcomingQueue(ids),
    onTrackChanged: (cb) => musicKitPlayer.onTrackChanged(cb),
    onPlaybackStateChanged: (cb) => musicKitPlayer.onPlaybackStateChanged(cb),
    getPlaybackStatus: () => musicKitPlayer.getPlaybackStatus(),
    getPlaybackTime: () => musicKitPlayer.getPlaybackTime(),
    setNowPlayingTrack:   (p) => musicKitPlayer.setNowPlayingTrack(p),
    setNowPlayingSegment: (p) => musicKitPlayer.setNowPlayingSegment(p),
    setNowPlayingElapsed: (e, p) => musicKitPlayer.setNowPlayingElapsed(e, p),
    clearNowPlaying:      ()  => musicKitPlayer.clearNowPlaying(),
    subscribeRemoteCommands: (h) => musicKitPlayer.subscribeRemoteCommands(h),
  },
```

- [ ] **Step 3: Run jest to confirm types still compile (test will fail because makeDeps doesn't supply the new fields yet — that's the next task)**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts --listTests`
Expected: lists the file (no compile error in the test loader). If TypeScript shouts about missing `MusicDeps` fields in the test, that's expected and fixed in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/engines/BroadcastPlayer.ts src/engines/BroadcastPlayer.singleton.ts
git commit -m "feat(player): extend MusicDeps + wire nowPlaying + remote commands"
```

---

### Task 9: Test fixtures — extend `makeDeps`

**Files:**
- Modify: `__tests__/engines/BroadcastPlayer.test.ts:48-88` (the `makeDeps` factory)

- [ ] **Step 1: Add the new mocks to `makeDeps`**

Inside the `music: { ... }` block in `makeDeps()` (around line 56), add after `onPlaybackStateChanged`:

```typescript
      setNowPlayingTrack:   jest.fn(async (p: any) => { logs.push(`np.track:${p.title}|${p.vibe}`); }),
      setNowPlayingSegment: jest.fn(async (p: any) => { logs.push(`np.segment:${p.kind}|${p.vibe}`); }),
      setNowPlayingElapsed: jest.fn(async (e: number, playing: boolean) => { logs.push(`np.elapsed:${e}|${playing}`); }),
      clearNowPlaying:      jest.fn(async () => { logs.push('np.clear'); }),
      subscribeRemoteCommands: jest.fn((h: { onPlay: () => void; onPause: () => void }) => {
        listeners.remotePlay  = h.onPlay;
        listeners.remotePause = h.onPause;
        return () => { listeners.remotePlay = undefined; listeners.remotePause = undefined; };
      }),
```

Extend the `Listeners` type at the top of the file (around line 43):

```typescript
type Listeners = {
  track?: (e: { trackId?: string }) => void;
  state?: (e: { status: string; playbackTime: number }) => void;
  remotePlay?: () => void;
  remotePause?: () => void;
};
```

Add helpers at the end of `makeDeps()` (next to `fireTrackChanged`):

```typescript
    fireRemotePlay:  () => listeners.remotePlay?.(),
    fireRemotePause: () => listeners.remotePause?.(),
```

- [ ] **Step 2: Run existing tests to confirm nothing regressed**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts`
Expected: all existing tests pass. The new mocks are wired but no test asserts on them yet.

- [ ] **Step 3: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.test.ts
git commit -m "test(player): add nowPlaying + remote-command mocks to makeDeps"
```

---

### Task 10: TDD — `runTrackAt` calls `setNowPlayingTrack` before `music.play`

**Files:**
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`
- Modify: `src/engines/BroadcastPlayer.ts:467-483` (`runTrackAt`)

- [ ] **Step 1: Write the failing test**

Add inside the main `describe('BroadcastPlayer', ...)` block, after the existing `end()` tests:

```typescript
  it('runTrackAt sets NowPlaying track metadata before music.play', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    // Drive past cold_open to hit runTrackAt(0).
    for (let i = 0; i < 80; i++) await Promise.resolve();
    const trackIdx = deps.logs.findIndex(l => l === 'play:t0');
    const npIdx = deps.logs.findIndex(l => l.startsWith('np.track:T0'));
    expect(npIdx).toBeGreaterThanOrEqual(0);
    expect(trackIdx).toBeGreaterThanOrEqual(0);
    expect(npIdx).toBeLessThan(trackIdx);
    await player.end();
  });
```

- [ ] **Step 2: Run, confirm it fails**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "runTrackAt sets NowPlaying"`
Expected: FAIL — `npIdx` is `-1` because `runTrackAt` doesn't call `setNowPlayingTrack` yet.

- [ ] **Step 3: Implement — call `setNowPlayingTrack` at the top of `runTrackAt`**

In `src/engines/BroadcastPlayer.ts`, replace the body of `runTrackAt` (lines 467–483):

```typescript
  private async runTrackAt(trackIndex: number): Promise<void> {
    if (!this.manifest) return;
    const track = this.manifest.tracks[trackIndex];
    this.currentTrackIndex = trackIndex;
    updatePersistedCursor(trackIndex);
    this.state = 'playing_track';

    // Lock-screen tile — set ONAY-branded metadata BEFORE music.play so the
    // tile paints the moment the audio session goes active. The 1Hz pump
    // (started below) re-asserts the full dict every second to overwrite
    // any MusicKit clobber.
    await this.music.setNowPlayingTrack({
      title: track.title,
      artist: track.artistName,
      vibe: this.manifest.vibe,
      duration: track.duration ?? 180,
    }).catch(() => {});

    console.log(`[BroadcastPlayer] runTrackAt(${trackIndex}) id=${track.id} "${track.title}"`);
    try {
      await this.music.play([track.id]);
      console.log(`[BroadcastPlayer] music.play resolved for ${track.id}`);
    } catch (err) {
      console.warn(`[BroadcastPlayer] music.play threw for ${track.id}:`, err);
      return;
    }
    await this.waitForTrackEnd();
    console.log(`[BroadcastPlayer] track ended: ${track.id}`);
  }
```

- [ ] **Step 4: Run, confirm test passes**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "runTrackAt sets NowPlaying"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.test.ts src/engines/BroadcastPlayer.ts
git commit -m "feat(player): set NowPlaying track metadata before music.play"
```

---

### Task 11: TDD — `runSegmentAt` calls `setNowPlayingSegment` with the correct kind

**Files:**
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`
- Modify: `src/engines/BroadcastPlayer.ts:413-418` (`runSegmentAt` head)

- [ ] **Step 1: Write the failing test**

```typescript
  it('runSegmentAt pushes NowPlaying segment metadata for cold_open / transition / sign_off', async () => {
    const deps = makeDeps();
    const music = {
      ...deps.music,
      getPlaybackStatus: jest.fn(async () => 'stopped'),
      getPlaybackTime: jest.fn(async () => 1),
    };
    const player = new BroadcastPlayer(
      music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest3(), ['https://cdn/seg0-v0.mp3']);
    // Drive all 3 tracks through to sign-off.
    for (let t = 0; t < 3; t++) {
      for (let i = 0; i < 80; i++) await Promise.resolve();
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
    }
    for (let i = 0; i < 80; i++) await Promise.resolve();

    const kinds = deps.logs.filter(l => l.startsWith('np.segment:')).map(l => l.split(':')[1].split('|')[0]);
    expect(kinds).toEqual(['cold_open', 'transition', 'sign_off']);
    await player.end();
  });
```

- [ ] **Step 2: Run, confirm it fails**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "runSegmentAt pushes NowPlaying"`
Expected: FAIL — `kinds` is `[]`.

- [ ] **Step 3: Implement — call `setNowPlayingSegment` at the head of `runSegmentAt`**

In `src/engines/BroadcastPlayer.ts`, modify `runSegmentAt` (around line 413). After the existing `if (!slot) return;` line, before `this.currentSegmentIndex = slotIndex;`, add:

```typescript
    await this.music.setNowPlayingSegment({
      vibe: this.manifest.vibe,
      kind: slot.kind as 'cold_open' | 'transition' | 'sign_off',
    }).catch(() => {});
```

- [ ] **Step 4: Run, confirm test passes**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "runSegmentAt pushes NowPlaying"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.test.ts src/engines/BroadcastPlayer.ts
git commit -m "feat(player): push NowPlaying segment metadata at runSegmentAt entry"
```

---

### Task 12: TDD — `end()` calls `clearNowPlaying`

**Files:**
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`
- Modify: `src/engines/BroadcastPlayer.ts:330-359` (`end()`)

- [ ] **Step 1: Write the failing test**

```typescript
  it('end() clears the NowPlaying tile', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await player.end();
    expect(deps.music.clearNowPlaying).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run, confirm it fails**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "end\\(\\) clears the NowPlaying"`
Expected: FAIL — `clearNowPlaying` not called.

- [ ] **Step 3: Implement — call `clearNowPlaying` in `end()`**

In `src/engines/BroadcastPlayer.ts`, inside `end()` (around line 354), add immediately before `this.state = 'idle';`:

```typescript
    await this.music.clearNowPlaying().catch(() => {});
```

- [ ] **Step 4: Run, confirm test passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.test.ts src/engines/BroadcastPlayer.ts
git commit -m "feat(player): clearNowPlaying on end()"
```

---

### Task 13: TDD — natural completion (sign-off) clears the tile too

**Files:**
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`
- Modify: `src/engines/BroadcastPlayer.ts:211-251` (`runMainLoop`)

- [ ] **Step 1: Write the failing test**

```typescript
  it('natural broadcast completion clears the NowPlaying tile', async () => {
    const deps = makeDeps();
    const music = {
      ...deps.music,
      getPlaybackStatus: jest.fn(async () => 'stopped'),
      getPlaybackTime: jest.fn(async () => 1),
    };
    const player = new BroadcastPlayer(
      music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < 80; i++) await Promise.resolve();
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
    }
    for (let i = 0; i < 120; i++) await Promise.resolve();
    expect(deps.music.clearNowPlaying).toHaveBeenCalledTimes(1);
    await player.end();
  });
```

- [ ] **Step 2: Run, confirm it fails**

Expected: FAIL — `clearNowPlaying` not called by `runMainLoop`.

- [ ] **Step 3: Implement — clear inside `runMainLoop` after sign-off plays**

In `src/engines/BroadcastPlayer.ts`, in `runMainLoop` (around line 248), immediately after `await this.music.pause().catch(() => {});` and before `this.state = 'ended';`, add:

```typescript
    await this.music.clearNowPlaying().catch(() => {});
```

- [ ] **Step 4: Run, confirm test passes**

Expected: PASS. Note: the previous `end() clears the NowPlaying tile` test still calls `end()` after the natural-completion path is exercised in this new test, so verify both pass:

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "NowPlaying"`
Expected: all NowPlaying-related tests pass.

- [ ] **Step 5: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.test.ts src/engines/BroadcastPlayer.ts
git commit -m "feat(player): clearNowPlaying after natural sign-off completion"
```

---

### Task 14: TDD — remote-command subscriptions in `initPlayback` + teardown in `end()`

**Files:**
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`
- Modify: `src/engines/BroadcastPlayer.ts:169-205` (`initPlayback`)

- [ ] **Step 1: Write the failing test (remote pause → BroadcastPlayer.pause)**

```typescript
  it('remote pause from lock screen pauses the broadcast', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(deps.music.subscribeRemoteCommands).toHaveBeenCalled();
    deps.fireRemotePause();
    expect(player.getStatus().state).toBe('paused');
    deps.fireRemotePlay();
    expect(player.getStatus().state).not.toBe('paused');
    await player.end();
  });
```

- [ ] **Step 2: Run, confirm it fails**

Expected: FAIL — `subscribeRemoteCommands` not yet called.

- [ ] **Step 3: Implement — subscribe in `initPlayback`, push the unsubscriber into `this.subscriptions`**

In `src/engines/BroadcastPlayer.ts`, at the bottom of `initPlayback` (after the existing `this.subscriptions.push(...)` block, around line 205), append:

```typescript
    this.subscriptions.push(
      this.music.subscribeRemoteCommands({
        onPlay:  () => { this.resumeFromPause().catch(() => {}); },
        onPause: () => { this.pause().catch(() => {}); },
      }),
    );
```

- [ ] **Step 4: Run, confirm test passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/engines/BroadcastPlayer.test.ts src/engines/BroadcastPlayer.ts
git commit -m "feat(player): wire lock-screen play/pause to BroadcastPlayer"
```

---

### Task 15: Elapsed-time pump — start in `runTrackAt`, stop on every exit

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts` — add field + helper, modify `runTrackAt` + `pause` + `end`
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`

- [ ] **Step 1: Write the failing test (pump fires while playing, stops on pause)**

```typescript
  it('elapsed pump pushes NowPlaying elapsed while playing and stops on pause', async () => {
    jest.useFakeTimers();
    const deps = makeDeps();
    let t = 0;
    const music = {
      ...deps.music,
      getPlaybackStatus: jest.fn(async () => 'playing'),
      getPlaybackTime:   jest.fn(async () => { t += 1; return t; }),
    };
    const player = new BroadcastPlayer(
      music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    // Allow cold_open + runTrackAt(0) to be reached.
    for (let i = 0; i < 80; i++) { await Promise.resolve(); }
    // Advance fake time by 3s — pump should have fired ~3 times.
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(1000);
      for (let j = 0; j < 5; j++) await Promise.resolve();
    }
    const playingTicks = (deps.music.setNowPlayingElapsed as jest.Mock).mock.calls
      .filter(c => c[1] === true).length;
    expect(playingTicks).toBeGreaterThanOrEqual(2);

    await player.pause();
    const beforePause = (deps.music.setNowPlayingElapsed as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(3000);
    for (let j = 0; j < 5; j++) await Promise.resolve();
    const afterPause = (deps.music.setNowPlayingElapsed as jest.Mock).mock.calls.length;
    // Pump may push a single playing:false tick when pause runs, but should
    // not keep ticking after — so afterPause - beforePause ≤ 1.
    expect(afterPause - beforePause).toBeLessThanOrEqual(1);

    await player.end();
    jest.useRealTimers();
  });
```

- [ ] **Step 2: Run, confirm it fails**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "elapsed pump"`
Expected: FAIL — pump not implemented.

- [ ] **Step 3: Implement — add pump field, start helper, stop helper**

In `src/engines/BroadcastPlayer.ts`, near the other private fields (around line 73), add:

```typescript
  private elapsedPumpTimer: ReturnType<typeof setInterval> | null = null;
```

Add two private methods anywhere in the class (near `schedulePolling`):

```typescript
  private startElapsedPump(): void {
    if (this.elapsedPumpTimer) return;
    this.elapsedPumpTimer = setInterval(async () => {
      if (!this.manifest || this.currentTrackIndex < 0) return;
      const playing = !this.isPaused && this.state === 'playing_track';
      try {
        const t = this.music.getPlaybackTime ? await this.music.getPlaybackTime() : 0;
        await this.music.setNowPlayingElapsed(t, playing).catch(() => {});
      } catch { /* one tick failure is not fatal */ }
    }, 1000);
  }

  private stopElapsedPump(): void {
    if (this.elapsedPumpTimer) {
      clearInterval(this.elapsedPumpTimer);
      this.elapsedPumpTimer = null;
    }
  }
```

In `runTrackAt`, immediately after the `setNowPlayingTrack` call (added in Task 10), insert:

```typescript
    this.startElapsedPump();
```

In `runTrackAt`, immediately after `await this.waitForTrackEnd();`, insert:

```typescript
    this.stopElapsedPump();
```

In `pause()` (around line 289), after setting `this.state = 'paused'`, add an explicit final-state push so the lock-screen play icon flips immediately rather than waiting on the next pump tick:

```typescript
    try {
      const t = this.music.getPlaybackTime ? await this.music.getPlaybackTime() : 0;
      await this.music.setNowPlayingElapsed(t, false).catch(() => {});
    } catch { /* swallow */ }
    this.stopElapsedPump();
```

In `resumeFromPause()` (around line 299), after restoring `this.state`, add (only when resuming a track):

```typescript
    if (this.currentTrackIndex >= 0 && this.currentSegmentIndex < 0) {
      this.startElapsedPump();
    }
```

In `end()` (the modified version after Task 12), add `this.stopElapsedPump();` immediately before `this.state = 'idle';`.

- [ ] **Step 4: Run, confirm test passes**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts -t "elapsed pump"`
Expected: PASS.

- [ ] **Step 5: Run the full BroadcastPlayer suite**

Run: `npx jest __tests__/engines/BroadcastPlayer.test.ts`
Expected: all tests pass (existing + 6 new ones from Tasks 10–15).

- [ ] **Step 6: Commit**

```bash
git add src/engines/BroadcastPlayer.ts __tests__/engines/BroadcastPlayer.test.ts
git commit -m "feat(player): 1Hz elapsed pump for lock-screen scrubber"
```

---

### Task 16: Manual QA on a physical device

**Files:** none — verification only.

This is the only place the visual design and audio-session interplay can be properly verified. Simulator's Now Playing rendering differs from device behavior.

- [ ] **Step 1: Build to a real device**

Run: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`

- [ ] **Step 2: Run the QA matrix from the spec**

Walk the manual QA list in `docs/superpowers/specs/2026-04-23-lock-screen-now-playing-design.md` ("Manual QA — physical device" section). For each pass, screenshot the lock screen and note any deviation from the design or unexpected MusicKit clobber that the 1Hz pump didn't catch within ~1s.

- [ ] **Step 3: If anything is off**

File a follow-up task or open a GitHub issue. Do NOT silently patch the spec or plan.

- [ ] **Step 4: Commit a QA note (optional)**

If you took screenshots worth keeping, drop them in `docs/superpowers/qa/2026-04-23-lock-screen-now-playing/` and commit:

```bash
git add docs/superpowers/qa/2026-04-23-lock-screen-now-playing/
git commit -m "docs(qa): lock-screen NowPlaying device verification screenshots"
```

---

### Task 17: Open the PR

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/lock-screen-player
```

- [ ] **Step 2: Open PR via gh CLI**

```bash
gh pr create --title "feat: ONAY-branded lock-screen Now Playing tile" --body "$(cat <<'EOF'
## Summary
- Replaces MusicKit's default Now Playing tile with an ONAY-branded, per-vibe presentation that follows the broadcast lifecycle (cold_open → tracks → transitions → sign_off).
- Adds two new Swift types in expo-music-kit: VibeArtworkRenderer (Core Graphics, 1024×1024, LRU-cached) and NowPlayingController (MPNowPlayingInfoCenter + MPRemoteCommandCenter wiring with skip/seek explicitly disabled).
- Wires lock-screen play/pause back through BroadcastPlayer.pause() / resumeFromPause() so the existing "tracks pause immediately, segments finish then park" semantics are preserved.
- Extends BroadcastPlayer with a 1Hz elapsed-time pump so the system scrubber stays accurate and any MusicKit clobber is corrected within a second.

Spec: docs/superpowers/specs/2026-04-23-lock-screen-now-playing-design.md
Plan: docs/superpowers/plans/2026-04-23-lock-screen-now-playing.md

## Test plan
- [x] Jest: full BroadcastPlayer suite (existing + 6 new NowPlaying tests) passes
- [ ] Manual on device: walk all 9 steps in the spec's "Manual QA — physical device" section across all 7 vibes
- [ ] Manual on device: confirm no prev/next buttons render; scrubber drag does not seek

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report PR URL back to the user**

---

## Self-review notes

- **Spec coverage:** every spec section maps to at least one task — VibeArtworkRenderer (Tasks 1–2), NowPlayingController (Task 4), module surface (Task 5), JS bridge (Tasks 6–7), MusicDeps + singleton (Task 8), `runTrackAt` (Task 10), `runSegmentAt` (Task 11), `end()` (Task 12), natural completion (Task 13), remote commands (Task 14), elapsed pump + pause/resume race fix (Task 15), manual QA (Task 16). Asset bundling (Task 3) is split out so the avatar import is its own commit.
- **Type / name consistency:** `setNowPlayingTrack` / `setNowPlayingSegment` / `setNowPlayingElapsed` / `clearNowPlaying` / `subscribeRemoteCommands` used identically across module index, MusicKitPlayer, MusicDeps interface, singleton wiring, and tests. Segment kinds `'cold_open' | 'transition' | 'sign_off'` match the manifest's `SegmentSlot.kind` values.
- **Pump race resilience:** the pump reads `this.isPaused && this.state` at each tick rather than capturing at start, per the spec's "pump tick reads paused flag" requirement (Task 15).
- **No placeholders:** every step has either a concrete code block, a concrete shell command with expected output, or a single physical-device QA action.

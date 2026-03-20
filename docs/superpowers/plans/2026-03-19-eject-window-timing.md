# Eject Window Timing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cleo's post-track-change timing with a radio-style eject window system where Cleo speaks over the outgoing track's fade-out, bridging into the next song.

**Architecture:** A new `TransitionPreloader` (JS) manages pre-generation of Cleo's script + TTS mid-track. At the eject point, a single atomic native call (`playEjectTransition`) handles ducking, TTS playback, track skip, and crossfade. The existing `handleTrackChange` flow becomes the fallback path for skips and pre-gen failures.

**Tech Stack:** TypeScript (React Native/Expo), Swift (ExpoMusicKitModule), AVAudioSession ducking, MusicKit ApplicationMusicPlayer

**Spec:** `docs/superpowers/specs/2026-03-19-eject-window-timing-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/engines/TransitionPreloader.ts` | Create | Pre-gen lifecycle, eject window timing, state machine, genre-based window sizing |
| `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` | Modify | `playEjectTransition()`, `cancelEjectTransition()`, `ejectTransitionInProgress` flag, `onEjectTrackChanged` event, suppress `onTrackChanged` during transition |
| `modules/expo-music-kit/index.ts` | Modify | Export `playEjectTransition`, `cancelEjectTransition`, `addEjectTrackChangedListener` |
| `src/services/CleoScriptGenerator.ts` | Modify | Add `eject_transition` delivery mode + prompt template |
| `src/engines/SegmentController.ts` | Modify | Add `generateEjectTransition()` method that forces `eject_transition` delivery mode and `maxWords: 40` |
| `src/engines/AudioCoordinator.ts` | Modify | Add `handleTrackStart()`, wire TransitionPreloader, add `genreNames` to TrackInfo, keep existing flow as fallback |
| `src/services/MusicKitPlayer.ts` | Modify | Add `onEjectTrackChanged` listener forwarding |
| `src/screens/player/BroadcastScreen.tsx` | Modify | Wire eject track changed listener, entry point decision tree |

---

### Task 1: Add `eject_transition` Delivery Mode to CleoScriptGenerator

**Files:**
- Modify: `src/services/CleoScriptGenerator.ts:6` (DeliveryMode type)
- Modify: `src/services/CleoScriptGenerator.ts:91-102` (delivery mode prompt block)

- [ ] **Step 1: Add `eject_transition` to the DeliveryMode type**

In `src/services/CleoScriptGenerator.ts`, line 6, change:

```typescript
export type DeliveryMode = 'pre_song' | 'post_song';
```

to:

```typescript
export type DeliveryMode = 'pre_song' | 'post_song' | 'eject_transition';
```

- [ ] **Step 2: Add the eject_transition prompt block**

In `src/services/CleoScriptGenerator.ts`, in the `buildDynamicPrompt` function, after the `post_song` delivery mode block (around line 102), add an `else if` for `eject_transition`:

```typescript
  } else if (context.deliveryMode === 'eject_transition') {
    prompt += `\n\nDELIVERY MODE: eject_transition
You are speaking OVER the fade-out of "${context.currentTrack.title}" by ${context.currentTrack.artistName}. The listener can still hear it underneath you, fading out.`;
    if (context.nextTrack) {
      prompt += ` Bridge into "${context.nextTrack.title}" by ${context.nextTrack.artistName} — it is about to begin.`;
    } else {
      prompt += ` Wrap this moment smoothly — another track is coming.`;
    }
    prompt += `
Do NOT say "that was" — the song is still audible. Do NOT say "coming up next" — speak as if the transition is already happening. Be confident, smooth, like a DJ talking over the outro.`;
  } else {
```

This replaces the existing `else {` for the `post_song` block. The full if/else chain becomes: `if (pre_song) ... else if (eject_transition) ... else { // post_song`.

- [ ] **Step 3: Verify the file compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit src/services/CleoScriptGenerator.ts 2>&1 | head -20`

Expected: No errors (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add src/services/CleoScriptGenerator.ts && git commit -m "feat: add eject_transition delivery mode to CleoScriptGenerator"
```

---

### Task 2: Add `generateEjectTransition()` to SegmentController

**Files:**
- Modify: `src/engines/SegmentController.ts`

The existing `generateNext()` determines delivery mode internally. We need a dedicated method that forces `eject_transition` mode and `maxWords: 40`.

- [ ] **Step 1: Import the new delivery mode**

The `DeliveryMode` type is defined in `CleoScriptGenerator.ts` and re-exported from `SegmentController.ts` (line 10). No import change needed since `eject_transition` was added to the type in Task 1.

- [ ] **Step 2: Add `generateEjectTransition()` method**

Add this method to `SegmentControllerEngine` class, after the `generateNext()` method (around line 290):

```typescript
  /**
   * Generate a segment specifically for eject window transitions.
   * Forces eject_transition delivery mode and maxWords: 40.
   * Advances rotation index like a normal segment.
   */
  async generateEjectTransition(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo
  ): Promise<SegmentResult | null> {
    // Skip-some-tracks: let the music breathe
    if (this.shouldStaySilent()) {
      console.log('[SegmentController] Staying silent — letting music breathe (eject)');
      return null;
    }

    this.bufferedSegment = null;

    let segmentType = this.getNextSegmentType();

    if (segmentType === 'track_story' && !currentTrack.hasRichData) {
      segmentType = 'artist_context';
    }

    segmentType = this.applyDataOverride(segmentType, currentTrack, previousTrack);

    // Force eject_transition delivery mode — update tracking as pre_song equivalent
    this.consecutivePreSong++;
    this.lastDeliveryMode = 'pre_song';

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode: 'eject_transition',
      sessionPhase: this.getSessionPhase(),
      currentTrack,
      previousTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
      tracksReferenced: [...this.tracksReferenced],
      previousSession: this.buildPreviousSession(),
      maxWords: 40,
    };

    const text = await generateSegment(context);

    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;
    this.segmentsSinceExtended = this.segmentsSinceExtended + 1;
    this.consecutiveSpokenSegments++;
    this.lastWasMidSongDrop = false;
    this.addToTracksReferenced(currentTrack.artistName);

    saveSessionMemory({
      lastTrackTitle: currentTrack.title,
      lastArtistName: currentTrack.artistName,
      lastArtists: [...this.tracksReferenced].slice(0, 10),
      lastTimestamp: Date.now(),
    });

    return { text, type: segmentType, deliveryMode: 'eject_transition' };
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit src/engines/SegmentController.ts 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add src/engines/SegmentController.ts && git commit -m "feat: add generateEjectTransition to SegmentController"
```

---

### Task 3: Native Module — `playEjectTransition()` and `cancelEjectTransition()`

**Files:**
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`

This is the most complex task. The native module gets two new functions and a track-change suppression flag.

- [ ] **Step 1: Add the `ejectTransitionInProgress` flag and stored track info**

At the top of `ExpoMusicKitModule` class (after line 19, near the other instance variables), add:

```swift
  private var ejectTransitionInProgress: Bool = false
  private var ejectSuppressedTrackInfo: [String: Any]? = nil
  private var ejectTrackIdBeforeSkip: String? = nil
```

- [ ] **Step 2: Register the new event**

On line 24, change:

```swift
    Events("onTrackChanged", "onPlaybackStateChanged")
```

to:

```swift
    Events("onTrackChanged", "onPlaybackStateChanged", "onEjectTrackChanged")
```

- [ ] **Step 3: Add track change suppression in the queue observer**

In `startObserving()` (around line 561), inside the `if currentId != self.lastTrackId` block, wrap the `sendEvent("onTrackChanged", event)` call with the suppression check:

```swift
        if currentId != self.lastTrackId {
          let previousTrackId = self.lastTrackId
          self.lastTrackId = currentId
          var event: [String: Any] = [:]
          if let currentId = currentId {
            event["trackId"] = currentId
          }
          if let previousTrackId = previousTrackId {
            event["previousTrackId"] = previousTrackId
          }

          if self.ejectTransitionInProgress {
            // Suppress — store for synthetic event after transition completes
            self.ejectSuppressedTrackInfo = event
          } else {
            self.sendEvent("onTrackChanged", event)
          }
        }
```

- [ ] **Step 4: Add `playEjectTransition()` function**

Add this after the `deactivateDuckingSession` AsyncFunction block (around line 424), before the `OnStartObserving` block:

```swift
    AsyncFunction("playEjectTransition") { (ttsBase64: String, fadeInDelayMs: Int, promise: Promise) in
      guard let data = Data(base64Encoded: ttsBase64) else {
        promise.reject("ERR", "Invalid base64 audio data")
        return
      }

      // Record the current track ID before we skip
      self.ejectTrackIdBeforeSkip = {
        guard let entry = self.player.queue.currentEntry else { return nil }
        if case .song(let song) = entry.item { return song.id.rawValue }
        return nil
      }()

      self.ejectTransitionInProgress = true
      self.ejectSuppressedTrackInfo = nil

      do {
        // Stop any currently playing TTS
        if let existing = self.audioPlayer, existing.isPlaying {
          existing.stop()
        }
        self.audioPlayer = nil
        self.audioDelegate = nil

        // Step 1: Activate ducking
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)

        // Step 2: Play TTS
        let newPlayer = try AVAudioPlayer(data: data)
        self.audioPlayer = newPlayer
        self.audioDelegate = AudioPlayerDelegate(player: newPlayer) { [weak self] in
          guard let self = self else { return }
          self.audioPlayer = nil
          self.audioDelegate = nil
          self.crossfadeTimer?.invalidate()
          self.crossfadeTimer = nil

          if self.crossfadeActive {
            self.crossfadeActive = false
          } else {
            // No crossfade happened (short TTS) — remove ducking now
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            // Ensure music is playing (MusicKit may have paused between entries)
            Task {
              try? await self.player.play()
            }
          }

          // Emit synthetic track changed event
          self.ejectTransitionInProgress = false
          if let suppressed = self.ejectSuppressedTrackInfo {
            self.sendEvent("onEjectTrackChanged", suppressed)
            self.ejectSuppressedTrackInfo = nil
          } else {
            // Track change event may not have fired yet — emit with current state
            let currentId: String? = {
              guard let entry = self.player.queue.currentEntry else { return nil }
              if case .song(let song) = entry.item { return song.id.rawValue }
              return nil
            }()
            var event: [String: Any] = [:]
            if let id = currentId { event["trackId"] = id }
            if let prev = self.ejectTrackIdBeforeSkip { event["previousTrackId"] = prev }
            self.sendEvent("onEjectTrackChanged", event)
          }
          self.ejectTrackIdBeforeSkip = nil

          promise.resolve(nil)
        }
        self.audioPlayer?.delegate = self.audioDelegate
        newPlayer.volume = self.ttsVolume
        self.audioPlayer?.prepareToPlay()

        // Step 3: Schedule track skip
        let ttsDuration = self.audioPlayer?.duration ?? 3.0
        let fadeInDelaySec = Double(fadeInDelayMs) / 1000.0
        let skipDelay = min(fadeInDelaySec, max(ttsDuration * 0.5, 1.0))

        DispatchQueue.main.asyncAfter(deadline: .now() + skipDelay) { [weak self] in
          guard let self = self, self.ejectTransitionInProgress else { return }
          // Check if track already auto-advanced
          let currentId: String? = {
            guard let entry = self.player.queue.currentEntry else { return nil }
            if case .song(let song) = entry.item { return song.id.rawValue }
            return nil
          }()
          if currentId == self.ejectTrackIdBeforeSkip {
            // Track hasn't changed yet — skip it
            Task {
              try? await self.player.skipToNextEntry()
            }
          }
        }

        // Step 4: Crossfade — remove ducking before TTS ends
        self.crossfadeActive = false
        self.crossfadeTimer?.invalidate()
        self.crossfadeTimer = nil

        if ttsDuration > 3.0 {
          let fadePoint = ttsDuration - 2.0
          DispatchQueue.main.async {
            self.crossfadeTimer = Timer.scheduledTimer(withTimeInterval: fadePoint, repeats: false) { [weak self] _ in
              guard let self = self, self.audioPlayer?.isPlaying == true else { return }
              self.crossfadeActive = true
              try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            }
          }
        }

        self.audioPlayer?.play()
      } catch {
        self.ejectTransitionInProgress = false
        self.ejectSuppressedTrackInfo = nil
        self.ejectTrackIdBeforeSkip = nil
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        promise.reject("ERR", error.localizedDescription)
      }
    }

    AsyncFunction("cancelEjectTransition") {
      guard self.ejectTransitionInProgress else { return }
      self.crossfadeTimer?.invalidate()
      self.crossfadeTimer = nil
      self.crossfadeActive = false
      self.audioPlayer?.stop()
      self.audioPlayer = nil
      self.audioDelegate = nil
      self.ejectTransitionInProgress = false
      self.ejectSuppressedTrackInfo = nil
      self.ejectTrackIdBeforeSkip = nil
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
    }
```

- [ ] **Step 5: Build the native module to verify**

Run: `cd /Users/kari/Documents/cleo-app && cd ios && ~/.rbenv/shims/pod install 2>&1 | tail -5`

Then: `cd /Users/kari/Documents/cleo-app && xcodebuild -workspace ios/Cleo.xcworkspace -scheme Cleo -sdk iphoneos -configuration Debug build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add modules/expo-music-kit/ios/ExpoMusicKitModule.swift && git commit -m "feat: add playEjectTransition and cancelEjectTransition native functions"
```

---

### Task 4: TypeScript Exports for New Native Functions

**Files:**
- Modify: `modules/expo-music-kit/index.ts`

- [ ] **Step 1: Add the new function exports**

At the end of `modules/expo-music-kit/index.ts`, before the `// ── Event Listeners` section (around line 144), add:

```typescript
// ── Eject Transition ──────────────────────────────────────────────────

export async function playEjectTransition(ttsBase64: string, fadeInDelayMs: number): Promise<void> {
  return await ExpoMusicKit.playEjectTransition(ttsBase64, fadeInDelayMs);
}

export async function cancelEjectTransition(): Promise<void> {
  return await ExpoMusicKit.cancelEjectTransition();
}
```

- [ ] **Step 2: Add the new event listener export**

In the `// ── Event Listeners` section, after `addPlaybackStateListener`, add:

```typescript
export type EjectTrackChangedEvent = {
  trackId?: string;
  previousTrackId?: string;
};

export function addEjectTrackChangedListener(
  listener: (event: EjectTrackChangedEvent) => void
): EventSubscription {
  return emitter.addListener('onEjectTrackChanged', listener);
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add modules/expo-music-kit/index.ts && git commit -m "feat: export playEjectTransition, cancelEjectTransition, and eject event listener"
```

---

### Task 5: Add Eject Listener to MusicKitPlayer Service

**Files:**
- Modify: `src/services/MusicKitPlayer.ts`

- [ ] **Step 1: Import the new listener and event type**

At the top of `src/services/MusicKitPlayer.ts`, add `addEjectTrackChangedListener` and `EjectTrackChangedEvent` to the import from `../../modules/expo-music-kit`:

```typescript
import {
  // ... existing imports ...
  addEjectTrackChangedListener,
  type EjectTrackChangedEvent,
} from '../../modules/expo-music-kit';
```

Also add the callback type alias after the existing ones (around line 27):

```typescript
type EjectTrackChangeCallback = (event: EjectTrackChangedEvent) => void;
```

- [ ] **Step 2: Add eject listener management to the class**

Add a new instance variable (after `stateListeners`):

```typescript
  private ejectSub: EventSubscription | null = null;
  private ejectListeners: EjectTrackChangeCallback[] = [];
```

Add a new public method after `onPlaybackStateChanged`:

```typescript
  onEjectTrackChanged(callback: EjectTrackChangeCallback): () => void {
    this.ejectListeners.push(callback);
    this.ensureSubscriptions();
    return () => {
      this.ejectListeners = this.ejectListeners.filter(cb => cb !== callback);
      this.cleanupIfEmpty();
    };
  }
```

- [ ] **Step 3: Wire up the subscription in `ensureSubscriptions()`**

Add to the end of `ensureSubscriptions()`:

```typescript
    if (!this.ejectSub && this.ejectListeners.length > 0) {
      this.ejectSub = addEjectTrackChangedListener((event) => {
        this.ejectListeners.forEach(cb => cb(event));
      });
    }
```

- [ ] **Step 4: Wire up cleanup in `cleanupIfEmpty()` and `destroy()`**

Add to `cleanupIfEmpty()`:

```typescript
    if (this.ejectListeners.length === 0 && this.ejectSub) {
      this.ejectSub.remove();
      this.ejectSub = null;
    }
```

Add to `destroy()` (before setting arrays to `[]`):

```typescript
    this.ejectSub?.remove();
    this.ejectSub = null;
    this.ejectListeners = [];
```

- [ ] **Step 5: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add src/services/MusicKitPlayer.ts && git commit -m "feat: add onEjectTrackChanged listener to MusicKitPlayer"
```

---

### Task 6: Create TransitionPreloader

**Files:**
- Create: `src/engines/TransitionPreloader.ts`

This is the core JS-side engine — state machine, pre-gen triggers, eject window timing.

- [ ] **Step 1: Create the TransitionPreloader file**

Create `src/engines/TransitionPreloader.ts`:

```typescript
import { segmentController } from './SegmentController';
import { synthesize } from '../services/CleoVoiceEngine';
import { playEjectTransition, cancelEjectTransition } from '../../modules/expo-music-kit';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import type { Vibe } from '../cleo/fallbacks';
import type { SegmentResult } from './SegmentController';

type PreloaderState = 'idle' | 'generating' | 'ready' | 'fired' | 'done';

interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  genreNames?: string[];
  duration?: number;
  enrichedFacts?: any;
  hasRichData?: boolean;
}

// ── Eject Window Sizing ─────────────────────────────────────────────

const GENRE_WINDOWS: { keywords: string[]; windowSec: number }[] = [
  { keywords: ['electronic', 'ambient', 'jazz'], windowSec: 22 },
  { keywords: ['pop', 'hip-hop', 'hip hop', 'r&b', 'rnb'], windowSec: 13 },
  { keywords: ['rock', 'indie', 'alternative'], windowSec: 16 },
];
const DEFAULT_WINDOW_SEC = 15;

function getEjectWindowSec(genreNames?: string[]): number {
  if (!genreNames || genreNames.length === 0) return DEFAULT_WINDOW_SEC;
  const lower = genreNames.map(g => g.toLowerCase());
  for (const { keywords, windowSec } of GENRE_WINDOWS) {
    if (keywords.some(kw => lower.some(g => g.includes(kw)))) {
      return windowSec;
    }
  }
  return DEFAULT_WINDOW_SEC;
}

// ── Pre-Gen Trigger ─────────────────────────────────────────────────

function getPreGenTriggerFraction(durationSec: number): number {
  if (durationSec < 180) return 0.5;
  if (durationSec <= 300) return 0.6;
  return 0.7;
}

// ── TransitionPreloader ─────────────────────────────────────────────

class TransitionPreloaderEngine {
  private state: PreloaderState = 'idle';
  private currentTrack: TrackInfo | null = null;
  private nextTrack: TrackInfo | null = null;
  private previousTrack: TrackInfo | null = null;
  private cachedBase64: string | null = null;
  private cachedSegment: SegmentResult | null = null;
  private preGenTriggerSec = 0;
  private ejectPointSec = 0;
  private playbackUnsub: (() => void) | null = null;
  private currentVibe: Vibe = 'general';
  private ejectWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private isSpeakingCheck: (() => boolean) | null = null;

  setVibe(vibe: Vibe) {
    this.currentVibe = vibe;
  }

  /** Provide a function that returns the current isSpeaking state from AudioCoordinator */
  setIsSpeakingCheck(fn: () => boolean) {
    this.isSpeakingCheck = fn;
  }

  /**
   * Called when a new track starts. Resets state and begins monitoring
   * playback position for pre-gen and eject triggers.
   */
  startForTrack(
    track: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void,
    onEjectFired?: () => void,
    onFallback?: () => void
  ): void {
    this.reset();

    const duration = track.duration;
    if (!duration || duration < 30) {
      // Too short for eject window — let fallback handle it
      return;
    }

    this.currentTrack = track;
    this.nextTrack = nextTrack ?? null;
    this.previousTrack = previousTrack ?? null;
    this.state = 'idle';

    const triggerFraction = getPreGenTriggerFraction(duration);
    this.preGenTriggerSec = duration * triggerFraction;

    const windowSec = getEjectWindowSec(track.genreNames);
    this.ejectPointSec = duration - windowSec;

    // Don't allow eject point before pre-gen trigger
    if (this.ejectPointSec <= this.preGenTriggerSec) {
      this.ejectPointSec = this.preGenTriggerSec + 10;
    }

    // If eject point is past the track duration, bail
    if (this.ejectPointSec >= duration) {
      return;
    }

    console.log(`[TransitionPreloader] Track: "${track.title}" (${duration.toFixed(0)}s), pre-gen at ${this.preGenTriggerSec.toFixed(0)}s, eject at ${this.ejectPointSec.toFixed(0)}s`);

    // Listen to playback position via existing event stream
    this.playbackUnsub = musicKitPlayer.onPlaybackStateChanged((event) => {
      if (this.state === 'done' || this.state === 'fired') return;

      const time = event.playbackTime;

      // Pre-gen trigger
      if (this.state === 'idle' && time >= this.preGenTriggerSec) {
        this.beginGeneration(onSegmentReady);
      }

      // Eject trigger
      if (time >= this.ejectPointSec) {
        this.tryFireEject(onEjectFired, onFallback);
      }
    });
  }

  private async beginGeneration(onSegmentReady?: (segment: SegmentResult) => void) {
    if (this.state !== 'idle') return;
    this.state = 'generating';

    try {
      const track = this.currentTrack!;
      const segment = await segmentController.generateEjectTransition(
        track,
        this.nextTrack ?? undefined,
        this.previousTrack ?? undefined
      );

      if (this.state !== 'generating') return; // cancelled

      if (!segment) {
        console.log('[TransitionPreloader] Generation returned null — will fallback');
        this.state = 'idle'; // allow fallback
        return;
      }

      // Synthesize TTS
      const base64 = await synthesize(segment.text, this.currentVibe);

      if (this.state !== 'generating') return; // cancelled

      if (!base64) {
        console.log('[TransitionPreloader] TTS synthesis failed — will fallback');
        this.state = 'idle';
        return;
      }

      this.cachedBase64 = base64;
      this.cachedSegment = segment;
      this.state = 'ready';
      onSegmentReady?.(segment);
      console.log(`[TransitionPreloader] Ready — TTS cached for "${track.title}"`);
    } catch (error) {
      console.error('[TransitionPreloader] Generation failed:', error);
      this.state = 'idle';
    }
  }

  private tryFireEject(onEjectFired?: () => void, onFallback?: () => void) {
    if (this.state === 'ready') {
      // Check if something else is speaking (e.g., mid-song drop)
      if (this.isSpeakingCheck?.()) {
        // Wait up to 3s for speaking to finish
        if (!this.ejectWaitTimer) {
          this.ejectWaitTimer = setTimeout(() => {
            this.ejectWaitTimer = null;
            if (this.state === 'ready' && !this.isSpeakingCheck?.()) {
              this.fireEject(onEjectFired);
            } else {
              console.log('[TransitionPreloader] Still speaking after 3s wait — falling back');
              onFallback?.();
            }
          }, 3000);
        }
        return;
      }
      this.fireEject(onEjectFired);
    } else if (this.state === 'generating') {
      // Wait up to 3s for generation to finish
      if (!this.ejectWaitTimer) {
        this.ejectWaitTimer = setTimeout(() => {
          this.ejectWaitTimer = null;
          if (this.state === 'ready') {
            this.fireEject(onEjectFired);
          } else {
            console.log('[TransitionPreloader] Generation not ready after 3s — falling back');
            onFallback?.();
          }
        }, 3000);
      }
    }
    // state === 'idle' means generation hasn't started or failed — fallback will handle via track change
  }

  private async fireEject(onEjectFired?: () => void) {
    if (this.state !== 'ready' || !this.cachedBase64) return;
    this.state = 'fired';

    console.log(`[TransitionPreloader] Firing eject transition`);
    onEjectFired?.();

    try {
      // Calculate fadeInDelay as ~70% of estimated TTS duration
      // Average speech rate: ~150 words/min = 2.5 words/sec
      // With 20-40 words, TTS is ~8-16s. Use 70% as fade-in point.
      const estimatedTtsSec = (this.cachedSegment?.text.split(/\s+/).length ?? 30) / 2.5;
      const fadeInDelayMs = Math.round(estimatedTtsSec * 0.7 * 1000);

      await playEjectTransition(this.cachedBase64, fadeInDelayMs);
      this.state = 'done';
      console.log('[TransitionPreloader] Eject transition completed');
    } catch (error) {
      console.error('[TransitionPreloader] Eject transition failed:', error);
      this.state = 'done';
    }
  }

  /** Cancel any in-progress pre-gen or eject. Called on skip. */
  cancel() {
    if (this.state === 'fired') {
      cancelEjectTransition().catch(() => {});
    }
    this.reset();
  }

  getState(): PreloaderState {
    return this.state;
  }

  getCachedSegment(): SegmentResult | null {
    return this.cachedSegment;
  }

  private reset() {
    this.state = 'idle';
    this.currentTrack = null;
    this.nextTrack = null;
    this.previousTrack = null;
    this.cachedBase64 = null;
    this.cachedSegment = null;
    this.preGenTriggerSec = 0;
    this.ejectPointSec = 0;
    if (this.ejectWaitTimer) {
      clearTimeout(this.ejectWaitTimer);
      this.ejectWaitTimer = null;
    }
    if (this.playbackUnsub) {
      this.playbackUnsub();
      this.playbackUnsub = null;
    }
  }
}

export const transitionPreloader = new TransitionPreloaderEngine();
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit src/engines/TransitionPreloader.ts 2>&1 | head -20`

Expected: No errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add src/engines/TransitionPreloader.ts && git commit -m "feat: create TransitionPreloader engine with pre-gen and eject window timing"
```

---

### Task 7: Wire TransitionPreloader into AudioCoordinator

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

- [ ] **Step 1: Import TransitionPreloader**

At the top of `src/engines/AudioCoordinator.ts`, add:

```typescript
import { transitionPreloader } from './TransitionPreloader';
```

- [ ] **Step 2: Add `genreNames` to TrackInfo interface**

In the `TrackInfo` interface (around line 36), add `genreNames`:

```typescript
interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  genreNames?: string[];
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
  duration?: number;
}
```

- [ ] **Step 3: Add `handleTrackStart()` method**

Add this new method to `AudioCoordinatorEngine` class, after the `setVibe` method (around line 338):

```typescript
  /**
   * Primary entry point for new tracks. Kicks off the eject window pre-generation
   * pipeline. Falls back to handleTrackChange if the eject system doesn't fire.
   * Does NOT schedule mid-song drops — those are handled by the fallback path
   * or after the eject transition completes.
   */
  handleTrackStart(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void
  ): void {
    // Save previous track BEFORE overwriting, so TransitionPreloader can use it
    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    const trackInfo = this.enrichTrack(currentTrack);

    transitionPreloader.startForTrack(
      { ...trackInfo, genreNames: currentTrack.genreNames },
      nextTrack,
      previous ?? undefined,
      (segment) => {
        onSegmentReady?.(segment);
      },
      () => {
        // onEjectFired — mark as speaking so mid-song drops don't fire
        this.isSpeaking = true;
      },
      () => {
        // onFallback — eject didn't fire, will be handled by onTrackChanged fallback
        console.log('[AudioCoordinator] Eject fallback — will use handleTrackChange on next track event');
      }
    );

    // Schedule mid-song drop for this track
    this.scheduleMidSongDrop(trackInfo);
  }
```

- [ ] **Step 4: Wire TransitionPreloader into cancelPendingTimer**

In the `cancelPendingTimer()` method (around line 61), add at the end before `this.generationId++`:

```typescript
    transitionPreloader.cancel();
```

- [ ] **Step 5: Set isSpeaking check and vibe on TransitionPreloader**

In the `setVibe` method, add:

```typescript
    transitionPreloader.setVibe(vibe);
```

In the constructor, add:

```typescript
    transitionPreloader.setIsSpeakingCheck(() => this.isSpeaking);
```

- [ ] **Step 6: Handle eject transition completion in isSpeaking**

After the `handleTrackStart` method, add a method to reset speaking state after eject completes:

```typescript
  /** Called when the eject transition completes (onEjectTrackChanged event fires) */
  handleEjectComplete(): void {
    this.isSpeaking = false;
    this.lastSegmentEndTime = Date.now();
  }
```

- [ ] **Step 7: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add src/engines/AudioCoordinator.ts && git commit -m "feat: wire TransitionPreloader into AudioCoordinator with handleTrackStart"
```

---

### Task 8: Wire BroadcastScreen Entry Points

**Files:**
- Modify: `src/screens/player/BroadcastScreen.tsx`

This task updates the track change listener to implement the entry point decision tree.

- [ ] **Step 1: Add imports**

Add to the imports at the top of BroadcastScreen:

```typescript
import { transitionPreloader } from '../../engines/TransitionPreloader';
```

- [ ] **Step 2: Add a skip flag ref**

Inside the `BroadcastScreen` component, add a ref to track manual skips (after the existing refs):

```typescript
  const manualSkipRef = useRef(false);
```

- [ ] **Step 3: Update `handleNext` to set the skip flag**

In `handleNext` (around line 243), add `manualSkipRef.current = true;` before the skip call:

```typescript
  const handleNext = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    manualSkipRef.current = true;
    try {
      await musicKitPlayer.skip();
    } catch {
      // skip may throw if at end of queue
    }
  };
```

- [ ] **Step 4: Add the eject track changed listener**

Add a new `useEffect` after the existing track change listener (after line 211):

```typescript
  // --- Eject transition completed listener ---
  useEffect(() => {
    const unsub = musicKitPlayer.onEjectTrackChanged(async (event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        setProgress(0);
        progressWidth.setValue(0);

        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          const profile = queueManager.getTrackProfile(event.trackId);
          const artworkUrl = profile?.artworkUrl ?? np.artworkUrl;
          durationRef.current = np.duration ?? 0;
          setNowPlaying({ ...np, artworkUrl });

          // Update Cleo speaking state from eject segment
          const ejectSegment = transitionPreloader.getCachedSegment();
          if (ejectSegment) {
            setCleoText(ejectSegment.text);
            setSegmentType(ejectSegment.type);
            setCleoSpeaking(true);
            setTimeout(() => setCleoSpeaking(false), 1500);
          }

          // Mark eject complete and start pre-gen for the new track
          audioCoordinator.handleEjectComplete();

          const nextTrackId = sessionEngine.getNextTrackId();
          const nextProfile = nextTrackId ? queueManager.getTrackProfile(nextTrackId) : null;
          audioCoordinator.handleTrackStart(
            {
              id: np.id,
              title: np.title,
              artistName: np.artistName,
              albumTitle: np.albumTitle,
              duration: np.duration,
              genre: np.genreNames?.[0],
              genreNames: np.genreNames,
            },
            nextProfile ? {
              title: nextProfile.title,
              artistName: nextProfile.artistName,
            } : undefined,
            (segment) => {
              setCleoText(segment.text);
              setSegmentType(segment.type);
              setCleoSpeaking(true);
            }
          );
        }
      }
    });
    return unsub;
  }, []);
```

- [ ] **Step 5: Update the existing track change listener to be the fallback**

Replace the existing track change listener `useEffect` (lines 174-211) with:

```typescript
  // --- Track change listener (fallback path) ---
  // This fires when onTrackChanged is NOT suppressed (i.e., eject transition wasn't active).
  // Handles: manual skips, natural track ends where eject wasn't ready, very short tracks.
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        const isManualSkip = manualSkipRef.current;
        manualSkipRef.current = false;

        addRecentlyPlayedTrack(event.trackId);
        setProgress(0);
        progressWidth.setValue(0);

        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          const profile = queueManager.getTrackProfile(event.trackId);
          const artworkUrl = profile?.artworkUrl ?? np.artworkUrl;
          durationRef.current = np.duration ?? 0;
          setNowPlaying({ ...np, artworkUrl });

          const trackInfo = {
            id: np.id,
            title: np.title,
            artistName: np.artistName,
            albumTitle: np.albumTitle,
            duration: np.duration,
            genre: np.genreNames?.[0],
            genreNames: np.genreNames,
          };

          // Fallback: use existing handleTrackChangeWithResult
          // This handles Cleo speaking + schedules mid-song drops internally
          await audioCoordinator.handleTrackChangeWithResult(
            trackInfo,
            undefined,
            (segment) => {
              setCleoText(segment.text);
              setSegmentType(segment.type);
              setCleoSpeaking(true);
            },
            isManualSkip
          );
          setTimeout(() => {
            setCleoSpeaking(false);
          }, 1500);

          // Start eject pre-gen for the NEXT transition of this track.
          // Note: handleTrackChangeWithResult already scheduled mid-song drops,
          // so we only call transitionPreloader.startForTrack directly (not handleTrackStart
          // which would double-schedule mid-song drops).
          const nextTrackId = sessionEngine.getNextTrackId();
          const nextProfile = nextTrackId ? queueManager.getTrackProfile(nextTrackId) : null;
          transitionPreloader.startForTrack(
            { ...trackInfo, genreNames: np.genreNames },
            nextProfile ? { title: nextProfile.title, artistName: nextProfile.artistName } : undefined,
            undefined, // previousTrack already set by handleTrackChangeWithResult
          );
        }
      }
    });
    return unsub;
  }, []);
```

- [ ] **Step 6: Start pre-gen on initial session**

In the session initialization `useEffect` (around line 113), after `refreshNowPlaying()`, add the initial `handleTrackStart` call so pre-gen kicks off for the first track:

```typescript
      // Start eject window pre-gen for current track
      const np = await musicKitPlayer.getNowPlaying();
      if (np) {
        const nextTrackId = sessionEngine.getNextTrackId();
        const nextProfile = nextTrackId ? queueManager.getTrackProfile(nextTrackId) : null;
        audioCoordinator.handleTrackStart(
          {
            id: np.id,
            title: np.title,
            artistName: np.artistName,
            albumTitle: np.albumTitle,
            duration: np.duration,
            genre: np.genreNames?.[0],
            genreNames: np.genreNames,
          },
          nextProfile ? {
            title: nextProfile.title,
            artistName: nextProfile.artistName,
          } : undefined
        );
      }
```

Add this at the end of both the "existing session" early return block (after `queueManager.enrichExistingSession`) and after the new session initialization block (after `refreshNowPlaying()`).

- [ ] **Step 7: Commit**

```bash
cd /Users/kari/Documents/cleo-app && git add src/screens/player/BroadcastScreen.tsx && git commit -m "feat: wire BroadcastScreen with eject transition and fallback entry points"
```

---

### Task 9: Rsync, Build, and Device Test

**Files:** None (build verification)

- [ ] **Step 1: Rsync to cleo-app**

```bash
rsync -av --delete --exclude='ios/' --exclude='node_modules/' --exclude='.expo/' --exclude='.git/' /Users/kari/Documents/DJApp/ /Users/kari/Documents/cleo-app/
```

- [ ] **Step 2: Verify entitlements**

Check that `Cleo.entitlements` has empty `<dict/>` (no musickit key):

```bash
cat /Users/kari/Documents/cleo-app/ios/Cleo/Cleo.entitlements
```

- [ ] **Step 3: Pod install and build**

```bash
cd /Users/kari/Documents/cleo-app/ios && ~/.rbenv/shims/pod install && cd .. && xcodebuild -workspace ios/Cleo.xcworkspace -scheme Cleo -sdk iphoneos -configuration Debug build 2>&1 | tail -30
```

- [ ] **Step 4: Test on device**

Deploy to physical device. Play a playlist with tracks 3+ minutes long. Verify:

1. At ~60% through the track, console logs show `[TransitionPreloader] Ready`
2. Near the end of the track (~15s before end), console logs show `[TransitionPreloader] Firing eject transition`
3. Music ducks, Cleo speaks over the outro
4. Track changes to the next song while Cleo is speaking
5. Music rises under Cleo's last words
6. Manual skip (tap forward) uses the fallback path — Cleo speaks after the new track starts

- [ ] **Step 5: Commit any fixes**

Stage only the specific files that were fixed, then commit:

```bash
cd /Users/kari/Documents/cleo-app && git add <specific-files-changed> && git commit -m "fix: address device testing issues for eject window system"
```

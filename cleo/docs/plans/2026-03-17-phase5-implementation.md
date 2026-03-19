# Phase 5 — Audio Coordination & Core Handoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatic radio loop — when a song ends, Cleo speaks an intro for the next track with music ducking, then music resumes.

**Architecture:** Native AVAudioSession ducking via ExpoMusicKit module. SegmentController manages segment type rotation and context assembly. AudioCoordinator orchestrates the duck→speak→resume sequence. onTrackChanged triggers the loop automatically.

**Tech Stack:** Swift AVAudioSession, ExpoMusicKit native module, TypeScript engines

---

### Task 1: Add native audio ducking to ExpoMusicKit

**Files:**
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`
- Modify: `modules/expo-music-kit/index.ts`

**Step 1: Add ducking functions to Swift module**

In `ExpoMusicKitModule.swift`, add two new AsyncFunctions before the `// MARK: - Observation Lifecycle` section:

```swift
AsyncFunction("activateDuckingSession") {
  try AVAudioSession.sharedInstance().setCategory(
    .playback,
    mode: .default,
    options: [.duckOthers]
  )
  try AVAudioSession.sharedInstance().setActive(true)
}

AsyncFunction("deactivateDuckingSession") {
  try AVAudioSession.sharedInstance().setActive(
    false,
    options: .notifyOthersOnDeactivation
  )
}
```

Also add a callback-based version of `playAudioFromBase64` that resolves when playback finishes. Replace the existing `playAudioFromBase64` with:

```swift
AsyncFunction("playAudioFromBase64") { (base64String: String, promise: Promise) in
  guard let data = Data(base64Encoded: base64String) else {
    promise.reject("ERR", "Invalid base64 audio data")
    return
  }

  do {
    try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.duckOthers])
    try AVAudioSession.sharedInstance().setActive(true)

    self.audioPlayer = try AVAudioPlayer(data: data)
    self.audioDelegate = AudioPlayerDelegate {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      promise.resolve(nil)
    }
    self.audioPlayer?.delegate = self.audioDelegate
    self.audioPlayer?.play()
  } catch {
    promise.reject("ERR", error.localizedDescription)
  }
}
```

Add a delegate class and property to the module:

```swift
private var audioDelegate: AudioPlayerDelegate?

// Add at the bottom of the file, outside the Module class:
class AudioPlayerDelegate: NSObject, AVAudioPlayerDelegate {
  let onFinish: () -> Void

  init(onFinish: @escaping () -> Void) {
    self.onFinish = onFinish
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    onFinish()
  }
}
```

This makes `playAudioFromBase64` handle ducking automatically — it activates ducking before playing and deactivates when done. The promise resolves when audio finishes, so the caller knows when Cleo is done speaking.

**Step 2: Update TypeScript exports**

In `modules/expo-music-kit/index.ts`, add:

```typescript
export async function activateDuckingSession(): Promise<void> {
  return await ExpoMusicKit.activateDuckingSession();
}

export async function deactivateDuckingSession(): Promise<void> {
  return await ExpoMusicKit.deactivateDuckingSession();
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add modules/expo-music-kit/
git commit -m "feat: add AVAudioSession ducking + audio completion callback to native module"
```

---

### Task 2: Build SegmentController engine

**Files:**
- Create: `src/engines/SegmentController.ts`

**Step 1: Create the engine**

`src/engines/SegmentController.ts`:
```typescript
import { generateSegment, type SegmentContext } from '../services/CleoScriptGenerator';
import type { SegmentType, Vibe } from '../cleo/fallbacks';

interface TrackInfo {
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
}

interface SegmentResult {
  text: string;
  type: SegmentType;
}

// Segment type rotation order
const ROTATION: SegmentType[] = [
  'song_intro',
  'song_intro',
  'station_id',
  'song_intro',
  'song_intro',
  'listener_shoutout',
  'song_intro',
  'song_intro',
  'session_checkin',
];

class SegmentControllerEngine {
  private history: string[] = [];
  private rotationIndex = 0;
  private segmentCount = 0;
  private sessionStartTime = Date.now();
  private bufferedSegment: SegmentResult | null = null;
  private currentVibe: Vibe = 'chill';
  private listenerName?: string;

  setVibe(vibe: Vibe) {
    this.currentVibe = vibe;
  }

  setListenerName(name: string) {
    this.listenerName = name;
  }

  startSession() {
    this.history = [];
    this.rotationIndex = 0;
    this.segmentCount = 0;
    this.sessionStartTime = Date.now();
    this.bufferedSegment = null;
  }

  private getNextSegmentType(): SegmentType {
    const type = ROTATION[this.rotationIndex % ROTATION.length];
    this.rotationIndex++;
    return type;
  }

  private getSessionDuration(): number {
    return Math.floor((Date.now() - this.sessionStartTime) / 60000);
  }

  async generateNext(currentTrack: TrackInfo, nextTrack?: TrackInfo): Promise<SegmentResult> {
    // Use buffered segment if available
    if (this.bufferedSegment) {
      const buffered = this.bufferedSegment;
      this.bufferedSegment = null;
      this.history.unshift(buffered.text);
      if (this.history.length > 3) this.history.pop();
      this.segmentCount++;
      return buffered;
    }

    const segmentType = this.getNextSegmentType();

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      currentTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
    };

    const text = await generateSegment(context);

    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;

    return { text, type: segmentType };
  }

  async preloadNext(currentTrack: TrackInfo, nextTrack?: TrackInfo): Promise<void> {
    if (this.bufferedSegment) return;

    const segmentType = ROTATION[(this.rotationIndex) % ROTATION.length];

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      currentTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
    };

    try {
      const text = await generateSegment(context);
      this.bufferedSegment = { text, type: segmentType };
    } catch {
      // Pre-load failure is non-fatal
    }
  }

  getSegmentCount(): number {
    return this.segmentCount;
  }
}

export const segmentController = new SegmentControllerEngine();
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/engines/SegmentController.ts
git commit -m "feat: add SegmentController with rotation, history, and pre-loading"
```

---

### Task 3: Build AudioCoordinator engine

**Files:**
- Create: `src/engines/AudioCoordinator.ts`

**Step 1: Create the engine**

`src/engines/AudioCoordinator.ts`:
```typescript
import { synthesizeAndPlay } from '../services/CleoVoiceEngine';
import { segmentController } from './SegmentController';

interface TrackInfo {
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
}

class AudioCoordinatorEngine {
  private isSpeaking = false;

  async handleTrackChange(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo
  ): Promise<void> {
    if (this.isSpeaking) return;
    this.isSpeaking = true;

    try {
      // Small delay for natural feel
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Generate segment (uses buffer if pre-loaded)
      const segment = await segmentController.generateNext(currentTrack, nextTrack);

      console.log(`[Cleo] ${segment.type}: ${segment.text}`);

      // Play TTS — ducking is handled inside playAudioFromBase64 natively
      await synthesizeAndPlay(segment.text);

      // Pre-load next segment while music plays
      segmentController.preloadNext(currentTrack, nextTrack);
    } catch (error) {
      console.error('[AudioCoordinator] Handoff failed:', error);
    } finally {
      this.isSpeaking = false;
    }
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const audioCoordinator = new AudioCoordinatorEngine();
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "feat: add AudioCoordinator with duck-speak-resume handoff"
```

---

### Task 4: Wire auto-trigger into HomeScreen

**Files:**
- Modify: `src/screens/home/HomeScreen.tsx`

**Step 1: Replace manual TEST CLEO with auto-trigger**

Update the `onTrackChanged` listener in HomeScreen to call `audioCoordinator.handleTrackChange()` automatically. Keep the TEST CLEO button but also add automatic triggering.

Import the coordinator:
```typescript
import { audioCoordinator } from '../../engines/AudioCoordinator';
import { segmentController } from '../../engines/SegmentController';
```

Update the track change listener:
```typescript
useEffect(() => {
  segmentController.startSession();

  const unsub = musicKitPlayer.onTrackChanged(async (event) => {
    if (event.trackId) {
      addRecentlyPlayedTrack(event.trackId);
      const np = await musicKitPlayer.getNowPlaying();
      if (np) {
        setNowPlaying({ title: np.title, artistName: np.artistName });
        setAuthState('playing');

        // Auto-trigger Cleo
        audioCoordinator.handleTrackChange(
          { title: np.title, artistName: np.artistName, albumTitle: np.albumTitle },
        );
      }
    }
  });
  return unsub;
}, []);
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/screens/home/HomeScreen.tsx
git commit -m "feat: auto-trigger Cleo on track change — full radio loop"
```

---

### Task 5: Rebuild and test on device

**Step 1: Sync, prebuild, pod install, build**

Must rebuild native binary because we added Swift code (ducking + audio completion).

```bash
# Sync to build path
rsync -a --exclude='ios' --exclude='android' --exclude='node_modules' --exclude='.git' --exclude='server' \
  "/Users/kari/Documents/DJ App/cleo/" /Users/kari/Documents/cleo-app/

# Prebuild
cd /Users/kari/Documents/cleo-app && npm install && rm -rf ios android && npx expo prebuild --clean

# Pod install
echo '{"expo.jsEngine":"hermes","EX_DEV_CLIENT_NETWORK_INSPECTOR":"true","ios.deploymentTarget":"16.0"}' > ios/Podfile.properties.json
cat > ios/Cleo/Cleo.entitlements << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict/>
</plist>
PLIST
cd ios && pod install

# Fix deployment target and build
sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 15.1/IPHONEOS_DEPLOYMENT_TARGET = 16.0/g' Cleo.xcodeproj/project.pbxproj
cd .. && rm -rf ~/Library/Developer/Xcode/DerivedData/Cleo-*
xcodebuild -workspace ios/Cleo.xcworkspace -configuration Debug -scheme Cleo \
  -destination "id=00008120-000C7CAE1407601E" DEVELOPMENT_TEAM=8F2VWCN5KF \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration
```

**Step 2: Start servers and install**

```bash
# Backend
cd server && npx tsx src/index.ts &

# Metro
cd /Users/kari/Documents/cleo-app && npx expo start --port 8081 &

# Install and launch
xcrun devicectl device install app --device "00008120-000C7CAE1407601E" <path-to-Cleo.app>
xcrun devicectl device process launch --device "00008120-000C7CAE1407601E" com.worthymedia.cleo
```

**Step 3: Test the radio loop**

1. Open app, tap a playlist to start playing
2. Wait for a song to end (or skip to next)
3. Expected: ~1.5s after track change, music ducks, Cleo speaks an intro, music volume returns
4. Next song plays, loop repeats

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: Phase 5 complete — full radio loop with auto Cleo segments"
```

---

## Milestone Verification

Phase 5 is complete when:

- [ ] Music plays → song ends → Cleo automatically speaks
- [ ] Music volume ducks while Cleo speaks
- [ ] Music volume returns to normal when Cleo finishes
- [ ] Segment types rotate (song_intro, station_id, listener_shoutout, etc.)
- [ ] Segment history prevents repetitive structures
- [ ] Pre-loading buffers next segment during playback
- [ ] No crashes on rapid track skipping

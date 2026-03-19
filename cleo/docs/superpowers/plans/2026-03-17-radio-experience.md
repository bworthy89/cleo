# Radio Experience Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cleo feel like a real radio station with mid-song drops, session memory across app opens, and music crossfade under Cleo's voice.

**Architecture:** Six files modified in dependency order — new SessionMemory storage first, then CleoScriptGenerator prompt changes, then SegmentController mid-song generation, then AudioCoordinator timing, then PlayerScreen call site, then native crossfade. Each task is independently testable.

**Tech Stack:** TypeScript, React Native 0.83, Expo SDK 55, MMKV storage, Swift/AVFoundation native module.

---

## File Map

| File | What Changes |
|---|---|
| `src/services/SessionMemory.ts` | **New file** — MMKV persistence for session context across app opens |
| `src/services/CleoScriptGenerator.ts` | Add `maxWords?` and `previousSession?` to `SegmentContext`; variable word limit; PREVIOUS SESSION prompt block |
| `src/engines/SegmentController.ts` | Add `duration?` to TrackInfo; `generateMidSongDrop()`; `startSession(stationId, vibe)` reads/writes SessionMemory |
| `src/engines/AudioCoordinator.ts` | Add `duration?` to TrackInfo; `scheduleMidSongDrop()`, `pendingMidSongTimer`, `lastSegmentEndTime` |
| `src/screens/player/PlayerScreen.tsx` | Pass `duration` + `genre` in track info; pass `stationId`/`vibe` to `startSession()`; remove `setVibe()` |
| `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` | Add `crossfadeTimer`, `crossfadeActive`; fade-point ducking deactivation; branch `audioPlayerDidFinishPlaying` |

**Verify TypeScript compiles** after each task: `cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit`

---

## Task 1: Create SessionMemory Module

**Files:**
- Create: `cleo/src/services/SessionMemory.ts`

This is a thin MMKV read/write layer for persisting session context across app opens. No business logic — just storage with typed helpers.

- [ ] **Step 1: Create SessionMemory.ts**

```typescript
import { storage } from './Storage';

export interface SessionMemoryData {
  lastStationId: string;
  lastVibe: string;
  lastArtists: string[];
  lastTrackTitle: string;
  lastArtistName: string;
  lastTimestamp: number;
  sessionCount: number;
}

const KEY = 'session.memory';

export function saveSessionMemory(data: Partial<SessionMemoryData>): void {
  const existing = loadSessionMemory();
  const merged = { ...existing, ...data };
  storage.set(KEY, JSON.stringify(merged));
}

export function loadSessionMemory(): SessionMemoryData | null {
  const raw = storage.getString(KEY);
  if (!raw) return null;
  return JSON.parse(raw) as SessionMemoryData;
}

export function getTimeSinceLastSession(): { hours: number; sameDay: boolean; label: string } | null {
  const mem = loadSessionMemory();
  if (!mem?.lastTimestamp) return null;

  const ms = Date.now() - mem.lastTimestamp;
  const hours = Math.floor(ms / 3600000);
  const today = new Date();
  const last = new Date(mem.lastTimestamp);
  const sameDay = today.toDateString() === last.toDateString();

  let label: string;
  if (hours < 1) label = 'just now';
  else if (hours < 4) label = `${hours} hour${hours === 1 ? '' : 's'} ago`;
  else if (sameDay) label = 'earlier today';
  else if (hours < 48) label = 'yesterday';
  else {
    const days = Math.floor(hours / 24);
    label = `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return { hours, sameDay, label };
}

export function incrementSessionCount(): number {
  const mem = loadSessionMemory();
  const count = (mem?.sessionCount ?? 0) + 1;
  saveSessionMemory({ sessionCount: count });
  return count;
}

export function clearSessionMemory(): void {
  storage.delete(KEY);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/services/SessionMemory.ts && git commit -m "feat(session): add SessionMemory MMKV persistence layer"
```

---

## Task 2: Add maxWords and previousSession to CleoScriptGenerator

**Files:**
- Modify: `cleo/src/services/CleoScriptGenerator.ts`

Add `maxWords?: number` and `previousSession?` fields to `SegmentContext`. Update `buildDynamicPrompt` to use variable word limits and include PREVIOUS SESSION block.

- [ ] **Step 1: Add new fields to SegmentContext interface**

In `CleoScriptGenerator.ts`, add these fields to the `SegmentContext` interface (after `tracksReferenced`):

```typescript
  maxWords?: number;
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

- [ ] **Step 2: Add PREVIOUS SESSION block to buildDynamicPrompt**

In `buildDynamicPrompt`, after the `segmentHistory` block (around line 129) and before the `SEGMENT TYPE` line, add:

```typescript
  if (context.previousSession) {
    const ps = context.previousSession;
    prompt += `\n\nPREVIOUS SESSION`;
    prompt += `\n- Last station: ${ps.stationName}`;
    prompt += `\n- Last vibe: ${ps.vibe}`;
    prompt += `\n- Last track: "${ps.lastTrack}" by ${ps.lastArtist}`;
    prompt += `\n- Time since: ${ps.timeSince}`;
    if (ps.artists.length > 0) {
      prompt += `\n- Artists from last session: ${ps.artists.join(', ')}`;
    }
    prompt += `\n- Session number: ${ps.sessionNumber}`;
    if (ps.returningToSameStation) {
      prompt += `\n- Returning to same station: yes`;
    }
    if (ps.switchedStation) {
      prompt += `\n- Switched to a different station: yes`;
    }
  }
```

- [ ] **Step 3: Make word limit variable**

Replace the hardcoded word limit line:

```typescript
// Replace:
- 40 to 75 words maximum.
// With:
- ${context.maxWords ? `15 to ${context.maxWords}` : '40 to 75'} words maximum.
```

The full OUTPUT RULES line becomes:

```typescript
  prompt += `\n\nSEGMENT TYPE: ${context.segmentType}
CREATIVE BRIEF: ${brief}

OUTPUT RULES
- ${context.maxWords ? `15 to ${context.maxWords}` : '40 to 75'} words maximum.
- Plain text only. No quotes, no stage directions, no labels.
- Do not include the segment type name in your response.`;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/services/CleoScriptGenerator.ts && git commit -m "feat(script): add maxWords and previousSession to segment context and prompt"
```

---

## Task 3: Add generateMidSongDrop and SessionMemory to SegmentController

**Files:**
- Modify: `cleo/src/engines/SegmentController.ts`

Add `duration?: number` to TrackInfo. Add `generateMidSongDrop()` as a standalone generation path. Update `startSession()` to accept `stationId` and `vibe` params and read/write SessionMemory. Write SessionMemory on every `generateNext()`.

- [ ] **Step 1: Add duration to TrackInfo and import SessionMemory**

At top of file, add import:

```typescript
import { saveSessionMemory, loadSessionMemory, getTimeSinceLastSession, incrementSessionCount } from '../services/SessionMemory';
```

Add `duration?: number` to the `TrackInfo` interface (after `hasRichData`):

```typescript
interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
  duration?: number;
}
```

- [ ] **Step 2: Add session memory fields and update startSession**

Add new private fields to `SegmentControllerEngine`:

```typescript
  private sessionMemory: ReturnType<typeof loadSessionMemory> = null;
  private currentStationId = '';
```

Replace `startSession()` with:

```typescript
  startSession(stationId?: string, vibe?: Vibe) {
    // Load previous session memory before resetting
    this.sessionMemory = loadSessionMemory();

    this.history = [];
    this.rotationIndex = 0;
    this.segmentCount = 0;
    this.sessionStartTime = Date.now();
    this.bufferedSegment = null;
    this.lastDeliveryMode = 'pre_song';
    this.consecutivePreSong = 0;
    this.tracksReferenced = [];

    if (stationId) this.currentStationId = stationId;
    if (vibe) this.currentVibe = vibe;

    // Persist new session start
    incrementSessionCount();
    if (stationId) saveSessionMemory({ lastStationId: stationId });
    if (vibe) saveSessionMemory({ lastVibe: vibe });
  }
```

- [ ] **Step 3: Write SessionMemory on every generateNext**

At the end of `generateNext()`, just before `return { text, type: segmentType, deliveryMode };`, add:

```typescript
    // Persist session context for cross-session continuity
    saveSessionMemory({
      lastTrackTitle: currentTrack.title,
      lastArtistName: currentTrack.artistName,
      lastArtists: [...this.tracksReferenced].slice(0, 10),
      lastTimestamp: Date.now(),
    });
```

- [ ] **Step 4: Pass previousSession to SegmentContext in generateNext**

In `generateNext()`, when building the `context` object, add `previousSession` if session memory exists. After the `tracksReferenced` line:

```typescript
    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode,
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
    };
```

Add the helper method to the class:

```typescript
  private buildPreviousSession(): SegmentContext['previousSession'] {
    if (!this.sessionMemory) return undefined;
    const timeSince = getTimeSinceLastSession();
    if (!timeSince) return undefined;

    return {
      stationName: this.sessionMemory.lastStationId,
      vibe: this.sessionMemory.lastVibe,
      lastTrack: this.sessionMemory.lastTrackTitle,
      lastArtist: this.sessionMemory.lastArtistName,
      timeSince: timeSince.label,
      artists: this.sessionMemory.lastArtists ?? [],
      sessionNumber: this.sessionMemory.sessionCount ?? 1,
      returningToSameStation: this.sessionMemory.lastStationId === this.currentStationId,
      switchedStation: this.sessionMemory.lastStationId !== this.currentStationId,
    };
  }
```

- [ ] **Step 5: Add generateMidSongDrop method**

Add this new method to `SegmentControllerEngine`. It is a standalone generation path — does NOT advance rotation or affect delivery mode tracking:

```typescript
  private static MID_SONG_TYPES: SegmentType[] = ['station_id', 'session_checkin', 'post_track_reflection'];

  async generateMidSongDrop(currentTrack: TrackInfo): Promise<SegmentResult> {
    // Pick random type from allowed mid-song types
    const segmentType = SegmentControllerEngine.MID_SONG_TYPES[
      Math.floor(Math.random() * SegmentControllerEngine.MID_SONG_TYPES.length)
    ];

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode: 'post_song',
      sessionPhase: this.getSessionPhase(),
      currentTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
      tracksReferenced: [...this.tracksReferenced],
      maxWords: 25,
    };

    const text = await generateSegment(context);

    // Update history and tracking — but NOT rotation index or delivery mode
    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;
    this.addToTracksReferenced(currentTrack.artistName);

    // Persist session context
    saveSessionMemory({
      lastTrackTitle: currentTrack.title,
      lastArtistName: currentTrack.artistName,
      lastArtists: [...this.tracksReferenced].slice(0, 10),
      lastTimestamp: Date.now(),
    });

    return { text, type: segmentType, deliveryMode: 'post_song' };
  }
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/engines/SegmentController.ts && git commit -m "feat(segment): add generateMidSongDrop and SessionMemory read/write"
```

---

## Task 4: Add Mid-Song Scheduling to AudioCoordinator

**Files:**
- Modify: `cleo/src/engines/AudioCoordinator.ts`

Add `duration?: number` to TrackInfo. Add `scheduleMidSongDrop()`, `pendingMidSongTimer`, and `lastSegmentEndTime`. Update `cancelPendingTimer()` to clear mid-song timer.

- [ ] **Step 1: Add duration to TrackInfo and new fields to class**

Add `duration?: number` to the `TrackInfo` interface (after `hasRichData`):

```typescript
interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
  duration?: number;
}
```

Add new private fields to `AudioCoordinatorEngine`:

```typescript
  private pendingMidSongTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSegmentEndTime = 0;
```

- [ ] **Step 2: Update cancelPendingTimer to clear mid-song timer**

```typescript
  private cancelPendingTimer() {
    if (this.pendingPostSongTimer) {
      clearTimeout(this.pendingPostSongTimer);
      this.pendingPostSongTimer = null;
    }
    if (this.pendingMidSongTimer) {
      clearTimeout(this.pendingMidSongTimer);
      this.pendingMidSongTimer = null;
    }
    // Invalidate any in-progress generation so stale results are discarded
    this.generationId++;
    this.isSpeaking = false;
  }
```

- [ ] **Step 3: Track lastSegmentEndTime in existing finally blocks**

In `handleTrackChange`, in the pre_song `finally` block, add `this.lastSegmentEndTime = Date.now();` before `this.isSpeaking = false`. Same for the post_song timer's `finally` block.

In `handleTrackChangeWithResult`, same pattern: add `this.lastSegmentEndTime = Date.now();` in both the pre_song and post_song `finally` blocks (before `this.isSpeaking = false`).

- [ ] **Step 4: Add scheduleMidSongDrop method**

```typescript
  private scheduleMidSongDrop(trackInfo: TrackInfo) {
    // Only for tracks > 3 minutes
    if (!trackInfo.duration || trackInfo.duration <= 180) return;
    // 40% chance
    if (Math.random() >= 0.4) return;

    // Random delay between 45-90 seconds
    const delay = 45000 + Math.floor(Math.random() * 45000);

    this.pendingMidSongTimer = setTimeout(async () => {
      this.pendingMidSongTimer = null;

      // Guards: not speaking, cooldown passed, no pending post-song segment
      if (this.isSpeaking) return;
      if (this.pendingPostSongTimer !== null) return;
      if (Date.now() - this.lastSegmentEndTime < 30000) return;

      this.isSpeaking = true;
      const myId = this.generationId;

      try {
        const segment = await segmentController.generateMidSongDrop(trackInfo);
        if (myId !== this.generationId) return;
        console.log(`[Cleo] mid-song ${segment.type}: ${segment.text}`);
        await synthesizeAndPlay(segment.text);
      } catch (error) {
        console.error('[AudioCoordinator] Mid-song drop failed:', error);
      } finally {
        if (myId === this.generationId) {
          this.lastSegmentEndTime = Date.now();
          this.isSpeaking = false;
        }
      }
    }, delay);
  }
```

- [ ] **Step 5: Call scheduleMidSongDrop after track change handlers**

In `handleTrackChange`, at the end of the pre_song path (after `synthesizeAndPlay` and `preloadNext`, before the `catch`), add:

```typescript
        // Schedule potential mid-song drop
        if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
```

In `handleTrackChangeWithResult`, at the end of the pre_song `try` block (after `preloadNext`), add the same line. For the post_song path, schedule it inside the `setTimeout` callback after `synthesizeAndPlay` and `preloadNext`:

```typescript
            if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/engines/AudioCoordinator.ts && git commit -m "feat(audio): add mid-song Cleo drops with 40% chance on 3+ min tracks"
```

---

## Task 5: Update PlayerScreen Call Site

**Files:**
- Modify: `cleo/src/screens/player/PlayerScreen.tsx`

Pass `duration` and `genre` in track info to `handleTrackChangeWithResult`. Pass `stationId` and `vibe` to `segmentController.startSession()`. Remove the separate `setVibe()` call.

- [ ] **Step 1: Update startSession call**

In PlayerScreen's mount `useEffect` (around line 61-62), replace:

```typescript
      segmentController.startSession();
      segmentController.setVibe(vibe);
```

With:

```typescript
      segmentController.startSession(stationId, vibe);
```

- [ ] **Step 2: Pass duration and genre in track info**

In the `onTrackChanged` listener (around line 134-140), update the track info object passed to `handleTrackChangeWithResult`:

```typescript
          await audioCoordinator.handleTrackChangeWithResult(
            {
              id: np.id,
              title: np.title,
              artistName: np.artistName,
              albumTitle: np.albumTitle,
              duration: np.duration,
              genre: np.genreNames?.[0],
            },
            undefined,
            (segment) => {
              setCleoText(segment.text);
              setIsPullQuote(segment.type === 'track_story' || segment.type === 'post_track_reflection');
              setCleoSpeaking(true);
            }
          );
```

Note: `np.genreNames` is on the `NowPlaying` type (inherited from `MusicTrack`). If it's undefined, the field is simply omitted.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/screens/player/PlayerScreen.tsx && git commit -m "feat(player): pass duration/genre to AudioCoordinator, stationId/vibe to startSession"
```

---

## Task 6: Add Crossfade to Native Module

**Files:**
- Modify: `cleo/modules/expo-music-kit/ios/ExpoMusicKitModule.swift`

Add `crossfadeTimer` and `crossfadeActive` flag. Schedule a fade-point timer that deactivates ducking 2 seconds before Cleo finishes. Branch `audioPlayerDidFinishPlaying` based on crossfade state.

- [ ] **Step 1: Add crossfade state to ExpoMusicKitModule**

Add two new properties to the `ExpoMusicKitModule` class (after `audioDelegate`):

```swift
  private var crossfadeTimer: Timer?
  private var crossfadeActive: Bool = false
```

- [ ] **Step 2: Add crossfade timer logic to playAudioFromBase64**

After the `self.audioPlayer?.prepareToPlay()` line and before `self.audioPlayer?.play()`, add the crossfade timer setup:

```swift
        // Crossfade: schedule ducking deactivation 2s before audio ends
        self.crossfadeActive = false
        self.crossfadeTimer?.invalidate()
        self.crossfadeTimer = nil

        if let duration = self.audioPlayer?.duration, duration > 3.0 {
          let fadePoint = duration - 2.0
          // Schedule on main thread to ensure RunLoop is active
          DispatchQueue.main.async {
            self.crossfadeTimer = Timer.scheduledTimer(withTimeInterval: fadePoint, repeats: false) { [weak self] _ in
              guard let self = self, self.audioPlayer?.isPlaying == true else { return }
              self.crossfadeActive = true
              // Deactivate ducking — iOS ramps music back up naturally (~0.5s)
              try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }
          }
        }
```

- [ ] **Step 3: Branch audioPlayerDidFinishPlaying on crossfade state**

Replace the current `AudioPlayerDelegate` `onFinish` closure inside `playAudioFromBase64`. The existing closure is:

```swift
        self.audioDelegate = AudioPlayerDelegate(player: newPlayer) { [weak self] in
          self?.audioPlayer = nil
          self?.audioDelegate = nil
          // Deactivate ducking session, then resume MusicKit playback
          try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
          Task {
            try? await self?.player.play()
          }
          promise.resolve(nil)
        }
```

Replace with:

```swift
        self.audioDelegate = AudioPlayerDelegate(player: newPlayer) { [weak self] in
          self?.audioPlayer = nil
          self?.audioDelegate = nil
          self?.crossfadeTimer?.invalidate()
          self?.crossfadeTimer = nil

          if self?.crossfadeActive == true {
            // Music already resumed from fade point — just resolve
            self?.crossfadeActive = false
            promise.resolve(nil)
          } else {
            // No crossfade — hard transition (short segment or timer didn't fire)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            Task {
              try? await self?.player.play()
            }
            promise.resolve(nil)
          }
        }
```

- [ ] **Step 4: Update stopAudio to clean up crossfade state**

Update the `stopAudio` function:

```swift
    AsyncFunction("stopAudio") {
      self.crossfadeTimer?.invalidate()
      self.crossfadeTimer = nil
      self.crossfadeActive = false
      self.audioPlayer?.stop()
      self.audioPlayer = nil
      self.audioDelegate = nil
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
```

- [ ] **Step 5: Sync to cleo-app and build**

```bash
rsync -av "/Users/kari/Documents/DJ App/cleo/modules/expo-music-kit/ios/ExpoMusicKitModule.swift" /Users/kari/Documents/cleo-app/modules/expo-music-kit/ios/ExpoMusicKitModule.swift

cd /Users/kari/Documents/cleo-app && xcodebuild -workspace ios/Cleo.xcworkspace -configuration Debug -scheme Cleo -destination "id=00008120-000C7CAE1407601E" DEVELOPMENT_TEAM=8F2VWCN5KF -allowProvisioningUpdates -allowProvisioningDeviceRegistration 2>&1 | tail -5
```

Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 6: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add modules/expo-music-kit/ios/ExpoMusicKitModule.swift && git commit -m "feat(native): add crossfade — deactivate ducking 2s before Cleo finishes"
```

---

## Verification Checklist

After all tasks complete, verify on physical device:

- [ ] Mid-song drop fires during a 3+ minute track (check console for `[Cleo] mid-song`)
- [ ] Mid-song drops are brief (< 25 words)
- [ ] No double-speak: mid-song drop never fires while post-song is pending
- [ ] Close and reopen app → Cleo references previous session (check console for PREVIOUS SESSION in prompt)
- [ ] Return to same station → prompt includes `Returning to same station: yes`
- [ ] When Cleo finishes a segment, music rises under her last words — no hard silence gap
- [ ] Short segments (< 3s) still hard-transition (no crossfade)
- [ ] Skipping a track cancels all pending timers (mid-song, post-song)
- [ ] `startSession(stationId, vibe)` works — no separate `setVibe()` needed

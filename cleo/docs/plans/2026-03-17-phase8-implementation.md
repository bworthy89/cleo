# Phase 8 — PlayerScreen + Pull Quote + Subtitles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the hero PlayerScreen with full editorial layout, word-by-word subtitle reveal, pull quote overlays for track stories, and ON AIR pulse indicator — the core visual experience of the app.

**Architecture:** PlayerScreen receives current track + Cleo state from a shared context. WordByWordSubtitle uses React Native Animated API for staggered word fade-in. PullQuoteOverlay renders as a modal overlay with dimmed backdrop. App.tsx manages screen state (home vs player) without React Navigation.

**Tech Stack:** React Native Animated API, design tokens, existing engine/service layer

---

### Task 1: Build WordByWordSubtitle component

**Files:**
- Create: `src/components/WordByWordSubtitle.tsx`

**Step 1: Create the component**

`src/components/WordByWordSubtitle.tsx`:
```typescript
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Animation } from '../tokens/design-tokens';

interface WordByWordSubtitleProps {
  text: string;
  visible: boolean;
  onFinish?: () => void;
}

export function WordByWordSubtitle({ text, visible, onFinish }: WordByWordSubtitleProps) {
  const words = text.split(/\s+/);
  const opacities = useRef(words.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!visible) {
      // Reset all opacities
      opacities.forEach((o) => o.setValue(0));
      return;
    }

    // Stagger fade-in for each word
    const animations = opacities.map((opacity, index) =>
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        delay: index * Animation.wordFade.stagger,
        useNativeDriver: true,
      })
    );

    Animated.parallel(animations).start(() => {
      // Hold for 1 second after all words visible
      setTimeout(() => {
        // Fade out all words
        Animated.timing(new Animated.Value(1), {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }).start();
        onFinish?.();
      }, 1000);
    });
  }, [visible, text]);

  if (!visible || !text) return null;

  return (
    <View style={styles.container}>
      <View style={styles.wordWrap}>
        {words.map((word, index) => (
          <Animated.Text
            key={`${word}-${index}`}
            style={[styles.word, { opacity: opacities[index] ?? 1 }]}
          >
            {word}{' '}
          </Animated.Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    minHeight: 60,
  },
  wordWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  word: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 18,
    color: Colors.accent,
    lineHeight: 28,
  },
});
```

**Step 2: Commit**

```bash
git add src/components/WordByWordSubtitle.tsx
git commit -m "feat: add WordByWordSubtitle with staggered 40ms fade-in"
```

---

### Task 2: Build PullQuoteOverlay component

**Files:**
- Create: `src/components/PullQuoteOverlay.tsx`

**Step 1: Create the component**

`src/components/PullQuoteOverlay.tsx`:
```typescript
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Dimensions } from 'react-native';
import { Typography, Colors, Spacing } from '../tokens/design-tokens';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PullQuoteOverlayProps {
  text: string;
  visible: boolean;
  onFinish?: () => void;
}

export function PullQuoteOverlay({ text, visible, onFinish }: PullQuoteOverlayProps) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      backdropOpacity.setValue(0);
      textOpacity.setValue(0);
      translateY.setValue(0);
      return;
    }

    // Fade in backdrop and text
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0.7,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 600,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Hold for 1 second, then dissolve upward
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(textOpacity, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: -30,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onFinish?.();
        });
      }, 1000);
    });
  }, [visible, text]);

  if (!visible || !text) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
      <Animated.Text
        style={[
          styles.quoteText,
          {
            opacity: textOpacity,
            transform: [{ translateY }],
          },
        ]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.base.black,
  },
  quoteText: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 28,
    color: Colors.base.white,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    lineHeight: 40,
  },
});
```

**Step 2: Commit**

```bash
git add src/components/PullQuoteOverlay.tsx
git commit -m "feat: add PullQuoteOverlay with dimmed backdrop and upward dissolve"
```

---

### Task 3: Build OnAirIndicator component

**Files:**
- Create: `src/components/OnAirIndicator.tsx`

**Step 1: Create the component**

`src/components/OnAirIndicator.tsx`:
```typescript
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Spacing } from '../tokens/design-tokens';

interface OnAirIndicatorProps {
  active: boolean;
  accentColor?: string;
}

export function OnAirIndicator({ active, accentColor }: OnAirIndicatorProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (active) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );

      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );

      pulse.start();
      glow.start();

      return () => {
        pulse.stop();
        glow.stop();
        pulseAnim.setValue(1);
        glowAnim.setValue(0.3);
      };
    } else {
      pulseAnim.setValue(1);
      glowAnim.setValue(0.3);
    }
  }, [active]);

  const color = accentColor ?? Colors.accent;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            opacity: glowAnim,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />
      <Animated.Text style={[styles.label, { color, opacity: active ? glowAnim : 0.3 }]}>
        ON AIR
      </Animated.Text>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            opacity: glowAnim,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 3,
  },
});
```

**Step 2: Commit**

```bash
git add src/components/OnAirIndicator.tsx
git commit -m "feat: add OnAirIndicator with pulse animation"
```

---

### Task 4: Build PlayerScreen

**Files:**
- Create: `src/screens/player/PlayerScreen.tsx`

**Step 1: Create the full PlayerScreen**

`src/screens/player/PlayerScreen.tsx`:
```typescript
import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Colors, Typography, Spacing } from '../../tokens/design-tokens';
import { WordByWordSubtitle } from '../../components/WordByWordSubtitle';
import { PullQuoteOverlay } from '../../components/PullQuoteOverlay';
import { OnAirIndicator } from '../../components/OnAirIndicator';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { audioCoordinator } from '../../engines/AudioCoordinator';
import { segmentController } from '../../engines/SegmentController';
import { queueManager } from '../../engines/QueueManager';
import { sessionEngine } from '../../engines/SessionEngine';
import { addRecentlyPlayedTrack } from '../../services/Storage';
import type { Vibe } from '../../cleo/fallbacks';
import type { NowPlaying } from '../../../modules/expo-music-kit';

interface PlayerScreenProps {
  stationName: string;
  playlistId: string;
  stationId: string;
  vibe: Vibe;
  onBack: () => void;
}

export function PlayerScreen({
  stationName,
  playlistId,
  stationId,
  vibe,
  onBack,
}: PlayerScreenProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [cleoText, setCleoText] = useState('');
  const [cleoSpeaking, setCleoSpeaking] = useState(false);
  const [isPullQuote, setIsPullQuote] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);

  const vibeTheme = Colors.vibe[vibe] ?? Colors.vibe.chill;

  // Start session on mount
  useEffect(() => {
    (async () => {
      segmentController.startSession();
      segmentController.setVibe(vibe);
      await queueManager.initializeSession(playlistId, vibe, stationId);
      setSessionStarted(true);
      refreshNowPlaying();
    })();
  }, []);

  // Listen for track changes
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          setNowPlaying(np);

          // Auto-trigger Cleo
          setCleoSpeaking(true);
          const segment = await audioCoordinator.handleTrackChangeWithResult({
            id: np.id,
            title: np.title,
            artistName: np.artistName,
            albumTitle: np.albumTitle,
          });
          if (segment) {
            setCleoText(segment.text);
            setIsPullQuote(segment.type === 'track_story');
          }
          setCleoSpeaking(false);
        }
      }
    });
    return unsub;
  }, []);

  async function refreshNowPlaying() {
    const np = await musicKitPlayer.getNowPlaying();
    if (np) setNowPlaying(np);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: vibeTheme.bg }]}>
      {/* Pull Quote Overlay */}
      <PullQuoteOverlay
        text={cleoText}
        visible={isPullQuote && cleoSpeaking}
        onFinish={() => setIsPullQuote(false)}
      />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={[styles.backButton, { color: vibeTheme.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.stationName, { color: vibeTheme.text }]}>
          {stationName.toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Accent Line */}
      <View style={[styles.accentLine, { backgroundColor: vibeTheme.accent }]} />

      {/* Album Art */}
      <View style={styles.artworkContainer}>
        {nowPlaying?.artworkUrl ? (
          <Image
            source={{ uri: nowPlaying.artworkUrl }}
            style={styles.artwork}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]} />
        )}
      </View>

      {/* Track Info */}
      <View style={styles.trackInfo}>
        <Text
          style={[styles.songTitle, { color: vibeTheme.text }]}
          numberOfLines={2}
        >
          {nowPlaying?.title?.toUpperCase() ?? 'LOADING...'}
        </Text>
        <Text style={[styles.artistName, { color: vibeTheme.text }]}>
          {nowPlaying?.artistName ?? ''}
          {nowPlaying?.albumTitle ? `  ·  ${nowPlaying.albumTitle}` : ''}
        </Text>
      </View>

      {/* ON AIR Indicator */}
      <OnAirIndicator active={cleoSpeaking} accentColor={vibeTheme.accent} />

      {/* Cleo's Words */}
      {!isPullQuote && (
        <WordByWordSubtitle
          text={cleoText}
          visible={cleoSpeaking}
        />
      )}

      {/* Progress Line */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressLine, { backgroundColor: vibeTheme.accent }]} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  backButton: {
    fontSize: 24,
    fontFamily: Typography.label.family,
  },
  stationName: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    letterSpacing: 3,
  },
  accentLine: {
    height: 1,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  artworkContainer: {
    width: '100%',
    aspectRatio: 1,
    marginTop: Spacing.md,
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  artworkPlaceholder: {
    backgroundColor: Colors.base.black,
  },
  trackInfo: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  songTitle: {
    fontFamily: Typography.display.family,
    fontSize: 32,
    letterSpacing: 1,
    lineHeight: 38,
  },
  artistName: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    opacity: 0.7,
    marginTop: Spacing.xs,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  progressContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  progressLine: {
    height: 2,
    width: '100%',
    opacity: 0.3,
  },
});
```

Note: This references `audioCoordinator.handleTrackChangeWithResult` which doesn't exist yet — we'll add it in Task 5.

**Step 2: Commit**

```bash
git add src/screens/player/PlayerScreen.tsx
git commit -m "feat: add PlayerScreen with editorial layout, album art, track info"
```

---

### Task 5: Update AudioCoordinator to return segment data

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

**Step 1: Add handleTrackChangeWithResult**

The PlayerScreen needs to know what Cleo said and what type of segment it was. Add a new method that returns the segment result:

```typescript
import type { SegmentResult } from './SegmentController';
```

Note: SegmentResult is currently not exported. Export it from SegmentController.ts first:

In `src/engines/SegmentController.ts`, change:
```typescript
interface SegmentResult {
```
to:
```typescript
export interface SegmentResult {
```

Then in AudioCoordinator, add:

```typescript
  async handleTrackChangeWithResult(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo
  ): Promise<SegmentResult | null> {
    if (this.isSpeaking) return null;
    this.isSpeaking = true;

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      let trackInfo = currentTrack;
      if (currentTrack.id) {
        const enrichedProfile = queueManager.getTrackProfile(currentTrack.id);
        if (enrichedProfile) {
          trackInfo = {
            ...currentTrack,
            enrichedFacts: enrichedProfile.enrichedFacts,
            hasRichData: enrichedProfile.hasRichData,
          };
        }
      }

      const segment = await segmentController.generateNext(trackInfo, nextTrack);
      console.log(`[Cleo] ${segment.type}: ${segment.text}`);

      await synthesizeAndPlay(segment.text);
      segmentController.preloadNext(trackInfo, nextTrack);

      return segment;
    } catch (error) {
      console.error('[AudioCoordinator] Handoff failed:', error);
      return null;
    } finally {
      this.isSpeaking = false;
    }
  }
```

**Step 2: Commit**

```bash
git add src/engines/AudioCoordinator.ts src/engines/SegmentController.ts
git commit -m "feat: add handleTrackChangeWithResult for PlayerScreen integration"
```

---

### Task 6: Wire PlayerScreen into App.tsx

**Files:**
- Modify: `App.tsx`
- Modify: `src/screens/home/HomeScreen.tsx`

**Step 1: Update App.tsx with screen state management**

```typescript
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { HomeScreen } from './src/screens/home/HomeScreen';
import { PlayerScreen } from './src/screens/player/PlayerScreen';
import type { Vibe } from './src/cleo/fallbacks';

SplashScreen.preventAutoHideAsync();

interface PlayerParams {
  stationName: string;
  playlistId: string;
  stationId: string;
  vibe: Vibe;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular: require('@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf'),
    WorkSans_400Regular: require('@expo-google-fonts/work-sans/400Regular/WorkSans_400Regular.ttf'),
    WorkSans_500Medium: require('@expo-google-fonts/work-sans/500Medium/WorkSans_500Medium.ttf'),
    EBGaramond_400Regular: require('@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf'),
    EBGaramond_400Regular_Italic: require('@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf'),
    DMMono_400Regular: require('@expo-google-fonts/dm-mono/400Regular/DMMono_400Regular.ttf'),
  });

  const [playerParams, setPlayerParams] = useState<PlayerParams | null>(null);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  if (playerParams) {
    return (
      <>
        <PlayerScreen
          stationName={playerParams.stationName}
          playlistId={playerParams.playlistId}
          stationId={playerParams.stationId}
          vibe={playerParams.vibe}
          onBack={() => setPlayerParams(null)}
        />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      <HomeScreen onNavigateToPlayer={setPlayerParams} />
      <StatusBar style="dark" />
    </>
  );
}
```

**Step 2: Update HomeScreen to use onNavigateToPlayer**

Add `onNavigateToPlayer` prop to HomeScreen. When a station is pressed, instead of starting the session directly, navigate to PlayerScreen which handles session start.

Update HomeScreen's props and handleStationPress:

```typescript
interface HomeScreenProps {
  onNavigateToPlayer?: (params: {
    stationName: string;
    playlistId: string;
    stationId: string;
    vibe: Vibe;
  }) => void;
}

export function HomeScreen({ onNavigateToPlayer }: HomeScreenProps) {
```

Update `handleStationPress` to navigate instead of starting session:

```typescript
  const handleStationPress = useCallback(async (station: Station) => {
    if (onNavigateToPlayer) {
      onNavigateToPlayer({
        stationName: station.name,
        playlistId: station.playlistId,
        stationId: station.id,
        vibe: (station.defaultVibe as Vibe) ?? 'chill',
      });
    }
  }, [onNavigateToPlayer]);
```

Remove the `queueManager.initializeSession` and `segmentController` calls from HomeScreen — PlayerScreen now owns the session.

Remove unused imports from HomeScreen: `audioCoordinator`, `segmentController`, `queueManager`, `sessionEngine`, `Vibe` (keep `Vibe` if used in the navigate params).

Remove the auto-trigger `onTrackChanged` logic from HomeScreen — PlayerScreen handles it now.

**Step 3: Commit**

```bash
git add App.tsx src/screens/home/HomeScreen.tsx
git commit -m "feat: wire PlayerScreen into App with state-based navigation"
```

---

### Task 7: Test on device

**Step 1: Sync to Metro and test**

No native changes — JS only. Reload app on device.

**Step 2: Test flow**

1. App opens to HomeScreen with station cards
2. Tap a station → navigates to PlayerScreen
3. Album art loads, song title displays in large type
4. Cleo speaks → ON AIR pulses, words appear word-by-word
5. On track_story segment → pull quote overlay with dimmed backdrop
6. Back button returns to HomeScreen

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Phase 8 complete — PlayerScreen with editorial UI and Cleo visuals"
```

---

## Milestone Verification

Phase 8 is complete when:

- [ ] PlayerScreen displays album art full-bleed
- [ ] Song title in large Playfair Display
- [ ] Station name + accent line at top
- [ ] ON AIR indicator pulses when Cleo speaks
- [ ] Words appear word-by-word with 40ms stagger
- [ ] Pull quote overlay fires on track_story segments with dimmed backdrop
- [ ] Pull quote dissolves upward after 1s hold
- [ ] Back navigation works
- [ ] Vibe theme colors apply (background, text, accent)

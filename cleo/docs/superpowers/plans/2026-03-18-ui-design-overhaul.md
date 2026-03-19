# UI Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Cleo from a functional music player into an editorial magazine-cover experience with vibe-aware theming, Title Over Art player layout, and Cleo's typographic voice throughout.

**Architecture:** Bottom-up approach — tokens and helpers first, then shared components, then screens (player first as hero, then home, onboarding, settings). Each task produces a working commit. No task depends on uncommitted work from another task.

**Tech Stack:** React Native 0.83, Expo SDK 55, TypeScript, expo-linear-gradient (new), expo-haptics (new), Animated API

**Spec:** `docs/superpowers/specs/2026-03-17-ui-design-overhaul.md`

---

## File Map

### Create
- `src/components/GrainOverlay.tsx` — noise texture overlay component
- `assets/textures/grain.png` — 200x200 grayscale noise PNG

### Modify
- `src/tokens/design-tokens.ts` — add `Radius`, `Opacity`, `Tracking`, `withAlpha()`, `isDarkVibe()`
- `src/components/WordByWordSubtitle.tsx` — accentColor prop, fade-out fix
- `src/components/OnAirIndicator.tsx` — larger dots, glow, paused state
- `src/components/StationCard.tsx` — sharp corners, text-on-art, accent line, responsive width
- `src/components/VibeSelector.tsx` — remove emoji, color-driven cards
- `src/screens/player/PlayerScreen.tsx` — full Title Over Art layout rebuild
- `src/screens/home/HomeScreen.tsx` — vibe-aware theming, now playing bar, empty states
- `app/(onboarding)/welcome.tsx` — progressive reveal animation
- `app/(onboarding)/music-auth.tsx` — remove emoji, add Cleo voice line
- `app/(onboarding)/vibe-setup.tsx` — use redesigned VibeSelector
- `app/(onboarding)/first-station.tsx` — responsive cards, accent selection
- `app/(settings)/_layout.tsx` — vibe-aware header
- `app/(settings)/profile.tsx` — vibe-aware, redesigned status
- `app/(settings)/host-settings.tsx` — vibe-aware colors, accent switches
- `app/(settings)/history.tsx` — vibe-aware, Cleo empty state

---

## Task 1: Design Token Expansion

**Files:**
- Modify: `src/tokens/design-tokens.ts`

- [ ] **Step 1: Add Radius, Opacity, and Tracking tokens**

After the existing `Animation` export, add:

```ts
export const Radius = { none: 0, sm: 2 };

export const Opacity = {
  primary: 0.7,
  secondary: 0.5,
  muted: 0.35,
  ghost: 0.2,
};

export const Tracking = {
  tight: 0.5,
  normal: 1,
  wide: 3,
  ultra: 8,
};
```

- [ ] **Step 2: Add withAlpha helper**

```ts
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

- [ ] **Step 3: Add isDarkVibe helper**

```ts
export function isDarkVibe(bg: string): boolean {
  const r = parseInt(bg.slice(1, 3), 16) / 255;
  const g = parseInt(bg.slice(3, 5), 16) / 255;
  const b = parseInt(bg.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.2;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/kari/Documents/DJApp/cleo && npx tsc --noEmit src/tokens/design-tokens.ts`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/tokens/design-tokens.ts
git commit -m "feat: add Radius, Opacity, Tracking tokens and helper functions"
```

---

## Task 2: Install New Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install expo-linear-gradient and expo-haptics**

Run: `cd /Users/kari/Documents/DJApp/cleo && npx expo install expo-linear-gradient expo-haptics`

- [ ] **Step 2: Verify installation**

Run: `cd /Users/kari/Documents/DJApp/cleo && node -e "require('expo-linear-gradient'); require('expo-haptics'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install expo-linear-gradient and expo-haptics"
```

---

## Task 3: GrainOverlay Component

**Files:**
- Create: `src/components/GrainOverlay.tsx`
- Create: `assets/textures/grain.png`

- [ ] **Step 1: Generate grain texture PNG**

Create the directory and generate a 200x200 noise PNG using pure Node.js with the `pngjs` package:

```bash
cd /Users/kari/Documents/DJApp/cleo && mkdir -p assets/textures && npx -y pngjs-cli 2>/dev/null; node -e "
const { PNG } = require('pngjs');
const fs = require('fs');
const png = new PNG({ width: 200, height: 200 });
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 200; x++) {
    const idx = (200 * y + x) << 2;
    const v = Math.random() > 0.5 ? 255 : 0;
    png.data[idx] = v;
    png.data[idx + 1] = v;
    png.data[idx + 2] = v;
    png.data[idx + 3] = Math.floor(Math.random() * 60) + 20;
  }
}
png.pack().pipe(fs.createWriteStream('assets/textures/grain.png')).on('finish', () => console.log('grain.png created'));
"
```

If `pngjs` is not available, install it temporarily: `npm install --no-save pngjs`, run the script, then remove it. Alternatively, write a 1x1 transparent PNG as a minimal placeholder and replace later:

```bash
cd /Users/kari/Documents/DJApp/cleo && mkdir -p assets/textures && printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\xc8\x00\x00\x00\xc8\x08\x06\x00\x00\x00\xadp\xa8\x91\x00\x00\x00\x01sRGB\x00\xae\xce\x1c\xe9\x00\x00\x00\x15IDAT\x78\x9c\xed\xc1\x01\x0d\x00\x00\x00\xc2\xa0\xf7Om\x0e7\xa0\x00\x00\x00\x00\x00\x00\x00\x00\xbe\x0d!\x00\x00\x01\x9a`\xe1\xd5\x00\x00\x00\x00IEND\xaeB\x60\x82' > assets/textures/grain.png
```

- [ ] **Step 2: Create GrainOverlay component**

Write `src/components/GrainOverlay.tsx`:

```tsx
import { Image, StyleSheet } from 'react-native';

export function GrainOverlay() {
  return (
    <Image
      source={require('../../assets/textures/grain.png')}
      style={styles.grain}
      resizeMode="repeat"
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  grain: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.05,
    zIndex: 1,
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/components/GrainOverlay.tsx assets/textures/
git commit -m "feat: add GrainOverlay component with noise texture"
```

---

## Task 4: WordByWordSubtitle — accentColor Prop + Fade-Out Fix

**Files:**
- Modify: `src/components/WordByWordSubtitle.tsx`

- [ ] **Step 1: Add accentColor prop and fix container**

Replace the full component. Key changes:
- Add `accentColor` prop, default to `Colors.accent`
- Wrap container in `Animated.View` with `containerOpacity` ref
- Fix fade-out: animate `containerOpacity` to 0 on exit
- Use `Spacing.lg` instead of hardcoded `24`

```tsx
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Animation, Spacing } from '../tokens/design-tokens';

interface WordByWordSubtitleProps {
  text: string;
  visible: boolean;
  accentColor?: string;
  onFinish?: () => void;
}

export function WordByWordSubtitle({ text, visible, accentColor, onFinish }: WordByWordSubtitleProps) {
  const color = accentColor ?? Colors.accent;
  const words = text.split(/\s+/);
  const opacities = useRef(words.map(() => new Animated.Value(0))).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      // Fade out container, then reset
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start(() => {
        opacities.forEach((o) => o.setValue(0));
        containerOpacity.setValue(1);
        onFinish?.();
      });
      return;
    }

    // Reset for new text
    containerOpacity.setValue(1);
    opacities.forEach((o) => o.setValue(0));

    // Stagger fade-in for each word
    const animations = opacities.map((opacity, index) =>
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        delay: index * Animation.wordFade.stagger,
        useNativeDriver: true,
      })
    );

    Animated.parallel(animations).start();
  }, [visible, text]);

  if (!text) return null;

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <View style={styles.wordWrap}>
        {words.map((word, index) => (
          <Animated.Text
            key={`${word}-${index}`}
            style={[styles.word, { opacity: opacities[index] ?? 1, color }]}
          >
            {word}{' '}
          </Animated.Text>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
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
    lineHeight: 28,
  },
});
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd /Users/kari/Documents/DJApp/cleo && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/WordByWordSubtitle.tsx
git commit -m "fix: WordByWordSubtitle accentColor prop and fade-out bug"
```

---

## Task 5: OnAirIndicator — Larger Dots, Glow, Paused State

**Files:**
- Modify: `src/components/OnAirIndicator.tsx`

- [ ] **Step 1: Update dot size, add glow and paused state**

Key changes:
- Dot size: 8px (up from 6px)
- Add `shadowColor`, `shadowRadius: 4`, `shadowOpacity: 0.4` on dots when active
- Accept `paused` prop — when true, opacity 0.15, no pulse
- On resume from paused: single bright pulse then settle

```tsx
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Spacing } from '../tokens/design-tokens';

interface OnAirIndicatorProps {
  active: boolean;
  paused?: boolean;
  accentColor?: string;
}

export function OnAirIndicator({ active, paused, accentColor }: OnAirIndicatorProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.15)).current;

  const color = accentColor ?? Colors.accent;
  const isLive = active && !paused;

  useEffect(() => {
    if (isLive) {
      // Bright pulse on activation, then loop
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
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
      });
    } else {
      pulseAnim.setValue(1);
      Animated.timing(glowAnim, {
        toValue: 0.15,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
    return () => {
      pulseAnim.stopAnimation();
      glowAnim.stopAnimation();
    };
  }, [isLive]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            opacity: glowAnim,
            transform: [{ scale: pulseAnim }],
            shadowColor: color,
            shadowRadius: isLive ? 4 : 0,
            shadowOpacity: isLive ? 0.4 : 0,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      />
      <Animated.Text style={[styles.label, { color, opacity: glowAnim }]}>
        ON AIR
      </Animated.Text>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            opacity: glowAnim,
            transform: [{ scale: pulseAnim }],
            shadowColor: color,
            shadowRadius: isLive ? 4 : 0,
            shadowOpacity: isLive ? 0.4 : 0,
            shadowOffset: { width: 0, height: 0 },
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
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontFamily: Typography.mono.family, fontSize: 10, letterSpacing: 3 },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/OnAirIndicator.tsx
git commit -m "feat: OnAirIndicator larger dots, glow effect, paused state"
```

---

## Task 6: StationCard — Sharp Corners, Text-on-Art, Accent Line

**Files:**
- Modify: `src/components/StationCard.tsx`

- [ ] **Step 1: Rebuild StationCard**

Key changes:
- `borderRadius: 0`
- Remove dark overlay `labelContainer` — name goes directly on art with text shadow
- Add 2px accent line at bottom (accept `accentColor` prop, default to `Colors.accent`)
- Accept `width` prop for responsive sizing

```tsx
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../tokens/design-tokens';

interface StationCardProps {
  name: string;
  artworkUrl?: string;
  accentColor?: string;
  width?: number;
  onPress: () => void;
}

const DEFAULT_WIDTH = 160;

export function StationCard({ name, artworkUrl, accentColor, width, onPress }: StationCardProps) {
  const cardWidth = width ?? DEFAULT_WIDTH;
  const cardHeight = cardWidth * 1.5;
  const accent = accentColor ?? Colors.accent;

  return (
    <Pressable
      style={({ pressed }) => [
        { width: cardWidth, height: cardHeight },
        styles.card,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
    >
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.placeholder]} />
      )}
      <Text style={styles.label} numberOfLines={2}>
        {name}
      </Text>
      <View style={[styles.accentLine, { backgroundColor: accent }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginRight: Spacing.md,
    overflow: 'hidden',
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  artwork: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  placeholder: {
    backgroundColor: Colors.base.black,
  },
  label: {
    position: 'absolute',
    bottom: Spacing.sm + 2,
    left: Spacing.sm,
    right: Spacing.sm,
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.base.white,
    textTransform: 'uppercase',
    letterSpacing: 1,
    lineHeight: 14,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  accentLine: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StationCard.tsx
git commit -m "feat: StationCard sharp corners, text-on-art, accent line"
```

---

## Task 7: VibeSelector — Remove Emoji, Color-Driven

**Files:**
- Modify: `src/components/VibeSelector.tsx`

- [ ] **Step 1: Rebuild VibeSelector**

Key changes:
- Remove all emoji
- Cards filled with vibe bg color, label in vibe text color
- Selected: 2px accent border + full opacity
- Unselected: 50% opacity, no border

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Typography, Spacing, Opacity } from '../tokens/design-tokens';
import type { Vibe } from '../cleo/fallbacks';

interface VibeSelectorProps {
  selected: Vibe;
  onSelect: (vibe: Vibe) => void;
}

const VIBES: { id: Vibe; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'chill', label: 'Chill' },
  { id: 'workout', label: 'Workout' },
  { id: 'lateNight', label: 'Late Night' },
  { id: 'party', label: 'Party' },
];

export function VibeSelector({ selected, onSelect }: VibeSelectorProps) {
  const handleSelect = (id: Vibe) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(id);
  };

  return (
    <View style={styles.container}>
      {VIBES.map((vibe) => {
        const isSelected = selected === vibe.id;
        const theme = Colors.vibe[vibe.id];
        return (
          <Pressable
            key={vibe.id}
            style={[
              styles.card,
              {
                backgroundColor: theme.bg,
                borderColor: isSelected ? theme.accent : 'transparent',
                opacity: isSelected ? 1 : Opacity.secondary,
              },
            ]}
            onPress={() => handleSelect(vibe.id)}
          >
            <Text style={[styles.label, { color: theme.text }]}>{vibe.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  card: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/VibeSelector.tsx
git commit -m "feat: VibeSelector remove emoji, color-driven selection"
```

---

## Task 8: PlayerScreen — Title Over Art Layout Rebuild

**Files:**
- Modify: `src/screens/player/PlayerScreen.tsx`

This is the largest task. The full PlayerScreen gets restructured.

- [ ] **Step 1: Add imports for new dependencies**

At the top of PlayerScreen.tsx, add:

```ts
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { GrainOverlay } from '../../components/GrainOverlay';
import { Spacing, Opacity, Tracking, withAlpha, isDarkVibe } from '../../tokens/design-tokens';
```

- [ ] **Step 2: Add animation refs**

Inside the component, after existing refs, add:

```ts
const artOpacity = useRef(new Animated.Value(1)).current;
const accentLineOpacity = useRef(new Animated.Value(0.5)).current;
const bgColorAnim = useRef(new Animated.Value(0)).current;
```

- [ ] **Step 2b: Add background entrance animation on mount**

After the session start `useEffect`, add:

```ts
// Background color entrance animation (800ms)
useEffect(() => {
  Animated.timing(bgColorAnim, {
    toValue: 1,
    duration: 800,
    useNativeDriver: false,
  }).start();
}, []);
```

Then in the JSX, replace the `SafeAreaView` container with:

```tsx
<Animated.View style={[styles.container, {
  flex: 1,
  backgroundColor: bgColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.base.cream, vibeTheme.bg],
  }),
}]}>
  <SafeAreaView style={{ flex: 1 }}>
    {/* ... rest of content */}
  </SafeAreaView>
</Animated.View>
```

- [ ] **Step 3: Add art dim effect when Cleo speaks**

```ts
useEffect(() => {
  Animated.timing(artOpacity, {
    toValue: cleoSpeaking ? 0.85 : 1,
    duration: cleoSpeaking ? 300 : 400,
    useNativeDriver: true,
  }).start();
}, [cleoSpeaking]);
```

- [ ] **Step 4: Add accent line flash on track change**

Inside the existing `onTrackChanged` callback, after `setNowPlaying`, add:

```ts
// Accent line flash
Animated.sequence([
  Animated.timing(accentLineOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
  Animated.timing(accentLineOpacity, { toValue: 0.5, duration: 500, useNativeDriver: true }),
]).start();
```

- [ ] **Step 5: Add haptics to controls**

In `handlePlayPause`, add at the start: `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);`

In `handleSkip`, add: `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);`

- [ ] **Step 6: Rebuild the JSX return**

Replace the entire return block with the new Title Over Art layout:

```tsx
return (
  <SafeAreaView style={[styles.container, { backgroundColor: vibeTheme.bg }]}>
    <GrainOverlay />

    <PullQuoteOverlay
      text={cleoText}
      visible={isPullQuote && cleoSpeaking}
      onFinish={() => setIsPullQuote(false)}
    />

    {/* Header */}
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={[styles.backChevron, { color: vibeTheme.text }]}>{'\u2039'}</Text>
      </Pressable>
      <Text style={[styles.stationName, { color: vibeTheme.text }]}>
        {stationName.toUpperCase()}
      </Text>
    </View>

    {/* Accent Line */}
    <Animated.View style={[styles.accentLine, { backgroundColor: vibeTheme.accent, opacity: accentLineOpacity }]} />

    {/* Album Art with Title Over */}
    <View style={styles.artworkContainer}>
      <Animated.View style={{ width: '100%', height: '100%', opacity: artOpacity }}>
        {nowPlaying?.artworkUrl ? (
          <Image source={{ uri: nowPlaying.artworkUrl }} style={styles.artwork} resizeMode="cover" />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]} />
        )}
      </Animated.View>

      {/* Dark vibe glow */}
      {isDarkVibe(vibeTheme.bg) && (
        <View style={[styles.vibeGlow, { backgroundColor: vibeTheme.accent }]} />
      )}

      {/* Gradient + Title */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)']}
        style={styles.artGradient}
      >
        <Text style={styles.songTitle} numberOfLines={2}>
          {(nowPlaying?.title ?? 'Loading...').toUpperCase()}
        </Text>
      </LinearGradient>
    </View>

    {/* Artist + Album */}
    <View style={styles.trackInfo}>
      <Text style={[styles.artistName, { color: vibeTheme.text }]} numberOfLines={1}>
        {[nowPlaying?.artistName, nowPlaying?.albumTitle].filter(Boolean).join(' \u00B7 ')}
      </Text>
    </View>

    {/* Progress Bar */}
    <View style={styles.progressSection}>
      <View style={[styles.progressTrack, { backgroundColor: withAlpha(vibeTheme.text, 0.1) }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: vibeTheme.accent,
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
      <View style={styles.progressTimes}>
        <Text style={[styles.timeText, { color: vibeTheme.text }]}>{formatTime(elapsed)}</Text>
        <Text style={[styles.timeText, { color: vibeTheme.text }]}>-{formatTime(remaining)}</Text>
      </View>
    </View>

    {/* Controls */}
    <View style={styles.controls}>
      <Pressable onPress={handlePrevious} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} hitSlop={8}>
        <Text style={[styles.secondaryIcon, { color: vibeTheme.text }]}>{'\u00AB'}</Text>
      </Pressable>

      <Pressable
        onPress={handlePlayPause}
        style={({ pressed }) => [styles.playPauseButton, { borderColor: vibeTheme.accent }, pressed && styles.pressed]}
      >
        {isPlaying ? (
          <View style={styles.pauseIcon}>
            <View style={[styles.pauseBar, { backgroundColor: vibeTheme.text }]} />
            <View style={[styles.pauseBar, { backgroundColor: vibeTheme.text }]} />
          </View>
        ) : (
          <Text style={[styles.playIcon, { color: vibeTheme.text }]}>{'\u25B6'}</Text>
        )}
      </Pressable>

      <Pressable onPress={handleSkip} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} hitSlop={8}>
        <Text style={[styles.secondaryIcon, { color: vibeTheme.text }]}>{'\u00BB'}</Text>
      </Pressable>
    </View>

    {/* Cleo Section */}
    <View style={styles.cleoSection}>
      <OnAirIndicator active={cleoSpeaking} paused={!isPlaying} accentColor={vibeTheme.accent} />

      {!isPullQuote && cleoSpeaking ? (
        <WordByWordSubtitle text={cleoText} visible={cleoSpeaking} accentColor={vibeTheme.accent} />
      ) : !cleoSpeaking ? (
        <Text style={[styles.cleoResting, { color: vibeTheme.text }]}>
          CLEO {'\u00B7'} {stationName.toUpperCase()}
        </Text>
      ) : null}
    </View>
  </SafeAreaView>
);
```

- [ ] **Step 7: Replace the entire styles object**

```ts
const styles = StyleSheet.create({
  container: { flex: 1 },
  pressed: { opacity: 0.6 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    position: 'relative',
  },
  backButton: { width: 44, height: 44, justifyContent: 'center' },
  backChevron: {
    fontSize: 24,
    fontFamily: Typography.display.family,
  },
  stationName: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: Tracking.wide,
    opacity: Opacity.ghost,
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    zIndex: -1,
  },
  accentLine: {
    height: 1,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
  },

  // Artwork
  artworkContainer: {
    marginTop: Spacing.sm,
    aspectRatio: 1,
    position: 'relative',
  },
  artwork: { width: '100%', height: '100%' },
  artworkPlaceholder: { backgroundColor: Colors.base.black },
  vibeGlow: {
    position: 'absolute',
    bottom: -20,
    left: '20%',
    right: '20%',
    height: 80,
    borderRadius: 40,
    opacity: 0.08,
  },
  artGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  songTitle: {
    fontFamily: Typography.display.family,
    fontSize: 36,
    color: Colors.base.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    lineHeight: 40,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },

  // Track Info
  trackInfo: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  artistName: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: Tracking.normal,
    opacity: Opacity.secondary,
  },

  // Progress
  progressSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  progressTimes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  timeText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    opacity: Opacity.muted,
    letterSpacing: Tracking.normal,
  },

  // Controls
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.md,
    gap: Spacing.xl,
  },
  playPauseButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { fontSize: 20 },
  pauseIcon: {
    flexDirection: 'row',
    gap: 4,
  },
  pauseBar: {
    width: 3,
    height: 16,
    borderRadius: 1,
  },
  secondaryButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryIcon: {
    fontFamily: Typography.mono.family,
    fontSize: 18,
    opacity: Opacity.muted,
  },

  // Cleo Section
  cleoSection: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.xl,
    minHeight: 100,
  },
  cleoResting: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: Tracking.wide,
    textAlign: 'center',
    opacity: Opacity.ghost,
    paddingBottom: Spacing.sm,
  },
});
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `cd /Users/kari/Documents/DJApp/cleo && npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/screens/player/PlayerScreen.tsx
git commit -m "feat: PlayerScreen Title Over Art layout, vibe atmosphere, haptics"
```

---

## Task 9: HomeScreen — Vibe-Aware Theming + UI Refresh

**Files:**
- Modify: `src/screens/home/HomeScreen.tsx`

- [ ] **Step 1: Add imports and vibe theme hook**

Add at top:

```ts
import * as Haptics from 'expo-haptics';
import { Opacity, Tracking, withAlpha } from '../../tokens/design-tokens';
import { getUser } from '../../services/Storage';
```

Inside the component, after existing state, add:

```ts
const user = getUser();
const userVibe = (user?.defaultVibe as keyof typeof Colors.vibe) ?? 'morning';
const vibeTheme = Colors.vibe[userVibe] ?? Colors.vibe.morning;
```

- [ ] **Step 2: Replace all hardcoded morning references**

Remove all `Colors.vibe.morning.*` from the StyleSheet. Move those colors to inline styles using `vibeTheme`. Specifically:

1. `styles.container`: remove `backgroundColor: Colors.vibe.morning.bg` → use inline `{ backgroundColor: vibeTheme.bg }`
2. `styles.title`: remove `color: Colors.vibe.morning.text` → use inline `{ color: vibeTheme.text }`
3. `styles.heroTitle`: remove `color: Colors.vibe.morning.text` → use inline `{ color: vibeTheme.text }`
4. `styles.heroTagline`: keep `color: Colors.accent` (global accent for unauthorized state)
5. `styles.heroDescription`: remove `color: Colors.vibe.morning.text` → use inline `{ color: vibeTheme.text }`
6. `styles.nowPlayingTitle`: remove `color: Colors.vibe.morning.text` → use inline `{ color: vibeTheme.text }`
7. `styles.nowPlayingArtist`: remove `color: Colors.vibe.morning.text` → use inline `{ color: vibeTheme.text }`
8. `styles.sectionTitle`: remove `color: Colors.vibe.morning.text` → use inline `{ color: vibeTheme.text }`
9. `styles.emptyText` / `styles.emptyHint`: remove `color: Colors.vibe.morning.text` → use inline
10. `styles.nowPlayingLabel`: change to use `vibeTheme.accent`
11. `styles.settingsText`: remove `color` from style — apply inline as `{ color: vibeTheme.text }`

The unauthorized and loading states also need `vibeTheme` applied to their container backgrounds:
```tsx
// Unauthorized
<SafeAreaView style={[styles.container, { backgroundColor: vibeTheme.bg }]}>

// Loading
<SafeAreaView style={[styles.container, { backgroundColor: vibeTheme.bg }]}>

// Ready/Playing
<SafeAreaView style={[styles.container, { backgroundColor: vibeTheme.bg }]}>
```

- [ ] **Step 3: Update header settings button**

Replace the gear Unicode with DM Mono text:

```tsx
<Pressable
  style={({ pressed }) => [styles.settingsButton, pressed && styles.buttonPressed]}
  onPress={onNavigateToSettings}
  hitSlop={12}
>
  <Text style={[styles.settingsText, { color: vibeTheme.text }]}>SETTINGS</Text>
</Pressable>
```

Update style (remove hardcoded color — applied inline above):
```ts
settingsText: {
  fontFamily: Typography.mono.family,
  fontSize: 9,
  letterSpacing: Tracking.normal,
  opacity: Opacity.muted,
},
```

- [ ] **Step 4: Update Now Playing bar**

Remove `borderRadius: 4` from `nowPlaying` style. Add progress line at bottom and replace arrow with compact ON AIR dot. Add `nowPlayingProgress` style:

```tsx
{nowPlaying && (
  <Pressable
    style={({ pressed }) => [styles.nowPlaying, { backgroundColor: withAlpha(vibeTheme.text, 0.05) }, pressed && styles.nowPlayingPressed]}
    onPress={onNavigateToActivePlayer}
  >
    <View style={[styles.nowPlayingAccent, { backgroundColor: vibeTheme.accent }]} />
    {nowPlaying.artworkUrl ? (
      <Image source={{ uri: nowPlaying.artworkUrl }} style={styles.nowPlayingArt} />
    ) : (
      <View style={[styles.nowPlayingArt, styles.nowPlayingArtPlaceholder]} />
    )}
    <View style={styles.nowPlayingInfo}>
      <Text style={[styles.nowPlayingLabel, { color: vibeTheme.accent }]}>NOW PLAYING</Text>
      <Text style={[styles.nowPlayingTitle, { color: vibeTheme.text }]} numberOfLines={1}>{nowPlaying.title}</Text>
      <Text style={[styles.nowPlayingArtist, { color: vibeTheme.text }]} numberOfLines={1}>{nowPlaying.artistName}</Text>
    </View>
    <View style={[styles.nowPlayingDot, { backgroundColor: vibeTheme.accent }]} />
    {/* Progress line at bottom of bar */}
    <View style={[styles.nowPlayingProgress, { backgroundColor: withAlpha(vibeTheme.text, 0.08) }]}>
      <View style={{ width: '35%', height: '100%', backgroundColor: vibeTheme.accent }} />
    </View>
  </Pressable>
)}
```

Add styles:
```ts
nowPlayingDot: {
  width: 6,
  height: 6,
  borderRadius: 3,
  marginRight: Spacing.md,
},
nowPlayingProgress: {
  position: 'absolute',
  bottom: 0,
  left: 3,
  right: 0,
  height: 2,
},
```

Note: the progress line width (`35%` above) is a visual placeholder. To show actual track progress, wire it to `musicKitPlayer.getPlaybackTime()` via a periodic timer or the `onPlaybackStateChanged` event — but that's a functional change. For now, show the static bar as a visual indicator that tapping opens the player.

Remove the `nowPlayingArrow` style and the `›` Text element entirely.

- [ ] **Step 5: Update empty state**

Replace emoji empty state with Cleo's voice:

```tsx
<View style={styles.emptyState}>
  <Text style={[styles.emptyCleoVoice, { color: vibeTheme.accent }]}>
    Pick a playlist. I'll do the rest.
  </Text>
  <Text style={[styles.emptyHint, { color: vibeTheme.text }]}>
    Tap a playlist below to create your first station
  </Text>
</View>
```

Add style:
```ts
emptyCleoVoice: {
  fontFamily: Typography.cleoVoice.family,
  fontStyle: 'italic',
  fontSize: 18,
  textAlign: 'center',
  marginBottom: Spacing.sm,
},
```

- [ ] **Step 6: Update section titles opacity**

```ts
sectionTitle: {
  ...existing,
  opacity: Opacity.muted,
},
```

- [ ] **Step 7: Add haptics to station press**

In `handleStationPress`, add: `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);`

- [ ] **Step 8: Commit**

```bash
git add src/screens/home/HomeScreen.tsx
git commit -m "feat: HomeScreen vibe-aware theming, Cleo empty states, settings text"
```

---

## Task 10: Onboarding — Welcome Screen Progressive Reveal

**Files:**
- Modify: `app/(onboarding)/welcome.tsx`

- [ ] **Step 1: Add animated progressive reveal**

Import `Animated`, `useRef`, `useEffect` and `WordByWordSubtitle`. Replace static text with:
- Tagline uses `WordByWordSubtitle` for word-by-word reveal
- Description fades in after tagline
- Button fades in last

```tsx
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Tracking } from '../../src/tokens/design-tokens';
import { WordByWordSubtitle } from '../../src/components/WordByWordSubtitle';

export default function WelcomeScreen() {
  const [taglineDone, setTaglineDone] = useState(false);
  const descOpacity = useRef(new Animated.Value(0)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Tagline takes ~1.5s (word count * 40ms stagger + 200ms per word)
    // Start showing tagline immediately via WordByWordSubtitle visible=true
    const timer = setTimeout(() => setTaglineDone(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (taglineDone) {
      Animated.sequence([
        Animated.timing(descOpacity, { toValue: 1, duration: 600, delay: 400, useNativeDriver: true }),
        Animated.timing(buttonOpacity, { toValue: 1, duration: 600, delay: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [taglineDone]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>CLEO</Text>
        <WordByWordSubtitle
          text="Every song has a story. I'm just here to tell it."
          visible={true}
          accentColor={Colors.accent}
        />
        <Animated.Text style={[styles.description, { opacity: descOpacity }]}>
          Your personal AI radio host. I'll play your music, share the stories behind the songs, and make every session feel like it was made just for you.
        </Animated.Text>
      </View>
      <Animated.View style={[styles.bottom, { opacity: buttonOpacity }]}>
        <Pressable style={styles.button} onPress={() => router.push('/(onboarding)/music-auth')}>
          <Text style={styles.buttonText}>GET STARTED</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.vibe.morning.bg },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 72,
    color: Colors.vibe.morning.text,
    letterSpacing: Tracking.ultra,
    marginBottom: Spacing.lg,
  },
  description: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.vibe.morning.text,
    textAlign: 'center',
    lineHeight: 24,
    opacity: 0.7,
    marginTop: Spacing.md,
  },
  bottom: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },
  button: { backgroundColor: Colors.base.black, paddingVertical: Spacing.md, alignItems: 'center' },
  buttonText: { fontFamily: Typography.mono.family, fontSize: 12, color: Colors.base.white, letterSpacing: Tracking.wide },
});
```

- [ ] **Step 2: Commit**

```bash
git add app/\(onboarding\)/welcome.tsx
git commit -m "feat: Welcome screen progressive reveal with WordByWordSubtitle"
```

---

## Task 11: Onboarding — Music Auth, Vibe Setup, First Station

**Files:**
- Modify: `app/(onboarding)/music-auth.tsx`
- Modify: `app/(onboarding)/vibe-setup.tsx`
- Modify: `app/(onboarding)/first-station.tsx`

- [ ] **Step 1: Update Music Auth screen**

Remove emoji. Add accent line and Cleo voice line above button. Update button to 12pt font.

Key changes in `music-auth.tsx`:
- Remove `<Text style={styles.emoji}>🎵</Text>`
- Add before the button: `<Text style={styles.cleoVoice}>I need access to your library to start hosting.</Text>`
- Add `cleoVoice` style: `{ fontFamily: Typography.cleoVoice.family, fontStyle: 'italic', fontSize: 16, color: Colors.accent, textAlign: 'center', marginBottom: Spacing.lg }`
- Add accent line above title: `<View style={{ width: 40, height: 2, backgroundColor: Colors.accent, marginBottom: Spacing.lg }} />`
- Update `buttonText` fontSize to 12, letterSpacing to `Tracking.wide`

- [ ] **Step 2: Update Vibe Setup screen**

Replace VibeSelector usage — component already updated in Task 7, just ensure the import works and update button style to 12pt.

- [ ] **Step 3: Update First Station screen**

Remove `borderWidth: 2` selection wrapper. Use accent line + scale for selection. Make card width responsive:

```tsx
import { Dimensions } from 'react-native';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.md) / 2;
```

Pass `width={CARD_WIDTH}` to `StationCard`. For selection state, add `accentColor={selected === item.id ? Colors.accent : 'transparent'}` and wrap in a `View` with `transform: [{ scale: selected === item.id ? 1.02 : 1 }]`.

Update button fontSize to 12.

- [ ] **Step 4: Commit**

```bash
git add app/\(onboarding\)/music-auth.tsx app/\(onboarding\)/vibe-setup.tsx app/\(onboarding\)/first-station.tsx
git commit -m "feat: onboarding screens editorial styling, no emoji, Cleo voice"
```

---

## Task 12: Settings Screens — Vibe-Aware Theming

**Files:**
- Modify: `app/(settings)/_layout.tsx`
- Modify: `app/(settings)/profile.tsx`
- Modify: `app/(settings)/host-settings.tsx`
- Modify: `app/(settings)/history.tsx`

- [ ] **Step 1: Update settings layout header**

In `_layout.tsx`, read user vibe and apply to header:

```tsx
import { getUser } from '../../src/services/Storage';
import { Colors } from '../../src/tokens/design-tokens';

const user = getUser();
const vibe = (user?.defaultVibe as keyof typeof Colors.vibe) ?? 'morning';
const vibeTheme = Colors.vibe[vibe] ?? Colors.vibe.morning;
```

Set `headerStyle: { backgroundColor: vibeTheme.bg }` and `headerTintColor: vibeTheme.text`.

- [ ] **Step 2: Update Profile screen**

Replace all `Colors.vibe.morning.*` with vibeTheme lookup. Replace `✓ Connected` with accent dot + "CONNECTED" in DM Mono. Replace "SAVED ✓" with accent-colored "SAVED". Update button to 12pt.

- [ ] **Step 3: Update Host Settings screen**

Replace hardcoded morning colors with vibeTheme. Add `thumbColor` and `trackColor` props to Switch using vibeTheme.accent. Replace `rgba(0,0,0,0.08)` dividers with `withAlpha(vibeTheme.text, 0.08)`.

- [ ] **Step 4: Update History screen**

Replace hardcoded morning colors with vibeTheme. Update empty state to Cleo's voice:

```tsx
<View style={styles.empty}>
  <Text style={[styles.emptyCleoVoice, { color: vibeTheme.accent }]}>
    We haven't started yet. But I'm ready when you are.
  </Text>
  <Text style={[styles.emptySubtext, { color: vibeTheme.text }]}>
    Start listening to build your history
  </Text>
</View>
```

Add `emptyCleoVoice` style: `{ fontFamily: Typography.cleoVoice.family, fontStyle: 'italic', fontSize: 18, textAlign: 'center', marginBottom: Spacing.sm }`.

Replace `rgba(0,0,0,0.08)` dividers with `withAlpha(vibeTheme.text, 0.08)`.

- [ ] **Step 5: Commit**

```bash
git add app/\(settings\)/
git commit -m "feat: settings screens vibe-aware theming, Cleo empty states"
```

---

## Task 13: Navigation Fixes — Vibe Fallback + Transition

**Files:**
- Modify: `app/(main)/player.tsx`
- Modify: `app/(main)/_layout.tsx`

- [ ] **Step 1: Fix player route vibe fallback to morning**

In `app/(main)/player.tsx`, change the vibe fallback from `'chill'` to `'morning'` to match the spec:

```tsx
vibe={(params.vibe as Vibe) ?? 'morning'}
```

- [ ] **Step 2: Ensure slide_from_bottom transition for player**

In `app/(main)/_layout.tsx`, verify the player screen uses `slide_from_bottom` animation (already present in current code, just verify it survived any changes):

```tsx
<Stack.Screen
  name="player"
  options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add app/\(main\)/player.tsx app/\(main\)/_layout.tsx
git commit -m "fix: player vibe fallback to morning, verify slide_from_bottom transition"
```

---

## Task 14: Final Verification

- [ ] **Step 1: TypeScript compilation check**

Run: `cd /Users/kari/Documents/DJApp/cleo && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Visual smoke test on device**

Build and run on device via the no-spaces path:
1. Sync to build path: `rsync -a --delete /Users/kari/Documents/DJApp/cleo/ /Users/kari/Documents/cleo-app/ --exclude node_modules --exclude .expo`
2. Build and run on device
3. Walk through: onboarding → home → player → settings
4. Verify: sharp corners on all cards, title over art on player, no emoji anywhere, vibe colors applied

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: visual polish from device testing"
```

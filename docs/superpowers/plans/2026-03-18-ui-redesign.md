# Cleo UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Cleo app UI to match Stitch mockups with PRD color scheme (gold/black/cream), new navigation, and new screens.

**Architecture:** Progressive rebuild — foundation tokens and shared components first, then each screen rebuilt independently while preserving all service/engine logic. Dark-only UI with gold `#C8832A` as constant primary accent and dynamic vibe secondary accents.

**Tech Stack:** React Native 0.83, Expo SDK 55, Expo Router (Tabs), Reanimated 3, expo-blur, react-native-svg, Inter/Playfair Display/EB Garamond/DM Mono fonts.

**Spec:** `docs/superpowers/specs/2026-03-18-ui-redesign-design.md`

**Working directory:** All file paths relative to `/Users/kari/Documents/cleo-app/` (the no-spaces build path). After each task, rsync changes back to `/Users/kari/Documents/DJApp/`.

---

## File Map

### New Files
```
src/tokens/design-tokens.ts              ← REWRITE: new surface hierarchy, typography, glassmorphism tokens
src/components/GlassCard.tsx              ← NEW: reusable glass container
src/components/AppHeader.tsx              ← NEW: shared app header
src/components/TabBar.tsx                 ← NEW: custom glass tab bar
src/components/TabIcon.tsx                ← NEW: SVG tab icons (sensors, timeline, library_music, blur_on)
src/components/WaveformBars.tsx           ← NEW: animated waveform indicator
src/components/CleoPulseDot.tsx           ← NEW: pulsing gold dot
src/components/CleoOrb.tsx                ← NEW: gold gradient orb with glow
src/components/SectionLabel.tsx           ← NEW: DM Mono section header
src/components/CleoSpeakingOverlay.tsx    ← NEW: replaces PullQuoteOverlay + WordByWordSubtitle
src/screens/player/BroadcastScreen.tsx    ← NEW: redesigned player
src/screens/home/HomeScreenRedesign.tsx   ← NEW: redesigned home
src/screens/onboarding/CleoOnboarding.tsx ← NEW: onboarding flow
src/screens/arc/SessionArcScreen.tsx      ← NEW: queue/arc view
src/screens/settings/ProfileScreen.tsx    ← NEW: profile & settings
app/(main)/_layout.tsx                    ← REWRITE: Stack → Tabs
app/(main)/(broadcast)/_layout.tsx        ← NEW: broadcast stack
app/(main)/(broadcast)/index.tsx          ← NEW: routes to HomeScreen
app/(main)/(broadcast)/player.tsx         ← NEW: routes to BroadcastScreen
app/(main)/(arc)/index.tsx                ← NEW: routes to SessionArcScreen
app/(main)/(archive)/index.tsx            ← NEW: placeholder
app/(main)/(cleo)/index.tsx               ← NEW: routes to ProfileScreen
app/(onboarding)/cleo-setup.tsx            ← NEW: routes to CleoOnboarding
```

### Modified Files
```
app/_layout.tsx                           ← font loading: swap Work Sans → Inter
babel.config.js                           ← CREATE (if missing) + add reanimated plugin
package.json                              ← new dependencies
```

### Deprecated (keep until all screens migrated, then delete)
```
src/components/PullQuoteOverlay.tsx
src/components/WordByWordSubtitle.tsx
src/components/OnAirIndicator.tsx
src/components/VibeSelector.tsx
src/components/GrainOverlay.tsx
src/screens/home/HomeScreen.tsx
src/screens/player/PlayerScreen.tsx
app/(main)/index.tsx
app/(main)/player.tsx
app/(settings)/  (entire folder)
app/(onboarding)/vibe-setup.tsx
app/(onboarding)/first-station.tsx
```

---

## Task 1: Install Dependencies & Configure

**Files:**
- Modify: `package.json`
- Modify: `babel.config.js`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Install new packages**

```bash
cd /Users/kari/Documents/cleo-app
npx expo install expo-blur react-native-reanimated react-native-svg @expo-google-fonts/inter expo-linear-gradient
npm uninstall @expo-google-fonts/work-sans
```

- [ ] **Step 2: Create/update Babel config for Reanimated**

Check if `babel.config.js` exists. If not, create it. The Reanimated plugin must be the **last** plugin:

```bash
# Check if it exists
ls babel.config.js 2>/dev/null || echo "MISSING - create it"
```

Create or update `babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

Also verify `expo-linear-gradient` is already installed (it is — `~55.0.9`). The `npx expo install` command above is idempotent and will just verify/skip it.

- [ ] **Step 3: Update font loading in root layout**

In `app/_layout.tsx`, replace Work Sans imports with Inter:

```typescript
const [fontsLoaded] = useFonts({
  PlayfairDisplay_400Regular: require('@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf'),
  Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  EBGaramond_400Regular: require('@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf'),
  EBGaramond_400Regular_Italic: require('@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf'),
  DMMono_400Regular: require('@expo-google-fonts/dm-mono/400Regular/DMMono_400Regular.ttf'),
});
```

- [ ] **Step 4: Rebuild native app**

```bash
cd /Users/kari/Documents/cleo-app/ios
pod install
cd ..
npx expo run:ios --device
```

Verify app launches with Inter loaded (existing screens will still use old token references — that's fine).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: install redesign dependencies (reanimated, blur, svg, inter font)"
```

---

## Task 2: Rewrite Design Tokens

**Files:**
- Rewrite: `src/tokens/design-tokens.ts`

- [ ] **Step 1: Rewrite design-tokens.ts**

Replace the entire file with the new token system. Key changes:
- New `Surface` object with 7-level hierarchy
- New `TextColors` object
- `Colors.vibe` — all vibes now dark-only (bg uses `Surface.base`, accent remains)
- `Typography.label` renamed from Work Sans to Inter
- New `Glass`, `Glow`, `Gradient` token objects
- Preserved: `withAlpha`, `isDarkVibe`, `safeOpacity` utilities
- Preserved: `Animation`, `Spacing`, `ZIndex` values

```typescript
// design-tokens.ts — Single source of truth for all UI values

export const Colors = {
  base: { black: '#0D0D0D', white: '#FAF8F4', cream: '#F5F0E8' },
  accent: '#C8832A',
  accentDark: '#A06820',
  error: '#ff6e84',
  vibe: {
    morning:    { accent: '#C8832A' },
    chill:      { accent: '#5B7FA6' },
    lateNight:  { accent: '#7B5EA7' },
    workout:    { accent: '#FF4D3D' },
    party:      { accent: '#FF8C42' },
    general:    { accent: '#C8832A' },
    focus:      { accent: '#4A7A5B' },
    feelGood:   { accent: '#E8923A' },
    throwback:  { accent: '#B87A3A' },
    elevated:   { accent: '#8B7BA8' },
    melancholy: { accent: '#5B6A8A' },
    sunday:     { accent: '#A88B6A' },
  },
};

export const Surface = {
  lowest:    '#000000',
  base:      '#0D0D0D',
  low:       '#131315',
  container: '#19191C',
  high:      '#1F1F22',
  highest:   '#262528',
  bright:    '#2C2C2F',
};

export const TextColors = {
  primary:   '#F6F3F5',
  secondary: '#ACAAAD',
  outline:   '#767577',
  outlineVariant: '#48474A',
};

export const Typography = {
  display:   { family: 'PlayfairDisplay_400Regular' },
  body:      { family: 'Inter_400Regular', familyMedium: 'Inter_500Medium', familySemiBold: 'Inter_600SemiBold' },
  cleoVoice: { family: 'EBGaramond_400Regular_Italic', style: 'italic' as const },
  mono:      { family: 'DMMono_400Regular' },
};

export const Glass = {
  panel:     { bg: 'rgba(38,37,40,0.4)', blur: 24, tint: 'dark' as const },
  panelDark: { bg: 'rgba(19,19,21,0.6)', blur: 24, tint: 'dark' as const },
  border:    'rgba(72,71,74,0.08)',
  borderSubtle: 'rgba(72,71,74,0.05)',
};

export const Glow = {
  accent: { color: Colors.accent, opacity: 0.15, spread: 40 },
  ctaShadow: {
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
};

export const Gradient = {
  cta: { colors: [Colors.accent, Colors.accentDark] as const, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
};

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 };

export const Radius = { none: 0, sm: 4, md: 12, lg: 16, xl: 24, full: 9999 };

export const Animation = {
  duck:      { duration: 300, targetVolume: 0.15 },
  rampUp:    { duration: 800 },
  wordFade:  { stagger: 40 },
  cleoScale: { speaking: 1.03, resting: 1.0 },
  press:     { scale: 0.92, duration: 200 },
};

export const TabBar = {
  height: 84,
  radius: 24,
  bg: 'rgba(13,13,13,0.6)',
  activeColor: Colors.accent,
  inactiveColor: 'rgba(172,170,173,0.35)',
  iconSize: 24,
  labelSize: 8,
  labelTracking: 1.12,  // 0.14em * 8px
};

export const AppHeaderTokens = {
  height: 64,
  bg: 'rgba(13,13,13,0.6)',
  blur: 20,
  logoSize: 18,
  logoTracking: 2.7,  // 0.15em * 18px
  avatarSize: 32,
};

export const Shadow = {
  text:   { offset: { width: 0, height: 1 } as const, radius: 3, opacity: 0.3 },
  subtle: { offset: { width: 0, height: 2 } as const, radius: 4, opacity: 0.08 },
  medium: { offset: { width: 0, height: 4 } as const, radius: 8, opacity: 0.12 },
};

export const ZIndex = {
  base: 1,
  overlay: 10,
  header: 40,
  modal: 50,
  tabBar: 50,
};

export const Opacity = {
  primary: 0.9,
  secondary: 0.7,
  muted: 0.35,
  ghost: 0.15,
  dimmed: 0.3,
};

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getVibeAccent(vibe: string): string {
  return Colors.vibe[vibe as keyof typeof Colors.vibe]?.accent ?? Colors.accent;
}
```

- [ ] **Step 2: Verify app still compiles**

Existing screens will have type errors from removed exports (`isDarkVibe`, `safeOpacity`, `Grain`, `LineHeight`, `Tracking`). That's expected — they'll be replaced in later tasks. Check how many errors there are:

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expect errors in `HomeScreen.tsx`, `PlayerScreen.tsx`, `GrainOverlay.tsx`, `OnAirIndicator.tsx`, `VibeSelector.tsx`, `welcome.tsx`, `music-auth.tsx`, `vibe-setup.tsx`, `first-station.tsx`, etc. That's fine — these are all files that will be replaced, deleted, or updated in later tasks. The new token file itself should not be the source of any errors.

- [ ] **Step 3: Commit**

```bash
git add src/tokens/design-tokens.ts
git commit -m "feat: rewrite design tokens for dark-only UI with surface hierarchy"
```

---

## Task 3: Build Shared Components

**Files:**
- Create: `src/components/GlassCard.tsx`
- Create: `src/components/AppHeader.tsx`
- Create: `src/components/TabIcon.tsx`
- Create: `src/components/WaveformBars.tsx`
- Create: `src/components/CleoPulseDot.tsx`
- Create: `src/components/CleoOrb.tsx`
- Create: `src/components/SectionLabel.tsx`

- [ ] **Step 1: Create GlassCard**

```typescript
// src/components/GlassCard.tsx
import { StyleSheet, View, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { Glass, Radius } from '../tokens/design-tokens';

interface GlassCardProps extends ViewProps {
  variant?: 'default' | 'dark';
  blur?: boolean;
  radius?: number;
}

export function GlassCard({ variant = 'default', blur = false, radius = Radius.lg, style, children, ...props }: GlassCardProps) {
  const glass = variant === 'dark' ? Glass.panelDark : Glass.panel;

  if (blur) {
    return (
      <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: Glass.border }, style]} {...props}>
        <BlurView intensity={glass.blur} tint={glass.tint} style={StyleSheet.absoluteFill} />
        <View style={{ backgroundColor: glass.bg }}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[{
      backgroundColor: glass.bg,
      borderRadius: radius,
      borderWidth: 1,
      borderColor: Glass.border,
    }, style]} {...props}>
      {children}
    </View>
  );
}
```

- [ ] **Step 2: Create AppHeader**

```typescript
// src/components/AppHeader.tsx
import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeaderTokens, Colors, Typography, TextColors, ZIndex } from '../tokens/design-tokens';

interface AppHeaderProps {
  rightContent?: React.ReactNode;
}

export function AppHeader({ rightContent }: AppHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, height: AppHeaderTokens.height + insets.top }]}>
      <BlurView intensity={AppHeaderTokens.blur} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.inner}>
        <Text style={styles.logo}>CLEO</Text>
        {rightContent && <View style={styles.right}>{rightContent}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', top: 0, left: 0, right: 0,
    zIndex: ZIndex.header,
    backgroundColor: AppHeaderTokens.bg,
  },
  inner: {
    flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    fontFamily: Typography.mono.family,
    fontSize: AppHeaderTokens.logoSize,
    fontWeight: '500',
    color: Colors.accent,
    letterSpacing: AppHeaderTokens.logoTracking,
    textTransform: 'uppercase',
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
```

- [ ] **Step 3: Create TabIcon with SVG icons**

```typescript
// src/components/TabIcon.tsx
import Svg, { Path } from 'react-native-svg';

export type TabIconName = 'sensors' | 'timeline' | 'library_music' | 'blur_on';

interface TabIconProps {
  name: TabIconName;
  size?: number;
  color: string;
  filled?: boolean;
}

// SVG paths from Material Symbols
const ICONS: Record<TabIconName, { outlined: string; filled: string }> = {
  sensors: {
    outlined: 'M7.15 22.85 6.1 21.05Q4.05 19.5 2.775 17.25T1.5 12q0-2.75 1.275-5T6.1 2.95l1.05 1.8Q5.35 6 4.425 7.9T3.5 12q0 2.1.925 4.1T6.15 19.05ZM9.85 19.5l-1.1-1.8q1.15-.85 1.7-2.025T11 13.5V12q0-1.15-.55-2.175T8.75 7.8l1.1-1.8q1.65 1.15 2.4 2.9T13 12v1.5q0 1.5-.75 3.25t-2.4 2.75ZM12 14q-.825 0-1.412-.587T10 12t.588-1.412T12 10t1.413.588T14 12t-.587 1.413T12 14Zm2.15 5.5-1.1-1.8q1.15-.85 1.7-2.025T15.3 13.5V12q0-1.15-.55-2.175T13.05 7.8l1.1-1.8q1.65 1.15 2.4 2.9t.75 3.1v1.5q0 1.5-.75 3.25t-2.4 2.75Zm2.7 3.35-1.05-1.8Q17.65 20 18.575 18.1T19.5 14V12q0-2.1-.925-4.1T16.8 4.95l1.05-1.8Q19.95 4.5 21.225 6.75T22.5 12v2q0 2.75-1.275 5T17.85 22.85Z',
    filled: 'M7.15 22.85 6.1 21.05Q4.05 19.5 2.775 17.25T1.5 12q0-2.75 1.275-5T6.1 2.95l1.05 1.8Q5.35 6 4.425 7.9T3.5 12q0 2.1.925 4.1T6.15 19.05ZM9.85 19.5l-1.1-1.8q1.15-.85 1.7-2.025T11 13.5V12q0-1.15-.55-2.175T8.75 7.8l1.1-1.8q1.65 1.15 2.4 2.9T13 12v1.5q0 1.5-.75 3.25t-2.4 2.75ZM12 14q-.825 0-1.412-.587T10 12t.588-1.412T12 10t1.413.588T14 12t-.587 1.413T12 14Zm2.15 5.5-1.1-1.8q1.15-.85 1.7-2.025T15.3 13.5V12q0-1.15-.55-2.175T13.05 7.8l1.1-1.8q1.65 1.15 2.4 2.9t.75 3.1v1.5q0 1.5-.75 3.25t-2.4 2.75Zm2.7 3.35-1.05-1.8Q17.65 20 18.575 18.1T19.5 14V12q0-2.1-.925-4.1T16.8 4.95l1.05-1.8Q19.95 4.5 21.225 6.75T22.5 12v2q0 2.75-1.275 5T17.85 22.85Z',
  },
  timeline: {
    outlined: 'M3 18v-2h4.6l3.7-3.7-2.6-2.6L3 4.3V3h2.3l5 5.3 2.6 2.6L16.6 7H13V5h8v2h-2.6l-4.7 5.3 2.6 2.6L21 19.7V21h-2.3l-5-5.3-2.6-2.6L7.4 17H11v2z',
    filled: 'M3 18v-2h4.6l3.7-3.7-2.6-2.6L3 4.3V3h2.3l5 5.3 2.6 2.6L16.6 7H13V5h8v2h-2.6l-4.7 5.3 2.6 2.6L21 19.7V21h-2.3l-5-5.3-2.6-2.6L7.4 17H11v2z',
  },
  library_music: {
    outlined: 'M8 18q-1.65 0-2.825-1.175T4 14V4h2v10q0 .825.588 1.413T8 16t1.413-.587T10 14V6h4v8q0 1.65-1.175 2.825T10 18zm10 2q-1.65 0-2.825-1.175T14 16V4h2v12q0 .825.588 1.413T18 18t1.413-.587T20 16V4h2v12q0 1.65-1.175 2.825T18 20z',
    filled: 'M8 18q-1.65 0-2.825-1.175T4 14V4h2v10q0 .825.588 1.413T8 16t1.413-.587T10 14V6h4v8q0 1.65-1.175 2.825T10 18zm10 2q-1.65 0-2.825-1.175T14 16V4h2v12q0 .825.588 1.413T18 18t1.413-.587T20 16V4h2v12q0 1.65-1.175 2.825T18 20z',
  },
  blur_on: {
    outlined: 'M6 13q-.425 0-.712-.288T5 12t.288-.712T6 11t.713.288T7 12t-.287.713T6 13Zm2 4q-.425 0-.712-.288T7 16t.288-.712T8 15t.713.288T9 16t-.287.713T8 17Zm0-4q-.825 0-1.412-.587T6 12t.588-1.412T8 10t1.413.588T10 12t-.587 1.413T8 13Zm0-4q-.425 0-.712-.288T7 8t.288-.712T8 7t.713.288T9 8t-.287.713T8 9Zm4 8q-.825 0-1.412-.587T10 16t.588-1.412T12 14t1.413.588T14 16t-.587 1.413T12 17Zm0-4q-1.25 0-2.125-.875T9 12t.875-2.125T12 9t2.125.875T15 12t-.875 2.125T12 13Zm0-4q-.825 0-1.412-.587T10 8t.588-1.412T12 6t1.413.588T14 8t-.587 1.413T12 9Zm4 8q-.425 0-.712-.288T15 16t.288-.712T16 15t.713.288T17 16t-.287.713T16 17Zm0-4q-.825 0-1.412-.587T14 12t.588-1.412T16 10t1.413.588T18 12t-.587 1.413T16 13Zm0-4q-.425 0-.712-.288T15 8t.288-.712T16 7t.713.288T17 8t-.287.713T16 9Zm2 4q-.425 0-.712-.288T17 12t.288-.712T18 11t.713.288T19 12t-.287.713T18 13Z',
    filled: 'M6 13q-.425 0-.712-.288T5 12t.288-.712T6 11t.713.288T7 12t-.287.713T6 13Zm2 4q-.425 0-.712-.288T7 16t.288-.712T8 15t.713.288T9 16t-.287.713T8 17Zm0-4q-.825 0-1.412-.587T6 12t.588-1.412T8 10t1.413.588T10 12t-.587 1.413T8 13Zm0-4q-.425 0-.712-.288T7 8t.288-.712T8 7t.713.288T9 8t-.287.713T8 9Zm4 8q-.825 0-1.412-.587T10 16t.588-1.412T12 14t1.413.588T14 16t-.587 1.413T12 17Zm0-4q-1.25 0-2.125-.875T9 12t.875-2.125T12 9t2.125.875T15 12t-.875 2.125T12 13Zm0-4q-.825 0-1.412-.587T10 8t.588-1.412T12 6t1.413.588T14 8t-.587 1.413T12 9Zm4 8q-.425 0-.712-.288T15 16t.288-.712T16 15t.713.288T17 16t-.287.713T16 17Zm0-4q-.825 0-1.412-.587T14 12t.588-1.412T16 10t1.413.588T18 12t-.587 1.413T16 13Zm0-4q-.425 0-.712-.288T15 8t.288-.712T16 7t.713.288T17 8t-.287.713T16 9Zm2 4q-.425 0-.712-.288T17 12t.288-.712T18 11t.713.288T19 12t-.287.713T18 13Z',
  },
};

export function TabIcon({ name, size = 24, color, filled = false }: TabIconProps) {
  const d = filled ? ICONS[name].filled : ICONS[name].outlined;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d={d} />
    </Svg>
  );
}
```

- [ ] **Step 4: Create WaveformBars, CleoPulseDot, CleoOrb, SectionLabel**

**WaveformBars:** 5 bars, each 3px wide, `borderRadius: 2`. Heights vary (8-16px). `scaleY` animates between 0.4→1.0 using `withRepeat(withTiming(..., { duration: 600 }), -1, true)`. Each bar gets a staggered delay (0, 150, 300, 100, 250ms). Color: `Colors.accent`. Accepts `color` prop to override.

**CleoPulseDot:** 6px circle, `position: 'absolute'`, `top: 0`, `right: 4`. Background `Colors.accent`. Animated: `opacity` 1→0.5 and `scale` 1→1.3, `withRepeat(withTiming(..., { duration: 2000 }), -1, true)`. Shadow: `shadowColor: Colors.accent, shadowRadius: 4, shadowOpacity: 0.6`.

**CleoOrb:** Accepts `size` prop (default 28). Outer View with LinearGradient `[Colors.accent, withAlpha(Colors.accent, 0.4)]`. Inner View `backgroundColor: Surface.base`, `borderRadius: 9999`. Optional glow: absolutely-positioned View behind, `width: size + 80`, `opacity: Glow.accent.opacity`, `borderRadius: 9999`, `backgroundColor: Colors.accent`.

**SectionLabel:** Text component. `fontFamily: Typography.mono.family`, `fontSize: 9`, `letterSpacing: 1.6` (0.18em * 9), `textTransform: 'uppercase'`, `color: Colors.accent`, `fontWeight: '500'`. Accepts `children` and optional `color` override.

- [ ] **Step 5: Verify shared components render**

Create a temporary test screen that renders each component. Verify on device that:
- GlassCard shows translucent panel with border
- AppHeader shows "CLEO" in gold with blur background
- TabIcon renders all 4 icons in gold
- WaveformBars animate
- CleoPulseDot pulses

- [ ] **Step 6: Commit**

```bash
git add src/components/GlassCard.tsx src/components/AppHeader.tsx src/components/TabIcon.tsx src/components/WaveformBars.tsx src/components/CleoPulseDot.tsx src/components/CleoOrb.tsx src/components/SectionLabel.tsx
git commit -m "feat: add shared components (glass card, header, tab icons, waveform, orb)"
```

---

## Task 4: Build Tab Navigation

**Files:**
- Create: `src/components/TabBar.tsx`
- Rewrite: `app/(main)/_layout.tsx`
- Create: `app/(main)/(broadcast)/_layout.tsx`
- Create: `app/(main)/(broadcast)/index.tsx`
- Create: `app/(main)/(broadcast)/player.tsx`
- Create: `app/(main)/(arc)/index.tsx`
- Create: `app/(main)/(archive)/index.tsx`
- Create: `app/(main)/(cleo)/index.tsx`

- [ ] **Step 1: Create custom TabBar component**

```typescript
// src/components/TabBar.tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { TabBar as TabBarTokens, Typography } from '../tokens/design-tokens';
import { TabIcon, type TabIconName } from './TabIcon';
import { CleoPulseDot } from './CleoPulseDot';

const TABS: { key: string; label: string; icon: TabIconName }[] = [
  { key: '(broadcast)', label: 'Broadcast', icon: 'sensors' },
  { key: '(arc)', label: 'Arc', icon: 'timeline' },
  { key: '(archive)', label: 'Archive', icon: 'library_music' },
  { key: '(cleo)', label: 'Cleo', icon: 'blur_on' },
];

export function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || 20 }]}>
      <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.inner}>
        {TABS.map((tab, index) => {
          const isActive = state.index === index;
          const color = isActive ? TabBarTokens.activeColor : TabBarTokens.inactiveColor;
          return (
            <Pressable
              key={tab.key}
              onPress={() => navigation.navigate(tab.key)}
              style={styles.tab}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={{ position: 'relative' }}>
                <TabIcon name={tab.icon} size={TabBarTokens.iconSize} color={color} filled={isActive} />
                {tab.key === '(cleo)' && !isActive && <CleoPulseDot />}
              </View>
              <Text style={[styles.label, { color }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: TabBarTokens.radius,
    borderTopRightRadius: TabBarTokens.radius,
    overflow: 'hidden',
    backgroundColor: TabBarTokens.bg,
  },
  inner: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    height: 64, paddingHorizontal: 16,
  },
  tab: {
    alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 56, minHeight: 44,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: TabBarTokens.labelSize,
    fontWeight: '500',
    letterSpacing: TabBarTokens.labelTracking,
    textTransform: 'uppercase',
  },
});
```

- [ ] **Step 2: Rewrite app/(main)/_layout.tsx to Tabs**

```typescript
// app/(main)/_layout.tsx
import { Tabs } from 'expo-router';
import { CustomTabBar } from '../../src/components/TabBar';

export default function MainLayout() {
  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(broadcast)" />
      <Tabs.Screen name="(arc)" />
      <Tabs.Screen name="(archive)" />
      <Tabs.Screen name="(cleo)" />
    </Tabs>
  );
}
```

- [ ] **Step 3: Create tab folder route files**

Create `app/(main)/(broadcast)/_layout.tsx` as a Stack (home→player). Create `index.tsx` in each tab folder as a minimal placeholder that renders the screen name in white text on dark background. The existing HomeScreen/PlayerScreen imports will be wired in Tasks 5-6.

```typescript
// app/(main)/(broadcast)/_layout.tsx
import { Stack } from 'expo-router';
export default function BroadcastLayout() {
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="player" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
  </Stack>;
}
```

```typescript
// app/(main)/(broadcast)/index.tsx — temporary placeholder
import { View, Text } from 'react-native';
import { Surface, TextColors } from '../../../src/tokens/design-tokens';
export default function BroadcastHome() {
  return <View style={{ flex: 1, backgroundColor: Surface.base, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ color: TextColors.primary }}>Broadcast Home</Text>
  </View>;
}
```

Create similar placeholders for `(arc)/index.tsx`, `(archive)/index.tsx`, `(cleo)/index.tsx`.

- [ ] **Step 4: Delete old route files and update root layout**

Remove `app/(main)/index.tsx` and `app/(main)/player.tsx` (replaced by `(broadcast)/` folder). Remove `app/(settings)/` folder (replaced by `(cleo)/`).

**Critical:** Update `app/_layout.tsx` to remove the `(settings)` route declaration, or Expo Router will crash on launch:

```typescript
// In app/_layout.tsx, remove this line:
<Stack.Screen name="(settings)" />
```

The `(cleo)` tab is now inside `(main)`, so no root-level route is needed for settings.

- [ ] **Step 5: Test on device**

```bash
npx expo run:ios --device
```

Verify: Tab bar appears at bottom with 4 tabs. Gold icons. Tapping each tab switches to its placeholder. Glass blur effect visible. Cleo pulse dot animates.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add glass tab navigation with 4 tabs (broadcast, arc, archive, cleo)"
```

---

## Task 5: Build Broadcast (Now Playing) Screen

**Files:**
- Create: `src/screens/player/BroadcastScreen.tsx`
- Modify: `app/(main)/(broadcast)/player.tsx`

This is the largest task. The screen layout follows spec Section 4.1. Preserve all existing PlayerScreen logic (audio coordination, MusicKit, Cleo TTS, segment controller) but rebuild the UI layer.

- [ ] **Step 1: Create BroadcastScreen.tsx**

Build the full layout: AppHeader → Album Art Hero → Track Info → Host Commentary Card → Progress Bar → Playback Controls → Synchronized Next. Port all `useState`, `useEffect`, and service integration from existing `PlayerScreen.tsx`. Replace all `Animated` API usage with Reanimated 3. Use new design tokens throughout.

Key sections:
- Album art: `aspectRatio: 1`, `borderRadius: Radius.xl` (24), LinearGradient overlay
- Track title: `Typography.display.family`, 28px, light weight
- Artist: `Typography.body.family`, 16px, `TextColors.secondary`
- Commentary card: `GlassCard` with `CleoOrb` + DM Mono label + EB Garamond quote
- Progress: 5px bar with LinearGradient fill (gold → vibe accent)
- Play button: 72px circle, LinearGradient, `Glow.ctaShadow`
- Up next: `GlassCard` with 48px album art, Inter track/artist

- [ ] **Step 2: Wire route file**

```typescript
// app/(main)/(broadcast)/player.tsx
import { useLocalSearchParams } from 'expo-router';
import { BroadcastScreen } from '../../../src/screens/player/BroadcastScreen';
import type { Vibe } from '../../../src/cleo/fallbacks';

export default function PlayerRoute() {
  const params = useLocalSearchParams<{ stationName: string; playlistId: string; stationId: string; vibe: string }>();
  return <BroadcastScreen
    stationName={params.stationName ?? ''}
    playlistId={params.playlistId ?? ''}
    stationId={params.stationId ?? ''}
    vibe={(params.vibe ?? 'general') as Vibe}
  />;
}
```

- [ ] **Step 3: Test on device**

Navigate to player via a hardcoded test. Verify: dark background, gold accents, album art renders, playback controls work, Cleo commentary card appears after speaking, progress bar animates.

- [ ] **Step 4: Commit**

```bash
git add src/screens/player/BroadcastScreen.tsx app/(main)/(broadcast)/player.tsx
git commit -m "feat: build Broadcast (Now Playing) screen with new design system"
```

---

## Task 6: Build Cleo Speaking Overlay

**Files:**
- Create: `src/components/CleoSpeakingOverlay.tsx`
- Modify: `src/screens/player/BroadcastScreen.tsx`

- [ ] **Step 1: Create CleoSpeakingOverlay**

Full overlay component per spec Section 4.2. Accepts: `text`, `visible`, `onDismiss`, `vibeAccent`. Uses Reanimated 3 for all 8 animations. Include reduce-motion check via `AccessibilityInfo`.

Key elements:
- Scanline sweep (Reanimated translateY loop)
- "HOST INTERJECTION" in DM Mono 48px with text shadow
- Gold bar flash (width animation)
- Quote box at -1.5deg rotation (Reanimated rotate)
- WaveformBars component
- Word-by-word opacity animation (estimated timing)
- Exit dissolve sequence

- [ ] **Step 2: Integrate into BroadcastScreen**

In `BroadcastScreen.tsx`, add the overlay as a child. When `cleoSpeaking` is true and segment type is in the full-overlay list (`track_story`, `post_track_reflection`, `cold_open`, `session_close`), show the overlay. Dim the broadcast content to `opacity: 0.3`. For card-only segments, just update the commentary card text.

- [ ] **Step 3: Test on device**

Trigger a Cleo speaking event (play a station, wait for track change). Verify: overlay appears with glitch animation, words highlight, overlay dissolves, commentary card persists.

- [ ] **Step 4: Commit**

```bash
git add src/components/CleoSpeakingOverlay.tsx src/screens/player/BroadcastScreen.tsx
git commit -m "feat: build Cleo Speaking disruptive overlay with 8 animations"
```

---

## Task 7: Rebuild HomeScreen

**Files:**
- Create: `src/screens/home/HomeScreenRedesign.tsx`
- Modify: `app/(main)/(broadcast)/index.tsx`
- Modify: `src/components/StationCard.tsx`

- [ ] **Step 1: Update StationCard for new design**

Change dimensions to 140x200px. Add `borderRadius: Radius.lg` (16). Use Playfair Display for station name. Add LinearGradient overlay. Use new tokens.

- [ ] **Step 2: Create HomeScreenRedesign**

Layout per spec Section 4.5: AppHeader → Greeting → Now Playing Mini → Your Stations → Playlists → Cleo Suggestion. Port all existing HomeScreen logic (auth, playlists, stations, MMKV). Use `GlassCard` for now-playing mini and Cleo suggestion.

- [ ] **Step 3: Wire route file**

Update `app/(main)/(broadcast)/index.tsx` to render `HomeScreenRedesign`.

- [ ] **Step 4: Test on device**

Verify: dark background, time-of-day greeting, station cards scroll, now-playing card appears when music is active, tapping station navigates to player.

- [ ] **Step 5: Commit**

```bash
git add src/screens/home/HomeScreenRedesign.tsx src/components/StationCard.tsx app/(main)/(broadcast)/index.tsx
git commit -m "feat: rebuild HomeScreen with dark UI, glass cards, new typography"
```

---

## Task 8: Build Onboarding Screen

**Files:**
- Create: `src/screens/onboarding/CleoOnboarding.tsx`
- Modify: `app/(onboarding)/_layout.tsx`
- Delete: `app/(onboarding)/vibe-setup.tsx`
- Delete: `app/(onboarding)/first-station.tsx`
- Modify: `app/(onboarding)/welcome.tsx`

The existing onboarding has 4 screens: `welcome.tsx` → `music-auth.tsx` → `vibe-setup.tsx` → `first-station.tsx`. The new `CleoOnboarding` replaces `vibe-setup.tsx` and `first-station.tsx` (mood/goal/genre selection replaces vibe setup + station picking). `welcome.tsx` and `music-auth.tsx` are **preserved** — Apple Music auth must still happen before the user can browse playlists.

The new flow: `welcome.tsx` → `music-auth.tsx` → `CleoOnboarding` (new) → `/(main)`

- [ ] **Step 1: Create CleoOnboarding**

Layout per spec Section 4.3: CleoOrb → Greeting → Mood Picker → Session Goal → Genre Palette → CTA. Store selections in MMKV. All selections optional (CTA always enabled). "Skip setup, surprise me" applies defaults and navigates to `/(main)` via `router.replace('/(main)')`.

- [ ] **Step 2: Update onboarding route structure**

Update `app/(onboarding)/_layout.tsx` Stack to route: `welcome` → `music-auth` → `cleo-setup` (new screen). Delete `vibe-setup.tsx` and `first-station.tsx`. Create `app/(onboarding)/cleo-setup.tsx` that renders `CleoOnboarding`. Update `music-auth.tsx` to navigate to `cleo-setup` after auth completes (instead of `vibe-setup`).

- [ ] **Step 3: Test on device**

Clear MMKV user data to trigger onboarding. Verify: welcome → music auth → Cleo setup (mood chips toggle, session goal radio selects, genre pills multi-select) → CTA navigates to main tabs.

- [ ] **Step 4: Commit**

```bash
git add src/screens/onboarding/CleoOnboarding.tsx app/(onboarding)/
git commit -m "feat: build Cleo onboarding with mood, goal, and genre selection"
```

---

## Task 9: Build Session Arc Screen

**Files:**
- Create: `src/screens/arc/SessionArcScreen.tsx`
- Modify: `app/(main)/(arc)/index.tsx`

- [ ] **Step 1: Create SessionArcScreen**

Layout per spec Section 4.4. The SVG arc visualization uses `react-native-svg` Path with a cubic bezier curve. Gradient via Defs/LinearGradient. Cleo nodes as absolutely-positioned Views. Current track card and upcoming manifest pull from `queueManager` and `segmentController`.

Handle empty state (no active session): show "Start a broadcast to see your session arc" message.

- [ ] **Step 2: Wire route**

Update `app/(main)/(arc)/index.tsx` to render `SessionArcScreen`.

- [ ] **Step 3: Test on device**

Start a broadcast, switch to Arc tab. Verify: arc path renders, current track shows, upcoming tracks listed, Cleo nodes visible.

- [ ] **Step 4: Commit**

```bash
git add src/screens/arc/SessionArcScreen.tsx app/(main)/(arc)/index.tsx
git commit -m "feat: build Session Arc screen with SVG visualization and queue"
```

---

## Task 10: Build Profile & Settings Screen

**Files:**
- Create: `src/screens/settings/ProfileScreen.tsx`
- Modify: `app/(main)/(cleo)/index.tsx`

- [ ] **Step 1: Create ProfileScreen**

Layout per spec Section 4.6. AI Personality cards store selection in MMKV key `cleoPersonality`. Apple Music toggle reads from `musicKitPlayer.isAuthorized()`. Host Volume Mix slider updates `Animation.duck.targetVolume` in real-time (or a new MMKV key). Sign Out calls `AuthService.signOut()`.

- [ ] **Step 2: Wire route**

Update `app/(main)/(cleo)/index.tsx` to render `ProfileScreen`.

- [ ] **Step 3: Test on device**

Verify: profile shows user info, personality cards toggle, Apple Music shows connected, volume slider adjusts, sign out works.

- [ ] **Step 4: Commit**

```bash
git add src/screens/settings/ProfileScreen.tsx app/(main)/(cleo)/index.tsx
git commit -m "feat: build Profile & Settings with AI personality and voice controls"
```

---

## Task 11: Cleanup Deprecated Files

**Files:**
- Delete: `src/components/PullQuoteOverlay.tsx`
- Delete: `src/components/WordByWordSubtitle.tsx`
- Delete: `src/components/OnAirIndicator.tsx`
- Delete: `src/components/VibeSelector.tsx`
- Delete: `src/components/GrainOverlay.tsx`
- Delete: `src/screens/home/HomeScreen.tsx`
- Delete: `src/screens/player/PlayerScreen.tsx`
- Modify: `src/components/ErrorState.tsx` — update to use new tokens (Surface.base, TextColors, Typography.body)

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -r "PullQuoteOverlay\|WordByWordSubtitle\|OnAirIndicator\|VibeSelector\|GrainOverlay\|HomeScreen\b\|PlayerScreen\b" src/ app/ --include="*.tsx" --include="*.ts" -l
```

Should return only the files being deleted.

- [ ] **Step 1b: Update ErrorState to new tokens**

Replace old token imports (`Colors.vibe`, `Typography.label`, etc.) with new equivalents (`Surface`, `TextColors`, `Typography.body`). Keep the component logic unchanged.

- [ ] **Step 2: Delete deprecated files**

- [ ] **Step 3: Verify app compiles and runs**

```bash
npx expo run:ios --device
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated pre-redesign components and screens"
```

---

## Task 12: Final Integration Test

- [ ] **Step 1: Full user flow test on device**

1. Fresh install → Auth → Onboarding → mood/goal/genre → Start Broadcast
2. HomeScreen shows greeting, stations, playlists
3. Tap station → Player opens with album art, gold controls
4. Wait for track change → Cleo speaking overlay appears with animations
5. Overlay dismisses → commentary card persists
6. Switch to Arc tab → see session visualization
7. Switch to Cleo tab → profile loads, personality toggles work
8. Tab bar visible on all screens, gold active state, pulse dot on Cleo

- [ ] **Step 2: Rsync back to DJApp**

```bash
rsync -av --exclude=node_modules --exclude=.expo --exclude=ios/Pods /Users/kari/Documents/cleo-app/ /Users/kari/Documents/DJApp/
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete UI redesign — all 7 screens matching Stitch with PRD colors"
```

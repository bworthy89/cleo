# Cleo UI Design Overhaul

**Date:** 2026-03-17
**Direction:** Evolved editorial — PRD's magazine-cover spirit with practical readability refinements
**Player layout:** Title Over Art (Approach A)

---

## 1. Design Token Expansion

Add to `src/tokens/design-tokens.ts`:

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

// Helper: convert hex + alpha to rgba string
// Usage: withAlpha('#1A1208', 0.1) → 'rgba(26, 18, 8, 0.1)'
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

Use `withAlpha(vibeTheme.text, 0.1)` wherever the spec says `rgba(vibeTheme.text, X)`.

No font changes. Existing vibes in `Colors.vibe` (focus, feelGood, throwback, elevated, melancholy, sunday) are already defined — no additions needed.

**Vibe fallback:** When user has not completed onboarding or `getUser()` returns undefined, fall back to `Colors.vibe.morning` as the default theme across all screens.

---

## 2. Player Screen

The hero experience. Biggest visual change in the overhaul.

### Layout: Title Over Art

The artwork container is the primary layout region. Title is positioned inside it at the bottom, over a gradient. Everything below (artist, progress, controls, Cleo section) flows in a normal vertical stack.

```
┌─────────────────────────────┐
│  ‹   STATION NAME           │  ← header row
│  ─────────────────────────  │  ← accent line
│┌───────────────────────────┐│
││                           ││
││   ALBUM ART (full bleed)  ││  ← aspectRatio: 1, marginHorizontal: 0
││                           ││
││  ┌─gradient─────────────┐ ││
││  │ SONG TITLE UPPERCASE │ ││  ← absolute, bottom: 0, over gradient
││  └──────────────────────┘ ││
│└───────────────────────────┘│
│  Artist Name · Album        │  ← paddingHorizontal: Spacing.lg
│  ─────────────────────────  │  ← progress bar
│  1:47              -3:22    │
│       ◀◀   ▶   ▶▶          │  ← controls
│                             │
│    · ON AIR ·               │  ← Cleo section (minHeight: 100)
│  "Cleo's words appear here" │
└─────────────────────────────┘
```

- **Album art:** full-bleed (marginHorizontal: 0), borderRadius: 0, square aspect ratio
- **Bottom gradient overlay:** Use `expo-linear-gradient` (`LinearGradient` component) positioned absolute over the bottom 60% of the artwork. Colors: `['transparent', 'rgba(0,0,0,0.7)']`. Install via `npx expo install expo-linear-gradient`.
- **Song title:** 36pt Playfair Display, uppercase, absolute positioned at bottom of art container (bottom: 0), paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md. Text shadow: `textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 8`.
- **Artist + album:** 13pt Work Sans Medium, uppercase, letterSpacing: Tracking.normal, below art with paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm. Format: "ARTIST NAME · ALBUM TITLE" (no year — the existing NowPlaying type does not include release year, and adding it is a data enrichment change outside visual scope).
- **Album name:** shown inline with artist (not as a separate line). Remove the standalone `albumName` Text element.

### Progress Bar

- Remove `opacity: 0.1` / `opacity: 10` hack
- Track: `withAlpha(vibeTheme.text, 0.1)`
- Fill: solid `vibeTheme.accent`

### Controls

- Replace Unicode characters with simple Text-based icons using DM Mono or clean unicode arrows. Specifically:
  - Play: `▶` (U+25B6) — keep, it renders well
  - Pause: two thin vertical bars drawn as two `View` elements (width: 3, height: 16, backgroundColor: vibeTheme.text, gap: 4) — avoids Unicode inconsistency
  - Skip forward: `▶▶` replaced with `»` (U+00BB) in DM Mono at 18pt
  - Skip back: `◀◀` replaced with `«` (U+00AB) in DM Mono at 18pt
- If `expo-symbols` is later adopted, use SF Symbol names: `play.fill`, `pause.fill`, `forward.fill`, `backward.fill`
- Play/pause: 56px circle, 1.5px border in accent color
- Skip/previous: 44px touch target, Opacity.muted

### Cleo Section

- Fixed `minHeight: 100` to prevent layout jumps
- ON AIR indicator: 8px dots (up from 6px), subtle shadow glow in accent color
- WordByWordSubtitle: accepts `accentColor` prop, uses vibe accent
- Resting state: "CLEO · STATION NAME" in DM Mono 9pt, Opacity.ghost

### Header

- Back chevron: `‹` (U+2039) at 24pt (down from 32pt), Playfair Display
- Station name: DM Mono 10pt, centered via `position: 'absolute', left: 0, right: 0, textAlign: 'center'` so it stays centered regardless of back button width. `zIndex: -1` so it doesn't block back button press.
- Back button: `width: 44` (touch target), aligned left
- No right spacer element needed — absolute-centered title solves alignment

### Vibe Atmosphere

- Dark vibes: determine at runtime by checking background luminance. Use a helper: `isDarkVibe(bg: string): boolean` that parses the hex and returns true if relative luminance < 0.2. This covers lateNight, workout, party, elevated, melancholy and any future dark vibes without maintaining a hardcoded list. Dark vibes get: subtle radial gradient glow behind art at bottom center, 8% opacity in accent color (implemented via `expo-linear-gradient` radial mode or an absolutely positioned View with the accent color and borderRadius)
- Art dims to 85% opacity when Cleo speaks (300ms in, 400ms out)
- Background color transition: 800ms Animated.timing on mount

### Grain Texture

- New `GrainOverlay` component at `src/components/GrainOverlay.tsx`
- Implementation: generate a 200x200 noise PNG and place at `assets/textures/grain.png`. Use `<Image source={require('../../assets/textures/grain.png')} style={{ ...StyleSheet.absoluteFillObject, opacity: 0.05 }} resizeMode="repeat" pointerEvents="none" />`
- To generate the noise PNG: use a simple script or image editor to create a 200x200 grayscale noise image (random black/white pixels). Alternatively, generate procedurally at build time.
- Applied to PlayerScreen only, rendered after background but before all interactive content (zIndex: 1, interactive content zIndex: 2+)

### Haptics

- `expo-haptics` Light impact on: play/pause, station press, vibe selection
- Medium impact on: skip track
- Haptics respect the system haptics setting automatically via expo-haptics — no additional gating needed

---

## 3. Home Screen

### Vibe-Aware Theming

- Read user's `defaultVibe` from MMKV on mount
- Apply `Colors.vibe[userVibe]` for bg, text, accent — no more hardcoded morning
- Background color uses Animated.Value with 1.5s timing for transitions

### Header

- "CLEO" at 42pt Playfair, `vibeTheme.text` color
- Replace Unicode gear with "SETTINGS" text in DM Mono 9pt or 3-line menu icon

### Now Playing Bar

- Add 2px progress line at bottom of bar (accent color, shows track progress)
- Replace `›` arrow with compact ON AIR pulsing dot
- "NOW PLAYING" label pulses in accent color when actively playing
- Remove borderRadius: 4 — sharp corners

### Station Cards

- borderRadius: 0 (sharp corners)
- Remove dark overlay label bar
- Station name typeset directly on art: white, DM Mono 10pt, uppercase, text shadow (offset: 0/1, radius: 6, color: rgba(0,0,0,0.8))
- 2px accent line at bottom edge in station's vibe color
- Press: scale(0.97) + subtle shadow lift
- Responsive width: accept `width` prop, calculate from screen width

### Empty State (No Stations)

- Remove radio emoji
- EB Garamond italic in accent color: "Pick a playlist. I'll do the rest."
- DM Mono hint text below at Opacity.ghost

### Section Titles

- DM Mono 11pt uppercase, wide tracking
- Standardize opacity to Opacity.muted (0.35)

---

## 4. Onboarding Flow

### Welcome Screen

- "CLEO" at 72pt stays
- Tagline: animate using WordByWordSubtitle component (word-by-word reveal)
- Description: fade in after tagline completes (400ms delay)
- "GET STARTED" button: fade in 800ms after description — progressive reveal
- Uses morning vibe (neutral default for new users)

### Music Auth Screen

- Remove 🎵 emoji — replace with accent line + editorial typography
- Title "Connect Your Music" in Playfair 28pt stays
- Add EB Garamond italic line above button: "I need access to your library to start hosting."
- Disabled state: opacity 0.3

### Vibe Setup Screen

- VibeSelector redesign: remove all emoji
- Cards: filled with vibe bg color, label in vibe text color, DM Mono 10pt uppercase
- Selected: 2px border in vibe accent + full opacity bg
- Unselected: 50% opacity bg, no border
- Size: 100x100. Show only the 5 core vibes (morning, chill, workout, lateNight, party) in onboarding and settings. The additional vibes (focus, feelGood, throwback, elevated, melancholy, sunday, general) are available in the token system for future station-level vibe selection but are not exposed in the VibeSelector component for now.

### First Station Screen

- Remove borderWidth: 2 selection wrapper
- Selected: accent line at bottom + scale(1.02)
- Card width: `(screenWidth - padding - gap) / 2` instead of fixed 160px

### Shared Across Onboarding

- All buttons: paddingVertical: Spacing.md (16), DM Mono 12pt, letterSpacing: Tracking.wide (3), sharp corners (borderRadius: 0), Colors.base.black bg, Colors.base.white text. This changes the existing 14pt fontSize to 12pt for a more refined, editorial label feel.
- Bottom padding: Spacing.xxl (64)
- Default slide transitions (no custom animations)

---

## 5. Settings Screens

### Shared

- All backgrounds: `vibeTheme.bg` (read from user's defaultVibe)
- All text: `vibeTheme.text`
- All dividers: `withAlpha(vibeTheme.text, 0.08)`

### Profile Screen

- VibeSelector: same redesigned version (no emoji, color-driven)
- Apple Music status: accent-colored dot + "CONNECTED" in DM Mono 10pt uppercase (replace ✓ text)
- Save confirmation: accent color "SAVED" text for 2s (no ✓)
- Standardized CTA button style

### Host Settings Screen

- Switch on-state: vibeTheme.accent for thumbColor/trackColor
- Row titles: Work Sans Medium 16pt
- Row subtitles: Work Sans 13pt, Opacity.secondary

> **Functional flag:** Host settings toggles (commentary, pullQuotes) don't persist to MMKV. Requires functional change — outside visual scope.

### History Screen

- Empty state: EB Garamond italic "We haven't started yet. But I'm ready when you are." in accent color
- Below: DM Mono hint at Opacity.ghost
- Session rows: already correct typography, just needs vibe-aware colors

---

## 6. Component Specifications

### WordByWordSubtitle

- Accept `accentColor` prop — use instead of hardcoded Colors.accent
- Fix fade-out: wrap the container `View` in `Animated.View` with a `containerOpacity` ref (Animated.Value initialized to 1). On exit, animate `containerOpacity` to 0 over 600ms, then call `onFinish`. The current implementation at line 36 creates `new Animated.Value(1)` that is never attached to any rendered element — this must be replaced with the container-level approach.
- Use Spacing.lg instead of hardcoded paddingHorizontal: 24

### PullQuoteOverlay

- No changes — works correctly as-is
- zIndex: 10 already ensures it renders above full-bleed art

### OnAirIndicator

- Dot size: 8px (up from 6px)
- Active glow: shadowColor matching accent, shadowRadius: 4, shadowOpacity: 0.4
- Paused state: opacity 0.15, no pulse
- Resume: single bright pulse then settle into rhythm

### StationCard

- borderRadius: 0
- Name on art with text shadow (no dark overlay bar)
- 2px accent line at bottom
- Accept `width` prop for responsive sizing

### VibeSelector

- No emoji
- Color-driven: vibe bg/text/accent
- Selected: accent border + full opacity
- Unselected: 50% opacity, no border

### GrainOverlay (new)

- Absolutely positioned, full screen, pointerEvents: 'none'
- 200x200 noise PNG at `assets/textures/grain.png`, tiled via `<Image>` with `resizeMode: 'repeat'`, opacity: 0.05
- Renders above background, below interactive content (zIndex: 1)
- See Section 2 "Grain Texture" for full implementation detail

---

## 7. Typography as Brand

### EB Garamond Italic = Cleo's Voice

Appears in:
- WordByWordSubtitle (existing)
- PullQuoteOverlay (existing)
- Welcome screen tagline (new, animated)
- Music Auth permission framing (new)
- Empty state: no stations (new)
- Empty state: no history (new)
- Loading placeholder text where appropriate (new)

Does NOT appear in:
- Navigation, labels, metadata, buttons
- Any functional UI text

### Empty State Pattern (Reusable)

1. EB Garamond italic in accent color — Cleo's voice
2. DM Mono hint below at Opacity.ghost — functional guidance
3. No emoji, no icons
4. Centered, generous vertical padding

---

## 8. Transitions & Motion

### Screen Transitions

- Home → Player: slide_from_bottom (standard iOS modal player)
- Onboarding: slide_from_right (standard forward nav)
- Settings: native Stack transitions
- No shared element transitions (YAGNI for MVP)

### Vibe Background

- PlayerScreen mount: backgroundColor animates from neutral to vibe bg over 800ms
- Simple Animated.timing, not a crossfade between views

### Track Change

- Accent line flash: the `accentLine` View below the header in PlayerScreen — its opacity pulses from its resting state to 1.0 then fades back over 600ms on each track change event
- Progress bar: instant reset to 0 on new track
- Art swap: instant (no crossfade for MVP)

### Cleo Speaking Sequence

1. Art dims to 85% opacity (300ms)
2. ON AIR pulses bright once, then settles into rhythm
3. Words stagger in at 40ms intervals (existing)
4. Speech ends: art returns to 100% (400ms), ON AIR fades to idle
5. Subtitle holds 1s, fades out via container opacity (fixing existing bug)

### Not Doing (YAGNI)

- No shared element transitions
- No parallax scrolling
- No HomeScreen vibe animations
- No artwork crossfade
- No spring/bounce physics — all Animated.timing with ease curves

---

## Out of Scope (Functional Flags)

These require functional changes beyond visual design:

1. **Host settings persistence** — commentary and pullQuotes toggles need MMKV save/load
2. **Album art color extraction** — PRD specifies extracting dominant color from art for dynamic accents. Significant feature, not a visual tweak.
3. **Time-of-day vibe detection** — auto-selecting vibe based on clock. Logic change, not visual.

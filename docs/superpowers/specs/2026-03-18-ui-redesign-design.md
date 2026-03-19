# Cleo UI Redesign — Design Spec

**Date:** 2026-03-18
**Status:** Approved
**Approach:** Progressive Rebuild — screen by screen, preserving all service/engine logic

---

## 1. Design Decisions

| Decision | Choice |
|----------|--------|
| Color mapping | Gold `#C8832A` primary (constant) + dynamic vibe secondary accent |
| Typography | Hybrid — Playfair Display (display), Inter (body/UI), EB Garamond (Cleo voice), DM Mono (labels) |
| Approach | Progressive rebuild — design tokens first, then each screen as a self-contained milestone |
| Scope | 7 screens + 1 shared component (Archives excluded) |

---

## 2. Design Tokens

### 2.1 Base Colors (Permanent — from PRD)

```
black:    #0D0D0D
white:    #FAF8F4
cream:    #F5F0E8
accent:   #C8832A
```

### 2.2 Surface Hierarchy (from Stitch, adapted)

```
surface.lowest:    #000000   — deepest voids
surface.base:      #0D0D0D   — primary background
surface.low:       #131315   — secondary sections
surface.container: #19191C   — default containers
surface.high:      #1F1F22   — elevated cards
surface.highest:   #262528   — interactive elements
surface.bright:    #2C2C2F   — hover/active states
```

### 2.3 Text Colors

```
on-surface:         #F6F3F5   — primary text
on-surface-variant: #ACAAAD   — secondary text
outline:            #767577   — subtle borders
outline-variant:    #48474A   — ghost borders (use at 15% opacity)
```

### 2.4 Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| display | Playfair Display | 300, 400 | Track titles, screen headers, hero text |
| body | Inter | 400, 500, 600 | UI text, descriptions, buttons (replaces Work Sans). Install `@expo-google-fonts/inter`, remove `@expo-google-fonts/work-sans`. |
| cleoVoice | EB Garamond | 400 italic | Cleo commentary, pull quotes |
| mono | DM Mono | 400, 500 | Labels, metadata, technical indicators, tab labels |

### 2.5 Glassmorphism

```
Glass Panel:       surface-variant @ 40% opacity + expo-blur BlurView (intensity 50, tint "dark")
Glass Panel Dark:  surface-low @ 60% opacity + expo-blur BlurView (intensity 50, tint "dark")
Cleo Orb Glow:     Absolutely-positioned View, accent @ 15% opacity, borderRadius 9999,
                   width/height = element + 80px, centered behind element
CTA Gradient:      expo-linear-gradient [#C8832A, #A06820] start={[0,0]} end={[1,1]}
CTA Shadow:        shadowColor=#C8832A, shadowOffset={0,12}, shadowOpacity=0.3, shadowRadius=20
Ghost Border:      outline-variant @ 15% opacity (never solid 1px borders)
```

**Performance note:** Limit simultaneous BlurView instances to ~5 per screen. For lists of glass cards (queue items, station cards), use the solid `surface.low` / `surface.high` background fallback instead of blur. Reserve BlurView for tab bar, app header, and hero commentary card.

### 2.6 Vibe System

The existing 12 vibes remain (morning, chill, lateNight, workout, party, general, focus, feelGood, throwback, elevated, melancholy, sunday). Each vibe overrides: background, text, and **secondary accent**. The primary accent (`#C8832A` gold) stays constant across all vibes — it's Cleo's identity. Vibe accent colors shift secondary elements (progress bar gradient end, live indicators, mood tags).

**Dark-only UI:** The redesign moves to a dark-only interface. Vibes that previously had light backgrounds (morning, general, focus, feelGood, throwback, sunday) now use the dark surface hierarchy with their accent color as the secondary. Their light background values are deprecated. This simplifies the surface system and matches the Stitch "Sonic Ether" aesthetic. The vibe accent colors remain for personality — they just no longer flip the entire background to light.

---

## 3. Shared Components

### 3.1 Bottom Tab Navigation

**Implementation:** Expo Router `<Tabs>` layout in `app/(main)/_layout.tsx` with custom `tabBar` render function.

| Property | Value |
|----------|-------|
| Height | 84px (includes 20px safe area) |
| Corner radius | 24px top-left/right |
| Background | `rgba(13,13,13,0.6)` + `blur(24px)` backdrop filter (expo-blur) |
| Active color | `#C8832A` gold (constant) |
| Inactive color | `rgba(172,170,173,0.35)` |
| Icon size | 24px |
| Label font | DM Mono 500, 8px, tracking 0.14em, uppercase |
| Tap area | Min 44x44px |
| Press animation | scale(0.92), 200ms ease |

**Tabs:**

| Tab | Icon (Material Symbols) | Active State | Screen |
|-----|------------------------|-------------|--------|
| Broadcast | `sensors` | Filled | HomeScreen → PlayerScreen stack |
| Arc | `timeline` | Filled | Session Arc / Queue |
| Archive | `library_music` | Filled | Placeholder (out of scope) |
| Cleo | `blur_on` + pulse dot | Filled + gold pulse | Profile & Settings |

**Cleo Pulse Dot:** 6px gold circle, top-right of Cleo icon. Pulses (opacity 1→0.5, scale 1→1.3, 2s loop). Appears when Cleo has unseen insights. Disappears on tab visit.

**During Cleo Speaking:** Tab bar dims to 30% opacity, `pointerEvents: none`. Re-enables when overlay exits.

### 3.2 Glass Card

Reusable container used across all screens:
- Background: `rgba(38,37,40,0.4)` + `blur(24px)`
- Border: `1px solid rgba(72,71,74,0.08)`
- Border radius: 14px–16px
- No solid borders for sectioning — depth via background shifts only

### 3.3 App Header

Fixed top header, shared across all tabbed screens:
- Height: 64px
- Background: `rgba(13,13,13,0.6)` + `blur(20px)`
- Left: "CLEO" in DM Mono 500, 18px, letter-spacing 0.15em, gold
- Right: User avatar (32px circle), optional search icon

---

## 4. Screen Designs

### 4.1 The Broadcast (Now Playing)

**Redesigns:** Existing PlayerScreen

**Layout (top to bottom):**
1. **App Header** — sticky, glass blur
2. **Album Art Hero** — square aspect ratio, 24px border radius, gradient overlay at bottom
   - Cleo waveform badge: 5 animated bars + "CLEO IS TALKING" in DM Mono when speaking
   - Art dims to 85% opacity when Cleo speaks
3. **Track Info** — centered, Playfair Display 300 for title (28px), Inter for artist (16px, on-surface-variant)
4. **Host Commentary Card** — glass card with:
   - Cleo orb icon (28px, gold gradient ring with dark inner)
   - "HOST COMMENTARY" label in DM Mono
   - Quote text in EB Garamond italic
   - Only visible when Cleo has spoken. Persists after overlay dismisses.
5. **Progress Bar** — 5px height, gradient fill (gold → vibe accent), rounded. Times in DM Mono 9px.
6. **Playback Controls** — shuffle, skip prev, play/pause orb (72px gold gradient, orb glow shadow), skip next, repeat
7. **Synchronized Next** — glass card with album art thumbnail (48px), track name (Inter 14px bold), artist (Inter 12px)
8. **Tab Bar**

**Preserved logic:** All audio coordination, MusicKit playback, Cleo script generation, TTS, ducking — unchanged.

### 4.2 Cleo Speaking (Disruptive Overlay)

**Replaces:** PullQuoteOverlay + WordByWordSubtitle

**Not a separate screen** — z-index overlay on top of Broadcast screen.

**Segment type routing:**

| Segment Type | Treatment |
|-------------|-----------|
| `track_story` | Full disruptive overlay |
| `post_track_reflection` | Full disruptive overlay |
| `cold_open` | Full disruptive overlay |
| `genre_bridge` | Commentary card only |
| `fun_fact` | Commentary card only |
| `transition` | Commentary card only |
| `artist_spotlight` | Commentary card only |
| `mood_check` | Commentary card only |
| `session_close` | Full disruptive overlay |

**Activation Sequence:**
1. Track ends → `onTrackChanged` fires → 1.5s natural pause
2. Broadcast screen dims: `opacity(0.3)`. Controls gray out. (No native grayscale filter — opacity reduction achieves sufficient dimming.)
3. Disruption overlay slides in
4. Words highlight sequentially synced to TTS
5. TTS finishes → overlay dissolves (600ms) → broadcast un-dims → music resumes
6. Commentary card on broadcast screen persists with the spoken quote

**Animations (Reanimated 3, native thread):**

| # | Animation | Spec | Duration |
|---|-----------|------|----------|
| 1 | Scanline sweep | Gold line, translateY(-5%→105%) | 3.5s linear infinite |
| 2 | Title glitch-in | skewX + translateX slam, then jitter loop | 0.4s entrance + 0.3s jitter loop |
| 3 | Gold bar flash | width 0→100% + gold gradient overlay glow | 0.6s ease-out, delay 0.3s |
| 4 | Quote box slam | scale(0.9→1.02→1) + rotate(0→-2→-1.5deg) | 0.5s spring, delay 0.5s |
| 5 | Waveform bars | scaleY(0.4→1→0.4), staggered | 0.6s infinite, stagger 0.1-0.3s |
| 6 | Word-by-word highlight | opacity 0.35→gold glow→0.6 per word | ~200ms/word, estimated timing (word count / audio duration) |
| 7 | Speaking badge pulse | opacity 1→0.4→1 | 1.5s infinite |
| 8 | Exit dissolve | opacity→0, translateY(-20px), blur(4px) | 600ms |

**Emphasis word:** Identified by Cleo's script (Gemini output). Gets italic + underline + persistent gold glow.

**Reduce-motion fallback:** Simple fade in/out, no glitch/jitter/scanline.

**Visual Details:**
- "HOST INTERJECTION" title: DM Mono 800, 48px, text-shadow chromatic aberration (vibe accent + gold). DM Mono is already installed and provides sufficient impact at this weight/size — avoids adding JetBrains Mono as a dependency for a single element.
- Quote box: tilted -1.5deg, border-right + border-bottom 4px gold, backdrop blur
- Quote text: DM Mono 800, 22px uppercase
- Signal metadata corner: "SIGNAL: 104.2 MHZ / LATENCY: 0.003MS / ENCODING: AI_VOX_V4" in DM Mono 7px @ 35% opacity

### 4.3 Cleo Onboarding

**New screen:** First-run only, after Apple Music auth. Shown once. Selections stored in MMKV.

**Layout:**
1. **Cleo Orb** — 64px circle, gold glow aura (blur 12px), centered
2. **Greeting** — `"Hello, I'm Cleo."` Playfair Display 32px, "Cleo" in gold. Subtext in Inter 14px.
3. **Current Mood** — 3 glass chip cards (Focused, Energetic, Mellow). Gold border on selected. Maps to vibe system.
4. **Session Goal** — Radio-button list (Discovery, Relaxation, Work). Glass cards. Gold accent on selected. Feeds into SegmentController.
5. **Genre Palette** — Multi-select pill chips. Gold for selected, surface-high for unselected.
6. **CTA** — "Start My Broadcast" gold gradient button (full width, rounded-full, glow shadow)
7. **Skip link** — "Skip setup, surprise me" in on-surface-variant, bypasses with defaults

**Section labels:** DM Mono 9px, letter-spacing 0.18em, uppercase, gold.

### 4.4 Session Arc (Queue)

**New screen:** Accessible via Arc tab. Shows during active sessions.

**Layout:**
1. **App Header**
2. **Session Title** — "Live Session" tag in DM Mono (vibe accent). Session name in Playfair Display 30px with gold keyword highlight. Description in Inter.
3. **Arc Visualization** — SVG curved path (react-native-svg), gradient gold→vibe accent. Cleo moment nodes along path (glass circles, gold border). Peak node larger, vibe accent filled. "You are here" indicator with white dot + line.
4. **Current Track Card** — Glass card with album art, track title (Playfair 16px), artist, genre/BPM tag chips, waveform bars
5. **Session Pulse** — Energy level (gold percentage + progress bar) and time remaining (vibe accent). Data from SessionEngine.
6. **Upcoming Manifest** — Track list with glass cards. Cleo commentary nodes interspersed (vibe accent background, EB Garamond title). Data from QueueManager + SegmentController buffer.
7. **Tab Bar**

### 4.5 HomeScreen (Redesigned)

**Redesigns:** Existing HomeScreen

**Layout:**
1. **App Header** — with search icon + avatar
2. **Greeting** — Time-of-day in Playfair Display 28px ("Good Evening"). Contextual subhead in Inter.
3. **Now Playing Mini** — Glass card with album art (44px), track info, waveform bars. Visible only when music playing. Tap → Broadcast tab. Replaces current colored bar.
4. **Your Stations** — Section label in DM Mono. Horizontal scroll of station cards (140x200px, ~1:1.43 ratio — narrower than the current 2:3 ratio to fit more cards on screen, 16px radius, gradient overlay, Playfair Display station name). Preserved from current but restyled.
5. **Playlists** — Same card treatment, horizontal scroll.
6. **Cleo Suggestion** — Glass card with Cleo orb (40px) + EB Garamond suggestion text. Contextual based on listening history.
7. **Tab Bar**

**Preserved logic:** Apple Music auth flow, playlist fetching, MMKV station storage, vibe theming.

### 4.6 Profile & Settings

**New screen:** Accessible via Cleo tab.

**Layout:**
1. **App Header**
2. **Profile Header** — Gold gradient ring (100px) around avatar. Name in Playfair 24px. Email in Inter 12px. PRO badge if subscribed (future).
3. **AI Personality** — Section header "AI PERSONALITY" in DM Mono. Three radio-button cards:
   - **Curator** (gold icon) — Analytical, musicology deep dives
   - **Companion** (vibe accent icon) — Emotional, mood matching
   - **Oracle** (tertiary icon) — Experimental, cryptic curation
   - Selected card: glass-card with gold radio fill. Modifies Cleo's system prompt (static-core.ts). Stored in MMKV.
4. **Connected Ecosystem** — Apple Music toggle. Shows MusicKitPlayer connection status. Toggle uses gold fill.
5. **Voice Profile** — Two sliders:
   - Audio Fidelity: gold→vibe gradient fill (placeholder for future)
   - Host Volume Mix: maps to `AudioCoordinator.duck.targetVolume`. Slider thumb is 14px white circle.
6. **Account** — Manage Subscription (future, StoreKit). Sign Out (error color `#ff6e84`).
7. **Tab Bar**

---

## 5. Build Order

| Phase | What | Type |
|-------|------|------|
| 1 | Design tokens rewrite + glass card + app header components | Foundation |
| 2 | Bottom tab navigation (Expo Router Tabs layout) | Shared component |
| 3 | The Broadcast (Now Playing) screen | Redesign existing |
| 4 | Cleo Speaking overlay | Redesign existing |
| 5 | HomeScreen | Redesign existing |
| 6 | Cleo Onboarding | New screen |
| 7 | Session Arc / Queue | New screen |
| 8 | Profile & Settings | New screen |

Each phase is a self-contained milestone testable on device.

---

## 6. Technical Notes

### 6.1 New Dependencies

Must be installed before Phase 1:

| Package | Purpose | Requires native rebuild? |
|---------|---------|------------------------|
| `expo-blur` | BlurView for glass panels, tab bar, header | No (Expo managed) |
| `react-native-reanimated` | All animations (60fps native thread) | Yes — requires Babel plugin + pod install |
| `react-native-svg` | Session Arc SVG path visualization | No (Expo managed) |
| `@expo-google-fonts/inter` | Body/UI typography (replaces Work Sans) | No |
| `expo-linear-gradient` | CTA gradient buttons, progress fills | No (Expo managed) |

**Remove:** `@expo-google-fonts/work-sans` (replaced by Inter)

**Reanimated config:** Add `'react-native-reanimated/plugin'` to `babel.config.js` plugins array.

### 6.2 Navigation Route Map

Current structure → target structure:

```
app/
├── _layout.tsx                    ← Root layout (unchanged)
├── index.tsx                      ← Auth/onboarding redirect (unchanged)
├── (auth)/                        ← Auth screens (unchanged)
├── (onboarding)/
│   └── index.tsx                  ← NEW: Cleo Onboarding screen
├── (main)/
│   ├── _layout.tsx                ← CHANGED: Stack → Tabs layout with custom tabBar
│   ├── (broadcast)/               ← NEW tab folder
│   │   ├── _layout.tsx            ← Stack navigator (home → player)
│   │   ├── index.tsx              ← HomeScreen (redesigned)
│   │   └── player.tsx             ← PlayerScreen (redesigned) + Speaking overlay
│   ├── (arc)/                     ← NEW tab folder
│   │   └── index.tsx              ← Session Arc / Queue screen
│   ├── (archive)/                 ← NEW tab folder
│   │   └── index.tsx              ← Placeholder screen
│   └── (cleo)/                    ← NEW tab folder (replaces (settings))
│       └── index.tsx              ← Profile & Settings screen
```

The existing `(settings)/` folder is replaced by `(cleo)/`. The existing `(main)/index` (HomeScreen) and `(main)/player` move into the `(broadcast)/` stack.

### 6.3 Other Technical Notes

- **Animations:** Reanimated 3 for all 60fps native-thread animations. `withSequence` for orchestrated entrances, `withRepeat + withTiming` for loops.
- **Icons:** Material Symbols icons (`sensors`, `timeline`, `library_music`, `blur_on`) are not in `@expo/vector-icons`. Use custom SVG icons via react-native-svg, or install `react-native-vector-icons` with MaterialSymbols font. Fallback: MaterialCommunityIcons equivalents (`access-point` for sensors, `chart-timeline-variant` for timeline, `music-box-multiple` for library_music, `blur` for blur_on).
- **Blur effects:** `expo-blur` BlurView for tab bar, app header, and hero cards only. See performance note in Section 2.5.
- **Shadows/Glows:** Use React Native shadow properties (`shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`). For colored glows, use absolutely-positioned gradient overlay Views.
- **Reduce-motion:** All animations respect `AccessibilityInfo.isReduceMotionEnabled` — fall back to simple fades
- **No new backend work:** All data from existing services (MusicKit, Gemini, ElevenLabs, MMKV, Firebase Auth)
- **Native builds:** Continue using `/Users/kari/Documents/cleo-app/` (no-spaces path)
- **Word-by-word timing:** Uses estimated timing (total audio duration / word count) for highlight stagger. Future enhancement: ElevenLabs streaming API with alignment data for precise word timestamps.

---

## 7. Out of Scope

- Broadcast Archives screen (deferred)
- HeyGen avatar integration (already deferred in Phase 4)
- Spotify / Last.fm connections (future)
- StoreKit subscription management (future)
- Album art color extraction for dynamic accents (future enhancement)

---

## 8. Reference Files

- Stitch screenshots: `docs/stitch/screenshots/`
- Stitch HTML: `docs/stitch/html/`
- Stitch design system spec: Project metadata (colors, typography, glassmorphism rules, "Sonic Ether" creative direction)
- PRD: `/Users/kari/Documents/DJ App/cleo-prd.md`
- Visual mockups: `.superpowers/brainstorm/99830-1773880868/`

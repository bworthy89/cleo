# ONAY Animated Character — Design Spec

## Overview
Add an animated anime-style ONAY character to the ONAY (profile/settings) tab. The character greets the user with a contextual message and plays a subtle idle animation. Built with sprite frame crossfading — no additional animation libraries required.

## Character Design
- Black female anime character, 90s R&B aesthetic
- Natural hair, wearing gold headphones
- Cool, mysterious energy with a slight smile
- Gold accent (#C8832A) on headphones, jewelry, or clothing details
- Dark clothing blending with Surface.base (#0D0D0D)
- Waist-up portrait crop, transparent PNG background

## Asset Pipeline
- **3 PNG frames** at 800x1000px (2x retina, renders at ~200pt tall)
- Frame 1: neutral pose, eyes open, slight smile
- Frame 2: subtle head tilt, eyes looking slightly off-center
- Frame 3: eyes half-closed / blink moment, relaxed expression
- Generated in Midjourney with `--cref` for cross-frame consistency
- Background removed via Midjourney or remove.bg
- Stored in `assets/cleo/onay-frame-1.png`, `onay-frame-2.png`, `onay-frame-3.png`

### Midjourney Prompts
**Reference image:**
```
anime style portrait of a black woman wearing gold headphones,
90s R&B aesthetic, natural hair, cool mysterious expression,
slight smile, waist up, dark background, gold accent lighting,
cel shaded, studio quality --ar 4:5 --niji 6
```

**Variation frames (with --cref from reference):**
```
[same prompt] slight head tilt looking to the side --cref [reference URL]
```
```
[same prompt] eyes half closed relaxed blink moment --cref [reference URL]
```

## Placement
Replaces the current profile header on the ONAY tab. Layout top-to-bottom:

1. **Character image** (~200px tall, centered horizontally)
2. **Greeting card** (gold-edge editorial card, EB Garamond italic quote)
3. **Profile info** (compact row: name + email, moved from old header position)
4. **Existing sections** (AI Personality, Connected Ecosystem, etc.)

## Greeting Content
Contextual, time-of-day based. Displayed in the ONAY voice typography (EB Garamond Italic, curly quotes):

| Time | Example Greeting |
|------|-----------------|
| Morning (before 12pm) | "Morning, listener. What are we getting into today?" |
| Afternoon (12-5pm) | "Afternoon session? I like where your head's at." |
| Evening (5-9pm) | "Evening. Let's set the mood." |
| Late night (after 9pm) | "Late night vibes. I've got just the thing." |

## Animation

### Entrance (on tab focus)
1. Character fades in: opacity 0→1 over 400ms, slides up 10px
2. 300ms delay
3. Greeting card fades in: opacity 0→1 over 300ms

Replays on each tab focus via `useFocusEffect`.

### Idle Loop
- Crossfade between 3 frames at ~3 second intervals
- Two `Animated.Value` opacity values alternating (current frame fades out, next fades in)
- 800ms crossfade duration
- `useNativeDriver: true` for performance
- Sequence: Frame 1 → Frame 2 → Frame 3 → Frame 1 (loop)

## Component Structure

### `OnayCharacter` component (`src/components/OnayCharacter.tsx`)
- Props: none (self-contained)
- Manages the 3-frame idle animation loop internally
- Preloads all 3 images on mount via `Image.prefetch`
- Exposes no external API — just renders and animates

### ProfileScreen changes
- Remove: `LinearGradient` avatar ring, `avatarInner`, `avatarInitial`, `profileHeader` gradient section
- Add: `OnayCharacter` component at top
- Add: greeting card below character (gold-edge pattern matching existing cards)
- Add: compact profile info row (name + email) below greeting
- Existing sections (AI Personality, etc.) remain unchanged

## Design Tokens Used
- `Typography.cleoVoice` for greeting text
- `Colors.accent` for gold edge, accent elements
- `Surface.container` for greeting card background
- `Radius.sm` for card corners
- `Spacing.lg` / `Spacing.md` for layout gaps

## Dependencies
- No new libraries — uses React Native `Animated` and `Image`
- Requires 3 PNG assets generated externally (Midjourney)

## Out of Scope
- Interactive character responses (tapping ONAY, etc.)
- Multiple character outfits or expressions beyond the 3 idle frames
- Character appearing on other screens

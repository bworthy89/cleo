# Vibe Picker Bottom Sheet

## Summary
Add a vibe picker bottom sheet that appears when tapping a station or playlist on the Home screen, allowing users to select a vibe before launching a broadcast.

## Trigger
Tapping a station card or playlist card on HomeScreenRedesign opens a bottom sheet instead of navigating directly to the player.

## Layout (top to bottom)
1. Drag handle — 40px wide subtle bar
2. Station name in display font + artwork thumbnail (40px)
3. "SET YOUR VIBE" mono gold section label
4. Vibe grid — 12 vibes as flex-wrap pills (gold border + accent bg when selected)
5. "START BROADCAST" gold-bordered CTA button

## Behavior
- Single-select: tapping a vibe pill replaces previous selection
- Pre-selects the station's `defaultVibe` from Storage
- "START BROADCAST" saves selected vibe to station's `defaultVibe`, navigates to player
- Swipe down or tap backdrop dismisses without navigating
- Sheet height: ~50% screen

## Data Flow
- Open: read `station.defaultVibe` for pre-selection
- Confirm: update station in Storage with new vibe, `router.push` to player with selected vibe

## Implementation
- New component: `src/components/VibePicker.tsx` — Modal + Animated slide-up
- Modify: `HomeScreenRedesign.tsx` — station/playlist press opens picker instead of navigating
- Uses existing design tokens (Surface.container, gold accent pills, mono labels)
- No new dependencies

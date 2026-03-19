# Vibe Selector Expansion Design

**Date:** 2026-03-18
**Goal:** Surface all 12 vibes in the VibeSelector component so users can actually pick mood-based vibes that already exist in the system.

---

## Problem

The `VibeSelector` component only shows 5 activity-based vibes (Morning, Chill, Workout, Late Night, Party). The codebase defines 12 vibes with full support (fallbacks, cold opens, color themes, prompt context), but 7 are never selectable: General, Focus, Feel Good, Throwback, Elevated, Melancholy, Sunday.

---

## Change

**File:** `src/components/VibeSelector.tsx`

Single-file change:

1. Add 7 missing vibes to the `VIBES` array:

| Vibe | Label | Icon |
|------|-------|------|
| general | General | `radio-outline` |
| focus | Focus | `eye-outline` |
| feelGood | Feel Good | `heart-outline` |
| throwback | Throwback | `time-outline` |
| elevated | Elevated | `diamond-outline` |
| melancholy | Melancholy | `rainy-outline` |
| sunday | Sunday | `cafe-outline` |

2. Switch layout from fixed `flexDirection: 'row'` to a horizontal `ScrollView` with `showsHorizontalScrollIndicator={false}` and `contentContainerStyle` for padding/gap.

3. Card size: fixed width (not calculated from screen width / count) to maintain consistent sizing as the row scrolls.

---

## What This Does NOT Change

- No new vibe types — all 12 already exist in the `Vibe` type union
- No changes to fallbacks, cold opens, design tokens, or prompts
- No changes to the onboarding flow or settings screens (they consume VibeSelector as-is)
- No changes to how vibes are stored or applied

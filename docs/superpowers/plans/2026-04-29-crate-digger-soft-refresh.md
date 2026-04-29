# Crate Digger Soft Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surgical pass on Crate Digger chrome — reduce `Halftone` to one editorial surface (`FeaturedBroadcastCard`) and simplify `StampButton` Ticks from 4 corners to 2 diagonal — to take the "trying too hard" off the system.

**Architecture:** Pure deletions. No new components, no API changes, no token changes. Existing `Halftone` and `Tick` components are unchanged. Three call-sites drop their `<Halftone>` element + import, and one component drops two of its four `<Tick>` corners.

**Tech Stack:** TypeScript (strict), React Native / Expo SDK 55. Existing tokens (`AM`, `Fonts`, `Space`, `TypeScale`) all stay.

---

## Spec reference

Spec: [`docs/superpowers/specs/2026-04-28-crate-digger-soft-refresh-design.md`](../specs/2026-04-28-crate-digger-soft-refresh-design.md)
Issue: [#52](https://github.com/bworthy89/cleo/issues/52) (Phase 3 milestone)
Branch: `feat/crate-digger-soft-refresh` (already created off `main`; spec already committed at `5657eac2`)

---

## File map

| File | Change | Lines moved |
|---|---|---|
| `src/screens/tonight/TonightScreen.tsx` | Remove `<Halftone>` element + drop from named import + update stale comment | 3 |
| `src/screens/settings/ProfileScreen.tsx` | Remove `<Halftone>` element + drop from named import | 2 |
| `src/components/broadcast/SlotPlaceholderCard.tsx` | Remove `<Halftone>` element + remove import line | 2 |
| `src/components/crate/StampButton.tsx` | Delete `<Tick pos="tr" …>` + `<Tick pos="bl" …>` | 2 |

Files deliberately **NOT** touched:
- `src/components/broadcast/FeaturedBroadcastCard.tsx` — keeps its `<Halftone opacity={0.3} />` (the editorial moment)
- `src/components/crate/Halftone.tsx` — component stays, still consumed by `FeaturedBroadcastCard`
- `src/components/crate/Tick.tsx` — component stays
- `src/components/crate/index.ts` — barrel `export { Halftone } from './Halftone';` stays (no consumer change to it; FeaturedBroadcastCard imports `./Halftone` directly, but the barrel is harmless and removing it would be scope creep)

---

## Testing approach

This is a visual-only change with no behavior delta. There are no unit tests to write or update. The two gates per task are:

1. **`npx tsc --noEmit`** must remain clean. Since we're only removing JSX elements + an unused named import, this is mechanical.
2. **Visual smoke** at the end (one task at the close), not per-task — switching back and forth between sims after each step would be slower than a single end-of-PR pass.

There is no behavior to assert, so **no failing-test-first step**. TDD is appropriate when there's logic; here there isn't. Each task is: edit → tsc clean → commit.

---

## Task 1: Remove Halftone from TonightScreen masthead

**Files:**
- Modify: `src/screens/tonight/TonightScreen.tsx` (import line 16, comment line 131, element line 133)

- [ ] **Step 1: Edit the named import on line 16**

Open `src/screens/tonight/TonightScreen.tsx`. Find this line:

```tsx
import { SleeveArt, SectionMarker, Halftone, SettingsCog } from '../../components/crate';
```

Replace with (drop `Halftone` from the destructured list):

```tsx
import { SleeveArt, SectionMarker, SettingsCog } from '../../components/crate';
```

- [ ] **Step 2: Update the stale comment on line 131**

Find:

```tsx
        {/* Oxblood masthead with halftone */}
```

Replace with:

```tsx
        {/* Oxblood masthead */}
```

- [ ] **Step 3: Delete the `<Halftone>` element on line 133**

Find this block (inside the `<View style={styles.masthead}>`):

```tsx
        <View style={styles.masthead}>
          <Halftone opacity={0.35} spacing={5} />
          <View style={styles.cogWrap}>
```

Replace with:

```tsx
        <View style={styles.masthead}>
          <View style={styles.cogWrap}>
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`
Expected: clean exit (no errors). If `Halftone` shows up in any unused-import warning surface, it means we missed dropping it from the destructured import in Step 1 — go back and re-check.

- [ ] **Step 5: Commit**

```bash
git add src/screens/tonight/TonightScreen.tsx
git commit -m "refactor(tonight): drop halftone from masthead

Per crate-digger soft-refresh spec: TonightScreen masthead is a functional
plate, not an editorial moment. Halftone was decoration without a job."
```

---

## Task 2: Remove Halftone from ProfileScreen member card

**Files:**
- Modify: `src/screens/settings/ProfileScreen.tsx` (import block lines 9-14, element line 251)

- [ ] **Step 1: Edit the named import block on lines 9-14**

Open `src/screens/settings/ProfileScreen.tsx`. Find this multi-line import:

```tsx
import {
  StatusStrip,
  LinerNotes,
  SectionMarker,
  Halftone,
} from '../../components/crate';
```

Replace with (remove the `Halftone,` line):

```tsx
import {
  StatusStrip,
  LinerNotes,
  SectionMarker,
} from '../../components/crate';
```

- [ ] **Step 2: Delete the `<Halftone>` element on line 251**

Find this block (inside `<View style={styles.card}>`):

```tsx
        <View style={styles.card}>
          <Halftone opacity={0.3} spacing={5} />
          <View style={{ position: 'relative' }}>
```

Replace with:

```tsx
        <View style={styles.card}>
          <View style={{ position: 'relative' }}>
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add src/screens/settings/ProfileScreen.tsx
git commit -m "refactor(profile): drop halftone from member card

Per crate-digger soft-refresh spec: the oxblood member card is a functional
identity surface, not an editorial moment."
```

---

## Task 3: Remove Halftone from SlotPlaceholderCard

**Files:**
- Modify: `src/components/broadcast/SlotPlaceholderCard.tsx` (import line 3, element line 15)

- [ ] **Step 1: Remove the `Halftone` import on line 3**

Open `src/components/broadcast/SlotPlaceholderCard.tsx`. Delete this line entirely:

```tsx
import { Halftone } from '../crate/Halftone';
```

The remaining imports above it stay:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
```

(There is no other `Halftone` usage in this file, so deleting the entire import line is correct — unlike Tasks 1 and 2 where `Halftone` is one item among several in a destructured import.)

- [ ] **Step 2: Delete the `<Halftone>` element on line 15**

Find this block (inside `<View style={styles.plate}>`):

```tsx
      <View style={styles.plate}>
        <Halftone opacity={0.3} />
        <View style={styles.plateRow}>
```

Replace with:

```tsx
      <View style={styles.plate}>
        <View style={styles.plateRow}>
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add src/components/broadcast/SlotPlaceholderCard.tsx
git commit -m "refactor(slot-placeholder): drop halftone

Per crate-digger soft-refresh spec: a placeholder by definition has no
content to dress up. Halftone here was decoration on emptiness."
```

---

## Task 4: Simplify StampButton Ticks (4 corners → 2 diagonal)

**Files:**
- Modify: `src/components/crate/StampButton.tsx` (lines 62-65)

- [ ] **Step 1: Delete two of the four `<Tick>` lines**

Open `src/components/crate/StampButton.tsx`. Find this block inside the `<Pressable>`:

```tsx
      <Tick pos="tl" color={stroke} bg={tickBg} />
      <Tick pos="tr" color={stroke} bg={tickBg} />
      <Tick pos="bl" color={stroke} bg={tickBg} />
      <Tick pos="br" color={stroke} bg={tickBg} />
```

Replace with (keep only `tl` and `br` — the diagonal pair):

```tsx
      <Tick pos="tl" color={stroke} bg={tickBg} />
      <Tick pos="br" color={stroke} bg={tickBg} />
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`
Expected: clean exit. (`Tick` is still imported on line 5 and still used twice — no import change needed.)

- [ ] **Step 3: Commit**

```bash
git add src/components/crate/StampButton.tsx
git commit -m "refactor(stamp-button): 4 ticks → 2 diagonal (tl + br)

Per crate-digger soft-refresh spec: real-world print stamps rarely register
all 4 corners. Diagonal pair (tl + br) still implies the bounding rect and
reads as a deliberate stamped frame; lighter on busier surfaces. Universal
across both kind=amber and kind=oxblood — every consumer (HomeBroadcastScreen,
AskOnayScreen, SettingsDrawer, SetupSheet, music-auth, welcome, first-listen,
player, login) inherits the lighter look automatically."
```

---

## Task 5: Visual smoke + push for review

**Files:** none (verification + branch push only)

- [ ] **Step 1: Final type-check**

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`
Expected: clean exit. Same gate as the per-task ones, run once more in case any cross-file issue snuck through.

- [ ] **Step 2: Run the dev server & quick visual smoke (optional but recommended)**

Per CLAUDE.md "Doing tasks → For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."

- Start dev server: `cd /Users/kari/Documents/cleo-app && npx expo start --ios`
- On the booted simulator, walk these surfaces and visually confirm:
  - **Tonight tab opens** — masthead is solid oxblood with no halftone dot pattern. Anton title still readable. Cog still tappable in the corner.
  - **ONAY tab (Profile)** — member card is solid oxblood with no halftone dot pattern. Member № + name still legible.
  - **Empty home rail** — if any `SlotPlaceholderCard` surfaces (no broadcasts yet on a fresh account), the placeholder plate reads as a clean empty box. Hard to reproduce without resetting state; if you can't get to it, that's fine — it's a low-risk surface.
  - **Featured rail card on Home** — `FeaturedBroadcastCard` still has its halftone (verify nothing accidentally got removed there).
  - **Any `StampButton`** — easiest reach is the Setup wizard's primary CTA. The frame should still read as a stamp, but with corner Ticks only at `tl` and `br`. The other two corners (`tr`, `bl`) should now show plain border with no Tick rectangle.
- If anything looks wrong, go back to the appropriate task. If the dev server can't be started in this environment, skip this step and report that visual smoke is deferred to TestFlight 64 — call it out explicitly.

- [ ] **Step 3: Push branch**

```bash
git push -u origin feat/crate-digger-soft-refresh
```

- [ ] **Step 4: Run CodeRabbit pre-PR review (per `feedback_coderabbit_pre_pr.md`)**

Run: `cd /Users/kari/Documents/cleo-app && coderabbit review --agent --base main --type committed`
Address any findings before opening the PR. For a 4-file deletion-only PR, expect zero or trivial findings.

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "refactor(crate-digger): soft refresh — halftone reduction + tick simplification (#52)" --body "$(cat <<'EOF'
## Summary
- Remove `<Halftone>` from `TonightScreen` masthead, `ProfileScreen` member card, and `SlotPlaceholderCard` plate. Keeps it on `FeaturedBroadcastCard` (the editorial moment).
- Simplify `StampButton` from 4 corner Ticks to 2 diagonal (`tl` + `br`). Universal across `kind=amber` / `kind=oxblood`. Every consumer of `StampButton` inherits the lighter look automatically.

Spec: `docs/superpowers/specs/2026-04-28-crate-digger-soft-refresh-design.md`
Closes #52.

## Test plan
- [ ] `npx tsc --noEmit` clean
- [ ] Tonight masthead — no halftone, Anton title still readable
- [ ] ONAY (Profile) member card — no halftone, identity legible
- [ ] `FeaturedBroadcastCard` halftone still present
- [ ] `StampButton` reads as a stamp, corner Ticks at tl + br only

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope (explicit, mirrors spec)

These are intentionally not in this plan and should NOT be added by an executing agent:

- Spacing token sweep (`Space.s*` tightening across surfaces)
- Motion / animation patterns
- Per-`StampButton` prop to override Tick count (YAGNI — universal rule is simpler)
- `FeaturedBroadcastCard` halftone parameter tuning
- Removing the `Halftone` re-export from `src/components/crate/index.ts` (harmless; out of surgical scope)
- Removing the `Halftone` component file itself (still consumed by `FeaturedBroadcastCard`)

If during implementation the agent thinks any of the above is necessary, STOP and surface to the human — don't expand scope inside this plan.

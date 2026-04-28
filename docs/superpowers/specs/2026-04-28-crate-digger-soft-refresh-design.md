# Crate Digger Soft Refresh (Surgical Pass) — Design

**Issue:** [#52](https://github.com/bworthy89/cleo/issues/52) (Phase 3 milestone)
**Status:** Brainstormed 2026-04-28
**Approach:** Surgical scope cut — only the two lowest-risk levers (Halftone reduction + Tick simplification). Spacing and motion deferred to follow-up.

---

## Goal

Address the "trying too hard" feeling in the Crate Digger system by reducing two specific elements that are currently over-applied. Tokens (`AM` palette, `Fonts.display`/`serif`/`mono`, `TypeScale`, `Space`, `Radius`) all stay unchanged. No new components. No API changes.

## Scope decision (locked during brainstorm)

Issue #52 lists 4 buckets — tighten spacing, more motion, selective halftone, simplify Ticks. We chose **option A — surgical pass** on only the two lowest-risk buckets. Spacing and motion are bigger judgment calls per surface and would benefit from getting the loud chrome quieter first; they ship in a separate follow-up if needed.

| Bucket | This PR | Deferred |
|---|---|---|
| Halftone — selective | ✅ Yes (reduce from 4 surfaces to 1) | — |
| Tick — simplified | ✅ Yes (4 corners → 2 diagonal) | — |
| Spacing — tightened | ❌ | Deferred |
| Motion — more | ❌ | Deferred |

## Design — what changes

### 1. Halftone reduction

The `Halftone` component is currently rendered on 4 surfaces. Per the Phase 3 roadmap spec ("reduce to editorial moments"), we keep it only on the one surface that genuinely IS an editorial moment — `FeaturedBroadcastCard`, the curator's hero pick on Home — and remove it from the three functional surfaces where it was acting as default decoration.

| File | Today | After |
|---|---|---|
| `src/components/broadcast/FeaturedBroadcastCard.tsx:47` | `<Halftone opacity={0.3} />` | **unchanged** — this IS the editorial moment |
| `src/screens/tonight/TonightScreen.tsx:133` | `<Halftone opacity={0.35} spacing={5} />` | element + import removed |
| `src/screens/settings/ProfileScreen.tsx:251` | `<Halftone opacity={0.3} spacing={5} />` | element + import removed |
| `src/components/broadcast/SlotPlaceholderCard.tsx:15` | `<Halftone opacity={0.3} />` | element + import removed |

The `src/components/crate/Halftone.tsx` component file itself stays — `FeaturedBroadcastCard` still uses it. Only the 3 redundant consumers go.

**Why these 3:** `TonightScreen` and `ProfileScreen` are functional whole-screen plates — halftone there is decoration without a job. `SlotPlaceholderCard` is by definition an empty placeholder; there's no content to dress up. `FeaturedBroadcastCard` keeps it because a curator-authored pick is exactly the kind of moment a print-shop halftone is meant to mark.

### 2. Tick simplification on `StampButton`

Today every `StampButton` renders 4 Ticks at every corner (`tl`, `tr`, `bl`, `br`). On busier surfaces this reads as the system trying too hard — print stamps in the real world rarely register all 4 corners; 2 is the convention.

Single change in `src/components/crate/StampButton.tsx:62-65`:

```tsx
// Before
<Tick pos="tl" color={stroke} bg={tickBg} />
<Tick pos="tr" color={stroke} bg={tickBg} />
<Tick pos="bl" color={stroke} bg={tickBg} />
<Tick pos="br" color={stroke} bg={tickBg} />

// After
<Tick pos="tl" color={stroke} bg={tickBg} />
<Tick pos="br" color={stroke} bg={tickBg} />
```

Universal — applied to both `kind="amber"` and `kind="oxblood"` variants identically. No per-variant branching, no new props, no API change. Every consumer of `StampButton` (HomeBroadcastScreen, AskOnayScreen, SettingsDrawer, SetupSheet, music-auth, welcome, first-listen, player, login) automatically gets the lighter look.

**Why diagonal (tl + br) and not single-corner or 2-adjacent:** the diagonal pair still implies the rectangle's bounding box and reads as a deliberate "stamped" frame. A single corner reads as an asymmetric typo; an adjacent pair (tl + tr only) reads as an open-bottom box. Diagonal is the established print convention.

### 3. What's deliberately NOT in scope

- **Spacing tightening / `Space.s*` token sweep** — bigger judgment call across many surfaces; follow-up after this lands
- **More motion / animation patterns** — #51 already shipped Liquid Glass which added meaningful motion to the chrome story; deeper motion work follows once we have data on whether the existing motion feels enough
- **Per-`StampButton` prop to override Tick count** — YAGNI; the hardcoded universal rule is simpler and easier to read
- **`FeaturedBroadcastCard`'s halftone params (opacity / spacing)** — left at the existing `0.3` since the surface already works; tuning happens by ear, not by spec

## Architecture

Architecture section is intentionally short because there isn't one — no new components, no API changes, no abstractions introduced. Just deletions and a 2-line trim. The existing `Halftone` and `Tick` components stay as they are.

## Data flow

N/A — pure render-tree change.

## Error handling

N/A — no new failure modes introduced. The deletions can't fail at runtime; they just mean fewer DOM nodes / SVG paths in the layer tree on Tonight / Profile / SlotPlaceholder surfaces.

## Testing

- TypeScript check (`npx tsc --noEmit`) clean — should be, since no API changes
- No automated tests — visual surface change. Existing test suite covers nothing affected (no behavior change).
- Manual visual smoke on TestFlight (build 64+):
  - Tonight tab opens — feels intentionally clean (no halftone), still visibly Crate Digger via the warm-black backdrop and Anton headers
  - Profile (Settings) tab — same
  - Empty home rail (no broadcasts yet) — `SlotPlaceholderCard` looks plain, intentional
  - Featured rail card — unchanged, halftone still readable
  - Every `StampButton` (across onboarding, Setup wizard, Settings drawer, login, player end-button, etc.) — frame still reads as a stamp, but lighter; corner Ticks at tl + br only

## Rollout

Single PR. Net diff:

- **4 files touched** — 3 deletions + 1 line-trim
- **~8 lines removed total**
- Zero new files
- Zero new tests
- Zero API changes
- Zero token changes

Mergeable on its own; no client/server coordination needed; visual change ships in next TestFlight build.

## Out of scope (filed as follow-up if needed after smoke)

- Spacing token sweep (`Space.s*` tightening across surfaces)
- Motion / animation patterns layered on top of Liquid Glass chrome
- `FeaturedBroadcastCard` halftone parameter tuning if it reads as too heavy now that it's solo
- Tick refactor to a configurable-corner-set prop if a future surface needs different framing

# Liquid Glass on iOS 26 Chrome Surfaces — Design

**Issue:** [#51](https://github.com/bworthy89/cleo/issues/51) (Phase 3 milestone)
**Status:** Brainstormed 2026-04-27
**Approach:** Hybrid — Apple `UIGlassEffect` material + Crate Digger marks layered on top

---

## Goal

Apply Liquid Glass to **persistent chrome surfaces only** behind `#available(iOS 26, *)` runtime guards. Content layer stays Crate Digger. iOS 16.2 / 18 keep their existing solid `AM.bg` chrome — no intermediate "kinda-glass" treatment.

## Brainstorm decisions

The original issue listed 7 chrome surfaces (4 persistent + 3 modal sheets). Brainstorming trimmed to 4:

| Decision | Locked value |
|---|---|
| Visual direction | **Hybrid** — Apple `UIGlassEffect` substrate, Crate Digger marks (Anton labels, Tick corners, hairlines, oxblood underline) layered on top in RN |
| Surfaces in scope | **4 persistent chrome:** `TabBar`, `AppHeader`, `NowPlayingBar`, `OfflineBanner` |
| Surfaces out of scope | **3 modal sheets:** `SetupSheet`, `SettingsDrawer`, `PublishFeaturedSheet` (sheets are screens wearing modal clothes — they have their own `BroadcastBackdrop` and don't benefit from glass over a dimmed parent) |
| iOS < 26 fallback | **Stay as today** — solid `AM.bg`, hairlines, no blur. Two visual states total: today's chrome on iOS 16.2/18, real glass on iOS 26+ |
| Implementation | **New `modules/expo-liquid-glass` Expo Modules native package** exposing a single `<LiquidGlassView />` primitive. Native = thin `UIVisualEffectView` wrapper. Crate Digger composition stays in RN |
| Behaviors v1 | **Static material only.** Refraction comes free from `UIGlassEffect()`. No deformation, no scroll-edge reactivity, no tint — defer to follow-up if missing after smoke |
| Rollout | **Two PRs.** PR 1 = native module only (no consumer changes). PR 2 = adopt across the 4 chrome surfaces |

## Architecture

### New native module: `modules/expo-liquid-glass`

Mirrors the structure of `modules/expo-music-kit`. Swift on the iOS side, TypeScript on the JS side.

**Native (Swift, iOS only):**

- `LiquidGlassView` — a `UIVisualEffectView`-backed component
  - iOS 26+: `effect = UIGlassEffect()`
  - iOS 16.2 / 18: `effect = nil` (renders transparent — parent provides background)
  - Single binary ships across all OS versions; divergence handled inside the view via `if #available(iOS 26.0, *)`
- `intensity?: 'regular' | 'thin' | 'ultraThin'` prop, default `'regular'`
- Module-level constant exposed back to JS: `isLiquidGlassAvailable: boolean`, computed once via `#available` check
- No props beyond `intensity` for v1 — Apple's automatic behaviors (refraction, scroll-edge reactivity) come from the material; we are not opting into deformation/interaction APIs

**JS (TypeScript):**

```ts
import { LiquidGlassView, isLiquidGlassAvailable } from 'expo-liquid-glass';
```

- `<LiquidGlassView intensity="regular" style={{...}}>...</LiquidGlassView>` — wraps children with the native effect view
- `isLiquidGlassAvailable` — boolean constant for consumers to gate their solid-background fallback

### Consumer surfaces

| Surface | File | Today | After |
|---|---|---|---|
| TabBar | `src/components/TabBar.tsx` | `backgroundColor: AM.bg` solid | Wrap inner with `<LiquidGlassView>`; container background = `isLiquidGlassAvailable ? 'transparent' : AM.bg` |
| AppHeader | `src/components/AppHeader.tsx` | `backgroundColor: 'transparent'` | Wrap inner with `<LiquidGlassView>`; iOS 26 gets glass material; iOS < 26 stays transparent (no change) |
| NowPlayingBar | `src/components/NowPlayingBar.tsx` | `backgroundColor: AM.bg` solid | Same pattern as TabBar |
| OfflineBanner | `src/components/OfflineBanner.tsx` | `backgroundColor: Surface.high` (legacy alias for `AM.bg`) | Same pattern as TabBar |

Crate Digger marks (Anton labels, mono numerals, oxblood underlines, hairline rules, Tick corners) all stay in RN. The native module does only the material layer.

**Net file count:** 1 new module dir (~5 files), 4 modified RN components.

## Data flow

Intentionally minimal — pure visual layering change.

The one piece of state JS needs is "Can this device render Liquid Glass?" The native module exposes `isLiquidGlassAvailable` (computed once at module load via `#available`). Consumers gate their solid-background fallback on it:

```tsx
backgroundColor: isLiquidGlassAvailable ? 'transparent' : AM.bg
```

This keeps the iOS-version logic in one place (the native module) and chrome components dumb.

## Error handling

Three cases:

1. **iOS < 26 (expected).** `LiquidGlassView` renders a transparent `UIView`. `isLiquidGlassAvailable === false`. Consumers paint solid `AM.bg`. Normal happy path on older OSes.
2. **`UIGlassEffect()` instantiation fails on iOS 26 (unexpected).** Wrap native effect setup in `do/catch` — on failure, set `effect = nil` and log via `NSLog`. Visual outcome identical to iOS < 26 path: transparent, parent provides background. Logging is observability only.
3. **Consumer wraps non-translucent content.** Documented constraint, not runtime-enforced. Contract: anything wrapped in `<LiquidGlassView>` should set its own `backgroundColor: 'transparent'` (or use the `isLiquidGlassAvailable` gate). If a consumer forgets, glass simply has nothing to refract — visual no-op, not a crash. README covers this with a 3-line example.

## Testing

### Test matrix

| OS | Where | Validates |
|---|---|---|
| iOS 16.2 | Xcode 26 simulator | Solid `AM.bg` fallback path; no native crash; `isLiquidGlassAvailable === false` |
| iOS 18 | Xcode 26 simulator | Same fallback path; sanity check that `if #available` gate cleanly excludes 18 |
| iOS 26 | Real iPhone | Glass material renders; refraction visible against `BroadcastBackdrop`'s amber bloom; Crate Digger marks layer cleanly on top; no z-order glitches |

### Manual smoke per OS

- Launch app, sit on home screen — `TabBar` + `AppHeader` visible. Scroll the home content; on iOS 26, glass should subtly react to content moving under it (free behavior from `UIGlassEffect`).
- Start a broadcast — `NowPlayingBar` appears between content and `TabBar`. Confirm both glass surfaces stack cleanly.
- Toggle airplane mode — `OfflineBanner` slides in from top, glass on iOS 26.
- Open a modal sheet — sheets stay solid (not in scope), no visual regression.

### Automated tests

No automated tests for visual fidelity — those are notoriously brittle. Native module gets a Jest smoke test that `LiquidGlassView` mounts without throwing (runs without iOS simulator).

## Rollout

Two PRs to keep infrastructure cleanly separable from consumer adoption:

### PR 1 — `feat(modules): expo-liquid-glass primitive`

- New module dir under `modules/expo-liquid-glass`
- Native Swift `LiquidGlassView` + JS wrapper + `isLiquidGlassAvailable` constant + README
- Zero consumer-side changes
- Reviewable as pure infrastructure: does the API expose the right surface?
- Mergeable on its own without any visual impact

### PR 2 — `feat(chrome): adopt Liquid Glass on iOS 26`

- Modifies `TabBar`, `AppHeader`, `NowPlayingBar`, `OfflineBanner` to wrap with the primitive
- Gates solid backgrounds on `isLiquidGlassAvailable`
- All visual change happens in this PR
- Easy to revert as a single unit if iOS 26 smoke turns up problems

PR 1 lands first, sits in `main` without affecting any user. PR 2 can be tested against a stable baseline.

## Out of scope (deferred to follow-up issues if needed after smoke)

- **Modal sheets** (`SetupSheet`, `SettingsDrawer`, `PublishFeaturedSheet`) — explicitly trimmed during brainstorm. Sheets have their own `BroadcastBackdrop` and don't benefit from glass over a dimmed parent
- **Per-surface intensity overrides** — all 4 surfaces use `regular` default for v1
- **Animated transitions when toggling glass on/off** — Apple's material handles this automatically via the host view's animation context
- **Color tint variants** (`UIGlassEffect.tint()` API) — chrome stays neutral
- **Apple's interactive behaviors** (deformation on tap, scroll-edge reactivity beyond what's automatic, tint interpolation) — file follow-up if missing after smoke
- **Crate Digger soft refresh** (#52) — separate issue, sequenced after this lands

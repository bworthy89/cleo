# Analog Midnight — App-Wide Redesign

**Goal:** Replace the current "Sonic Ether Gold" UI with the **Analog Midnight** direction from the 2026-04-17 design handoff. Lock in three structural Phase B decisions along the way: rename second tab to `you`, strip the `defaultVibe` concept end-to-end, and remove the 7-vibe color system in favor of a single amber accent.

**Source of truth:** `/Users/kari/Downloads/design_handoff_onay/README.md` and `Onay Design Review.html`. The README is the pixel spec; the HTML is the visual reference.

**Branch:** continue on `pre-baked-broadcast`.

---

## Scope summary

**In:** design tokens, fonts, grain texture, all 6 product screens (home, player, setup sheet, ask ONAY, profile, onboarding), tab bar, app icon, removal of `defaultVibe` and vibe color system.

**Out:** sound design / station ident, voice-reactive motion, onboarding content changes beyond visual polish, marketing site, TestFlight submission. Those are follow-ups.

**Not a rewrite:** business logic, engines, services, native modules, server, and test suites are untouched. This is a visual + structural refactor of the client UI layer only.

---

## Phase B structural decisions (locked)

1. **Tabs:** keep 2 tabs. Rename `(cleo)` tab label from `ONAY` to lowercase mono `you`. Route folder stays `(cleo)` to avoid expo-router churn and bundle-id coupling.
2. **Host volume mix:** move from Profile to Player screen (long-press or a single control on the now-playing surface).
3. **`defaultVibe`:** delete from `UserData`, onboarding, Profile UI, and Storage. Users pick vibe fresh each broadcast.
4. **Ask ONAY:** on Home, becomes a "peer block" — italic-serif voice, not a second amber CTA. Multi-turn chat + Publish-as-Featured preserved.
5. **Vibe colors:** drop all 7 vibe accents. Amber is the only accent. Setup sheet vibe picker becomes a typographic italic-serif list with amber selection state.

---

## Design constants (for reference during implementation)

```
bg           #0B0907   warm-biased near-black
ink          #E8E0D0   warm cream, primary text
ink-mid      rgba(232,224,208,0.55)
ink-dim      rgba(232,224,208,0.42)
amber        #E8A24B   single accent
amber-dim    rgba(232,162,75,0.38)
amber-faint  rgba(232,162,75,0.15)   hairlines

Fonts:
  Fraunces — italic 300/400 — all display, CTAs, body with warmth
  JetBrains Mono — 400/500 — labels, metadata (always tracked)

Spacing scale: 4 6 8 10 14 16 18 22 26 32 34 40 52
Type scale:    9 10 11 13 14 15 16 18 44
Radius:        0 for buttons (sharp rectangle, intentional)
Glows:
  cta     0 0 24px rgba(232,162,75,0.12), inset 0 0 24px rgba(232,162,75,0.04)
  dot     0 0 6px #E8A24B
  bg      radial-gradient(140% 60% at 50% -10%, rgba(232,162,75,0.06), transparent 70%)
```

---

## File Structure

### Create
- `src/components/Grain.tsx` — full-bleed tiled grain overlay (uses `assets/textures/grain.png`, already exists)
- `src/components/AmberCTA.tsx` — reusable amber-bordered CTA with glow + press intensify
- `src/components/HairlineRow.tsx` — row with 1px amber-faint bottom rule
- `src/components/OnAirIndicator.tsx` — 5px amber dot + glow + gentle pulse when broadcast active
- `src/components/BroadcastBackdrop.tsx` — bg + radial bloom + grain, single component wrapping every screen root

### Modify
- `src/tokens/design-tokens.ts` — full rewrite to Analog Midnight palette/scale
- `app/_layout.tsx` — swap font loader to Fraunces + JetBrains Mono
- `app/(main)/_layout.tsx` — tab label + bar styling
- `src/components/TabBar.tsx` + `TabIcon.tsx` — new visual treatment
- `src/components/AppHeader.tsx` — lowercase wordmark + on-air indicator
- `src/screens/home/HomeBroadcastScreen.tsx` — full rewrite to hifi spec
- `src/components/broadcast/SetupSheet.tsx` — typographic vibe picker, amber selection
- `src/components/broadcast/YourBroadcastSetup.tsx` — subsumed into hero + pick rows; likely deleted or reduced
- `src/components/broadcast/TuningInOverlay.tsx` — amber ring + italic serif "tuning in"
- `src/components/broadcast/FeaturedBroadcastCard.tsx` — retune to editorial row style
- `app/(main)/(broadcast)/player.tsx` — full rewrite to Analog Midnight; **keep album artwork as a hero element** (emotional anchor for discovery), italic serif title + artist, amber progress, host-volume control
- `src/screens/curate/AskOnayScreen.tsx` — retune; ONAY voice in italic serif, mono metadata
- `src/screens/settings/ProfileScreen.tsx` — retune + remove default-vibe section (host-volume section is removed atomically with Task 6, not here)
- `src/screens/onboarding/CleoOnboarding.tsx` — retune; remove default-vibe step if present
- `src/services/Storage.ts` — remove `defaultVibe` from `UserData`. `HOST_VOLUME_MIX` is **kept** (backing the new Player control in Task 6).
- `assets/icon.png`, `assets/splash-icon.png`, `assets/android-icon-*.png`, `assets/favicon.png` — regenerate for "The Glow"

### Component lifetime notes
- `SectionLabel.tsx` — survives through Tasks 4–7 (Home stops using it; `AskOnayScreen` still does). Delete only after Task 8 retunes Ask ONAY, or replace it earlier with an inline implementation if convenient.

### Remove (after Task 7 completes)
- `getVibeAccent` helper in `design-tokens.ts`
- `Colors.vibe.*` palette
- Any remaining Playfair / Inter / EBGaramond / DMMono imports
- `GlassCard.tsx`, `StationCard.tsx`, `SectionLabel.tsx` (after Task 8) if unreferenced
- `@expo-google-fonts/*` packages for retired families (package.json cleanup)

---

## Task 1 — Foundation: tokens, fonts, grain, backdrop

**Files:**
- Modify: `src/tokens/design-tokens.ts`, `app/_layout.tsx`, `package.json`
- Create: `src/components/Grain.tsx`, `src/components/BroadcastBackdrop.tsx`

**Strategy:** Add Analog Midnight tokens **alongside** legacy tokens temporarily. Legacy values stay valid until every screen has migrated. This avoids a single giant breaking commit.

- [ ] **Step 1.1** — Install fonts
  - Add `@expo-google-fonts/fraunces` and `@expo-google-fonts/jetbrains-mono` to `package.json`
  - Update `app/_layout.tsx` `useFonts` call to load `Fraunces_300Light_Italic`, `Fraunces_400Regular_Italic`, `JetBrainsMono_400Regular`, `JetBrainsMono_500Medium`
  - Keep the old font entries loaded for now so legacy screens still render during migration
  - Verify: app launches, no font-loading error

- [ ] **Step 1.2** — Rewrite `design-tokens.ts`
  - Replace `Colors` with `{ bg: '#0B0907', ink: '#E8E0D0', inkMid: ..., inkDim: ..., amber: '#E8A24B', amberDim: ..., amberFaint: ... }`
  - Keep old exports (`Surface`, `TextColors`, `accent`, etc.) as aliases pointing to new tokens so legacy consumers still compile. Mark with `@deprecated` JSDoc.
  - New `Typography`: `display` (Fraunces italic), `mono` (JetBrains Mono). Retire `body` and `cleoVoice` aliases — but keep them pointing at the new fonts so legacy calls degrade gracefully (italic serif everywhere is intentional).
  - New `Spacing`: `{ s4, s6, s8, s10, s14, s16, s18, s22, s26, s32, s34, s40, s52 }` — keep legacy `xs/sm/md/lg/xl/xxl` as aliases
  - New `Radius`: `{ none: 0, button: 0 }` — keep legacy
  - New `Glow`: `cta`, `ctaInner`, `dot`, `bgBloom`
  - New `TypeScale`: `{ s9, s10, s11, s13, s14, s15, s16, s18, s44 }`
  - Keep `getVibeAccent` for now but have it always return `amber` (single-line change; caller-side cleanup comes in Task 7)

- [ ] **Step 1.3** — `Grain.tsx`
  - `<Image source={require('../../assets/textures/grain.png')} resizeMode="repeat" style={{ position: 'absolute', top/left/right/bottom: 0, opacity: 0.06, pointerEvents: 'none' }} />`
  - Wrap with `pointerEvents="none"` at the view level so touches pass through
  - Respect `useAppActive()` — opacity is fine static, no animation

- [ ] **Step 1.4** — `BroadcastBackdrop.tsx`
  - Children + `bg` fill + `<LinearGradient>` for the amber radial bloom at the top + `<Grain />` on top
  - Accepts `style` prop for safe-area padding passthrough

**Verification:** build passes, launch app, visually confirm old screens still render (they'll look fine because aliases map to warmer tokens — that's expected drift during migration).

---

## Task 2 — Tab bar + AppHeader

**Files:** `app/(main)/_layout.tsx`, `src/components/TabBar.tsx`, `src/components/TabIcon.tsx`, `src/components/AppHeader.tsx`, `src/components/OnAirIndicator.tsx`

- [ ] **Step 2.1** — Rename second tab
  - `app/(main)/_layout.tsx`: change second tab's `title`/`label` from `ONAY` to `you`
  - Keep route folder name `(cleo)` — no file renames
  - Tab icons retire (handoff says "avoid decorative icons"). Tabs become text-only: italic-serif label + mono sub-label or just the label in mono, depending on look test during Task 2.3
  - Active tab: amber label + 1px amber underline. Inactive: ink-dim.

- [ ] **Step 2.2** — `OnAirIndicator.tsx`
  - 5px amber dot + `shadowColor amber / shadowRadius 6`
  - Pulse (1.8s ease-in-out, opacity 1 → 0.65 → 1) when broadcast is active
  - Accept `active: boolean` as a prop — caller owns the subscription (AppHeader reads from broadcast player singleton)
  - **Pulse animation must gate on `useAppActive()`** — stop the `Animated.loop` when backgrounded to respect iOS background CPU budget (CLAUDE.md convention)
  - Static when nothing is playing

- [ ] **Step 2.3** — AppHeader rewrite
  - Left: lowercase `onay` wordmark in JetBrains Mono 9/3px tracking, ink-dim
  - Right: `<OnAirIndicator /> on air · 11:47 pm` (JetBrains Mono 9/3px, ink-dim)
  - Drop avatar, drop the gold "CLEO" logo treatment
  - Screens that currently use `AppHeader` keep using it — visual only

**Verification:** launch app, confirm header renders, tap both tabs, labels swap. Start a broadcast, confirm dot pulses.

---

## Task 3 — Strip `defaultVibe` end-to-end

**Files:** `src/services/Storage.ts`, `src/screens/settings/ProfileScreen.tsx`, `src/screens/onboarding/CleoOnboarding.tsx`, `src/components/broadcast/SetupSheet.tsx`.

**Pre-step (audit):** grep for `defaultVibe` across the repo and confirm the only writers/readers are `Storage.ts`, `CleoOnboarding.tsx`, `ProfileScreen.tsx`, and `SetupSheet.tsx`. If any onboarding entry under `app/(onboarding)/` references it, add to the file list.

- [ ] **Step 3.1** — Remove from `UserData`
  - `src/services/Storage.ts` — delete `defaultVibe` from `UserData` interface
  - Any existing MMKV records with `defaultVibe` set will simply carry an unread field — no migration needed

- [ ] **Step 3.2** — Remove from onboarding
  - If `CleoOnboarding.tsx` has a "pick your default vibe" step, remove it
  - Shorten onboarding to music-auth + welcome wrap-up

- [ ] **Step 3.3** — Remove default-vibe row from ProfileScreen only
  - Delete the "Default vibe" row + picker entry
  - **Keep the host-volume row intact** — it stays until Task 6 lands the Player control atomically (avoids a 3-task gap with no way to adjust host volume)

- [ ] **Step 3.4** — Setup sheet no longer prefills
  - `SetupSheet.tsx` — vibe step starts unselected. Next button disabled until user picks.

**Verification:** fresh install flow → onboarding has no vibe step → home → "Build your broadcast" → vibe picker starts empty. Profile still shows host-volume (intentional) but no default vibe.

---

## Task 4 — Home screen rewrite

**Files:** `src/screens/home/HomeBroadcastScreen.tsx` (full rewrite), `src/components/broadcast/YourBroadcastSetup.tsx` (likely delete), `src/components/AmberCTA.tsx`, `src/components/HairlineRow.tsx`, `src/components/broadcast/FeaturedBroadcastCard.tsx`

The hifi spec in `README.md` § "Home — Tonight, a late-night broadcast" is the reference.

- [ ] **Step 4.1** — `AmberCTA.tsx`
  - Full-width `Pressable`, transparent bg, 1px amber border, 0 radius, 18px vertical padding
  - Fraunces italic 18px, 0.5px tracking, amber text, centered
  - Press intensify: border+inner-glow opacity 0.12 → 0.24 over 150ms ease-out, snap back on release
  - Haptic on press
  - Props: `label: string`, `onPress: () => void`, `accessibilityLabel: string` (required, defaults to `label` if omitted), `accessibilityHint?: string`, `disabled?: boolean`
  - `accessibilityRole="button"` baked into the component (CLAUDE.md convention)

- [ ] **Step 4.2** — `HairlineRow.tsx`
  - Flex row with `borderBottomColor: amberFaint, borderBottomWidth: 1`
  - Optional `leading` (label column), `value` (center, flex 1), `trailing` (chevron or duration)

- [ ] **Step 4.3** — Home layout
  1. `<BroadcastBackdrop>` wrapper
  2. Status strip (inherits from AppHeader but custom instance on home since the spec layout is tighter — 18px top, 26px sides)
  3. 32px gap
  4. Hero statement: 3 lines Fraunces italic 44/300, -0.8px letter-spacing, line-height 1.05
     - Line 1 "Tonight," (ink)
     - Line 2 vibe word e.g. "a late-night" (amber) — derived from current selected vibe
     - Line 3 "broadcast." (ink)
     - If no vibe picked yet, show default "a broadcast" (all ink) and skip line 2's amber
  5. Three pick rows (`HairlineRow`): `FROM / Evening Commute / ›`, `VIBE / Late Night / ›`, `LENGTH / Nine tracks · 28 min / ›`
     - Tap row → opens relevant step of `SetupSheet`
     - Values reflect current selections persisted in component state
  6. 34px gap → `AmberCTA label="Begin broadcast"`
  7. 10px gap → commitment caption: `no skips · no shuffle · sit with it` (JetBrains Mono 9/2px, ink-dim, centered)
  8. 52px gap → section label `earlier · 24h` (mono 10/2.5px, ink-dim, lowercase)
  9. Recent reel rows (`HairlineRow` with top rule): reel number (mono 10 amber-dim, e.g. `042`), italic 16 title, mono 10 duration
     - **Title source:** `Manifest` has `playlistId` but no `playlistName`. Resolve client-side: look up `entry.manifest.playlistId` in `getCachedPlaylists()` → use the playlist's `name`. Fallback chain for misses (deleted playlists, featured broadcasts with `playlistId: null`, cache eviction): `<vibe> · <N> tracks` (e.g. `Late Night · 9 tracks`). Implement as `titleFor(entry)` helper colocated with `HomeBroadcastScreen`.
     - Reel number: use entry index in the 24h window (newest = `01`, increasing) in mono 10 amber-dim. Keep it simple — no persisted counter; reset visually each 24h as entries age out.
  10. Featured broadcasts: second section below recents, label `tonight on onay` (same type style as earlier · 24h), list rows same row anatomy
  11. **Ask ONAY peer block** at bottom — italic serif voice, not amber-bordered
      - Small "ONAY" label in mono amber-dim
      - Italic serif line: `"Want something different tonight? Ask me."`
      - Tap → navigates to Ask ONAY screen
      - No button, just a tappable block with a thin amber-faint top hairline
  12. Bottom safe-area padding for tab bar

- [ ] **Step 4.4** — `FeaturedBroadcastCard.tsx` rewrite
  - Not actually a card anymore — it's a `HairlineRow`
  - Leading: 28px mono 10 amber-dim featured index (`T01`, `T02`, `T03`)
  - Value: italic serif 16 title
  - Trailing: duration mono 10
  - Tap → play (same handler as before)

**Verification:** load home with no broadcasts, with 1 recent, with 10 recents, with featured list. Confirm scroll, tap each row, CTA opens sheet or starts broadcast.

---

## Task 5 — Setup sheet + typographic vibe picker

**Files:** `src/components/broadcast/SetupSheet.tsx`, `src/components/VibePicker.tsx` (rewrite or replace)

- [ ] **Step 5.1** — Sheet chrome
  - Black bg, thin amber-faint top border, drag handle in amber-faint
  - Step indicator: mono 10, amber-dim `01 / 03`
  - Step title: italic serif 22, ink

- [ ] **Step 5.2** — Playlist step
  - List of playlists as `HairlineRow`s — italic 16 title + mono 10 track count
  - Tap selects + advances

- [ ] **Step 5.3** — Vibe step (typographic picker)
  - Vertical list of 7 vibes
  - Each row: italic serif 18 label (e.g. `Late Night`), left-aligned, 16px vertical padding
  - Selected: amber text + tiny amber dot (`·`) in mono at the right edge
  - Unselected: ink-mid
  - No color swatches, no illustrations, no cards

- [ ] **Step 5.4** — Length step
  - Three options: `Quick · 4 tracks · 12 min`, `Standard · 9 tracks · 28 min`, `Long · 16 tracks · 48 min`
  - Same typographic row treatment
  - Primary `AmberCTA` at bottom: `Begin broadcast`

**Verification:** open sheet from home, step through all 3 steps, confirm back/forward, confirm selection persists on re-open.

---

## Task 6 — Player screen

**Files:** `app/(main)/(broadcast)/player.tsx`, `src/components/broadcast/TuningInOverlay.tsx`, `src/screens/settings/ProfileScreen.tsx` (host-volume row removed here, atomic with new Player control)

The handoff README excludes the player on purpose ("explored separately; not included here"). The design lead is inferred from the Analog Midnight system, **but album artwork stays as a hero element** — artwork + first-time discovery is an emotional anchor for a music-discovery app; the austere text-only treatment belongs on Home / Setup / Ask ONAY, not the listening surface.

- [ ] **Step 6.1** — Layout
  - `<BroadcastBackdrop>` (bg + bloom + grain at 6%)
  - Top: mono 9/3px status strip — left `now playing · reel 042`, right `on air · 11:47 pm` (live clock)
  - **Hero: album artwork** — centered, square, ~72% of viewport width, no rounded corners (intentional — rectangle matches the editorial tone), subtle amber 1px border at `amberFaint`, no drop shadow. Grain overlay continues over the artwork at the same 6% opacity so it feels of-a-piece with the bg.
    - Source: existing artwork fetch via MusicKit on the current track. Keep the existing fetch logic; retain fallback to a plain ink-dim square if artwork is missing.
  - Below artwork (24px gap): italic serif 22 track title (Fraunces 300 italic), single line with ellipsis; italic 16 ink-mid artist name below (8px gap)
  - 24px gap, then 1px amber-faint hairline, then mono 10 metadata row — `01 / 09 · 03:42 / 04:15`
  - Thin progress bar: 1px ink-dim track, amber fill (no gradient, solid amber)
  - Controls: sparse. `pause / resume` as italic serif 18 tappable text, centered. No skip buttons (product rule: no skips).
  - Host volume mix: `HairlineRow`-style row below controls — leading mono `ONAY VOLUME`, trailing subtle ink-dim slider track with amber thumb. Reads/writes `HOST_VOLUME_MIX` via `Storage.ts` (same key as before, same persistence).
  - Bottom: `end broadcast` in mono 10 amber-dim, tappable

- [ ] **Step 6.2** — ProfileScreen host-volume cleanup
  - Delete host-volume row from `ProfileScreen.tsx`
  - Host-volume control now lives exclusively on Player (Step 6.1)
  - Atomic with Step 6.1 — land in the same commit

- [ ] **Step 6.3** — TuningInOverlay
  - Black screen + grain + single pulsing amber ring (opacity 0.3 → 0.8 → 0.3 over 1.6s)
  - Ring pulse gated on `useAppActive()` (same CPU discipline as `OnAirIndicator`)
  - Italic serif 22 centered: `tuning in…` (italic, lowercase, intentional)
  - Fades out when cold open starts playing

**Verification:** start broadcast → tuning in overlay → player renders with artwork + title + progress → tap pause, confirm it pauses, resume → adjust host-volume slider, confirm it persists across broadcasts → end broadcast returns to home. Profile no longer shows host-volume.

---

## Task 7 — Strip vibe color system

**Files:** `src/tokens/design-tokens.ts`, `src/components/broadcast/SetupSheet.tsx`, any `getVibeAccent` callers

- [ ] **Step 7.1** — Find all consumers
  - `grep -rn 'getVibeAccent\|Colors.vibe'` — audit hits
  - Task 4 home + Task 5 sheet + Task 6 player should already no longer reference vibe accents after rewrites. This task is cleanup.

- [ ] **Step 7.2** — Delete
  - Remove `Colors.vibe` and `getVibeAccent` from `design-tokens.ts`
  - Delete any surviving imports

**Verification:** `grep` returns zero hits. Build passes.

---

## Task 8 — Ask ONAY screen retune

**Files:** `src/screens/curate/AskOnayScreen.tsx`

- [ ] **Step 8.1** — Apply Analog Midnight language
  - `<BroadcastBackdrop>`
  - Header: lowercase mono `ask onay` + subtle description in italic serif 15
  - Chat transcript: ONAY messages in italic serif 16 ink, user messages in mono 13 ink-mid (visual asymmetry = ONAY speaks, you prompt)
  - Input: thin amber-faint hairlines top + bottom, italic placeholder
  - Submit: small amber text `send ›`
  - Suggested playlist: italic serif track list, each row a `HairlineRow`
  - Primary `AmberCTA`: `Take it live`
  - Curator-only: second `AmberCTA` variant in a subtle form: `Publish to onay` — maybe mono caption `curator only` underneath

- [ ] **Step 8.2** — Preserve
  - Multi-turn chat state machine
  - Publish-as-Featured logic
  - Curator gate (UI + server-side)

**Verification:** send a message, confirm LLM response renders, take it live successfully, publish-as-featured still gated.

---

## Task 9 — Profile + onboarding retune

**Files:** `src/screens/settings/ProfileScreen.tsx`, `src/screens/onboarding/CleoOnboarding.tsx`

- [ ] **Step 9.1** — ProfileScreen
  - `<BroadcastBackdrop>`
  - Section label `your account` (mono 10/2.5px amber-dim)
  - `HairlineRow`s for: name, email, Apple Music status, broadcast history (link to recents), sign out
  - No default-vibe (Task 3), no host-volume (moved in Task 6)
  - Settings entry point discoverable — `you` tab is the gateway

- [ ] **Step 9.2** — Onboarding
  - Welcome: hero statement in same treatment as Home (italic 44/300)
  - Music auth: italic serif pitch + single `AmberCTA`
  - Cleo setup: retune if still used; otherwise delete

**Verification:** logout, complete onboarding fresh, confirm visual consistency + navigation.

---

## Task 10 — App icon "The Glow"

**Files:** `assets/icon.png`, `assets/splash-icon.png`, `assets/android-icon-*.png`, `assets/favicon.png`, `app.json`

- [ ] **Step 10.1** — Generate master icon
  - 1024×1024 radial-gradient tile per README § "Icon #01 The Glow — implementation spec"
  - Orb center (50%, 50%), ~450px diameter, radial amber fill + 80px amber glow (scaled to 1024)
  - Grain overlay at 12% opacity, overlay blend, baked into PNG
  - Export flat PNG (iOS system handles the squircle mask)

- [ ] **Step 10.2** — Derive platform sizes
  - Let Expo/EAS generate from `icon.png` for both platforms, OR hand-derive the iOS icon set (180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20)

- [ ] **Step 10.3** — Splash screen
  - New `splash-icon.png`: same orb centered on bg #0B0907
  - `app.json` `splash.backgroundColor` → `#0B0907`

- [ ] **Step 10.4** — Android adaptive icon
  - `android-icon-background.png` → solid `#0B0907`
  - `android-icon-foreground.png` → orb + grain
  - `android-icon-monochrome.png` → single-color orb outline

**Verification:** `npx expo run:ios --device` — confirm home-screen icon renders as warm amber orb. Splash transitions cleanly to app.

---

## Task 11 — Cleanup pass

**Files:** `package.json`, `src/tokens/design-tokens.ts`, `app/_layout.tsx`, unused components

- [ ] **Step 11.1** — Audit legacy font imports
  - `grep -rn 'PlayfairDisplay\|Inter_\|EBGaramond\|DMMono'` → delete all
  - Remove from `useFonts` in `app/_layout.tsx`
  - Remove packages from `package.json`

- [ ] **Step 11.2** — Remove deprecated token aliases
  - Delete `Surface`, `TextColors`, `accent`, legacy `Spacing`/`Radius` aliases
  - Fix any compile errors

- [ ] **Step 11.3** — Delete unused components
  - Check usage of `GlassCard.tsx`, `StationCard.tsx`, `CleoOrb.tsx`, `CleoPulseDot.tsx`, `CleoSpeakingOverlay.tsx`, `WaveformBars.tsx` — delete any with zero references

- [ ] **Step 11.4** — Typecheck + full manual smoke
  - `npx tsc --noEmit`
  - Full walk: launch → onboarding → home → sheet → broadcast → pause/resume → end → recents → featured → ask ONAY → profile → sign out

---

## Sequencing + checkpoints

```
Task 1 (foundation) → commit checkpoint: app builds, no visual regression
Task 2 (tab + header) → commit: new chrome live, old screens still render
Task 3 (defaultVibe strip) → commit: data model simplified
Task 4 (home) → commit: new home live; this is the biggest visible jump
Task 5 (setup sheet) → commit: picker retuned
Task 6 (player) → commit: player retuned, host volume lives here
Task 7 (vibe color cleanup) → commit: token layer simplified
Task 8 (ask ONAY) → commit
Task 9 (profile + onboarding) → commit
Task 10 (app icon) → commit
Task 11 (cleanup) → commit
```

Keep commits shippable — every task ends in a working app. Screen rewrites don't need to land in a single commit but should not leave a mixed-token state mid-commit.

---

## Out-of-scope / deferred

- Voice-reactive motion on the player (Phase C)
- Sound design / station ident (Phase C)
- Time-synced lyrics on the player (Phase C — discussed but scoped out; artwork carries the emotional anchor for this release)
- Grain density + animation tempo per vibe (nice-to-have; add only if the typographic vibe picker feels undercooked)
- Deep link redesign from share sheets / universal links
- Marketing site, App Store screenshots — separate deliverable once UI lands

---

## Known risks

- **Font loading regression:** swapping the `useFonts` map is the only way a fresh install can fail to boot. Keep old entries during Tasks 1–10, remove in Task 11.
- **Grain overdraw on low-end devices:** the grain image is already in repo; if tiled image at full screen impacts scrolling, switch to a `react-native-canvas` or native shader later. Not blocking.
- **Tab label visual weight:** text-only tabs are unusual on iOS. If user testing shows confusion, add a tiny mono glyph under each label (`· / you`). Decide after Task 2 landing.
- **Player host-volume control:** the Analog Midnight system resists slider affordances (they're "streaming-app" shaped). A minimal hairline row + thumb is the proposed compromise. Revisit if it doesn't feel right after Task 6.
- **Player artwork is a design outlier:** Home/Setup/Ask ONAY are austere text-first; the player has artwork. The visual language still holds (no rounded corners, amber-faint border, grain overlay continues), but if the artwork feels tonally disconnected after Task 6 we can experiment with a duotone filter (amber + ink) to pull it into the palette. Not part of the initial implementation — ship raw artwork first, tune later if needed.
- **App icon compatibility:** iOS renders the squircle mask automatically, but Android adaptive icon spec expects foreground padded in a safe zone. Verify on a physical Android device or drop Android support for the re-icon until that ships.

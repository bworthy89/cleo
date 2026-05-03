---
name: ONAY
description: Pre-baked AI radio, framed like a record sleeve.
colors:
  bg: "#0B0907"
  bg-deep: "#050403"
  ink: "#F4ECDC"
  ink-mid: "#F4ECDCCC"
  ink-dim: "#F4ECDC94"
  ink-ghost: "#F4ECDC33"
  amber: "#E8A24B"
  amber-dim: "#E8A24B8C"
  amber-faint: "#E8A24B26"
  oxblood: "#A43A2E"
  oxblood-dim: "#A43A2E8C"
  paper: "#F2E7CF"
  paper-ink: "#2A1510"
  rule: "#F4ECDC42"
  rule-strong: "#F4ECDC80"
typography:
  display:
    fontFamily: "Anton, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.05em"
  display-stamp:
    fontFamily: "Anton, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.1em"
  body:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "italic"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    letterSpacing: "0.2em"
  catalog-num:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.2em"
rounded:
  none: "0px"
  hairline: "2px"
  full: "9999px"
spacing:
  s2: "2px"
  s4: "4px"
  s6: "6px"
  s8: "8px"
  s10: "10px"
  s12: "12px"
  s14: "14px"
  s16: "16px"
  s20: "20px"
  s24: "24px"
  s32: "32px"
  s40: "40px"
  s48: "48px"
  s60: "60px"
  s72: "72px"
components:
  stamp-button-amber:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.amber}"
    typography: "{typography.display-stamp}"
    rounded: "{rounded.none}"
    padding: "18px 20px 16px"
  stamp-button-oxblood:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.oxblood}"
    typography: "{typography.display-stamp}"
    rounded: "{rounded.none}"
    padding: "18px 20px 16px"
  catalog-row:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "14px 0"
  section-marker:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "0 0 6px"
  liner-notes:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink-mid}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
  on-air-dot:
    backgroundColor: "{colors.oxblood}"
    textColor: "{colors.oxblood}"
    rounded: "{rounded.full}"
    size: "5px"
  hairline-divider:
    backgroundColor: "{colors.rule}"
    rounded: "{rounded.none}"
    height: "1px"
---

# Design System: ONAY

## 1. Overview

**Creative North Star: "The Catalog Sleeve"**

ONAY is dressed like the back of a record. The app frames the broadcast
the way liner notes frame a pressing: a warm-black sleeve, cream type
set in Anton at the top of every plate, JetBrains Mono catalog numbers
running in the gutter, Fraunces italic for the host's voice. Amber and
oxblood are not decoration; they are the only two ink colors on the
press. Amber means signal (live, glowing, ready). Oxblood means stamp
(authority, the editorial mark). Everything else is cream on warm
black or hairlines that came off a metal rule.

This system explicitly rejects three families. It is not a Spotify-skin
card grid (Yoodio); cards in ONAY are bordered plates with corner ticks,
never rounded containers stacked in a uniform feed. It is not the bright,
peppy chrome of a morning-show app (Radiant); the affect is unhurried,
the type is condensed, the easing is exponential, the host has the
patience to leave a beat of silence. It is not "AI radio" futurism;
there are no synth-glow gradients, no neon, no glassmorphism, no robot
iconography, no "Powered by AI" badges. The visual register is editorial
print, not app chrome.

The system commits to scarcity. One display face, one body face, one
mono. Two colors of ink. Radius 0 almost everywhere. Most surfaces are
flat; the only shadows in the system are signal cues (the on-air pulse,
the CTA's ambient amber haze) and the ink-stamp displacement on
oxblood plates. Variation comes from spacing rhythm and typographic
hierarchy, not from an ever-growing component library.

**Key Characteristics:**

- Warm-black (`#0B0907`) base, never pure black, tinted toward the amber/oxblood family.
- Three faces only: Anton condensed display, Fraunces italic body, JetBrains Mono labels.
- Sharp corners; `rounded.none` is the default for plates, buttons, sheets, cards.
- Two-ink rule: amber for signal, oxblood for stamp; cream is "ink" not a third color.
- Hairlines, not dividers: 1px rules at 26%-50% cream alpha.
- Mostly flat. Shadows only as signal (on-air glow, CTA ambient haze, ink-stamp offset).
- Editorial gestures everywhere: corner ticks, catalog numbers, sleeve framing, mono metadata.

## 2. Colors

A two-ink press on warm black. Cream is the ink; amber is the signal;
oxblood is the editorial stamp. Nothing else is allowed to talk.

### Primary

- **Amber** (`#E8A24B`): the signal color. Used for live state, the
  primary CTA stroke (amber stamp button), the catalog-number prefix on
  section headers, and the on-air glow's ambient halo. Never used as a
  surface fill. Per the One Voice Rule below, amber stays under ~10% of
  any screen's ink.
- **Oxblood** (`#A43A2E`): the editorial stamp. Used for the on-air
  dot, the secondary CTA stroke (oxblood stamp button), and any
  authoritative mark that wants the weight of a record-label seal.
  Never as a body-text color; amber and ink share that load.

### Neutral

- **Warm Black** (`bg` `#0B0907`): the sleeve. The default surface for
  every screen, plate, and sheet. Tinted toward the amber/oxblood
  family by ~3% chroma so it reads warm, not industrial.
- **Deeper Warm Black** (`bg-deep` `#050403`): used only as the shadow
  color in the oxblood ink-stamp offset and as the ground beneath the
  amber bloom gradient. Never as a surface fill.
- **Cream** (`ink` `#F4ECDC`): the ink. Default text color, default
  border color, default hairline color (with alpha). Cream at 100% is
  reserved for primary text and the corner ticks; alpha steps step down
  to mid (80%, secondary text), dim (58%, metadata, disabled values),
  ghost (20%, decoration).
- **Paper Stock** (`paper` `#F2E7CF`): inverted surface for editorial
  inserts (library card, share artwork). Pairs with `paper-ink`
  (`#2A1510`) for body text on those surfaces. Used rarely.

### Named Rules

**The Two-Ink Rule.** There are exactly two ink colors on the press:
amber and oxblood. Cream is not an ink, it is the substrate; warm
black is the sleeve. Forbidden to introduce a third accent (no teal
"info", no green "success", no blue "link"). Status is communicated by
amber (active, present) or oxblood (committed, stamped). Errors borrow
oxblood. There are no others.

The Two-Ink Rule applies to **UI surfaces**: chrome, controls, status,
type, hairlines, plates, sheets. It does **not** apply to simulated
physical artifacts the app renders inside the broadcast experience.
The placeholder album-art system (`SleeveArt`) draws from a fixed
8-palette set (oxblood, deep teal, mustard, plum, bottle green, rose,
cognac, navy) precisely because record sleeves on a shelf are
chromatically varied; muting them to amber + oxblood would lose the
"records, not avatars" reading. Treat those palettes as scoped to
SleeveArt; never harvest them into UI tokens.

**The One Voice Rule.** Amber is the signal color and stays under
~10% of any screen's visible ink. Its rarity is the point. If amber
covers more than a tenth of a screen, the screen is overstated; pull
back.

**The No-Pure-Black Rule.** `#000` is forbidden. Every "black" in this
system is `#0B0907` (`bg`) or `#050403` (`bg-deep`). Pure black sits
cold and digital next to cream and amber; the warm tint is what makes
the system read like a press, not a screen.

## 3. Typography

**Display Font:** Anton (`Anton_400Regular`), condensed sans-serif, single weight.
**Body Font:** Fraunces Italic (`Fraunces_400Regular_Italic`, with `Fraunces_300Light_Italic` for the lighter voice).
**Label/Mono Font:** JetBrains Mono (`JetBrainsMono_400Regular`, `JetBrainsMono_500Medium`).

**Character.** Anton is poster-condensed metal type, set in caps with
generous tracking; it carries every title, CTA label, and section
header. Fraunces in italic is the host's voice, the liner-notes voice,
the "ONAY says" register; it appears anywhere copy speaks rather than
labels. JetBrains Mono is the gutter, the catalog number, the
metadata, the timestamp; it is always uppercase with `0.2em`
letter-spacing and small (9px-12px). The pairing reads as ink-press
metal display + handwritten margin annotation + typewriter caption,
not as "tech sans + readable serif."

### Hierarchy

- **Display (Anton)** (`400`, sizes 20px-76px in `TypeScale`, `lineHeight: 1.2`, `letterSpacing: 0.05em-0.1em`): titles,
  CTA labels, the value column of catalog rows. Always uppercase. Never below
  16px. Anton's cap-height clips at tight line-boxes on iOS, so explicit
  `lineHeight: 1.2x fontSize` is required on every display run.
- **Body (Fraunces Italic)** (`400`, 13px-15px, `lineHeight: 1.5`, italic
  always on): host commentary, liner-note captions, sheet copy, the
  "ONAY speaks" block. Body line length capped at 65ch-75ch. Light
  weight (`300`) reserved for hero subtitles only.
- **Label (JetBrains Mono)** (`400`, 9px-12px, `letterSpacing: 0.2em`,
  uppercase): row labels (FROM / VIBE / LENGTH), catalog numbers
  (B-01), side metadata (FROM YOUR LIBRARY), timestamps, ONAY
  attribution, catalog-prefix Med weight (`500`) for emphasis.
- **Catalog number** (Mono `500`, 10px, amber-dim color): the small
  prefix that sits before every Section Marker title. Always
  amber-dim (`#E8A24B8C`), never full amber, because the title carries
  the signal weight, not the prefix.

### Named Rules

**The Anton Cap-Height Rule.** Every Anton run on iOS sets `lineHeight`
to ~1.2x its `fontSize` explicitly. The cap-height clips top-of-glyph
at tight line-boxes. Forgetting this drops the top off "ONAY" and
"DROP THE NEEDLE" silently.

**The Three-Face Rule.** Anton, Fraunces Italic, JetBrains Mono.
Three. Not "Inter as a fallback when those don't load," not "system
sans for chrome." Three. Fallbacks resolve to the system serif/sans
family, but new copy is never authored against a fourth face.

**The All-Caps-Mono Rule.** Mono is always uppercase, always
letter-spaced 0.2em-0.25em, always 9px-12px. Mono in mixed case at
14px+ reads like code, which is the wrong register.

## 4. Elevation

This system is flat by default. Surfaces sit at the same depth as the
backdrop, separated by hairline rules and corner ticks instead of
shadows. Three exceptions exist, and they are signal cues, not
material elevation.

### Shadow Vocabulary

- **CTA ambient haze** (`shadow: 0 0 24px rgba(232, 162, 75, 0.12)`):
  ambient amber halo around the primary play button when it's the
  next action. Diffuse and low-opacity, so it reads as "this is hot"
  rather than "this is lifted." Used only on the active CTA, never on
  a static button at rest.
- **On-air pulse glow** (`shadow: 0 0 6px rgba(164, 58, 46, 1)`): hard
  oxblood haze around the 5px on-air dot, animated 1.0 to 0.65 to 1.0
  opacity over 1.8s. Structural, not ambient: this glow says "the
  broadcast is live right now."
- **Oxblood ink-stamp displacement** (`shadow: 2px 2px 0 #050403`):
  hard, no-blur offset under oxblood plates. Reads as a wet ink stamp
  pressed into the sleeve, not as a card lifted off a surface. Use only
  on oxblood components, never on amber or cream.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat. Cards do not float.
Plates do not lift on hover. The three shadows above are the entire
elevation vocabulary; anything else (Material elevation tokens,
Tailwind shadow scales, blurred glassmorphism panels) is forbidden.

**The Stamp-Not-Emboss Rule.** When a shadow is needed, it goes
*flat-offset* (the oxbloodStamp ink-press), never *soft-blurred*
(the SaaS card hover). Stamps press *into* the sleeve; embossed cards
lift *off* it. ONAY only stamps.

## 5. Components

The component library is small on purpose. Most screens are composed
of plates, hairlines, and labels; new screens should reach for these
seven primitives before inventing something.

**Component philosophy: catalog-plate confidence.** Every component
reads like a stamped catalog plate: a bordered rectangle, mono label
on top, condensed display below, hairline rule beneath. The interface
asserts; it does not ingratiate. Borders are sharp (radius 0); strokes
are deliberate (1px-1.5px); decoration only appears when it serves
identification (corner ticks, catalog numbers, ONAY attribution).

### Buttons

- **Shape:** flat rectangle, **`rounded.none`** (0px). Borders 1.5px,
  amber or oxblood depending on kind. Four corner Ticks bite into the
  border at each corner so the plate reads as cataloged metal, not as
  a CSS button.
- **Primary (`stamp-button-amber`):** amber 1.5px stroke on `bg`,
  amber Anton label (20px, letter-spacing 0.1em, lineHeight 24px),
  optional mono sub-label (`ink-dim`, 9px, letter-spacing 0.2em),
  trailing right-arrow `->` rendered in Anton at 24px. Padding
  `18px 20px 16px 20px`.
- **Secondary (`stamp-button-oxblood`):** identical geometry, oxblood
  stroke and label instead of amber. Used for editorial actions
  (publish featured, curator-only flows), not for "secondary" in the
  SaaS sense (cancel, dismiss).
- **The play strip ("DROP THE NEEDLE"):** *not* a StampButton. It is a
  bespoke filled oxblood plate that spans the width of its parent,
  with no corner ticks. Documented separately because the geometry is
  intentionally different from the catalog-stamp pattern.
- **States:** pressed = `opacity: 0.8`. No hover (touch-first). Focus
  ring inherited from RN focus model; explicit focus styling pending.
- **Press feedback:** every press fires a `Haptics.impactAsync` (Medium
  for stamp buttons, Light for catalog rows). The press is felt before
  it is seen.

### Catalog Rows

- **Style:** mono label (left, 56px fixed width, 9px, `ink-dim`,
  `letterSpacing: 0.2em`), Anton value (center, 16px, `ink`,
  `letterSpacing: 0.04em`), trailing arrow `->` (Anton 18px,
  `ink-dim`).
- **Divider:** 0.5px hairline at `rule` (`#F4ECDC42`), full-width
  beneath each row.
- **Padding:** vertical 14px, no horizontal padding (parent owns
  gutters).
- **States:** pressed = `opacity: 0.75`. Disabled = render the row
  without `Pressable`. Empty value = render `placeholder` in
  `ink-dim`.

### Section Markers

- **Style:** Mono catalog number (10px, `amber-dim`, `letter-spacing:
  0.2em`) + Anton title (22px, `ink`, `letterSpacing: 0.025em`,
  `lineHeight: 26px`) on the left, baseline-aligned with `gap: 10px`.
  Optional mono side label (9px, `ink-dim`, `letter-spacing: 0.2em`)
  on the right.
- **Divider:** 1px hairline at `rule-strong` (`#F4ECDC80`)
  flush-bottom, with 6px padding above the rule.
- **Spacing:** 32px above, 14px below.
- **The Section Marker is the only way to title a section.** Do not
  reintroduce the legacy "small-caps amber label + 2x40 gold bar."

### Liner Notes (the "ONAY speaks" block)

- **Style:** Fraunces italic body (15px, `ink-mid`, `lineHeight:
  22.5px`) followed by mono attribution (9px, `oxblood`, `letter-spacing:
  0.25em`, prefixed with `--`).
- **Container:** flat `bg`, no border, no shadow. The block is
  identified by its typography (Fraunces italic + mono attribution),
  not by chrome.
- *Current implementation has a 2px oxblood `border-left` as a margin
  rule. This is a documented violation of the No-Side-Stripe Rule
  below and is scheduled for removal. Replace with full hairline
  border + leading "--" mark in the attribution.*

### On-Air Indicator

- **Shape:** 5x5px oxblood circle (`rounded.full`).
- **Glow:** 6px hard oxblood haze, opacity 1.0 -> 0.65 -> 1.0 over
  1.8s. Loop pauses when `useAppActive()` reports backgrounded.
- **Idle:** 5x5px `ink-dim` circle, no glow, no animation.
- **Used:** in the app header beside "ONAY" wordmark, in the player's
  status strip, in any list row that represents a live broadcast.

### Tick

- **Shape:** 10x10px corner-bite that sits on the corner of any
  bordered surface. Two adjacent borders at 1.5px in the surface's
  stroke color, with a `bg`-colored fill that "bites" the parent
  border so the corner reads as nicked, not framed.
- **Used:** all four corners of every StampButton. Never on cards,
  inputs, or sheets; the Tick is the StampButton's signature.

### Backdrop

- **Composition:** `BroadcastBackdrop` is the root of every screen.
  Stack: `bg` fill -> `AMBloom` linear gradient (vertical
  approximation of a radial amber bloom from top center, three stops:
  `#E8A24B19` -> `#E8A24B0A` -> `#0B0907`) -> 6%-opacity grain overlay
  (`Grain` component). Children sit above all three.
- **Forbidden:** painting a solid background that covers the bloom.
  The amber top band is the visual anchor; opaque fills break it.

## 6. Do's and Don'ts

### Do:

- **Do** use exactly two ink colors: amber (`#E8A24B`) for signal,
  oxblood (`#A43A2E`) for stamp. Cream is the substrate, not an ink.
- **Do** set every Anton run with explicit `lineHeight: 1.2 * fontSize`
  on iOS (the cap-height clips otherwise).
- **Do** use Pressable with `accessibilityLabel` + `accessibilityRole`
  on every interactive element. Haptics on every tap (Medium for
  stamps, Light for rows).
- **Do** wrap every screen root in `BroadcastBackdrop` so the amber
  bloom + grain layer composes correctly underneath.
- **Do** use a Section Marker to title every list section: catalog
  number + Anton title + hairline rule + optional side label.
- **Do** prefer hairlines (1px at 26%-50% cream alpha) over dividers,
  spacing breaks, or background-tint zones.
- **Do** pause every `Animated.loop` on `useAppActive() === false` so
  the iOS background CPU budget (48s/60s) is not blown.
- **Do** keep amber under ~10% of any screen's visible ink (the One
  Voice Rule).
- **Do** use the StampButton's four corner Ticks. They are the
  signature; rounded-corner buttons without ticks are off-system.

### Don't:

- **Don't** use `#000` or `#fff` anywhere; warm-tint every neutral
  toward the amber/oxblood family.
- **Don't** introduce a third accent color. No teal "info", no green
  "success", no blue "link". Status is amber or oxblood. Errors borrow
  oxblood.
- **Don't** revive per-vibe accent colors (`Colors.vibe.*`,
  `getVibeAccent()`). Every vibe is amber. The unification was
  deliberate (commit `d7193096`); reintroducing it is a regression.
- **Don't** use side-stripe borders (`border-left` or `border-right`
  greater than 1px as a colored accent). The current `LinerNotes` 2px
  oxblood `border-left` is a known violation and is scheduled for
  removal; do not propagate the pattern to new components.
- **Don't** ship Spotify-skin card grids. Cards in ONAY are bordered
  plates with corner ticks, not rounded containers stacked in a uniform
  feed (the Yoodio anti-reference).
- **Don't** ship bright, peppy chrome: rounded buttons with gradient
  fills, breezy SaaS sans, friendly emoji microcopy. The host is
  unhurried; the chrome should be too (the Radiant anti-reference).
- **Don't** ship "AI radio" futurism: synth-glow gradients, neon
  accents, glassmorphism, robot-host iconography, "Powered by AI"
  badges, hero-metric dashboards.
- **Don't** add rounded corners to plates, buttons, or sheets.
  `rounded.none` is the default; `rounded.full` is for the on-air dot
  and any other deliberately circular element.
- **Don't** introduce soft drop shadows under cards or hover-lifts on
  surfaces. The only shadows in the system are the CTA ambient haze,
  the on-air pulse glow, and the oxblood ink-stamp displacement.
  Anything else lifts the surface off the sleeve, which is wrong.
- **Don't** mix `Animated.loop` bounce or elastic easing into transitions.
  Easing is exponential ease-out (`Easing.out(Easing.exp)`); bouncy
  transitions break the unhurried register.
- **Don't** use a fourth typeface, even as a "fallback." Anton,
  Fraunces Italic, JetBrains Mono. System serif/sans are acceptable
  only as graceful-degradation fallbacks during font load, never as
  authored choices.
- **Don't** title sections with the legacy small-caps amber label or
  the 2x40 gold bar. Use Section Marker.
- **Don't** wrap everything in a card. Most surfaces are flat and
  framed by hairlines, not by bordered containers.

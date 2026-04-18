// design-tokens.ts — Onay "Crate Digger" design system.
//
// Evolution of the Analog Midnight palette into a late-night record-shop
// aesthetic: warm black base, amber as a signal, oxblood as the primary
// editorial stamp, cream as the surface ink. Anton (condensed display)
// replaces Fraunces for poster/headline roles; Fraunces italic remains
// the liner-notes voice.
//
// Primary exports: `AM` (palette), `Fonts`, `TypeScale`, `Space`,
// `Radius`, `Halftone`, `AMGlow`, `AMBloom`. Legacy aliases
// (`Colors`, `Typography`, `Surface`, `Spacing`, `TextColors`, `Radius`)
// remap to the new palette for surfaces that haven't yet been rewritten.
//
// ───────────────────────── Primary tokens ─────────────────────────

export const AM = {
  // Base — warm black
  bg:         '#0B0907',
  bgDeep:     '#050403',

  // Ink — cream, the text/stroke color on dark surfaces
  ink:        '#E8E0D0',
  inkMid:     'rgba(232, 224, 208, 0.62)',
  inkDim:     'rgba(232, 224, 208, 0.38)',
  inkGhost:   'rgba(232, 224, 208, 0.12)',

  // Amber — late-night signal, secondary accent
  amber:      '#E8A24B',
  amberDim:   'rgba(232, 162, 75, 0.55)',
  amberFaint: 'rgba(232, 162, 75, 0.15)',

  // Oxblood — record-label red, primary editorial stamp
  oxblood:    '#A43A2E',
  oxbloodDim: 'rgba(164, 58, 46, 0.55)',

  // Cream + paper — inverted surfaces (library card etc.)
  cream:      '#E8E0D0',
  paper:      '#F2E7CF',
  paperInk:   '#2A1510',

  // Hairline rules
  rule:       'rgba(232, 224, 208, 0.18)',
  ruleStrong: 'rgba(232, 224, 208, 0.38)',
} as const;

export const Fonts = {
  display:     'Anton_400Regular',                // condensed poster face
  displayThin: 'Anton_400Regular',                // kept for legacy alias
  serif:       'Fraunces_400Regular_Italic',      // liner-notes voice
  serifReg:    'Fraunces_400Regular_Italic',
  serifThin:   'Fraunces_300Light_Italic',
  mono:        'JetBrainsMono_400Regular',
  monoMedium:  'JetBrainsMono_500Medium',
} as const;

export const TypeScale = {
  s8: 8, s9: 9, s10: 10, s11: 11, s12: 12, s13: 13, s14: 14, s15: 15,
  s16: 16, s18: 18, s20: 20, s22: 22, s26: 26, s28: 28, s30: 30,
  s32: 32, s36: 36, s42: 42, s44: 44, s56: 56, s76: 76,
} as const;

export const Space = {
  s2: 2, s4: 4, s6: 6, s8: 8, s10: 10, s12: 12, s14: 14, s16: 16,
  s18: 18, s20: 20, s22: 22, s24: 24, s26: 26, s30: 30, s32: 32,
  s34: 34, s40: 40, s48: 48, s52: 52, s60: 60, s72: 72,
} as const;

export const AMGlow = {
  cta: {
    shadowColor: AM.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  dot: {
    shadowColor: AM.oxblood,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  oxbloodStamp: {
    shadowColor: AM.bgDeep,
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
} as const;

// Background radial amber bloom — LinearGradient stand-in (RN has no radial).
// Approximates `radial-gradient(ellipse 140% 60% at 50% 0%, amber-faint, transparent 70%)`.
export const AMBloom = {
  colors: ['rgba(232, 162, 75, 0.10)', 'rgba(232, 162, 75, 0.04)', 'rgba(11, 9, 7, 0)'] as const,
  locations: [0, 0.4, 0.7] as const,
  start: { x: 0.5, y: 0 },
  end:   { x: 0.5, y: 0.6 },
} as const;

// Halftone dot pattern — used under oxblood plates/panels for editorial grit.
// Consumed by `Halftone` component as a data URI.
export const HALFTONE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='6' height='6'>
  <circle cx='1' cy='1' r='0.6' fill='rgba(232,224,208,0.25)'/>
</svg>`;

export const GrainOpacity = 0.06;

export const ZIndex = {
  base: 1,
  overlay: 10,
  header: 40,
  modal: 50,
  tabBar: 50,
  drawer: 60,
  tuning: 70,
} as const;

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ───────────────────────── Legacy aliases ─────────────────────────
// Remap so unmigrated surfaces (auth/login, ErrorBoundary, OfflineBanner,
// NowPlayingBar, etc.) still render on-brand. New code should import
// `AM` / `Fonts` / `TypeScale` / `Space` / `Radius` directly.

/** @deprecated Use `AM` tokens. */
export const Colors = {
  base: { black: AM.bg, white: AM.ink, cream: AM.cream },
  accent:     AM.amber,
  accentDark: AM.amberDim,
  oxblood:    AM.oxblood,
  error:      AM.oxblood,
};

/** @deprecated Use `AM.bg` / `AM.amberFaint`. */
export const Surface = {
  lowest:    AM.bgDeep,
  base:      AM.bg,
  low:       AM.bg,
  container: AM.bg,
  high:      AM.bg,
  highest:   AM.bg,
  bright:    AM.bg,
};

/** @deprecated Use `AM.ink / inkMid / inkDim`. */
export const TextColors = {
  primary:        AM.ink,
  secondary:      AM.inkMid,
  outline:        AM.inkDim,
  outlineVariant: AM.inkGhost,
};

/** @deprecated Use `Fonts` directly. Legacy-shape keys retained. */
export const Typography = {
  display:   { family: Fonts.display },
  body:      { family: Fonts.serif, familyMedium: Fonts.serif, familySemiBold: Fonts.serif },
  cleoVoice: { family: Fonts.serif, style: 'italic' as const },
  mono:      { family: Fonts.mono },
};

/** @deprecated Use `Space`. */
export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 };

/** @deprecated Crate Digger uses radius 0 for primary surfaces. */
export const Radius = { none: 0, sm: 2, md: 4, lg: 8, xl: 12, full: 9999 };

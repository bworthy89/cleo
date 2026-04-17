// design-tokens.ts — Analog Midnight design system.
//
// The primary exports are the `AM` / `Fonts` / `TypeScale` / `Space` /
// `AMGlow` / `AMBloom` / `GrainOpacity` values. A small set of legacy
// aliases below remap the old "Sonic Ether Gold" names onto the new
// palette so three remaining surfaces — auth/login, ErrorBoundary, and
// OfflineBanner — render on-brand without a further rewrite. When those
// three migrate to the primary exports, the aliases can be deleted.

// ───────────────────────── Primary tokens ─────────────────────────

export const AM = {
  bg:         '#0B0907',
  ink:        '#E8E0D0',
  inkMid:     'rgba(232, 224, 208, 0.55)',
  inkDim:     'rgba(232, 224, 208, 0.42)',
  amber:      '#E8A24B',
  amberDim:   'rgba(232, 162, 75, 0.38)',
  amberFaint: 'rgba(232, 162, 75, 0.15)',
} as const;

export const Fonts = {
  display:     'Fraunces_400Regular_Italic',
  displayThin: 'Fraunces_300Light_Italic',
  mono:        'JetBrainsMono_400Regular',
  monoMedium:  'JetBrainsMono_500Medium',
} as const;

export const TypeScale = {
  s9: 9, s10: 10, s11: 11, s13: 13, s14: 14, s15: 15, s16: 16, s18: 18, s22: 22, s32: 32, s44: 44,
} as const;

export const Space = {
  s4: 4, s6: 6, s8: 8, s10: 10, s14: 14, s16: 16, s18: 18, s22: 22, s26: 26, s32: 32, s34: 34, s40: 40, s52: 52,
} as const;

export const AMGlow = {
  cta: {
    shadowColor: AM.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  dot: {
    shadowColor: AM.amber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
} as const;

// Background radial amber bloom — LinearGradient stand-in (RN has no radial).
// Approximates `radial-gradient(ellipse 140% 60% at 50% -10%, rgba(232,162,75,0.06), transparent 70%)`.
export const AMBloom = {
  colors: ['rgba(232, 162, 75, 0.08)', 'rgba(232, 162, 75, 0.03)', 'rgba(11, 9, 7, 0)'] as const,
  locations: [0, 0.4, 0.7] as const,
  start: { x: 0.5, y: 0 },
  end:   { x: 0.5, y: 0.6 },
} as const;

export const GrainOpacity = 0.06;

export const ZIndex = {
  base: 1,
  overlay: 10,
  header: 40,
  modal: 50,
  tabBar: 50,
};

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ───────────────────────── Legacy aliases ─────────────────────────
// Consumed only by auth/login, ErrorBoundary, and OfflineBanner. All
// values resolve to the Analog Midnight palette above so legacy screens
// render on-brand. Delete when those three surfaces are rewritten.

/** @deprecated Use `AM` tokens. */
export const Colors = {
  base: { black: AM.bg, white: AM.ink, cream: AM.ink },
  accent:     AM.amber,
  accentDark: AM.amber,
  error:      '#ff6e84',
};

/** @deprecated Use `AM.bg` / `AM.amberFaint`. */
export const Surface = {
  lowest:    '#000000',
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
  outlineVariant: AM.inkDim,
};

/** @deprecated Use `Fonts`. Points at the Analog Midnight families so
 *  unmigrated screens render on-brand. */
export const Typography = {
  display:   { family: Fonts.display },
  body:      { family: Fonts.display, familyMedium: Fonts.display, familySemiBold: Fonts.display },
  cleoVoice: { family: Fonts.display, style: 'italic' as const },
  mono:      { family: Fonts.mono },
};

/** @deprecated Use `Space`. */
export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 };

/** @deprecated Use literals; Analog Midnight uses radius 0 for buttons. */
export const Radius = { none: 0, sm: 4, md: 12, lg: 16, xl: 24, full: 9999 };

// design-tokens.ts — Analog Midnight design system.
//
// Primary exports live at the top. Legacy "Sonic Ether Gold" exports remain
// below as deprecated aliases so in-flight screens keep rendering during the
// migration (see docs/superpowers/plans/2026-04-17-analog-midnight-redesign.md).

// ───────────────────────── Analog Midnight — primary tokens ─────────────────

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

// ───────────────────────── Legacy aliases (@deprecated) ─────────────────────
// Kept so legacy screens continue to compile and render until each screen
// migrates to the Analog Midnight tokens above. Task 11 removes everything
// below this line.

/** @deprecated Use `AM` tokens instead. */
export const Colors = {
  base: { black: AM.bg, white: AM.ink, cream: AM.ink },
  accent:     AM.amber,
  accentDark: AM.amber,
  error:      '#ff6e84',
};

/** @deprecated Use `AM.bg` or `AM.amberFaint` for surface separation. */
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

/** @deprecated Use `Fonts`. Legacy families remain loaded so unmigrated
 *  screens render with their original type until rewritten. */
export const Typography = {
  display:   { family: 'PlayfairDisplay_400Regular' },
  body:      { family: 'Inter_400Regular', familyMedium: 'Inter_500Medium', familySemiBold: 'Inter_600SemiBold' },
  cleoVoice: { family: 'EBGaramond_400Regular_Italic', style: 'italic' as const },
  mono:      { family: 'DMMono_400Regular' },
};

/** @deprecated Analog Midnight does not use glass — no blurred surfaces. */
export const Glass = {
  panel:        { bg: 'rgba(38,37,40,0.4)', blur: 24, tint: 'dark' as const },
  panelDark:    { bg: 'rgba(19,19,21,0.6)', blur: 24, tint: 'dark' as const },
  border:       AM.amberFaint,
  borderSubtle: AM.amberFaint,
};

/** @deprecated Use `AMGlow`. */
export const Glow = {
  accent:    { color: AM.amber, opacity: 0.15, spread: 40 },
  ctaShadow: AMGlow.cta,
};

/** @deprecated Analog Midnight CTA is a sharp amber-bordered rectangle, not a
 *  gradient. Use `AmberCTA` component from `src/components/AmberCTA.tsx`. */
export const Gradient = {
  cta: { colors: [AM.amber, AM.amber] as const, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
};

/** @deprecated Use `Space`. */
export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 };

/** @deprecated Use literals; Analog Midnight uses radius 0 for buttons. */
export const Radius = { none: 0, sm: 4, md: 12, lg: 16, xl: 24, full: 9999 };

export const Animation = {
  duck:      { duration: 300, targetVolume: 0.15 },
  rampUp:    { duration: 800 },
  wordFade:  { stagger: 40 },
  cleoScale: { speaking: 1.03, resting: 1.0 },
  press:     { scale: 0.92, duration: 200 },
};

/** @deprecated Tab bar is retuned in Task 2. */
export const TabBar = {
  height: 84,
  radius: 24,
  bg: AM.bg,
  activeColor: AM.amber,
  inactiveColor: AM.inkDim,
  iconSize: 24,
  labelSize: 8,
  labelTracking: 1.12,
};

/** @deprecated AppHeader is retuned in Task 2. */
export const AppHeaderTokens = {
  height: 64,
  bg: AM.bg,
  blur: 0,
  logoSize: 18,
  logoTracking: 2.7,
  avatarSize: 32,
};

export const Shadow = {
  text:   { offset: { width: 0, height: 1 } as const, radius: 3, opacity: 0.3 },
  subtle: { offset: { width: 0, height: 2 } as const, radius: 4, opacity: 0.08 },
  medium: { offset: { width: 0, height: 4 } as const, radius: 8, opacity: 0.12 },
};

export const ZIndex = {
  base: 1,
  overlay: 10,
  header: 40,
  modal: 50,
  tabBar: 50,
};

export const Opacity = {
  primary: 0.9,
  secondary: 0.7,
  muted: 0.35,
  ghost: 0.15,
  dimmed: 0.3,
};

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

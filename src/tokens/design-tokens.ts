// design-tokens.ts — Single source of truth for all UI values

export const Colors = {
  base: { black: '#0D0D0D', white: '#FAF8F4', cream: '#F5F0E8' },
  accent: '#C8832A',
  accentDark: '#A06820',
  error: '#ff6e84',
  vibe: {
    morning:    { accent: '#C8832A' },
    chill:      { accent: '#5B7FA6' },
    lateNight:  { accent: '#7B5EA7' },
    workout:    { accent: '#FF4D3D' },
    party:      { accent: '#FF8C42' },
    general:    { accent: '#C8832A' },
    focus:      { accent: '#4A7A5B' },
    feelGood:   { accent: '#E8923A' },
    throwback:  { accent: '#B87A3A' },
    elevated:   { accent: '#8B7BA8' },
    melancholy: { accent: '#5B6A8A' },
    sunday:     { accent: '#A88B6A' },
  },
};

export const Surface = {
  lowest:    '#000000',
  base:      '#0D0D0D',
  low:       '#131315',
  container: '#19191C',
  high:      '#1F1F22',
  highest:   '#262528',
  bright:    '#2C2C2F',
};

export const TextColors = {
  primary:   '#F6F3F5',
  secondary: '#ACAAAD',
  outline:   '#767577',
  outlineVariant: '#48474A',
};

export const Typography = {
  display:   { family: 'PlayfairDisplay_400Regular' },
  body:      { family: 'Inter_400Regular', familyMedium: 'Inter_500Medium', familySemiBold: 'Inter_600SemiBold' },
  cleoVoice: { family: 'EBGaramond_400Regular_Italic', style: 'italic' as const },
  mono:      { family: 'DMMono_400Regular' },
};

export const Glass = {
  panel:     { bg: 'rgba(38,37,40,0.4)', blur: 24, tint: 'dark' as const },
  panelDark: { bg: 'rgba(19,19,21,0.6)', blur: 24, tint: 'dark' as const },
  border:    'rgba(72,71,74,0.08)',
  borderSubtle: 'rgba(72,71,74,0.05)',
};

export const Glow = {
  accent: { color: Colors.accent, opacity: 0.15, spread: 40 },
  ctaShadow: {
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
};

export const Gradient = {
  cta: { colors: [Colors.accent, Colors.accentDark] as const, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
};

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 };

export const Radius = { none: 0, sm: 4, md: 12, lg: 16, xl: 24, full: 9999 };

export const Animation = {
  duck:      { duration: 300, targetVolume: 0.15 },
  rampUp:    { duration: 800 },
  wordFade:  { stagger: 40 },
  cleoScale: { speaking: 1.03, resting: 1.0 },
  press:     { scale: 0.92, duration: 200 },
};

export const TabBar = {
  height: 84,
  radius: 24,
  bg: 'rgba(13,13,13,0.6)',
  activeColor: Colors.accent,
  inactiveColor: 'rgba(172,170,173,0.35)',
  iconSize: 24,
  labelSize: 8,
  labelTracking: 1.12,
};

export const AppHeaderTokens = {
  height: 64,
  bg: 'rgba(13,13,13,0.6)',
  blur: 20,
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

export function getVibeAccent(vibe: string): string {
  return Colors.vibe[vibe as keyof typeof Colors.vibe]?.accent ?? Colors.accent;
}

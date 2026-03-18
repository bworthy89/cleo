// design-tokens.ts — Single source of truth for all UI values

export const Colors = {
  base: { black: '#0D0D0D', white: '#FAF8F4', cream: '#F5F0E8' },
  accent: '#C8832A',
  vibe: {
    morning:   { bg: '#FAF6EF', text: '#1A1208', accent: '#C8832A' },
    chill:     { bg: '#F2F4F7', text: '#0F1318', accent: '#5B7FA6' },
    lateNight: { bg: '#080A0F', text: '#EDE8E0', accent: '#7B5EA7' },
    workout:   { bg: '#0A0A0A', text: '#FFFFFF', accent: '#FF4D3D' },
    party:     { bg: '#0D0010', text: '#F0F0F0', accent: '#FF8C42' },
    general:   { bg: '#F5F0E8', text: '#1A1208', accent: '#C8832A' },
    focus:     { bg: '#F0F4F0', text: '#0F1A0F', accent: '#4A7A5B' },
    feelGood:  { bg: '#FFF8EE', text: '#1A1208', accent: '#E8923A' },
    throwback: { bg: '#F8F2E8', text: '#1A1208', accent: '#B87A3A' },
    elevated:  { bg: '#0F0F14', text: '#E8E4DC', accent: '#8B7BA8' },
    melancholy:{ bg: '#12141A', text: '#D8D4CC', accent: '#5B6A8A' },
    sunday:    { bg: '#FAF8F0', text: '#1A1208', accent: '#A88B6A' },
  },
};

export const Typography = {
  display:   { family: 'PlayfairDisplay_400Regular', familyLight: 'PlayfairDisplay_400Regular', weights: ['300', '400'] },
  label:     { family: 'WorkSans_400Regular', familyMedium: 'WorkSans_500Medium', weights: ['400', '500'] },
  cleoVoice: { family: 'EBGaramond_400Regular_Italic', style: 'italic' as const },
  mono:      { family: 'DMMono_400Regular', weights: ['400'] },
};

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 };

export const Animation = {
  duck:      { duration: 300, targetVolume: 0.15 },
  rampUp:    { duration: 800 },
  wordFade:  { stagger: 40 },
  cleoScale: { speaking: 1.03, resting: 1.0 },
};

export const Radius = { none: 0, sm: 2, md: 12, lg: 28, full: 9999 };

export const Opacity = {
  primary: 0.7,
  secondary: 0.65,
  label: 0.45,
  muted: 0.35,
  ghost: 0.2,
};

export const Tracking = {
  tight: 0.5,
  normal: 1,
  wide: 3,
  ultra: 8,
};

export const Grain = {
  light: 0.06,
  dark: 0.035,
};

export const Shadow = {
  text:   { offset: { width: 0, height: 1 } as const, radius: 3, opacity: 0.3 },
  subtle: { offset: { width: 0, height: 2 } as const, radius: 4, opacity: 0.08 },
  medium: { offset: { width: 0, height: 4 } as const, radius: 8, opacity: 0.12 },
};

export const ZIndex = {
  base: 1,
  overlay: 10,
  modal: 100,
};

export const LineHeight = {
  tight: 1.15,
  normal: 1.4,
  relaxed: 1.55,
  loose: 1.7,
};

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Returns an opacity value with a minimum floor for dark backgrounds to maintain WCAG AA contrast. */
export function safeOpacity(baseOpacity: number, bg: string): number {
  return isDarkVibe(bg) ? Math.max(baseOpacity, 0.6) : baseOpacity;
}

export function isDarkVibe(bg: string): boolean {
  const r = parseInt(bg.slice(1, 3), 16) / 255;
  const g = parseInt(bg.slice(3, 5), 16) / 255;
  const b = parseInt(bg.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.2;
}

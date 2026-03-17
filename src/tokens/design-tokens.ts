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

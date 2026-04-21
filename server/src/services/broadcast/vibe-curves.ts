// server/src/services/broadcast/vibe-curves.ts
import type { Vibe } from './types';
import type { Keyframe, AudioFeatureWeights } from './scoring';

export interface VibeCurve {
  keyframes: [Keyframe, Keyframe, Keyframe, Keyframe];
  weights: AudioFeatureWeights;
}

// Positions are standardized across all vibes: open / body / peak / close.
const P_OPEN  = 0.00;
const P_BODY  = 0.33;
const P_PEAK  = 0.67;
const P_CLOSE = 1.00;

export const VIBE_CURVES: Record<Vibe, VibeCurve> = {
  // "Opens fresh — a song that sounds like a window opening. Mid-tempo,
  //  major key. Picks up steadily but never sprints. Peak is a gently
  //  uplifting mid-tempo anthem, never club energy. Close leaves ready to move."
  morning: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 95,  energy: 0.45, valence: 0.65, danceability: 0.50, acousticness: 0.45, loudness: 0.50, instrumentalness: 0.10 } },
      { position: P_BODY,  targets: { tempo: 105, energy: 0.55, valence: 0.70, danceability: 0.55, acousticness: 0.35, loudness: 0.55, instrumentalness: 0.08 } },
      { position: P_PEAK,  targets: { tempo: 115, energy: 0.70, valence: 0.75, danceability: 0.65, acousticness: 0.25, loudness: 0.65, instrumentalness: 0.05 } },
      { position: P_CLOSE, targets: { tempo: 105, energy: 0.55, valence: 0.70, danceability: 0.55, acousticness: 0.35, loudness: 0.55, instrumentalness: 0.08 } },
    ],
    weights: {
      tempo: 0.18, energy: 0.22, valence: 0.25, danceability: 0.12,
      acousticness: 0.10, loudness: 0.08, instrumentalness: 0.05,
    },
  },

  // "Opens textural, undemanding — instrumental or near-instrumental. No
  //  vocal hooks that pull you out. Body in lane; timbral variation only.
  //  No traditional peak — a mid-session plateau. Close suggests stopping."
  focus: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 85, energy: 0.30, valence: 0.50, danceability: 0.35, acousticness: 0.50, loudness: 0.35, instrumentalness: 0.75 } },
      { position: P_BODY,  targets: { tempo: 90, energy: 0.35, valence: 0.50, danceability: 0.35, acousticness: 0.45, loudness: 0.40, instrumentalness: 0.75 } },
      { position: P_PEAK,  targets: { tempo: 95, energy: 0.40, valence: 0.50, danceability: 0.40, acousticness: 0.40, loudness: 0.45, instrumentalness: 0.70 } },
      { position: P_CLOSE, targets: { tempo: 85, energy: 0.30, valence: 0.50, danceability: 0.35, acousticness: 0.50, loudness: 0.35, instrumentalness: 0.75 } },
    ],
    weights: {
      tempo: 0.10, energy: 0.20, valence: 0.05, danceability: 0.05,
      acousticness: 0.15, loudness: 0.15, instrumentalness: 0.30,
    },
  },

  // "Arrives running — immediate energy, clear pulse, 120+ BPM. Body holds
  //  plateau. Peak is the hardest-hitting cut, late-middle. Descent minimal
  //  until last track, which comes down but keeps momentum — finish line."
  workout: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 125, energy: 0.75, valence: 0.65, danceability: 0.70, acousticness: 0.15, loudness: 0.75, instrumentalness: 0.05 } },
      { position: P_BODY,  targets: { tempo: 130, energy: 0.80, valence: 0.65, danceability: 0.75, acousticness: 0.12, loudness: 0.80, instrumentalness: 0.05 } },
      { position: P_PEAK,  targets: { tempo: 140, energy: 0.90, valence: 0.70, danceability: 0.80, acousticness: 0.10, loudness: 0.85, instrumentalness: 0.03 } },
      { position: P_CLOSE, targets: { tempo: 115, energy: 0.65, valence: 0.70, danceability: 0.65, acousticness: 0.20, loudness: 0.70, instrumentalness: 0.05 } },
    ],
    weights: {
      tempo: 0.25, energy: 0.30, valence: 0.10, danceability: 0.15,
      acousticness: 0.05, loudness: 0.12, instrumentalness: 0.03,
    },
  },

  // "Opens instantly warm — a groove you can nod to from the first bar.
  //  Major key, hook-forward. Body builds generosity. Peak is the track
  //  that makes people sing along. Descent stays warm. Leaves a smile."
  feelGood: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 105, energy: 0.60, valence: 0.75, danceability: 0.70, acousticness: 0.25, loudness: 0.60, instrumentalness: 0.05 } },
      { position: P_BODY,  targets: { tempo: 110, energy: 0.65, valence: 0.80, danceability: 0.75, acousticness: 0.20, loudness: 0.65, instrumentalness: 0.05 } },
      { position: P_PEAK,  targets: { tempo: 115, energy: 0.75, valence: 0.85, danceability: 0.80, acousticness: 0.18, loudness: 0.70, instrumentalness: 0.05 } },
      { position: P_CLOSE, targets: { tempo: 100, energy: 0.55, valence: 0.78, danceability: 0.65, acousticness: 0.25, loudness: 0.55, instrumentalness: 0.05 } },
    ],
    weights: {
      tempo: 0.10, energy: 0.18, valence: 0.28, danceability: 0.22,
      acousticness: 0.07, loudness: 0.10, instrumentalness: 0.05,
    },
  },

  // "Opens low-lit — slow-burn vocal, 75-90 BPM, single lamp on. Texture
  //  builds, volume doesn't. Peak is a groove, never a banger — 2am college
  //  radio. Descent comes way down. Close is hushed: solo piano or acoustic."
  lateNight: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 80, energy: 0.25, valence: 0.30, danceability: 0.40, acousticness: 0.50, loudness: 0.35, instrumentalness: 0.20 } },
      { position: P_BODY,  targets: { tempo: 85, energy: 0.40, valence: 0.35, danceability: 0.50, acousticness: 0.35, loudness: 0.45, instrumentalness: 0.15 } },
      { position: P_PEAK,  targets: { tempo: 90, energy: 0.50, valence: 0.40, danceability: 0.60, acousticness: 0.25, loudness: 0.50, instrumentalness: 0.10 } },
      { position: P_CLOSE, targets: { tempo: 75, energy: 0.20, valence: 0.30, danceability: 0.30, acousticness: 0.70, loudness: 0.30, instrumentalness: 0.30 } },
    ],
    weights: {
      tempo: 0.15, energy: 0.25, valence: 0.20, danceability: 0.05,
      acousticness: 0.25, loudness: 0.05, instrumentalness: 0.05,
    },
  },

  // "Opens slow without wallowing — piano, strings, or spare vocal.
  //  Body deepens. Peak is emotional, not energetic — minor key or
  //  unresolved. Descent stays in register. Close leaves held, not dropped."
  melancholy: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 75, energy: 0.25, valence: 0.20, danceability: 0.30, acousticness: 0.65, loudness: 0.30, instrumentalness: 0.25 } },
      { position: P_BODY,  targets: { tempo: 80, energy: 0.30, valence: 0.18, danceability: 0.30, acousticness: 0.55, loudness: 0.35, instrumentalness: 0.20 } },
      { position: P_PEAK,  targets: { tempo: 85, energy: 0.45, valence: 0.15, danceability: 0.35, acousticness: 0.45, loudness: 0.45, instrumentalness: 0.15 } },
      { position: P_CLOSE, targets: { tempo: 70, energy: 0.20, valence: 0.25, danceability: 0.25, acousticness: 0.70, loudness: 0.25, instrumentalness: 0.30 } },
    ],
    weights: {
      tempo: 0.10, energy: 0.20, valence: 0.28, danceability: 0.05,
      acousticness: 0.22, loudness: 0.05, instrumentalness: 0.10,
    },
  },

  // "Arrives confident but not peaked — 100-115 BPM. Body climbs steadily.
  //  Peak is mid-to-late — biggest track, most-danceable. Brief descent
  //  drops to released communal energy. Close leaves the room elevated."
  party: {
    keyframes: [
      { position: P_OPEN,  targets: { tempo: 108, energy: 0.65, valence: 0.70, danceability: 0.75, acousticness: 0.15, loudness: 0.70, instrumentalness: 0.05 } },
      { position: P_BODY,  targets: { tempo: 115, energy: 0.75, valence: 0.75, danceability: 0.80, acousticness: 0.12, loudness: 0.75, instrumentalness: 0.05 } },
      { position: P_PEAK,  targets: { tempo: 122, energy: 0.85, valence: 0.80, danceability: 0.88, acousticness: 0.10, loudness: 0.82, instrumentalness: 0.03 } },
      { position: P_CLOSE, targets: { tempo: 112, energy: 0.70, valence: 0.78, danceability: 0.75, acousticness: 0.14, loudness: 0.72, instrumentalness: 0.05 } },
    ],
    weights: {
      tempo: 0.18, energy: 0.22, valence: 0.15, danceability: 0.28,
      acousticness: 0.05, loudness: 0.10, instrumentalness: 0.02,
    },
  },
};

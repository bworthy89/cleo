export interface AudioFeatures {
  tempo: number;            // BPM, typically 40-200
  energy: number;           // 0-1
  valence: number;          // 0-1 (sad → happy)
  danceability: number;     // 0-1
  acousticness: number;     // 0-1
  loudness: number;         // normalized 0-1 from (dB + 60) / 60
  instrumentalness: number; // 0-1
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function normalizeTempo(bpm: number): number {
  return clamp01((bpm - 40) / 160);
}

export function normalizeLoudness(db: number): number {
  return clamp01((db + 60) / 60);
}

export const NEUTRAL_FEATURES: AudioFeatures = {
  tempo: 100,
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.4,
  loudness: 0.5,
  instrumentalness: 0.2,
};

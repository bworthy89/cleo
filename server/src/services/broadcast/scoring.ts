import type { AudioFeatures } from './audio-features';
import { normalizeTempo, normalizeLoudness } from './audio-features';
import type { ManifestTrack } from './types';

export interface AudioFeatureWeights {
  tempo: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  loudness: number;
  instrumentalness: number;
}

export interface Keyframe {
  position: number;           // 0.0 → 1.0
  targets: AudioFeatures;
}

/**
 * Normalize a vector to the 0-1 space used for scoring (tempo + loudness
 * need remapping; others are already normalized).
 */
function toScoringSpace(f: AudioFeatures): AudioFeatures {
  return {
    ...f,
    tempo: normalizeTempo(f.tempo),
    loudness: f.loudness, // already normalized at ingest
  };
}

/**
 * Weighted Euclidean distance between two AudioFeatures vectors.
 * Returns 0-1; 0 means identical, 1 means maximally different.
 */
export function weightedDistance(
  a: AudioFeatures,
  b: AudioFeatures,
  weights: AudioFeatureWeights,
): number {
  const na = toScoringSpace(a);
  const nb = toScoringSpace(b);
  const keys: (keyof AudioFeatureWeights)[] = [
    'tempo', 'energy', 'valence', 'danceability',
    'acousticness', 'loudness', 'instrumentalness',
  ];
  let sum = 0;
  for (const k of keys) {
    const diff = na[k] - nb[k];
    sum += weights[k] * diff * diff;
  }
  return Math.sqrt(Math.max(0, sum));
}

/**
 * Adjacency penalty: discourage (but don't forbid) same-artist/same-album
 * transitions. Added to the distance score in TrackSequencer.
 */
export function adjacencyPenalty(
  candidate: ManifestTrack,
  previous: ManifestTrack | undefined,
): number {
  if (!previous) return 0;
  if (candidate.albumTitle && candidate.albumTitle === previous.albumTitle) {
    return 0.30;
  }
  if (candidate.artistName === previous.artistName) {
    return 0.15;
  }
  return 0;
}

function lerpAudioFeatures(
  a: AudioFeatures, b: AudioFeatures, t: number,
): AudioFeatures {
  return {
    tempo:            a.tempo + (b.tempo - a.tempo) * t,
    energy:           a.energy + (b.energy - a.energy) * t,
    valence:          a.valence + (b.valence - a.valence) * t,
    danceability:     a.danceability + (b.danceability - a.danceability) * t,
    acousticness:     a.acousticness + (b.acousticness - a.acousticness) * t,
    loudness:         a.loudness + (b.loudness - a.loudness) * t,
    instrumentalness: a.instrumentalness + (b.instrumentalness - a.instrumentalness) * t,
  };
}

/**
 * Interpolate the target AudioFeatures at fractional position `p` across
 * keyframes. Keyframes must be sorted by position.
 */
export function interpolateKeyframes(
  keyframes: Keyframe[],
  p: number,
): AudioFeatures {
  if (keyframes.length === 0) {
    throw new Error('interpolateKeyframes requires at least one keyframe');
  }
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped <= keyframes[0].position) return { ...keyframes[0].targets };
  const last = keyframes[keyframes.length - 1];
  if (clamped >= last.position) return { ...last.targets };
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (clamped >= a.position && clamped <= b.position) {
      const span = b.position - a.position;
      const t = span === 0 ? 0 : (clamped - a.position) / span;
      return lerpAudioFeatures(a.targets, b.targets, t);
    }
  }
  return { ...last.targets };
}

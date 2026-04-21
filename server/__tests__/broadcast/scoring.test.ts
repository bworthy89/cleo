import {
  weightedDistance,
  adjacencyPenalty,
  interpolateKeyframes,
  AudioFeatureWeights,
  Keyframe,
} from '../../src/services/broadcast/scoring';
import { AudioFeatures, NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';

const UNIFORM_WEIGHTS: AudioFeatureWeights = {
  tempo: 1/7, energy: 1/7, valence: 1/7, danceability: 1/7,
  acousticness: 1/7, loudness: 1/7, instrumentalness: 1/7,
};

describe('weightedDistance', () => {
  it('returns 0 for identical vectors', () => {
    const d = weightedDistance(NEUTRAL_FEATURES, NEUTRAL_FEATURES, UNIFORM_WEIGHTS);
    expect(d).toBe(0);
  });

  it('is symmetric', () => {
    const a: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 0.2 };
    const b: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 0.8 };
    const d1 = weightedDistance(a, b, UNIFORM_WEIGHTS);
    const d2 = weightedDistance(b, a, UNIFORM_WEIGHTS);
    expect(d1).toBeCloseTo(d2, 10);
  });

  it('respects per-feature weights', () => {
    const a: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 0.0 };
    const b: AudioFeatures = { ...NEUTRAL_FEATURES, energy: 1.0 };
    const highEnergy: AudioFeatureWeights = {
      tempo: 0, energy: 1, valence: 0, danceability: 0,
      acousticness: 0, loudness: 0, instrumentalness: 0,
    };
    expect(weightedDistance(a, b, highEnergy)).toBe(1);
    const zeroEnergy: AudioFeatureWeights = {
      tempo: 1, energy: 0, valence: 0, danceability: 0,
      acousticness: 0, loudness: 0, instrumentalness: 0,
    };
    expect(weightedDistance(a, b, zeroEnergy)).toBe(0);
  });
});

describe('adjacencyPenalty', () => {
  const trackA = { id: '1', title: 't', artistName: 'Alice', albumTitle: 'X',
    duration: 200 } as any;
  const trackB = { id: '2', title: 'u', artistName: 'Alice', albumTitle: 'Y',
    duration: 200 } as any;
  const trackC = { id: '3', title: 'v', artistName: 'Alice', albumTitle: 'X',
    duration: 200 } as any;
  const trackD = { id: '4', title: 'w', artistName: 'Bob', albumTitle: 'Z',
    duration: 200 } as any;

  it('returns 0 when no previous track', () => {
    expect(adjacencyPenalty(trackB, undefined)).toBe(0);
  });

  it('returns 0.30 when album matches previous', () => {
    expect(adjacencyPenalty(trackC, trackA)).toBe(0.30);
  });

  it('returns 0.15 when artist matches but album differs', () => {
    expect(adjacencyPenalty(trackB, trackA)).toBe(0.15);
  });

  it('returns 0 when both differ', () => {
    expect(adjacencyPenalty(trackD, trackA)).toBe(0);
  });
});

describe('interpolateKeyframes', () => {
  const kf: Keyframe[] = [
    { position: 0.0, targets: { ...NEUTRAL_FEATURES, energy: 0.2 } },
    { position: 0.5, targets: { ...NEUTRAL_FEATURES, energy: 0.6 } },
    { position: 1.0, targets: { ...NEUTRAL_FEATURES, energy: 0.4 } },
  ];

  it('returns the keyframe target at exact positions', () => {
    expect(interpolateKeyframes(kf, 0.0).energy).toBeCloseTo(0.2);
    expect(interpolateKeyframes(kf, 0.5).energy).toBeCloseTo(0.6);
    expect(interpolateKeyframes(kf, 1.0).energy).toBeCloseTo(0.4);
  });

  it('lerps between keyframes', () => {
    expect(interpolateKeyframes(kf, 0.25).energy).toBeCloseTo(0.4);   // halfway 0.2→0.6
    expect(interpolateKeyframes(kf, 0.75).energy).toBeCloseTo(0.5);   // halfway 0.6→0.4
  });

  it('clamps out-of-range positions', () => {
    expect(interpolateKeyframes(kf, -0.5).energy).toBeCloseTo(0.2);
    expect(interpolateKeyframes(kf, 1.5).energy).toBeCloseTo(0.4);
  });
});

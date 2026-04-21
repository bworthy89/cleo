// server/__tests__/broadcast/vibe-curves.test.ts
import { VIBE_CURVES } from '../../src/services/broadcast/vibe-curves';
import type { Vibe } from '../../src/services/broadcast/types';

const ALL_VIBES: Vibe[] = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
];

describe('VIBE_CURVES', () => {
  it.each(ALL_VIBES)('has exactly 4 keyframes for %s', (vibe) => {
    expect(VIBE_CURVES[vibe].keyframes).toHaveLength(4);
  });

  it.each(ALL_VIBES)('has canonical positions 0.0 / 0.33 / 0.67 / 1.0 for %s', (vibe) => {
    const positions = VIBE_CURVES[vibe].keyframes.map(k => k.position);
    expect(positions[0]).toBe(0.0);
    expect(positions[1]).toBeCloseTo(0.33, 2);
    expect(positions[2]).toBeCloseTo(0.67, 2);
    expect(positions[3]).toBe(1.0);
  });

  it.each(ALL_VIBES)('has weights summing to approximately 1 for %s', (vibe) => {
    const w = VIBE_CURVES[vibe].weights;
    const sum = w.tempo + w.energy + w.valence + w.danceability
              + w.acousticness + w.loudness + w.instrumentalness;
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('workout has higher peak tempo than lateNight', () => {
    const workoutPeak = VIBE_CURVES.workout.keyframes[2].targets.tempo;
    const lateNightPeak = VIBE_CURVES.lateNight.keyframes[2].targets.tempo;
    expect(workoutPeak).toBeGreaterThan(lateNightPeak);
  });

  it('focus weights instrumentalness higher than workout does', () => {
    expect(VIBE_CURVES.focus.weights.instrumentalness)
      .toBeGreaterThan(VIBE_CURVES.workout.weights.instrumentalness);
  });

  it('melancholy weights valence high (valence matters to sad/happy axis)', () => {
    expect(VIBE_CURVES.melancholy.weights.valence).toBeGreaterThanOrEqual(0.20);
  });
});

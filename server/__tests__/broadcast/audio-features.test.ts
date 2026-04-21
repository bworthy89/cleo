import {
  AudioFeatures,
  NEUTRAL_FEATURES,
  normalizeTempo,
  normalizeLoudness,
} from '../../src/services/broadcast/audio-features';

describe('audio-features', () => {
  describe('normalizeTempo', () => {
    it('maps 40 BPM to 0, 200 BPM to 1', () => {
      expect(normalizeTempo(40)).toBe(0);
      expect(normalizeTempo(200)).toBe(1);
    });
    it('maps 120 BPM to 0.5', () => {
      expect(normalizeTempo(120)).toBe(0.5);
    });
    it('clamps out-of-range inputs', () => {
      expect(normalizeTempo(20)).toBe(0);
      expect(normalizeTempo(400)).toBe(1);
    });
  });

  describe('normalizeLoudness', () => {
    it('maps -60 dB to 0, 0 dB to 1', () => {
      expect(normalizeLoudness(-60)).toBe(0);
      expect(normalizeLoudness(0)).toBe(1);
    });
    it('clamps below -60 dB', () => {
      expect(normalizeLoudness(-80)).toBe(0);
    });
  });

  describe('NEUTRAL_FEATURES', () => {
    it('has all required fields with mid-range values', () => {
      const n: AudioFeatures = NEUTRAL_FEATURES;
      expect(n.tempo).toBe(100);
      expect(n.energy).toBe(0.5);
      expect(n.valence).toBe(0.5);
      expect(n.danceability).toBe(0.5);
      expect(n.acousticness).toBe(0.4);
      expect(n.loudness).toBe(0.5);
      expect(n.instrumentalness).toBe(0.2);
    });
  });
});

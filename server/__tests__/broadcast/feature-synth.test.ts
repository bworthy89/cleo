import { synthesizeFeatures, applyTagOverrides } from '../../src/services/broadcast/feature-synth';
import { NEUTRAL_FEATURES } from '../../src/services/broadcast/audio-features';

describe('feature-synth', () => {
  describe('synthesizeFeatures', () => {
    it('uses genre-family defaults when given a genre', () => {
      const f = synthesizeFeatures({ genreFamily: 'rock' });
      expect(f.tempo).toBeGreaterThan(NEUTRAL_FEATURES.tempo);
      expect(f.loudness).toBeGreaterThan(NEUTRAL_FEATURES.loudness);
    });

    it('returns neutrals when no signals present', () => {
      const f = synthesizeFeatures({});
      expect(f).toEqual(NEUTRAL_FEATURES);
    });

    it('preserves ReccoBeats partial data', () => {
      const f = synthesizeFeatures({
        partialFeatures: { tempo: 130, energy: 0.8 },
        genreFamily: 'rock',
      });
      expect(f.tempo).toBe(130);
      expect(f.energy).toBe(0.8);
    });

    it('keeps genre defaults for fields not overridden by partial data', () => {
      const f = synthesizeFeatures({
        partialFeatures: { tempo: 85, energy: 0.3 },
        genreFamily: 'rock',
      });
      expect(f.tempo).toBe(85);       // partial data wins
      expect(f.energy).toBe(0.3);     // partial data wins
      expect(f.instrumentalness).toBe(0.05);  // genre default preserved
    });
  });

  describe('applyTagOverrides', () => {
    it('applies chill → lower energy + valence', () => {
      const f = applyTagOverrides(NEUTRAL_FEATURES, ['chill']);
      expect(f.energy).toBeLessThan(NEUTRAL_FEATURES.energy);
    });

    it('applies upbeat → higher valence', () => {
      const f = applyTagOverrides(NEUTRAL_FEATURES, ['upbeat']);
      expect(f.valence).toBeGreaterThan(NEUTRAL_FEATURES.valence);
    });

    it('averages overlapping tags', () => {
      const chillOnly = applyTagOverrides(NEUTRAL_FEATURES, ['chill']);
      const melancholyOnly = applyTagOverrides(NEUTRAL_FEATURES, ['melancholy']);
      const combined = applyTagOverrides(NEUTRAL_FEATURES, ['chill', 'melancholy']);
      // Both push valence down; combined should average between pure-chill
      // and pure-melancholy, not go below either.
      expect(combined.valence).toBeGreaterThanOrEqual(Math.min(chillOnly.valence, melancholyOnly.valence));
      expect(combined.valence).toBeLessThanOrEqual(Math.max(chillOnly.valence, melancholyOnly.valence));
    });

    it('ignores unknown tags', () => {
      const f = applyTagOverrides(NEUTRAL_FEATURES, ['unknownTag']);
      expect(f).toEqual(NEUTRAL_FEATURES);
    });
  });
});

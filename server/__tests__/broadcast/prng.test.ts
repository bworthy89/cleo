import { mulberry32, hashToUint32, seededPRNG } from '../../src/services/broadcast/prng';

describe('prng', () => {
  describe('mulberry32', () => {
    it('produces identical sequences for same seed', () => {
      const a = mulberry32(12345);
      const b = mulberry32(12345);
      const seqA = [a(), a(), a(), a(), a()];
      const seqB = [b(), b(), b(), b(), b()];
      expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
      const a = mulberry32(1);
      const b = mulberry32(2);
      expect(a()).not.toBe(b());
    });

    it('returns values in [0, 1)', () => {
      const r = mulberry32(42);
      for (let i = 0; i < 100; i++) {
        const v = r();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('hashToUint32', () => {
    it('returns stable uint32 for the same string', () => {
      expect(hashToUint32('abc')).toBe(hashToUint32('abc'));
    });

    it('returns different values for different strings', () => {
      expect(hashToUint32('abc')).not.toBe(hashToUint32('abd'));
    });
  });

  describe('seededPRNG.pickIndex', () => {
    it('returns an integer in [0, n)', () => {
      const rng = seededPRNG('broadcast-xyz');
      for (let i = 0; i < 50; i++) {
        const idx = rng.pickIndex(5);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(5);
        expect(Number.isInteger(idx)).toBe(true);
      }
    });
  });
});

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

    it('produces identical index sequences for the same seed', () => {
      const a = seededPRNG('broadcast-xyz');
      const b = seededPRNG('broadcast-xyz');
      const seqA = Array.from({ length: 20 }, () => a.pickIndex(7));
      const seqB = Array.from({ length: 20 }, () => b.pickIndex(7));
      expect(seqA).toEqual(seqB);
    });

    it('produces different index sequences for different seeds', () => {
      const a = seededPRNG('broadcast-aaa');
      const b = seededPRNG('broadcast-bbb');
      const seqA = Array.from({ length: 20 }, () => a.pickIndex(7));
      const seqB = Array.from({ length: 20 }, () => b.pickIndex(7));
      // 20 picks over 7 bins — collision probability ≈ 7^-20, effectively 0.
      expect(seqA).not.toEqual(seqB);
    });

    it('throws RangeError on invalid n (0, negative, non-integer, NaN)', () => {
      const rng = seededPRNG('broadcast-xyz');
      expect(() => rng.pickIndex(0)).toThrow(RangeError);
      expect(() => rng.pickIndex(-1)).toThrow(RangeError);
      expect(() => rng.pickIndex(1.5)).toThrow(RangeError);
      expect(() => rng.pickIndex(Number.NaN)).toThrow(RangeError);
      expect(() => rng.pickIndex(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });

    it('does not advance the PRNG state on invalid n', () => {
      const rng = seededPRNG('broadcast-xyz');
      try { rng.pickIndex(0); } catch { /* expected */ }
      try { rng.pickIndex(-5); } catch { /* expected */ }
      // First valid call should match a fresh PRNG with the same seed,
      // proving the invalid calls didn't consume any random values.
      const fresh = seededPRNG('broadcast-xyz');
      expect(rng.pickIndex(100)).toBe(fresh.pickIndex(100));
    });
  });
});

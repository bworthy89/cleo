import { createHash } from 'crypto';

/**
 * mulberry32 — small, fast, deterministic PRNG.
 * https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashToUint32(s: string): number {
  const hex = createHash('sha256').update(s).digest('hex').slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

export interface SeededPRNG {
  next: () => number;        // [0, 1)
  pickIndex: (n: number) => number; // integer in [0, n)
}

export function seededPRNG(seed: string): SeededPRNG {
  const gen = mulberry32(hashToUint32(seed));
  return {
    next: gen,
    pickIndex: (n: number) => Math.floor(gen() * n),
  };
}

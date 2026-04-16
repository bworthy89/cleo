import { BroadcastSegmentCache } from '../../src/engines/BroadcastSegmentCache';

describe('BroadcastSegmentCache', () => {
  it('stores and retrieves variants by slot index', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'base64a');
    c.put(0, 1, 'base64b');
    expect(c.get(0, 0)).toBe('base64a');
    expect(c.get(0, 1)).toBe('base64b');
  });

  it('returns undefined for uncached entries', () => {
    const c = new BroadcastSegmentCache();
    expect(c.get(2, 0)).toBeUndefined();
  });

  it('reports whether a slot has at least one variant ready', () => {
    const c = new BroadcastSegmentCache();
    expect(c.hasAny(1)).toBe(false);
    c.put(1, 0, 'x');
    expect(c.hasAny(1)).toBe(true);
  });

  it('clears all entries', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'x'); c.put(3, 0, 'y');
    c.clear();
    expect(c.get(0, 0)).toBeUndefined();
    expect(c.get(3, 0)).toBeUndefined();
  });

  it('pickVariant returns a deterministic variant given variantCount', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'a'); c.put(0, 1, 'b'); c.put(0, 2, 'c');
    const v0 = c.pickVariant(0, 3, () => 0.0);
    const v2 = c.pickVariant(0, 3, () => 0.9);
    expect(v0).toBe('a');
    expect(v2).toBe('c');
  });

  it('pickVariant falls back to variant 0 if picked variant missing', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'a');
    expect(c.pickVariant(0, 3, () => 0.9)).toBe('a');
  });

  it('pickVariant returns undefined when nothing is cached', () => {
    const c = new BroadcastSegmentCache();
    expect(c.pickVariant(5, 3, () => 0)).toBeUndefined();
  });
});

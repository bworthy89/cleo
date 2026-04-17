import { SequenceCache } from '@/services/broadcast/SequenceCache';

describe('SequenceCache', () => {
  let cache: SequenceCache;
  beforeEach(() => {
    cache = new SequenceCache();
  });

  it('returns null on miss', () => {
    expect(cache.get(['a', 'b', 'c'], 'morning', 'quick')).toBeNull();
  });

  it('returns the cached order on hit', () => {
    cache.set(['a', 'b', 'c'], 'morning', 'quick', ['b', 'a', 'c']);
    expect(cache.get(['a', 'b', 'c'], 'morning', 'quick')).toEqual(['b', 'a', 'c']);
  });

  it('key is stable under trackId reorder', () => {
    cache.set(['a', 'b', 'c'], 'morning', 'quick', ['b', 'a', 'c']);
    expect(cache.get(['c', 'a', 'b'], 'morning', 'quick')).toEqual(['b', 'a', 'c']);
  });

  it('key distinguishes vibe', () => {
    cache.set(['a', 'b'], 'morning', 'quick', ['a', 'b']);
    expect(cache.get(['a', 'b'], 'lateNight', 'quick')).toBeNull();
  });

  it('key distinguishes length', () => {
    cache.set(['a', 'b'], 'morning', 'quick', ['a', 'b']);
    expect(cache.get(['a', 'b'], 'morning', 'standard')).toBeNull();
  });

  it('expires entries after 24h', () => {
    jest.useFakeTimers();
    cache.set(['a', 'b'], 'morning', 'quick', ['a', 'b']);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(cache.get(['a', 'b'], 'morning', 'quick')).toBeNull();
    jest.useRealTimers();
  });

  it('evicts oldest entry when at capacity', () => {
    const c = new SequenceCache({ maxEntries: 2 });
    c.set(['a'], 'morning', 'quick', ['a']);
    c.set(['b'], 'morning', 'quick', ['b']);
    c.set(['c'], 'morning', 'quick', ['c']); // evicts a
    expect(c.get(['a'], 'morning', 'quick')).toBeNull();
    expect(c.get(['b'], 'morning', 'quick')).toEqual(['b']);
    expect(c.get(['c'], 'morning', 'quick')).toEqual(['c']);
  });
});

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
    cache.set(['a', 'b', 'c'], 'morning', 'quick', {
      ordered: ['b', 'a', 'c'], featureSlots: [1],
    });
    expect(cache.get(['a', 'b', 'c'], 'morning', 'quick'))
      .toEqual({ ordered: ['b', 'a', 'c'], featureSlots: [1] });
  });

  it('key is stable under trackId reorder', () => {
    cache.set(['a', 'b', 'c'], 'morning', 'quick', {
      ordered: ['b', 'a', 'c'], featureSlots: [1],
    });
    expect(cache.get(['c', 'a', 'b'], 'morning', 'quick'))
      .toEqual({ ordered: ['b', 'a', 'c'], featureSlots: [1] });
  });

  it('key distinguishes vibe', () => {
    cache.set(['a', 'b'], 'morning', 'quick', {
      ordered: ['a', 'b'], featureSlots: [],
    });
    expect(cache.get(['a', 'b'], 'lateNight', 'quick')).toBeNull();
  });

  it('key distinguishes length', () => {
    cache.set(['a', 'b'], 'morning', 'quick', {
      ordered: ['a', 'b'], featureSlots: [],
    });
    expect(cache.get(['a', 'b'], 'morning', 'standard')).toBeNull();
  });

  it('expires entries after 24h', () => {
    jest.useFakeTimers();
    cache.set(['a', 'b'], 'morning', 'quick', {
      ordered: ['a', 'b'], featureSlots: [],
    });
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(cache.get(['a', 'b'], 'morning', 'quick')).toBeNull();
    jest.useRealTimers();
  });

  it('evicts oldest entry when at capacity', () => {
    const c = new SequenceCache({ maxEntries: 2 });
    c.set(['a'], 'morning', 'quick', { ordered: ['a'], featureSlots: [] });
    c.set(['b'], 'morning', 'quick', { ordered: ['b'], featureSlots: [] });
    c.set(['c'], 'morning', 'quick', { ordered: ['c'], featureSlots: [] }); // evicts a
    expect(c.get(['a'], 'morning', 'quick')).toBeNull();
    expect(c.get(['b'], 'morning', 'quick'))
      .toEqual({ ordered: ['b'], featureSlots: [] });
    expect(c.get(['c'], 'morning', 'quick'))
      .toEqual({ ordered: ['c'], featureSlots: [] });
  });

  it('round-trips featureSlots alongside ordered', () => {
    cache.set(['a', 'b', 'c', 'd', 'e'], 'lateNight', 'quick', {
      ordered: ['a', 'b', 'c', 'd', 'e'],
      featureSlots: [2, 4],
    });
    const got = cache.get(['a', 'b', 'c', 'd', 'e'], 'lateNight', 'quick');
    expect(got).not.toBeNull();
    expect(got!.ordered).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(got!.featureSlots).toEqual([2, 4]);
  });
});

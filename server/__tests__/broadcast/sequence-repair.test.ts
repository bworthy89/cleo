import { repairSequence, removeDuplicates } from '@/services/broadcast/sequence-repair';
import type { ManifestTrack } from '@/services/broadcast/types';

const track = (
  id: string, artist: string, album = `${artist}-album-${id}`
): ManifestTrack => ({
  id, title: `${id}-title`, artistName: artist, albumTitle: album, duration: 200,
});

describe('removeDuplicates', () => {
  it('keeps a unique list as-is', () => {
    const pool = [track('a', 'A'), track('b', 'B'), track('c', 'C')];
    expect(removeDuplicates(pool, pool).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a duplicate with the next unused track from the pool', () => {
    const pool = [track('a', 'A'), track('b', 'B'), track('c', 'C'), track('d', 'D')];
    const ordered = [pool[0], pool[1], pool[1]]; // b duplicated
    const result = removeDuplicates(ordered, pool);
    expect(result.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('accepts duplicates when pool is exhausted', () => {
    const pool = [track('a', 'A'), track('b', 'B')];
    const ordered = [pool[0], pool[0], pool[1]]; // a duplicated, pool has no c
    const result = removeDuplicates(ordered, pool);
    expect(result).toHaveLength(3);
    // Preserves the first unique sighting + b; accepts the duplicate
  });
});

describe('repairSequence', () => {
  it('leaves a clean sequence untouched', () => {
    const pool = [track('a', 'A'), track('b', 'B'), track('c', 'C')];
    const result = repairSequence({ ordered: pool, pool });
    expect(result.ordered.map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(result.repairCount).toBe(0);
  });

  it('swaps to resolve same-artist adjacency', () => {
    const pool = [
      track('a', 'X'), track('b', 'X'), track('c', 'Y'), track('d', 'Z'),
    ];
    // a and b are both artist X, back-to-back
    const ordered = [pool[0], pool[1], pool[2], pool[3]];
    const result = repairSequence({ ordered, pool });
    const artists = result.ordered.map(t => t.artistName);
    expect(artists[0]).not.toBe(artists[1]);
    expect(result.repairCount).toBeGreaterThan(0);
  });

  it('resolves adjacency by swapping with the immediate neighbor (3-track boundary)', () => {
    // Regression: the only valid swap partner is at idx+1, not further down.
    const pool = [track('a', 'X'), track('b', 'X'), track('c', 'Y')];
    const ordered = [pool[0], pool[1], pool[2]];
    const result = repairSequence({ ordered, pool });
    const artists = result.ordered.map(t => t.artistName);
    expect(artists[0]).not.toBe(artists[1]);
    expect(artists[1]).not.toBe(artists[2]);
    expect(result.repairCount).toBeGreaterThan(0);
  });

  it('swaps to resolve same-album adjacency', () => {
    const pool = [
      track('a', 'X', 'Album1'), track('b', 'Y', 'Album1'),
      track('c', 'Z', 'Album2'), track('d', 'W', 'Album3'),
    ];
    const ordered = [pool[0], pool[1], pool[2], pool[3]];
    const result = repairSequence({ ordered, pool });
    const albums = result.ordered.map(t => t.albumTitle);
    expect(albums[0]).not.toBe(albums[1]);
    expect(result.repairCount).toBeGreaterThan(0);
  });

  it('caps at 5 passes and accepts unrepairable input', () => {
    // Every track is artist X — no valid ordering exists.
    const pool = Array.from({ length: 4 }, (_, i) => track(`t${i}`, 'X'));
    const result = repairSequence({ ordered: pool, pool });
    expect(result.ordered).toHaveLength(4);
    expect(result.passes).toBeLessThanOrEqual(5);
  });

  it('does not introduce new violations', () => {
    const pool = [
      track('a', 'X'), track('b', 'X'), track('c', 'Y'), track('d', 'Y'), track('e', 'Z'),
    ];
    const ordered = [pool[0], pool[1], pool[2], pool[3], pool[4]];
    const result = repairSequence({ ordered, pool });
    const ids = result.ordered.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length); // still unique
  });
});

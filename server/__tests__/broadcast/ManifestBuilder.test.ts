import { buildManifest } from '@/services/broadcast/ManifestBuilder';
import type { ManifestTrack } from '@/services/broadcast/types';

const t = (id: string): ManifestTrack => ({
  id, title: `Title ${id}`, artistName: `Artist ${id}`,
  albumTitle: `Album ${id}`, duration: 210,
});

describe('buildManifest', () => {
  it('produces N+1 slots for N tracks', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    // cold_open + 4 transitions + sign_off = 6
    expect(m.segmentSlots).toHaveLength(6);
    expect(m.tracks).toHaveLength(5);
  });

  it('preserves input track order', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.tracks.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('cold_open references first track', () => {
    const tracks = [t('a'), t('b')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[0].beforeTrackId).toBe('a');
  });

  it('sign_off references last track', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    const last = m.segmentSlots[m.segmentSlots.length - 1];
    expect(last.kind).toBe('sign_off');
    expect(last.afterTrackId).toBe('c');
  });

  it('throws on empty track list', () => {
    expect(() =>
      buildManifest({
        userId: 'u1', playlistId: 'p1', vibe: 'morning',
        length: 'quick', tracks: [],
      }),
    ).toThrow(/at least one track/);
  });
});

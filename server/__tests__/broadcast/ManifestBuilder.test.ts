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

describe('buildManifest — tier assignment', () => {
  it('sets cold_open and sign_off tiers', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
      ],
    });
    expect(m.segmentSlots[0].tier).toBe('cold_open');
    expect(m.segmentSlots[m.segmentSlots.length - 1].tier).toBe('sign_off');
  });

  it('marks transitions as deep_dive when index is in featureSlots', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '3', title: 'C', artistName: 'X', albumTitle: '', duration: 180 },
      ],
      featureSlots: [1],
    });
    // slots: 0=cold_open, 1=transition A→B (deep_dive), 2=transition B→C, 3=sign_off
    expect(m.segmentSlots[1].tier).toBe('deep_dive');
    expect(m.segmentSlots[2].tier).toBe('fact_bridge');
  });

  it('defaults transitions to fact_bridge when featureSlots empty or missing', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
      ],
    });
    // slots: 0=cold_open, 1=transition A→B, 2=sign_off
    expect(m.segmentSlots[1].tier).toBe('fact_bridge');
  });

  it('stores featureSlots on the manifest', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
      ],
      featureSlots: [1],
    });
    expect(m.featureSlots).toEqual([1]);
  });
});

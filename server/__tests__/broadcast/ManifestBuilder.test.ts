import { buildManifest } from '@/services/broadcast/ManifestBuilder';
import type { ManifestTrack } from '@/services/broadcast/types';

const t = (id: string): ManifestTrack => ({
  id, title: `Title ${id}`, artistName: `Artist ${id}`,
  albumTitle: `Album ${id}`, duration: 210,
});

describe('buildManifest — segment count', () => {
  it('produces cold_open + 2 transitions + sign_off (= 4 slots) for 5 tracks', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots).toHaveLength(4);
    expect(m.tracks).toHaveLength(5);
  });

  it('produces cold_open + 4 transitions + sign_off (= 6 slots) for 9 tracks', () => {
    const tracks = Array.from({ length: 9 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'standard', tracks,
    });
    expect(m.segmentSlots).toHaveLength(6);
  });

  it('produces cold_open + 7 transitions + sign_off (= 9 slots) for 15 tracks', () => {
    const tracks = Array.from({ length: 15 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'long', tracks,
    });
    expect(m.segmentSlots).toHaveLength(9);
  });

  it('produces cold_open + sign_off only (= 2 slots) for 1 track', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks: [t('only')],
    });
    expect(m.segmentSlots).toHaveLength(2);
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[1].kind).toBe('sign_off');
  });

  it('preserves input track order', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.tracks.map(x => x.id)).toEqual(['a', 'b', 'c']);
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

describe('buildManifest — slot targeting', () => {
  it('cold_open references first track via beforeTrackId', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[0].beforeTrackId).toBe('a');
    expect(m.segmentSlots[0].afterTrackId).toBeUndefined();
  });

  it('sign_off references last track via afterTrackId', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    const last = m.segmentSlots[m.segmentSlots.length - 1];
    expect(last.kind).toBe('sign_off');
    expect(last.afterTrackId).toBe('c');
    expect(last.beforeTrackId).toBeUndefined();
  });

  it('transitions fire before even-indexed tracks (2, 4, 6, ...)', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => t(String(i)));
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    // slots: 0=cold_open, 1=transition(after '1', before '2'), 2=transition(after '3', before '4'), 3=sign_off
    expect(m.segmentSlots[1].kind).toBe('transition');
    expect(m.segmentSlots[1].afterTrackId).toBe('1');
    expect(m.segmentSlots[1].beforeTrackId).toBe('2');
    expect(m.segmentSlots[2].kind).toBe('transition');
    expect(m.segmentSlots[2].afterTrackId).toBe('3');
    expect(m.segmentSlots[2].beforeTrackId).toBe('4');
  });
});

describe('buildManifest — tier alternation', () => {
  it('sets cold_open and sign_off tiers correctly', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => t(String(i))),
    });
    expect(m.segmentSlots[0].tier).toBe('cold_open');
    expect(m.segmentSlots[m.segmentSlots.length - 1].tier).toBe('sign_off');
  });

  it('alternates transitions starting with fact_bridge', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'long',
      tracks: Array.from({ length: 15 }, (_, i) => t(String(i))),
    });
    const transitions = m.segmentSlots.slice(1, -1);
    expect(transitions).toHaveLength(7);
    expect(transitions[0].tier).toBe('fact_bridge');
    expect(transitions[1].tier).toBe('tight_bridge');
    expect(transitions[2].tier).toBe('fact_bridge');
    expect(transitions[3].tier).toBe('tight_bridge');
    expect(transitions[4].tier).toBe('fact_bridge');
    expect(transitions[5].tier).toBe('tight_bridge');
    expect(transitions[6].tier).toBe('fact_bridge');
  });

  it('marks transitions as deep_dive when index is in featureSlots', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => t(String(i))),
      featureSlots: [1],
    });
    expect(m.segmentSlots[1].tier).toBe('deep_dive');
    // slot 2 should still follow alternation (tight_bridge, since slot 1 would
    // have been fact_bridge had featureSlots not overridden it)
    expect(m.segmentSlots[2].tier).toBe('tight_bridge');
  });

  it('stores featureSlots on the manifest', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => t(String(i))),
      featureSlots: [1],
    });
    expect(m.featureSlots).toEqual([1]);
  });
});

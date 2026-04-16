import { buildManifest } from '@/services/broadcast/ManifestBuilder';
import type { ManifestTrack } from '@/services/broadcast/types';

const t = (id: string): ManifestTrack => ({
  id, title: `Title ${id}`, artistName: `Artist ${id}`,
  albumTitle: `Album ${id}`, duration: 210,
});

describe('buildManifest', () => {
  const tracks = Array.from({ length: 20 }, (_, i) => t(String(i)));

  it('picks 5 tracks for quick length', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.tracks).toHaveLength(5);
  });

  it('picks 9 tracks for standard length', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'standard', tracks,
    });
    expect(m.tracks).toHaveLength(9);
  });

  it('picks 15 tracks for long length', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'long', tracks,
    });
    expect(m.tracks).toHaveLength(15);
  });

  it('produces N+1 segment slots for N tracks', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots).toHaveLength(6);
  });

  it('produces cold_open first, sign_off last, transitions between', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[m.segmentSlots.length - 1].kind).toBe('sign_off');
    for (let i = 1; i < m.segmentSlots.length - 1; i++) {
      expect(m.segmentSlots[i].kind).toBe('transition');
    }
  });

  it('wires afterTrackId/beforeTrackId correctly', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].beforeTrackId).toBe('0');
    expect(m.segmentSlots[0].afterTrackId).toBeUndefined();
    expect(m.segmentSlots[1].afterTrackId).toBe('0');
    expect(m.segmentSlots[1].beforeTrackId).toBe('1');
    expect(m.segmentSlots[5].kind).toBe('sign_off');
    expect(m.segmentSlots[5].afterTrackId).toBe('4');
    expect(m.segmentSlots[5].beforeTrackId).toBeUndefined();
  });

  it('all slots have variantCount 1 (MVP keeps the LLM budget tight)', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    for (let i = 0; i < m.segmentSlots.length; i++) {
      expect(m.segmentSlots[i].variantCount).toBe(1);
    }
  });

  it('throws if pool has fewer tracks than length requires', () => {
    const tooFew = Array.from({ length: 4 }, (_, i) => t(String(i)));
    expect(() => buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks: tooFew,
    })).toThrow('insufficient tracks');
  });
});

import { computeUpcoming } from '../../src/engines/BroadcastPlayer.upcoming';
import type { Manifest, PlayerState } from '../../src/engines/BroadcastPlayer.types';

// 5-track standard fixture under sparse cadence:
//   slot 0 = cold_open (before t0)
//   slot 1 = transition (after t1, before t2)
//   slot 2 = transition (after t3, before t4)
//   slot 3 = sign_off (after t4)
const make5Track = (): Manifest => ({
  broadcastId: 'b1',
  userId: 'u1',
  playlistId: 'p1',
  vibe: 'morning',
  length: 'standard',
  createdAt: 0,
  tracks: [
    { id: 't0', title: 'T0', artistName: 'A0', albumTitle: 'AL', duration: 180 },
    { id: 't1', title: 'T1', artistName: 'A1', albumTitle: 'AL', duration: 200 },
    { id: 't2', title: 'T2', artistName: 'A2', albumTitle: 'AL', duration: 220 },
    { id: 't3', title: 'T3', artistName: 'A3', albumTitle: 'AL', duration: 240 },
    { id: 't4', title: 'T4', artistName: 'A4', albumTitle: 'AL', duration: 260 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 2, kind: 'transition', afterTrackId: 't3', beforeTrackId: 't4', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 3, kind: 'sign_off', afterTrackId: 't4', variantCount: 1, status: 'ready', audioUrls: ['u'] },
  ],
});

// 3-track quick fixture: cold_open + sign_off only — no middle transitions.
const make3TrackNoTransitions = (): Manifest => ({
  broadcastId: 'b1',
  userId: 'u1',
  playlistId: 'p1',
  vibe: 'morning',
  length: 'quick',
  createdAt: 0,
  tracks: [
    { id: 't0', title: 'T0', artistName: 'A0', albumTitle: 'AL', duration: 180 },
    { id: 't1', title: 'T1', artistName: 'A1', albumTitle: 'AL', duration: 200 },
    { id: 't2', title: 'T2', artistName: 'A2', albumTitle: 'AL', duration: 220 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u'] },
    { index: 1, kind: 'sign_off', afterTrackId: 't2', variantCount: 1, status: 'ready', audioUrls: ['u'] },
  ],
});

const FRESH: { state: PlayerState; currentTrackIndex: number; currentSegmentIndex: number; nextSegmentIdx: number } = {
  state: 'loading',
  currentTrackIndex: -1,
  currentSegmentIndex: -1,
  nextSegmentIdx: 0,
};

describe('computeUpcoming', () => {
  it('case 1 — fresh start, before slot 0 plays: returns all tracks + transitions + sign_off', () => {
    const items = computeUpcoming({ manifest: make5Track(), ...FRESH });
    expect(items.map(i => i.kind)).toEqual([
      'track', 'track', 'transition', 'track', 'track', 'transition', 'track', 'sign_off',
    ]);
    expect(items.filter(i => i.kind === 'track').map(i => i.trackIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('case 2 — mid-cold-open: same as case 1 (cold_open is current, not upcoming)', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_segment',
      currentTrackIndex: -1,
      currentSegmentIndex: 0,
      nextSegmentIdx: 0, // cursor stays at 0 during cold_open; runMainLoop sets it to 1 after
    });
    expect(items.map(i => i.kind)).toEqual([
      'track', 'track', 'transition', 'track', 'track', 'transition', 'track', 'sign_off',
    ]);
  });

  it('case 3 — mid-track at index 2: returns t3, t4, transition before t4, sign_off', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_track',
      currentTrackIndex: 2,
      currentSegmentIndex: -1,
      nextSegmentIdx: 2,
    });
    expect(items.map(i => i.kind)).toEqual(['track', 'transition', 'track', 'sign_off']);
    expect(items.filter(i => i.kind === 'track').map(i => i.trackIndex)).toEqual([3, 4]);
  });

  it('case 4 — in-flight transition between t1 and t2: filtered out, next transition + remaining tracks shown', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_segment',
      currentTrackIndex: 1, // last completed track
      currentSegmentIndex: 1, // transition slot 1 is in flight
      nextSegmentIdx: 1, // engine cursor still at the in-flight slot
    });
    // Walk starts at track 2. cursor=1 (in-flight), slot 1.beforeTrackId='t2'
    //   matches t2 — but cursor === currentSegmentIndex, so SKIP. cursor → 2.
    // Track 2, 3 added. Slot 2.beforeTrackId='t4' matches t4. cursor !== current,
    //   add transition. cursor → 3. Track 4 added. Slot 3 = sign_off.
    expect(items.map(i => i.kind)).toEqual(['track', 'track', 'transition', 'track', 'sign_off']);
    expect(items.filter(i => i.kind === 'track').map(i => i.trackIndex)).toEqual([2, 3, 4]);
  });

  it('case 5 — last track playing: returns just sign_off', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_track',
      currentTrackIndex: 4,
      currentSegmentIndex: -1,
      nextSegmentIdx: 3,
    });
    expect(items.map(i => i.kind)).toEqual(['sign_off']);
  });

  it('case 6 — mid-sign-off: returns []', () => {
    const items = computeUpcoming({
      manifest: make5Track(),
      state: 'playing_segment',
      currentTrackIndex: 4,
      currentSegmentIndex: 3, // sign_off in flight
      nextSegmentIdx: 3,
    });
    expect(items).toEqual([]);
  });

  it('case 7 — failed transition in the middle: filtered, adjacent tracks render back-to-back', () => {
    const m = make5Track();
    m.segmentSlots[1].status = 'failed';
    const items = computeUpcoming({ manifest: m, ...FRESH });
    // Slot 1 (before t2) is failed → skipped. Slot 2 (before t4) still shown.
    expect(items.map(i => i.kind)).toEqual([
      'track', 'track', 'track', 'track', 'transition', 'track', 'sign_off',
    ]);
  });

  it('case 8 — manifest with no middle transitions: tracks + sign_off only', () => {
    const items = computeUpcoming({ manifest: make3TrackNoTransitions(), ...FRESH });
    expect(items.map(i => i.kind)).toEqual(['track', 'track', 'track', 'sign_off']);
  });

  it('case 9 — null manifest or ended state returns []', () => {
    expect(computeUpcoming({ manifest: null, ...FRESH })).toEqual([]);
    expect(computeUpcoming({ manifest: make5Track(), ...FRESH, state: 'ended' })).toEqual([]);
    expect(computeUpcoming({ manifest: make5Track(), ...FRESH, state: 'idle' })).toEqual([]);
    expect(computeUpcoming({ manifest: make5Track(), ...FRESH, state: 'error' })).toEqual([]);
  });

  it('produces stable React keys', () => {
    const items = computeUpcoming({ manifest: make5Track(), ...FRESH });
    const keys = items.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length); // unique
    // Track keys are track ids; segment keys are slot-<idx>.
    expect(keys[0]).toBe('t0');
    expect(keys.find(k => k.startsWith('slot-'))).toBeDefined();
  });
});

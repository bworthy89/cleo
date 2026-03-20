/**
 * Tests for src/cleo/fallbacks.ts
 *
 * NOTE: `recentlyUsed` is module-level state that persists across tests within
 * this file. Tests are ordered and written to account for that fact. The
 * recently-used window is MAX_RECENT = 5 lines, so calling the function more
 * than 5 times in a row with a large enough pool will eventually recycle lines.
 */

import { getFallbackLine, SegmentType, Vibe } from '../../src/cleo/fallbacks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Call getFallbackLine N times and return all results. */
function callN(n: number, type: SegmentType, vibe?: Vibe): string[] {
  const results: string[] = [];
  for (let i = 0; i < n; i++) {
    results.push(getFallbackLine(type, vibe));
  }
  return results;
}

/** Count distinct values in an array. */
function uniqueCount(arr: string[]): number {
  return new Set(arr).size;
}

// ---------------------------------------------------------------------------
// Basic return-value contract
// ---------------------------------------------------------------------------

describe('getFallbackLine — basic contract', () => {
  test('returns a non-empty string for a known type + vibe (song_intro / chill)', () => {
    const line = getFallbackLine('song_intro', 'chill');
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });

  test('returns a non-empty string when no vibe is supplied (track_story)', () => {
    const line = getFallbackLine('track_story');
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });

  test('returns a non-empty string for a known type + unknown vibe (falls back to type pool)', () => {
    // 'focus' vibe exists for song_intro but not for genre_bridge — should still work
    const line = getFallbackLine('genre_bridge', 'focus');
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// All 9 segment types return lines
// ---------------------------------------------------------------------------

describe('getFallbackLine — all 9 segment types', () => {
  const allTypes: SegmentType[] = [
    'song_intro',
    'track_story',
    'artist_context',
    'station_id',
    'listener_shoutout',
    'session_checkin',
    'genre_bridge',
    'post_track_reflection',
    'sign_off',
  ];

  test.each(allTypes)(
    'returns a non-empty string for type "%s"',
    (type) => {
      const line = getFallbackLine(type);
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
    }
  );
});

// ---------------------------------------------------------------------------
// Vibe-specific lines are included in the candidate pool
// ---------------------------------------------------------------------------

describe('getFallbackLine — vibe-specific lines appear in results', () => {
  // song_intro / morning has 6 vibe-specific lines and no generic (no-vibe)
  // entry for song_intro, so all 20 results must come from the morning pool.
  const morningLines = new Set([
    "This one's going to carry you through. Promise.",
    'Right on time — this track was made for exactly this moment.',
    'Keep moving. This one keeps pace with you.',
    "Morning energy — this next one has it.",
    "You need this one right now. Trust me.",
    "Here we go. This one sets the whole tone.",
  ]);

  test('calling 20 times with morning vibe returns ≥2 distinct lines', () => {
    const results = callN(20, 'song_intro', 'morning');
    expect(uniqueCount(results)).toBeGreaterThanOrEqual(2);
  });

  test('morning vibe results are drawn from the morning-specific pool', () => {
    const results = callN(20, 'song_intro', 'morning');
    for (const line of results) {
      expect(morningLines.has(line)).toBe(true);
    }
  });

  // session_checkin has both vibe-specific (chill: 5 lines) and generic
  // (no-vibe: 5 lines). Calling 20 times should yield ≥2 distinct lines.
  test('calling 20 times with chill vibe (session_checkin) returns ≥2 distinct lines', () => {
    const results = callN(20, 'session_checkin', 'chill');
    expect(uniqueCount(results)).toBeGreaterThanOrEqual(2);
  });

  // Verify that at least one chill-specific line appears across 20 calls
  test('chill-specific session_checkin lines appear in results', () => {
    const chillLines = new Set([
      "Still with me? Good. We've got more.",
      "We're deep into this now. The playlist has earned your attention.",
      "You've been here a while. So have I. Neither of us is leaving.",
      'This is what a good session feels like.',
      "Deep in it now. Stay.",
    ]);

    const results = callN(20, 'session_checkin', 'chill');
    const hasChillLine = results.some((l) => chillLines.has(l));
    expect(hasChillLine).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No-immediate-repeat within pool — 6 calls yield > 1 unique
// ---------------------------------------------------------------------------

describe('getFallbackLine — no immediate repeats within pool', () => {
  // sign_off has 5 lines. Calling 6 times must produce at least 2 distinct
  // lines because MAX_RECENT = 5 prevents the same line from appearing back-
  // to-back until the window shifts.
  test('sign_off: 6 consecutive calls return more than 1 unique line', () => {
    const results = callN(6, 'sign_off');
    expect(uniqueCount(results)).toBeGreaterThan(1);
  });

  // genre_bridge has 6 lines. 6 calls should yield at least 2 distinct.
  test('genre_bridge: 6 consecutive calls return more than 1 unique line', () => {
    const results = callN(6, 'genre_bridge');
    expect(uniqueCount(results)).toBeGreaterThan(1);
  });

  // post_track_reflection has 6 lines. 6 calls should yield at least 2 distinct.
  test('post_track_reflection: 6 consecutive calls return more than 1 unique line', () => {
    const results = callN(6, 'post_track_reflection');
    expect(uniqueCount(results)).toBeGreaterThan(1);
  });

  // song_intro + workout has 6 lines. 6 calls should yield at least 2 distinct.
  test('song_intro (workout vibe): 6 consecutive calls return more than 1 unique line', () => {
    const results = callN(6, 'song_intro', 'workout');
    expect(uniqueCount(results)).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Edge-case: type with only generic entries works without a vibe argument
// ---------------------------------------------------------------------------

describe('getFallbackLine — generic-only types work without vibe', () => {
  const genericOnlyTypes: SegmentType[] = [
    'track_story',
    'artist_context',
    'station_id',
    'listener_shoutout',
    'genre_bridge',
    'post_track_reflection',
    'sign_off',
  ];

  test.each(genericOnlyTypes)(
    '"%s" returns a non-empty string without vibe argument',
    (type) => {
      expect(getFallbackLine(type).length).toBeGreaterThan(0);
    }
  );
});

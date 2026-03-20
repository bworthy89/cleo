import { sessionEngine } from '../../src/engines/SessionEngine';
import type { QueuePlan } from '../../src/engines/QueuePlanner';

// The moduleNameMapper points react-native-mmkv to our manual mock which
// exports __resetAllStores. We reach it via require to avoid TS type errors.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __resetAllStores } = require('react-native-mmkv') as {
  __resetAllStores: () => void;
};

beforeEach(() => {
  // Force-end any running session to reset singleton state
  // endSession is a no-op if session is already null, so call it unconditionally
  // We need to bypass the guard — start a dummy session then end it
  try { sessionEngine.endSession(); } catch (_) {}
  // If there was no session, endSession was a no-op; start+end to guarantee null
  try {
    sessionEngine.startSession('__reset__', 'general');
    sessionEngine.endSession();
  } catch (_) {}
  __resetAllStores();
});

// Helper to build a minimal QueuePlan
function makePlan(trackIds: string[]): QueuePlan {
  return {
    arcShape: 'short',
    queue: trackIds.map((trackId, i) => ({
      trackId,
      position: i,
      role: 'filler',
      reason: 'test',
    })),
  };
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------
describe('getSession', () => {
  it('returns null before startSession is called', () => {
    expect(sessionEngine.getSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startSession
// ---------------------------------------------------------------------------
describe('startSession', () => {
  it('creates a valid session with stationId, vibe, empty arrays, and index 0', () => {
    const session = sessionEngine.startSession('station-1', 'chill');

    expect(session).not.toBeNull();
    expect(session.stationId).toBe('station-1');
    expect(session.vibe).toBe('chill');
    expect(session.tracksPlayed).toEqual([]);
    expect(session.skippedTracks).toEqual([]);
    expect(session.currentQueueIndex).toBe(0);
    expect(session.queuePlan).toBeNull();
    expect(typeof session.id).toBe('string');
    expect(typeof session.startTime).toBe('number');
  });

  it('returns the same session from getSession()', () => {
    const created = sessionEngine.startSession('station-2', 'morning');
    expect(sessionEngine.getSession()).toBe(created);
  });

  it('starts a new session replacing any previous one', () => {
    const first = sessionEngine.startSession('s1', 'focus');
    const second = sessionEngine.startSession('s2', 'workout');
    expect(second.stationId).toBe('s2');
    expect(sessionEngine.getSession()).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// advanceTrack
// ---------------------------------------------------------------------------
describe('advanceTrack', () => {
  it('adds to tracksPlayed and increments currentQueueIndex', () => {
    sessionEngine.startSession('station-1', 'general');

    sessionEngine.advanceTrack('track-A');
    const session = sessionEngine.getSession()!;
    expect(session.tracksPlayed).toEqual(['track-A']);
    expect(session.currentQueueIndex).toBe(1);
  });

  it('accumulates multiple advances', () => {
    sessionEngine.startSession('station-1', 'general');

    sessionEngine.advanceTrack('track-A');
    sessionEngine.advanceTrack('track-B');
    sessionEngine.advanceTrack('track-C');

    const session = sessionEngine.getSession()!;
    expect(session.tracksPlayed).toEqual(['track-A', 'track-B', 'track-C']);
    expect(session.currentQueueIndex).toBe(3);
  });

  it('is a no-op when there is no session', () => {
    expect(() => sessionEngine.advanceTrack('track-X')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// recordSkip
// ---------------------------------------------------------------------------
describe('recordSkip', () => {
  it('adds to skippedTracks but does NOT advance currentQueueIndex', () => {
    sessionEngine.startSession('station-1', 'general');

    sessionEngine.recordSkip('track-A');
    const session = sessionEngine.getSession()!;
    expect(session.skippedTracks).toEqual(['track-A']);
    expect(session.currentQueueIndex).toBe(0);
  });

  it('accumulates multiple skips without advancing index', () => {
    sessionEngine.startSession('station-1', 'general');

    sessionEngine.recordSkip('track-A');
    sessionEngine.recordSkip('track-B');

    const session = sessionEngine.getSession()!;
    expect(session.skippedTracks).toEqual(['track-A', 'track-B']);
    expect(session.currentQueueIndex).toBe(0);
  });

  it('is a no-op when there is no session', () => {
    expect(() => sessionEngine.recordSkip('track-X')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getConsecutiveSkips
// ---------------------------------------------------------------------------
describe('getConsecutiveSkips', () => {
  it('returns 0 with no session', () => {
    expect(sessionEngine.getConsecutiveSkips()).toBe(0);
  });

  it('returns 0 when nothing has been skipped', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.advanceTrack('track-A');
    expect(sessionEngine.getConsecutiveSkips()).toBe(0);
  });

  it('returns 0 when skipped tracks do not match played tracks', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.advanceTrack('track-A');
    sessionEngine.recordSkip('track-B');
    // skippedTracks[-1] = 'track-B', tracksPlayed[-1 - 0] = 'track-A' — no match
    expect(sessionEngine.getConsecutiveSkips()).toBe(0);
  });

  it('counts matching entries at the same relative-from-end position', () => {
    // The algorithm compares skippedTracks[i] to tracksPlayed[tracksPlayed.length - 1 - count]
    // A match occurs when the skip ID equals the played ID at the mirrored position.
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.advanceTrack('track-A');
    sessionEngine.advanceTrack('track-B');
    // Add skips whose IDs match the tracksPlayed entries at the same relative-from-end index
    // skippedTracks = ['track-B', 'track-A']
    // Iteration i=1 (last): skippedTracks[1]='track-A', lastPlayed[0]='track-B' → no match → break
    // So count = 0 in this arrangement. Let's verify by making the last skip match the last played:
    // skippedTracks = ['track-B'], tracksPlayed = ['track-A', 'track-B']
    // i=0: skippedTracks[0]='track-B', tracksPlayed[2-1-0]='track-B' → match → count=1
    // i loop ends → return 1
    sessionEngine.recordSkip('track-B'); // skippedTracks = ['track-B']
    expect(sessionEngine.getConsecutiveSkips()).toBe(1);
  });

  it('returns 0 with only skips and no plays (no overlap)', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.recordSkip('track-X');
    // tracksPlayed is empty, so lastPlayed = undefined; 'track-X' !== undefined → 0
    expect(sessionEngine.getConsecutiveSkips()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getCurrentPhase
// ---------------------------------------------------------------------------
describe('getCurrentPhase', () => {
  it('returns coldOpen when there is no session', () => {
    expect(sessionEngine.getCurrentPhase()).toBe('coldOpen');
  });

  it('returns coldOpen with no tracks played (regardless of duration)', () => {
    sessionEngine.startSession('station-1', 'general');
    expect(sessionEngine.getCurrentPhase()).toBe('coldOpen');
  });

  it('returns earlySession after playing tracks (session < 12 min)', () => {
    // startTime defaults to Date.now(), so duration ≈ 0 minutes < 12
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.advanceTrack('track-A');
    expect(sessionEngine.getCurrentPhase()).toBe('earlySession');
  });
});

// ---------------------------------------------------------------------------
// getNextTrackId
// ---------------------------------------------------------------------------
describe('getNextTrackId', () => {
  it('returns null when there is no queue plan', () => {
    sessionEngine.startSession('station-1', 'general');
    expect(sessionEngine.getNextTrackId()).toBeNull();
  });

  it('returns the first track at index 0', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.setQueuePlan(makePlan(['alpha', 'beta', 'gamma']));
    expect(sessionEngine.getNextTrackId()).toBe('alpha');
  });

  it('returns the correct track after advancing', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.setQueuePlan(makePlan(['alpha', 'beta', 'gamma']));
    sessionEngine.advanceTrack('alpha'); // index → 1
    expect(sessionEngine.getNextTrackId()).toBe('beta');
  });

  it('returns null past the end of the queue', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.setQueuePlan(makePlan(['only']));
    sessionEngine.advanceTrack('only'); // index → 1, queue.length = 1
    expect(sessionEngine.getNextTrackId()).toBeNull();
  });

  it('returns null without a session', () => {
    expect(sessionEngine.getNextTrackId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getNextTrackIds
// ---------------------------------------------------------------------------
describe('getNextTrackIds', () => {
  it('returns empty array with no queue plan', () => {
    sessionEngine.startSession('station-1', 'general');
    expect(sessionEngine.getNextTrackIds(3)).toEqual([]);
  });

  it('returns multiple upcoming track IDs', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.setQueuePlan(makePlan(['A', 'B', 'C', 'D']));
    expect(sessionEngine.getNextTrackIds(3)).toEqual(['A', 'B', 'C']);
  });

  it('returns fewer entries if near queue end', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.setQueuePlan(makePlan(['A', 'B', 'C']));
    sessionEngine.advanceTrack('A'); // index → 1
    sessionEngine.advanceTrack('B'); // index → 2
    expect(sessionEngine.getNextTrackIds(5)).toEqual(['C']);
  });

  it('returns empty array past queue end', () => {
    sessionEngine.startSession('station-1', 'general');
    sessionEngine.setQueuePlan(makePlan(['A']));
    sessionEngine.advanceTrack('A'); // index → 1
    expect(sessionEngine.getNextTrackIds(3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// setQueuePlan
// ---------------------------------------------------------------------------
describe('setQueuePlan', () => {
  it('stores the plan in the session', () => {
    sessionEngine.startSession('station-1', 'general');
    const plan = makePlan(['X', 'Y', 'Z']);
    sessionEngine.setQueuePlan(plan);
    expect(sessionEngine.getSession()!.queuePlan).toEqual(plan);
  });

  it('is a no-op when there is no session', () => {
    expect(() => sessionEngine.setQueuePlan(makePlan(['X']))).not.toThrow();
    expect(sessionEngine.getSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// endSession
// ---------------------------------------------------------------------------
describe('endSession', () => {
  it('nulls the session', () => {
    sessionEngine.startSession('station-1', 'general');
    expect(sessionEngine.getSession()).not.toBeNull();
    sessionEngine.endSession();
    expect(sessionEngine.getSession()).toBeNull();
  });

  it('is a no-op when session is already null', () => {
    expect(() => sessionEngine.endSession()).not.toThrow();
    expect(sessionEngine.getSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSessionDuration
// ---------------------------------------------------------------------------
describe('getSessionDuration', () => {
  it('returns 0 when there is no session', () => {
    expect(sessionEngine.getSessionDuration()).toBe(0);
  });

  it('returns 0 for a freshly started session (< 1 minute elapsed)', () => {
    sessionEngine.startSession('station-1', 'general');
    // startTime is Date.now(), so elapsed ≈ 0ms → 0 minutes
    expect(sessionEngine.getSessionDuration()).toBe(0);
  });
});

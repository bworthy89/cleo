import { __resetAllStores } from '../../__mocks__/react-native-mmkv';
import { storage } from '../../src/services/Storage';

const QUEUE_CACHE_PREFIX = 'queuePlanCache:';
const TTL = 4 * 60 * 60 * 1000; // 4 hours in ms

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(label: string) {
  return {
    queue: [{ trackId: `track-${label}`, position: 1, role: 'opener' }],
    arcShape: 'short' as const,
  };
}

function writeCacheEntry(
  playlistId: string,
  vibe: string,
  plan: object,
  timestamp: number,
) {
  storage.set(
    `${QUEUE_CACHE_PREFIX}${playlistId}:${vibe}`,
    JSON.stringify({ plan, timestamp }),
  );
}

function readCacheEntry(
  playlistId: string,
  vibe: string,
): { plan: object; timestamp: number } | null {
  const raw = storage.getString(`${QUEUE_CACHE_PREFIX}${playlistId}:${vibe}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { plan: object; timestamp: number };
  } catch {
    return null;
  }
}

function isCacheExpired(timestamp: number): boolean {
  return Date.now() - timestamp > TTL;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetAllStores();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue plan cache — key structure', () => {
  it('cache key includes playlistId and vibe: write to queuePlanCache:playlist-1:chill, read it back', () => {
    const plan = makePlan('chill');
    const now = Date.now();

    writeCacheEntry('playlist-1', 'chill', plan, now);

    const entry = readCacheEntry('playlist-1', 'chill');
    expect(entry).not.toBeNull();
    expect(entry!.plan).toEqual(plan);
    expect(entry!.timestamp).toBe(now);
  });

  it('the raw MMKV key matches the expected prefix + playlistId + vibe pattern', () => {
    const plan = makePlan('morning');
    const now = Date.now();

    writeCacheEntry('pl-abc', 'morning', plan, now);

    // Confirm the exact key that was written is readable
    const raw = storage.getString('queuePlanCache:pl-abc:morning');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { plan: object; timestamp: number };
    expect(parsed.plan).toEqual(plan);
  });
});

describe('Queue plan cache — vibe isolation', () => {
  it('different vibes produce separate cache entries that do not overwrite each other', () => {
    const chillPlan = makePlan('chill');
    const workoutPlan = makePlan('workout');
    const now = Date.now();

    writeCacheEntry('playlist-1', 'chill', chillPlan, now);
    writeCacheEntry('playlist-1', 'workout', workoutPlan, now);

    const chillEntry = readCacheEntry('playlist-1', 'chill');
    const workoutEntry = readCacheEntry('playlist-1', 'workout');

    expect(chillEntry).not.toBeNull();
    expect(workoutEntry).not.toBeNull();
    expect(chillEntry!.plan).toEqual(chillPlan);
    expect(workoutEntry!.plan).toEqual(workoutPlan);
  });

  it('writing a second vibe does not affect the first vibe entry', () => {
    const firstPlan = makePlan('lateNight');
    const secondPlan = makePlan('focus');
    const now = Date.now();

    writeCacheEntry('playlist-2', 'lateNight', firstPlan, now);
    writeCacheEntry('playlist-2', 'focus', secondPlan, now);

    // lateNight entry should remain unchanged
    const lateNightEntry = readCacheEntry('playlist-2', 'lateNight');
    expect(lateNightEntry!.plan).toEqual(firstPlan);
    expect(lateNightEntry!.plan).not.toEqual(secondPlan);
  });
});

describe('Queue plan cache — expiry: expired entry (>4h timestamp)', () => {
  it('a timestamp older than 4 hours is considered stale', () => {
    const expiredTimestamp = Date.now() - TTL - 1; // 1ms past the TTL boundary
    writeCacheEntry('playlist-3', 'chill', makePlan('chill'), expiredTimestamp);

    const entry = readCacheEntry('playlist-3', 'chill');
    expect(entry).not.toBeNull(); // raw data is still there

    expect(isCacheExpired(entry!.timestamp)).toBe(true);
  });

  it('a timestamp TTL + 1s ago is stale (strictly past the boundary)', () => {
    // The source uses `> QUEUE_CACHE_TTL_MS` (strict greater-than).
    // A timestamp that is TTL + 1000ms in the past is unambiguously expired.
    const pastBoundaryTimestamp = Date.now() - TTL - 1_000;
    writeCacheEntry('playlist-3', 'workout', makePlan('workout'), pastBoundaryTimestamp);

    const entry = readCacheEntry('playlist-3', 'workout');
    expect(entry).not.toBeNull();
    expect(Date.now() - entry!.timestamp).toBeGreaterThan(TTL);
    expect(isCacheExpired(entry!.timestamp)).toBe(true);
  });

  it('getCachedQueuePlan logic: expired cache returns null plan (simulate the check)', () => {
    const expiredTimestamp = Date.now() - TTL - 60_000; // 1 minute past expiry
    const plan = makePlan('melancholy');

    writeCacheEntry('playlist-4', 'melancholy', plan, expiredTimestamp);

    const entry = readCacheEntry('playlist-4', 'melancholy');
    // Simulate getCachedQueuePlan: if expired, return null
    const result = entry && !isCacheExpired(entry.timestamp) ? entry.plan : null;
    expect(result).toBeNull();
  });
});

describe('Queue plan cache — validity: fresh entry (<4h timestamp)', () => {
  it('a timestamp of just now is not expired', () => {
    const freshTimestamp = Date.now();
    writeCacheEntry('playlist-5', 'morning', makePlan('morning'), freshTimestamp);

    const entry = readCacheEntry('playlist-5', 'morning');
    expect(entry).not.toBeNull();
    expect(isCacheExpired(entry!.timestamp)).toBe(false);
  });

  it('a timestamp 1 hour ago is still within the 4h TTL', () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    writeCacheEntry('playlist-5', 'chill', makePlan('chill'), oneHourAgo);

    const entry = readCacheEntry('playlist-5', 'chill');
    expect(entry).not.toBeNull();
    expect(isCacheExpired(entry!.timestamp)).toBe(false);
  });

  it('a timestamp 3h 59m 59s ago is still valid', () => {
    const justUnderTTL = Date.now() - TTL + 1_000; // 1s before expiry
    writeCacheEntry('playlist-5', 'focus', makePlan('focus'), justUnderTTL);

    const entry = readCacheEntry('playlist-5', 'focus');
    expect(entry).not.toBeNull();
    expect(isCacheExpired(entry!.timestamp)).toBe(false);
  });

  it('getCachedQueuePlan logic: fresh cache returns the stored plan (simulate the check)', () => {
    const freshTimestamp = Date.now();
    const plan = makePlan('feelGood');

    writeCacheEntry('playlist-6', 'feelGood', plan, freshTimestamp);

    const entry = readCacheEntry('playlist-6', 'feelGood');
    // Simulate getCachedQueuePlan: if not expired, return plan
    const result = entry && !isCacheExpired(entry.timestamp) ? entry.plan : null;
    expect(result).toEqual(plan);
  });
});

describe('Queue plan cache — isolation between playlists', () => {
  it('two playlists with the same vibe have independent cache entries', () => {
    const planA = makePlan('pl-a');
    const planB = makePlan('pl-b');
    const now = Date.now();

    writeCacheEntry('playlist-a', 'chill', planA, now);
    writeCacheEntry('playlist-b', 'chill', planB, now);

    expect(readCacheEntry('playlist-a', 'chill')!.plan).toEqual(planA);
    expect(readCacheEntry('playlist-b', 'chill')!.plan).toEqual(planB);
  });
});

describe('Queue plan cache — missing entry', () => {
  it('returns null for a key that was never written', () => {
    const entry = readCacheEntry('nonexistent-playlist', 'chill');
    expect(entry).toBeNull();
  });

  it('returns null after __resetAllStores clears previously written data', () => {
    writeCacheEntry('playlist-x', 'party', makePlan('party'), Date.now());

    // Confirm data was written
    expect(readCacheEntry('playlist-x', 'party')).not.toBeNull();

    // Reset and confirm it's gone
    __resetAllStores();
    expect(readCacheEntry('playlist-x', 'party')).toBeNull();
  });
});

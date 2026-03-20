import { __resetAllStores } from '../../__mocks__/react-native-mmkv';
import {
  loadSessionMemory,
  saveSessionMemory,
  incrementSessionCount,
  clearSessionMemory,
  getTimeSinceLastSession,
  type SessionMemoryData,
} from '../../src/services/SessionMemory';

beforeEach(() => {
  __resetAllStores();
});

describe('loadSessionMemory', () => {
  it('returns null when storage is empty', () => {
    expect(loadSessionMemory()).toBeNull();
  });
});

describe('saveSessionMemory + loadSessionMemory', () => {
  it('roundtrips a full SessionMemoryData object', () => {
    const data: SessionMemoryData = {
      lastStationId: 'station-1',
      lastVibe: 'chill',
      lastArtists: ['Norah Jones', 'Bon Iver'],
      lastTrackTitle: 'Come Away With Me',
      lastArtistName: 'Norah Jones',
      lastTimestamp: 1700000000000,
      sessionCount: 3,
    };
    saveSessionMemory(data);
    expect(loadSessionMemory()).toEqual(data);
  });

  it('roundtrips a partial save', () => {
    saveSessionMemory({ lastVibe: 'focus', sessionCount: 1 });
    const result = loadSessionMemory();
    expect(result?.lastVibe).toBe('focus');
    expect(result?.sessionCount).toBe(1);
  });
});

describe('saveSessionMemory merging', () => {
  it('merges new fields with existing data without overwriting untouched fields', () => {
    saveSessionMemory({ lastStationId: 'station-abc', lastVibe: 'morning', sessionCount: 2 });
    saveSessionMemory({ lastVibe: 'lateNight', lastTrackTitle: 'Blue in Green' });

    const result = loadSessionMemory();
    expect(result?.lastStationId).toBe('station-abc'); // preserved
    expect(result?.sessionCount).toBe(2);              // preserved
    expect(result?.lastVibe).toBe('lateNight');        // updated
    expect(result?.lastTrackTitle).toBe('Blue in Green'); // new field
  });
});

describe('incrementSessionCount', () => {
  it('starts at 1 when no prior data exists', () => {
    expect(incrementSessionCount()).toBe(1);
  });

  it('returns 1 and persists it after first call', () => {
    incrementSessionCount();
    expect(loadSessionMemory()?.sessionCount).toBe(1);
  });

  it('increments on subsequent calls', () => {
    incrementSessionCount();
    incrementSessionCount();
    const count = incrementSessionCount();
    expect(count).toBe(3);
  });

  it('increments from an existing sessionCount', () => {
    saveSessionMemory({ sessionCount: 10 });
    expect(incrementSessionCount()).toBe(11);
  });
});

describe('clearSessionMemory', () => {
  it('removes all data so loadSessionMemory returns null', () => {
    saveSessionMemory({ lastVibe: 'party', sessionCount: 5 });
    clearSessionMemory();
    expect(loadSessionMemory()).toBeNull();
  });

  it('calling clear on empty storage does not throw', () => {
    expect(() => clearSessionMemory()).not.toThrow();
  });
});

describe('getTimeSinceLastSession', () => {
  it('returns null when no lastTimestamp is stored', () => {
    expect(getTimeSinceLastSession()).toBeNull();
  });

  it('returns null when storage is completely empty', () => {
    expect(getTimeSinceLastSession()).toBeNull();
  });

  it('returns "just now" for a session less than 1 hour ago', () => {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    saveSessionMemory({ lastTimestamp: thirtyMinutesAgo });
    const result = getTimeSinceLastSession();
    expect(result).not.toBeNull();
    expect(result!.label).toBe('just now');
    expect(result!.hours).toBe(0);
  });

  it('returns "just now" for a session seconds ago', () => {
    saveSessionMemory({ lastTimestamp: Date.now() - 5000 });
    expect(getTimeSinceLastSession()!.label).toBe('just now');
  });

  it('returns "1 hour ago" (singular) for exactly 1 hour ago', () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000 - 1000; // slightly over 1 hr
    saveSessionMemory({ lastTimestamp: oneHourAgo });
    const result = getTimeSinceLastSession();
    expect(result!.label).toBe('1 hour ago');
    expect(result!.hours).toBe(1);
  });

  it('returns "2 hours ago" (plural) for 2 hours ago', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000 - 1000;
    saveSessionMemory({ lastTimestamp: twoHoursAgo });
    const result = getTimeSinceLastSession();
    expect(result!.label).toBe('2 hours ago');
    expect(result!.hours).toBe(2);
  });

  it('returns "3 hours ago" (plural) for 3 hours ago', () => {
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000 - 1000;
    saveSessionMemory({ lastTimestamp: threeHoursAgo });
    const result = getTimeSinceLastSession();
    expect(result!.label).toBe('3 hours ago');
    expect(result!.hours).toBe(3);
  });

  it('singular "hour" for 1, plural "hours" for 2-3', () => {
    // singular
    saveSessionMemory({ lastTimestamp: Date.now() - 1 * 60 * 60 * 1000 - 5000 });
    expect(getTimeSinceLastSession()!.label).toContain('hour ago');

    __resetAllStores();

    // plural
    saveSessionMemory({ lastTimestamp: Date.now() - 2 * 60 * 60 * 1000 - 5000 });
    expect(getTimeSinceLastSession()!.label).toContain('hours ago');
  });

  it('returns sameDay: true for a timestamp from today', () => {
    saveSessionMemory({ lastTimestamp: Date.now() - 30 * 60 * 1000 });
    const result = getTimeSinceLastSession();
    expect(result!.sameDay).toBe(true);
  });
});

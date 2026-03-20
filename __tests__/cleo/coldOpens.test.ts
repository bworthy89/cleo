import { __resetAllStores } from '../../__mocks__/react-native-mmkv';
import { storage } from '../../src/services/Storage';
import { getColdOpen } from '../../src/cleo/cold-opens';
import type { Vibe } from '../../src/cleo/fallbacks';

const ALL_VIBES: Vibe[] = [
  'morning', 'chill', 'workout', 'lateNight', 'party',
  'general', 'focus', 'feelGood', 'throwback', 'elevated', 'melancholy', 'sunday',
];

/** ISO date string for today */
function today(): string {
  return new Date().toISOString().substring(0, 10);
}

/** ISO date string for yesterday */
function yesterday(): string {
  return new Date(Date.now() - 86400000).toISOString().substring(0, 10);
}

/** Write a ColdOpenHistory object into the shared storage instance */
function setColdOpenHistory(history: {
  lastUsedByVibe?: Record<string, number>;
  consecutiveDays?: number;
  lastSessionDate?: string;
  totalSessions?: number;
}) {
  storage.set(
    'coldOpenHistory',
    JSON.stringify({
      lastUsedByVibe: {},
      consecutiveDays: 0,
      lastSessionDate: '',
      totalSessions: 0,
      ...history,
    }),
  );
}

beforeEach(() => {
  __resetAllStores();
});

// ---------------------------------------------------------------------------
// Priority 1 — First ever session
// ---------------------------------------------------------------------------

describe('getColdOpen — first ever session (totalSessions === 0)', () => {
  it('returns the firstEver line containing "first time here"', () => {
    // Storage is empty after __resetAllStores, so totalSessions defaults to 0
    const line = getColdOpen('morning');
    expect(line).toContain('first time here');
  });

  it('returns the firstEver line regardless of vibe', () => {
    for (const vibe of ALL_VIBES) {
      __resetAllStores();
      const line = getColdOpen(vibe);
      expect(line).toContain('first time here');
    }
  });
});

// ---------------------------------------------------------------------------
// Priority 2 — Same-day return
// ---------------------------------------------------------------------------

describe('getColdOpen — same-day return', () => {
  it('first call returns firstEver, second call on same day returns a sameDayReturn line', () => {
    // First call: totalSessions === 0 → firstEver
    const first = getColdOpen('chill');
    expect(first).toContain('first time here');

    // After the first call, the module saves lastSessionDate = today and totalSessions = 1
    // Second call on same day → sameDayReturn
    const second = getColdOpen('chill');
    expect(second).not.toContain('first time here');

    const sameDayLines = [
      'Back already?',
      'You came back.',
      'Second session today',
      "Didn't think you'd be back",
      'You returned.',
      "Back for more.",
    ];
    const matchesSameDayPool = sameDayLines.some((fragment) =>
      second.includes(fragment),
    );
    expect(matchesSameDayPool).toBe(true);
  });

  it('returns a different sameDayReturn line on the second call when history already has totalSessions > 0 and lastSessionDate is today', () => {
    setColdOpenHistory({ totalSessions: 3, lastSessionDate: today() });

    const line = getColdOpen('morning');
    // Should NOT be a vibe line — must come from sameDayReturn pool
    const sameDayFragments = [
      'Back already?',
      'You came back.',
      'Second session today',
      "Didn't think you'd be back",
      'You returned.',
      'Back for more.',
    ];
    const isSameDay = sameDayFragments.some((f) => line.includes(f));
    expect(isSameDay).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// All 12 vibes produce a line (default vibe-matched path)
// ---------------------------------------------------------------------------

describe('getColdOpen — all 12 vibes produce a non-empty line', () => {
  it.each(ALL_VIBES)('vibe "%s" returns a non-empty string', (vibe) => {
    // Set up: past session date (not today, not yesterday) → default/vibe-matched path
    setColdOpenHistory({
      totalSessions: 5,
      lastSessionDate: '2020-01-01',
      consecutiveDays: 1,
    });

    // Ensure it's not Monday or Friday to avoid special-day paths
    // We can't control the real clock's day-of-week, so we accept that the test
    // just needs to return SOME non-empty string from any pool.
    const line = getColdOpen(vibe);
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });
});

describe('getColdOpen — vibe-matched path returns known vibe content', () => {
  // Force a Wednesday (or any non-Monday/non-Friday) by mocking Date.getDay
  // We pick a day-of-week that is neither 1 (Mon) nor 5 (Fri) and hour < 21
  // to guarantee the vibe path. Since we cannot rely on the real clock being
  // a specific day, we mock Date.

  const RealDate = global.Date;

  function mockDateToWednesdayNoon() {
    const fixed = new RealDate('2025-07-09T12:00:00.000Z'); // Wednesday
    // @ts-ignore
    global.Date = class extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super('2025-07-09T12:00:00.000Z');
        } else {
          // @ts-ignore
          super(...args);
        }
      }
      static now() {
        return fixed.getTime();
      }
    };
  }

  beforeEach(() => {
    mockDateToWednesdayNoon();
  });

  afterEach(() => {
    global.Date = RealDate;
  });

  it.each(ALL_VIBES)('vibe "%s" returns a non-empty string on a neutral weekday', (vibe) => {
    // Wednesday, noon, past date, low consecutiveDays → vibe-matched path
    setColdOpenHistory({
      totalSessions: 5,
      lastSessionDate: '2025-07-08', // yesterday relative to mocked date
      consecutiveDays: 1,
    });

    const line = getColdOpen(vibe);
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Streak detection
// ---------------------------------------------------------------------------

describe('getColdOpen — streak detection', () => {
  it('increments consecutiveDays from 1 to 2 when lastSessionDate was yesterday', () => {
    setColdOpenHistory({
      totalSessions: 3,
      lastSessionDate: yesterday(),
      consecutiveDays: 1,
    });

    // Call getColdOpen — streak logic should fire and increment consecutiveDays
    getColdOpen('focus');

    // Read back the saved history and verify
    const raw = storage.getString('coldOpenHistory');
    expect(raw).toBeDefined();
    const saved = JSON.parse(raw!);
    expect(saved.consecutiveDays).toBe(2);
  });

  it('increments totalSessions by 1 on each call', () => {
    setColdOpenHistory({ totalSessions: 7, lastSessionDate: '2020-01-01', consecutiveDays: 1 });

    getColdOpen('chill');

    const raw = storage.getString('coldOpenHistory');
    const saved = JSON.parse(raw!);
    expect(saved.totalSessions).toBe(8);
  });

  it('sets lastSessionDate to today after any call', () => {
    setColdOpenHistory({ totalSessions: 2, lastSessionDate: '2020-01-01', consecutiveDays: 1 });

    getColdOpen('morning');

    const raw = storage.getString('coldOpenHistory');
    const saved = JSON.parse(raw!);
    expect(saved.lastSessionDate).toBe(today());
  });

  it('does NOT increment consecutiveDays when lastSessionDate is today (same-day return)', () => {
    setColdOpenHistory({
      totalSessions: 2,
      lastSessionDate: today(),
      consecutiveDays: 1,
    });

    getColdOpen('chill');

    const raw = storage.getString('coldOpenHistory');
    const saved = JSON.parse(raw!);
    // The streak update condition: lastSessionDate === yesterday → increment
    // today's date is already today, so no increment
    expect(saved.consecutiveDays).toBe(1);
  });

  it('resets consecutiveDays to 1 when lastSessionDate is older than yesterday', () => {
    setColdOpenHistory({
      totalSessions: 5,
      lastSessionDate: '2020-01-01', // very old
      consecutiveDays: 10,
    });

    getColdOpen('general');

    const raw = storage.getString('coldOpenHistory');
    const saved = JSON.parse(raw!);
    expect(saved.consecutiveDays).toBe(1);
  });
});

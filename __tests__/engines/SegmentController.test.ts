// Mock CleoScriptGenerator BEFORE importing segmentController (singleton)
jest.mock('../../src/services/CleoScriptGenerator', () => ({
  generateSegment: jest.fn(async (ctx: any) => `Generated: ${ctx.segmentType}`),
}));

import { __resetAllStores } from '../../__mocks__/react-native-mmkv';
import { segmentController } from '../../src/engines/SegmentController';
import { generateSegment } from '../../src/services/CleoScriptGenerator';

const mockGenerateSegment = generateSegment as jest.Mock;

const mockTrack = {
  id: 't1',
  title: 'Test Track',
  artistName: 'Test Artist',
  albumTitle: 'Test Album',
  duration: 240,
};

beforeEach(() => {
  __resetAllStores();
  mockGenerateSegment.mockClear();
  segmentController.startSession('station-1', 'chill');
});

// ---------------------------------------------------------------------------
// getSegmentCount
// ---------------------------------------------------------------------------

describe('getSegmentCount', () => {
  it('starts at 0 after startSession', () => {
    expect(segmentController.getSegmentCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// First segment — cold open
// ---------------------------------------------------------------------------

describe('generateNext — first segment (cold open)', () => {
  it('returns type song_intro with pre_song delivery without calling generateSegment', async () => {
    const result = await segmentController.generateNext(mockTrack);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('song_intro');
    expect(result!.deliveryMode).toBe('pre_song');
    // Cold open uses getColdOpen, not generateSegment
    expect(mockGenerateSegment).not.toHaveBeenCalled();
  });

  it('returns a non-empty text string', async () => {
    const result = await segmentController.generateNext(mockTrack);

    expect(result).not.toBeNull();
    expect(typeof result!.text).toBe('string');
    expect(result!.text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// segmentCount increments
// ---------------------------------------------------------------------------

describe('segmentCount increments after generateNext', () => {
  it('increments from 0 to 1 after first generateNext', async () => {
    expect(segmentController.getSegmentCount()).toBe(0);
    await segmentController.generateNext(mockTrack);
    expect(segmentController.getSegmentCount()).toBe(1);
  });

  it('increments again on subsequent generateNext calls', async () => {
    await segmentController.generateNext(mockTrack); // cold open → 1
    await segmentController.generateNext(mockTrack); // AI segment → 2
    expect(segmentController.getSegmentCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// shouldStaySilent + markMidSongDropCompleted
// ---------------------------------------------------------------------------

describe('shouldStaySilent', () => {
  it('returns true immediately after markMidSongDropCompleted', () => {
    segmentController.markMidSongDropCompleted();
    expect(segmentController.shouldStaySilent()).toBe(true);
  });

  it('resets after returning true (second call is not forced silent)', () => {
    segmentController.markMidSongDropCompleted();
    segmentController.shouldStaySilent(); // consumes the flag
    // Without the flag, shouldStaySilent can still return true based on
    // random chance (consecutiveSpokenSegments >= 3), but with a fresh
    // session (0 spoken segments) the random path won't trigger.
    expect(segmentController.shouldStaySilent()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setVibe
// ---------------------------------------------------------------------------

describe('setVibe', () => {
  it('does not throw when called with a valid vibe', () => {
    expect(() => segmentController.setVibe('morning')).not.toThrow();
  });

  it('subsequent generateNext works after setVibe', async () => {
    segmentController.setVibe('workout');
    const result = await segmentController.generateNext(mockTrack);
    // First segment is always a cold open regardless of vibe
    expect(result).not.toBeNull();
    expect(result!.type).toBe('song_intro');
    expect(result!.deliveryMode).toBe('pre_song');
  });
});

// ---------------------------------------------------------------------------
// generateMidSongDrop — deliveryMode
// ---------------------------------------------------------------------------

describe('generateMidSongDrop', () => {
  it('returns post_song delivery mode', async () => {
    const result = await segmentController.generateMidSongDrop(mockTrack);

    expect(result).not.toBeNull();
    expect(result.deliveryMode).toBe('post_song');
  });

  it('passes maxWords: 25 to generateSegment', async () => {
    await segmentController.generateMidSongDrop(mockTrack);

    expect(mockGenerateSegment).toHaveBeenCalledTimes(1);
    const ctx = mockGenerateSegment.mock.calls[0][0];
    expect(ctx.maxWords).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Manual skip — maxWords
// ---------------------------------------------------------------------------

describe('generateNext with isManualSkip=true', () => {
  it('sets maxWords to 30 (brief tier)', async () => {
    // First call is the cold open (segmentCount 0), which bypasses generateSegment.
    // We need a second call (segmentCount >= 1) to exercise the maxWords path.
    await segmentController.generateNext(mockTrack); // cold open

    mockGenerateSegment.mockClear();
    await segmentController.generateNext(mockTrack, undefined, undefined, true);

    expect(mockGenerateSegment).toHaveBeenCalledTimes(1);
    const ctx = mockGenerateSegment.mock.calls[0][0];
    expect(ctx.maxWords).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// startSession resets state
// ---------------------------------------------------------------------------

describe('startSession resets all state', () => {
  it('resets segmentCount to 0', async () => {
    await segmentController.generateNext(mockTrack); // segmentCount → 1
    await segmentController.generateNext(mockTrack); // segmentCount → 2
    expect(segmentController.getSegmentCount()).toBe(2);

    segmentController.startSession('station-2', 'morning');
    expect(segmentController.getSegmentCount()).toBe(0);
  });

  it('first segment after startSession is a cold open again', async () => {
    await segmentController.generateNext(mockTrack); // first cold open
    await segmentController.generateNext(mockTrack); // AI segment

    mockGenerateSegment.mockClear();
    segmentController.startSession('station-2', 'morning');

    const result = await segmentController.generateNext(mockTrack);
    expect(result!.type).toBe('song_intro');
    expect(result!.deliveryMode).toBe('pre_song');
    // Cold open path must not call generateSegment
    expect(mockGenerateSegment).not.toHaveBeenCalled();
  });
});

import { transitionPreloader } from '../../src/engines/TransitionPreloader';
import { playEjectTransition, cancelEjectTransition } from '../../modules/expo-music-kit';
import type { TrackInfo } from '../../src/types/TrackInfo';

// Mock dependencies
jest.mock('../../src/engines/SegmentController', () => ({
  segmentController: {
    generateEjectTransition: jest.fn().mockResolvedValue({
      text: 'Eject text',
      type: 'eject_transition',
      deliveryMode: 'eject_transition',
    }),
  },
}));

jest.mock('../../src/services/CleoVoiceEngine', () => ({
  synthesize: jest.fn().mockResolvedValue('base64audiodata'),
}));

jest.mock('../../src/services/MusicKitPlayer', () => ({
  musicKitPlayer: {
    getPlaybackTime: jest.fn().mockResolvedValue(0),
    getNextInQueue: jest.fn().mockResolvedValue(null),
  },
}));

const mockTrack: TrackInfo = {
  id: 'track-1',
  title: 'Test Song',
  artistName: 'Test Artist',
  albumTitle: 'Test Album',
  duration: 240,
  genre: 'Pop',
  genreNames: ['Pop'],
};

const shortTrack: TrackInfo = {
  id: 'track-short',
  title: 'Short Song',
  artistName: 'Artist',
  albumTitle: 'Album',
  duration: 30,
  genre: 'Pop',
  genreNames: ['Pop'],
};

describe('TransitionPreloader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transitionPreloader.cancel();
    transitionPreloader.setVibe('general');
  });

  afterAll(() => {
    transitionPreloader.cancel();
  });

  describe('state machine', () => {
    it('starts in idle state', () => {
      expect((transitionPreloader as any).state).toBe('idle');
    });

    it('resets cleanly via cancel', () => {
      (transitionPreloader as any).state = 'ready';
      (transitionPreloader as any).cachedSegment = { text: 'cached' };
      (transitionPreloader as any).cachedBase64 = 'data';

      transitionPreloader.cancel();

      expect((transitionPreloader as any).state).toBe('idle');
      expect((transitionPreloader as any).cachedSegment).toBeNull();
      expect((transitionPreloader as any).cachedBase64).toBeNull();
      expect((transitionPreloader as any).currentTrack).toBeNull();
    });

    it('has a generationId for stale detection', () => {
      expect(typeof (transitionPreloader as any).generationId).toBe('number');
    });
  });

  describe('startForTrack', () => {
    it('skips tracks shorter than 40s', () => {
      transitionPreloader.startForTrack(shortTrack);
      // Should remain idle — track too short for eject
      expect((transitionPreloader as any).state).toBe('idle');
    });

    it('starts for tracks with sufficient duration', () => {
      transitionPreloader.startForTrack(mockTrack);
      // Should have set up the track and started polling
      expect((transitionPreloader as any).currentTrack).toEqual(mockTrack);
      expect((transitionPreloader as any).unsubscribePlayback).not.toBeNull();
    });

    it('calculates eject point based on duration and genre window', () => {
      transitionPreloader.startForTrack(mockTrack);
      // Pop genre = 13s window. 240 - 13 = 227
      expect((transitionPreloader as any).ejectPointSec).toBe(227);
    });

    it('uses default window for unknown genres', () => {
      const noGenreTrack = { ...mockTrack, genreNames: ['Noise'] };
      transitionPreloader.startForTrack(noGenreTrack);
      // Default window = 15s. 240 - 15 = 225
      expect((transitionPreloader as any).ejectPointSec).toBe(225);
    });

    it('uses electronic window for ambient tracks', () => {
      const ambientTrack = { ...mockTrack, genreNames: ['Ambient'] };
      transitionPreloader.startForTrack(ambientTrack);
      // Electronic window = 22s. 240 - 22 = 218
      expect((transitionPreloader as any).ejectPointSec).toBe(218);
    });
  });

  describe('cancel', () => {
    it('resets state and cleans up subscriptions', () => {
      transitionPreloader.startForTrack(mockTrack);
      expect((transitionPreloader as any).unsubscribePlayback).not.toBeNull();

      transitionPreloader.cancel();
      expect((transitionPreloader as any).state).toBe('idle');
      expect((transitionPreloader as any).unsubscribePlayback).toBeNull();
    });
  });

  describe('getCachedSegment', () => {
    it('returns null when no cached segment', () => {
      expect(transitionPreloader.getCachedSegment()).toBeNull();
    });

    it('returns cached segment when available', () => {
      const segment = { text: 'test', type: 'eject_transition' as const, deliveryMode: 'eject_transition' as const };
      (transitionPreloader as any).cachedSegment = segment;
      expect(transitionPreloader.getCachedSegment()).toEqual(segment);
    });
  });

  describe('genre window calculation', () => {
    it('returns 22 for electronic genres', () => {
      const track = { ...mockTrack, genreNames: ['Electronic'], duration: 300 };
      transitionPreloader.startForTrack(track);
      expect((transitionPreloader as any).ejectPointSec).toBe(278); // 300 - 22
    });

    it('returns 13 for hip-hop genres', () => {
      const track = { ...mockTrack, genreNames: ['Hip-Hop'], duration: 200 };
      transitionPreloader.startForTrack(track);
      expect((transitionPreloader as any).ejectPointSec).toBe(187); // 200 - 13
    });

    it('returns 16 for rock genres', () => {
      const track = { ...mockTrack, genreNames: ['Rock'], duration: 250 };
      transitionPreloader.startForTrack(track);
      expect((transitionPreloader as any).ejectPointSec).toBe(234); // 250 - 16
    });
  });
});

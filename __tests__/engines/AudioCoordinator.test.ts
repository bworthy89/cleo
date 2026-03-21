import { audioCoordinator } from '../../src/engines/AudioCoordinator';
import { getPlaybackStatus, activateDuckingSession, deactivateDuckingSession } from '../../modules/expo-music-kit';
import type { TrackInfo } from '../../src/types/TrackInfo';

// Mock dependencies
jest.mock('../../src/services/CleoVoiceEngine', () => ({
  synthesizeAndPlay: jest.fn().mockResolvedValue(undefined),
  synthesize: jest.fn().mockResolvedValue('base64audio'),
}));

jest.mock('../../src/engines/SegmentController', () => ({
  segmentController: {
    generateNext: jest.fn().mockResolvedValue({ text: 'Test segment', type: 'song_intro', deliveryMode: 'pre_song' }),
    generateEjectTransition: jest.fn().mockResolvedValue({ text: 'Eject segment', type: 'eject_transition', deliveryMode: 'eject_transition' }),
    startSession: jest.fn(),
    getVibe: jest.fn().mockReturnValue('general'),
  },
}));

jest.mock('../../src/engines/TransitionPreloader', () => ({
  transitionPreloader: {
    startForTrack: jest.fn(),
    cancel: jest.fn(),
    reset: jest.fn(),
    getCachedSegment: jest.fn().mockReturnValue(null),
    isActive: jest.fn().mockReturnValue(false),
    setIsSpeakingCheck: jest.fn(),
    setVibe: jest.fn(),
  },
}));

jest.mock('../../src/engines/QueueManager', () => ({
  queueManager: {
    getTrackProfile: jest.fn().mockReturnValue(null),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  addEventListener: jest.fn().mockReturnValue(jest.fn()),
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

describe('AudioCoordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPlaybackStatus as jest.Mock).mockResolvedValue('playing');
    audioCoordinator.setVibe('general');
  });

  describe('cancelPendingTimer', () => {
    it('increments generationId to invalidate in-flight generations', () => {
      const id1 = (audioCoordinator as any).generationId;
      (audioCoordinator as any).cancelPendingTimer();
      const id2 = (audioCoordinator as any).generationId;
      expect(id2).toBe(id1 + 1);
    });
  });

  describe('isMusicPlaying', () => {
    it('returns true when status is playing', async () => {
      (getPlaybackStatus as jest.Mock).mockResolvedValue('playing');
      const result = await (audioCoordinator as any).isMusicPlaying();
      expect(result).toBe(true);
    });

    it('returns false when status is paused', async () => {
      (getPlaybackStatus as jest.Mock).mockResolvedValue('paused');
      const result = await (audioCoordinator as any).isMusicPlaying();
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      (getPlaybackStatus as jest.Mock).mockRejectedValue(new Error('fail'));
      const result = await (audioCoordinator as any).isMusicPlaying();
      expect(result).toBe(false);
    });
  });

  describe('handleTrackChangeWithResult', () => {
    it('skips commentary when offline', async () => {
      const NetInfo = require('@react-native-community/netinfo');
      NetInfo.fetch.mockResolvedValueOnce({ isConnected: false });

      const result = await audioCoordinator.handleTrackChangeWithResult(mockTrack);
      expect(result).toBeNull();
      expect(activateDuckingSession).not.toHaveBeenCalled();
    });

    it('calls segment generation when online', async () => {
      const { segmentController } = require('../../src/engines/SegmentController');

      const onReady = jest.fn();
      await audioCoordinator.handleTrackChangeWithResult(mockTrack, undefined, onReady);

      expect(segmentController.generateNext).toHaveBeenCalled();
    });

    it('cancels previous timer before starting new generation', async () => {
      const initialId = (audioCoordinator as any).generationId;
      await audioCoordinator.handleTrackChangeWithResult(mockTrack);
      // generationId should have been incremented by cancelPendingTimer
      expect((audioCoordinator as any).generationId).toBeGreaterThan(initialId);
    });

    it('stores previousTrack for context', async () => {
      await audioCoordinator.handleTrackChangeWithResult(mockTrack);
      expect((audioCoordinator as any).previousTrack).toEqual(mockTrack);
    });
  });

  describe('handleEjectComplete', () => {
    it('resets speaking state', () => {
      (audioCoordinator as any).isSpeaking = true;
      audioCoordinator.handleEjectComplete();
      expect((audioCoordinator as any).isSpeaking).toBe(false);
    });
  });

  describe('setVibe', () => {
    it('stores the vibe', () => {
      audioCoordinator.setVibe('lateNight');
      expect((audioCoordinator as any).currentVibe).toBe('lateNight');
    });
  });
});

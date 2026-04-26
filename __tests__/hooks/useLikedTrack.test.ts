import { renderHook, act } from '@testing-library/react-native';
import { __resetFirestore, __seedDoc } from '../../__mocks__/@react-native-firebase/firestore';
import { __resetAuth } from '../../__mocks__/@react-native-firebase/auth';
import { useLikedTrack } from '../../src/hooks/useLikedTrack';

const TRACK = {
  id: 'track-123',
  title: 'Song',
  artistName: 'Artist',
  albumTitle: 'Album',
  artworkUrl: null,
};

beforeEach(() => {
  __resetFirestore();
  __resetAuth();
});

describe('useLikedTrack', () => {
  it('returns isLiked:false for an unsaved track', () => {
    const { result } = renderHook(() => useLikedTrack(TRACK));

    expect(result.current.isLiked).toBe(false);
  });

  it('returns isLiked:true for a saved track', () => {
    __seedDoc('users/test-uid/likes/track-123', {
      id: 'track-123',
      title: 'Song',
      artistName: 'Artist',
      albumTitle: 'Album',
      artworkUrl: null,
      savedAt: { toMillis: () => 5000, toDate: () => new Date(5000) },
    });

    const { result } = renderHook(() => useLikedTrack(TRACK));

    expect(result.current.isLiked).toBe(true);
  });

  it('toggle saves and unsaves', async () => {
    const { result } = renderHook(() => useLikedTrack(TRACK));

    expect(result.current.isLiked).toBe(false);

    await act(async () => { await result.current.toggle(); });
    expect(result.current.isLiked).toBe(true);

    await act(async () => { await result.current.toggle(); });
    expect(result.current.isLiked).toBe(false);
  });

  it('returns isLiked:false and a noop toggle when track is null', async () => {
    const { result } = renderHook(() => useLikedTrack(null));

    expect(result.current.isLiked).toBe(false);
    await expect(result.current.toggle()).resolves.toBeUndefined();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useLikedTrack(TRACK));
    unmount();
    // No assertion — passes if no listener-leak warning fires.
    // Stale listeners would be cleared by __resetFirestore in next beforeEach.
  });
});

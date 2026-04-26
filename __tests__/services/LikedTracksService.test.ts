import {
  __resetFirestore,
  __seedDoc,
  __deleteDoc,
  __getApiSpies,
} from '../../__mocks__/@react-native-firebase/firestore';
import { __resetAuth, __setCurrentUser } from '../../__mocks__/@react-native-firebase/auth';
import { toggle, subscribeToOne, subscribeToList } from '../../src/services/LikedTracksService';
import type { LikedTrackInput } from '../../src/services/LikedTracksService.types';
import { LIKED_TRACKS_CAP, AuthRequiredError } from '../../src/services/LikedTracksService.types';

const TRACK: LikedTrackInput = {
  id: 'track-123',
  title: 'Song',
  artistName: 'Artist',
  albumTitle: 'Album',
  artworkUrl: 'https://example.com/art.jpg',
};

beforeEach(() => {
  __resetFirestore();
  __resetAuth();
});

describe('toggle', () => {
  it('saves an unsaved track and returns "liked"', async () => {
    const result = await toggle(TRACK);

    expect(result).toBe('liked');
    const spies = __getApiSpies();
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.objectContaining({
        id: 'track-123',
        title: 'Song',
        artistName: 'Artist',
        albumTitle: 'Album',
        artworkUrl: 'https://example.com/art.jpg',
        savedAt: expect.any(Object),
      }),
    );
  });

  it('unsaves a saved track and returns "unliked"', async () => {
    __seedDoc('users/test-uid/likes/track-123', { id: 'track-123' });

    const result = await toggle(TRACK);

    expect(result).toBe('unliked');
    const spies = __getApiSpies();
    expect(spies.delete).toHaveBeenCalledWith('users/test-uid/likes/track-123');
    expect(spies.set).not.toHaveBeenCalled();
  });
});

describe('toggle with FIFO eviction', () => {
  function seedManyLikes(count: number) {
    for (let i = 0; i < count; i++) {
      __seedDoc(`users/test-uid/likes/old-${i}`, {
        id: `old-${i}`,
        title: `Old ${i}`,
        artistName: 'Artist',
        albumTitle: '',
        artworkUrl: null,
        savedAt: { toMillis: () => 1000 + i, toDate: () => new Date(1000 + i) },
      });
    }
  }

  it('does not evict when count is below cap', async () => {
    seedManyLikes(LIKED_TRACKS_CAP - 1);

    await toggle(TRACK);

    const spies = __getApiSpies();
    expect(spies.delete).not.toHaveBeenCalled();
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.any(Object),
    );
  });

  it('deletes the oldest doc and writes the new one when count is at cap', async () => {
    seedManyLikes(LIKED_TRACKS_CAP);

    await toggle(TRACK);

    const spies = __getApiSpies();
    expect(spies.delete).toHaveBeenCalledWith('users/test-uid/likes/old-0');
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.any(Object),
    );
  });

  it('does not run eviction when toggling off (unsave) at cap', async () => {
    seedManyLikes(LIKED_TRACKS_CAP);
    __seedDoc('users/test-uid/likes/track-123', {
      id: 'track-123',
      savedAt: { toMillis: () => 9999, toDate: () => new Date(9999) },
    });

    const result = await toggle(TRACK);

    expect(result).toBe('unliked');
    const spies = __getApiSpies();
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.delete).toHaveBeenCalledWith('users/test-uid/likes/track-123');
  });

  it('tolerates a stale-evict where the planned-oldest doc is gone', async () => {
    // Seed at cap so toggle's pre-transaction reads identify old-0 as the
    // planned-oldest doc, then race-delete old-0 before the transaction
    // body runs. The mock's transaction.delete is a no-op on a missing
    // path (matches Firestore's real behavior), so the new doc still
    // gets written without error.
    seedManyLikes(LIKED_TRACKS_CAP);
    __deleteDoc('users/test-uid/likes/old-0');

    await toggle(TRACK);

    const spies = __getApiSpies();
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.any(Object),
    );
  });
});

describe('toggle auth guard', () => {
  it('throws AuthRequiredError when no user is signed in', async () => {
    __setCurrentUser(null);

    await expect(toggle(TRACK)).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

describe('subscribeToOne', () => {
  it('emits exists:false for a missing doc', () => {
    const events: Array<{ exists: boolean; track: unknown }> = [];

    const unsub = subscribeToOne('track-123', (state) => events.push(state));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toEqual({ exists: false, track: null });
    unsub();
  });

  it('emits exists:true with track payload for a present doc', () => {
    __seedDoc('users/test-uid/likes/track-123', {
      id: 'track-123',
      title: 'Song',
      artistName: 'Artist',
      albumTitle: 'Album',
      artworkUrl: 'https://example.com/art.jpg',
      savedAt: { toMillis: () => 5000, toDate: () => new Date(5000) },
    });

    const events: Array<{ exists: boolean; track: unknown }> = [];

    const unsub = subscribeToOne('track-123', (state) => events.push(state));

    expect(events[0].exists).toBe(true);
    expect(events[0].track).toMatchObject({
      id: 'track-123',
      title: 'Song',
      artistName: 'Artist',
      albumTitle: 'Album',
      artworkUrl: 'https://example.com/art.jpg',
      savedAt: new Date(5000),
    });
    unsub();
  });

  it('emits empty state when no user is signed in', () => {
    __setCurrentUser(null);
    const events: Array<{ exists: boolean; track: unknown }> = [];

    const unsub = subscribeToOne('track-123', (state) => events.push(state));

    expect(events[0]).toEqual({ exists: false, track: null });
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

describe('subscribeToList', () => {
  it('emits empty list when no docs', () => {
    const events: Array<unknown[]> = [];

    const unsub = subscribeToList((tracks) => events.push(tracks));

    expect(events[0]).toEqual([]);
    unsub();
  });

  it('emits docs ordered savedAt desc', () => {
    __seedDoc('users/test-uid/likes/a', {
      id: 'a', title: 'A', artistName: 'X', albumTitle: '', artworkUrl: null,
      savedAt: { toMillis: () => 1000, toDate: () => new Date(1000) },
    });
    __seedDoc('users/test-uid/likes/b', {
      id: 'b', title: 'B', artistName: 'X', albumTitle: '', artworkUrl: null,
      savedAt: { toMillis: () => 3000, toDate: () => new Date(3000) },
    });
    __seedDoc('users/test-uid/likes/c', {
      id: 'c', title: 'C', artistName: 'X', albumTitle: '', artworkUrl: null,
      savedAt: { toMillis: () => 2000, toDate: () => new Date(2000) },
    });

    const events: Array<{ id: string; savedAt: Date }[]> = [];

    const unsub = subscribeToList((tracks) =>
      events.push(tracks.map(t => ({ id: t.id, savedAt: t.savedAt }))),
    );

    expect(events[0].map(t => t.id)).toEqual(['b', 'c', 'a']);
    unsub();
  });

  it('emits empty list when no user is signed in', () => {
    __setCurrentUser(null);
    const events: Array<unknown[]> = [];

    const unsub = subscribeToList((tracks: unknown[]) => events.push(tracks));

    expect(events[0]).toEqual([]);
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

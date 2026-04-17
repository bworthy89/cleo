import { __resetAllStores } from '../../__mocks__/react-native-mmkv';
import {
  getUser,
  setUser,
  getCachedPlaylists,
  setCachedPlaylists,
  clearUserData,
  setPersistedBroadcast,
  getPersistedBroadcast,
  clearPersistedBroadcast,
  type UserData,
} from '../../src/services/Storage';
import type { MusicPlaylist } from '../../modules/expo-music-kit';
import type { Manifest } from '../../src/engines/BroadcastPlayer.types';

beforeEach(() => {
  __resetAllStores();
});

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    appleMusicAuthorized: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePlaylist(id: string): MusicPlaylist {
  return { id, name: `Playlist ${id}` };
}

describe('getUser / setUser', () => {
  it('returns undefined when nothing has been stored', () => {
    expect(getUser()).toBeUndefined();
  });

  it('roundtrips a user object', () => {
    const user = makeUser({ name: 'Kari', defaultVibe: 'morning' });
    setUser(user);
    expect(getUser()).toEqual(user);
  });

  it('overwrites a previously stored user', () => {
    setUser(makeUser({ name: 'First' }));
    const updated = makeUser({ name: 'Second', appleMusicAuthorized: false });
    setUser(updated);
    expect(getUser()).toEqual(updated);
  });
});

describe('getCachedPlaylists / setCachedPlaylists', () => {
  it('returns undefined when nothing has been stored', () => {
    expect(getCachedPlaylists()).toBeUndefined();
  });

  it('roundtrips a list of playlists', () => {
    const playlists = [makePlaylist('p1'), makePlaylist('p2')];
    setCachedPlaylists(playlists);
    expect(getCachedPlaylists()).toEqual(playlists);
  });

  it('overwrites previously cached playlists', () => {
    setCachedPlaylists([makePlaylist('p1')]);
    const updated = [makePlaylist('p2'), makePlaylist('p3')];
    setCachedPlaylists(updated);
    expect(getCachedPlaylists()).toEqual(updated);
  });
});

describe('clearUserData', () => {
  it('clears playlist cache and persisted broadcast but preserves USER', () => {
    const user = makeUser({ name: 'Kari' });
    setUser(user);
    setCachedPlaylists([makePlaylist('p1')]);
    setPersistedBroadcast({
      broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
      vibe: 'morning', length: 'quick', createdAt: Date.now(),
      tracks: [], segmentSlots: [],
    });

    clearUserData();

    expect(getUser()).toEqual(user);
    expect(getCachedPlaylists()).toBeUndefined();
    expect(getPersistedBroadcast()).toBeUndefined();
  });

  it('is idempotent when storage is already empty', () => {
    expect(() => clearUserData()).not.toThrow();
  });
});

function makeManifest(id: string): Manifest {
  return {
    broadcastId: id,
    userId: 'u1',
    playlistId: 'p1',
    vibe: 'morning',
    length: 'quick',
    createdAt: Date.now(),
    tracks: [],
    segmentSlots: [],
  };
}

describe('broadcast storage', () => {
  it('stores and retrieves a persisted broadcast manifest', () => {
    setPersistedBroadcast(makeManifest('b1'));
    expect(getPersistedBroadcast()?.broadcastId).toBe('b1');
  });

  it('returns undefined when no broadcast is persisted', () => {
    expect(getPersistedBroadcast()).toBeUndefined();
  });

  it('clears the persisted broadcast', () => {
    setPersistedBroadcast(makeManifest('b2'));
    clearPersistedBroadcast();
    expect(getPersistedBroadcast()).toBeUndefined();
  });
});

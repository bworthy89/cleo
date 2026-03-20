import { __resetAllStores } from '../../__mocks__/react-native-mmkv';
import {
  getUser,
  setUser,
  getStations,
  setStations,
  addStation,
  getRecentlyPlayed,
  addRecentlyPlayedTrack,
  getCachedPlaylists,
  setCachedPlaylists,
  clearUserData,
  type UserData,
  type Station,
} from '../../src/services/Storage';
import type { MusicPlaylist } from '../../modules/expo-music-kit';

beforeEach(() => {
  __resetAllStores();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    appleMusicAuthorized: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStation(id: string): Station {
  return {
    id,
    name: `Station ${id}`,
    playlistId: `pl-${id}`,
    defaultVibe: 'chill',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

function makePlaylist(id: string): MusicPlaylist {
  return { id, name: `Playlist ${id}` };
}

// ---------------------------------------------------------------------------
// getUser / setUser
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getStations / setStations / addStation
// ---------------------------------------------------------------------------

describe('getStations / setStations / addStation', () => {
  it('returns an empty array when nothing has been stored', () => {
    expect(getStations()).toEqual([]);
  });

  it('addStation appends to an empty list', () => {
    const station = makeStation('s1');
    addStation(station);
    expect(getStations()).toEqual([station]);
  });

  it('addStation appends to an existing list', () => {
    const s1 = makeStation('s1');
    const s2 = makeStation('s2');
    addStation(s1);
    addStation(s2);
    expect(getStations()).toEqual([s1, s2]);
  });

  it('setStations replaces the entire list', () => {
    addStation(makeStation('s1'));
    addStation(makeStation('s2'));
    const replacement = [makeStation('s3')];
    setStations(replacement);
    expect(getStations()).toEqual(replacement);
  });

  it('setStations with empty array clears all stations', () => {
    addStation(makeStation('s1'));
    setStations([]);
    expect(getStations()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getRecentlyPlayed / addRecentlyPlayedTrack
// ---------------------------------------------------------------------------

describe('getRecentlyPlayed / addRecentlyPlayedTrack', () => {
  it('returns an empty trackIds array when nothing has been stored', () => {
    const rp = getRecentlyPlayed();
    expect(rp.trackIds).toEqual([]);
  });

  it('addRecentlyPlayedTrack adds the first track', () => {
    addRecentlyPlayedTrack('track-1');
    expect(getRecentlyPlayed().trackIds).toEqual(['track-1']);
  });

  it('most recent track appears first', () => {
    addRecentlyPlayedTrack('track-1');
    addRecentlyPlayedTrack('track-2');
    addRecentlyPlayedTrack('track-3');
    expect(getRecentlyPlayed().trackIds[0]).toBe('track-3');
    expect(getRecentlyPlayed().trackIds).toEqual(['track-3', 'track-2', 'track-1']);
  });

  it('deduplicates: re-adding an existing track moves it to the front', () => {
    addRecentlyPlayedTrack('track-1');
    addRecentlyPlayedTrack('track-2');
    addRecentlyPlayedTrack('track-1'); // duplicate
    expect(getRecentlyPlayed().trackIds).toEqual(['track-1', 'track-2']);
  });

  it('caps the list at 50 entries', () => {
    // Add 55 unique tracks
    for (let i = 1; i <= 55; i++) {
      addRecentlyPlayedTrack(`track-${i}`);
    }
    const { trackIds } = getRecentlyPlayed();
    expect(trackIds).toHaveLength(50);
    // The most recent 50 should be track-55 down to track-6
    expect(trackIds[0]).toBe('track-55');
    expect(trackIds[49]).toBe('track-6');
  });

  it('updates lastUpdated on each call', () => {
    const before = new Date().toISOString();
    addRecentlyPlayedTrack('track-1');
    const { lastUpdated } = getRecentlyPlayed();
    expect(lastUpdated >= before).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCachedPlaylists / setCachedPlaylists
// ---------------------------------------------------------------------------

describe('getCachedPlaylists / setCachedPlaylists', () => {
  it('returns undefined when nothing has been stored', () => {
    expect(getCachedPlaylists()).toBeUndefined();
  });

  it('roundtrips a list of playlists', () => {
    const playlists: MusicPlaylist[] = [
      makePlaylist('p1'),
      makePlaylist('p2'),
    ];
    setCachedPlaylists(playlists);
    expect(getCachedPlaylists()).toEqual(playlists);
  });

  it('overwrites previously cached playlists', () => {
    setCachedPlaylists([makePlaylist('p1')]);
    const updated = [makePlaylist('p2'), makePlaylist('p3')];
    setCachedPlaylists(updated);
    expect(getCachedPlaylists()).toEqual(updated);
  });

  it('can store an empty array', () => {
    setCachedPlaylists([]);
    expect(getCachedPlaylists()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clearUserData
// ---------------------------------------------------------------------------

describe('clearUserData', () => {
  it('clears user, stations, recentlyPlayed, and playlists cache', () => {
    setUser(makeUser({ name: 'Kari' }));
    addStation(makeStation('s1'));
    addRecentlyPlayedTrack('track-1');
    setCachedPlaylists([makePlaylist('p1')]);

    clearUserData();

    expect(getUser()).toBeUndefined();
    expect(getStations()).toEqual([]);
    expect(getRecentlyPlayed().trackIds).toEqual([]);
    expect(getCachedPlaylists()).toBeUndefined();
  });

  it('is idempotent when storage is already empty', () => {
    expect(() => clearUserData()).not.toThrow();
    expect(getUser()).toBeUndefined();
    expect(getStations()).toEqual([]);
  });
});

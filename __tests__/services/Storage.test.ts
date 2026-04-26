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
  updatePersistedCursor,
  addBroadcastToHistory,
  getBroadcastHistory,
  hasRecentBroadcastHistory,
  markFirstListenCompleted,
  hasCompletedFirstListen,
  BROADCAST_HISTORY_RETENTION_MS,
  BROADCAST_HISTORY_MAX_ENTRIES,
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
    const user = makeUser({ name: 'Kari' });
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
      manifest: {
        broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
        vibe: 'morning', length: 'quick', createdAt: Date.now(),
        tracks: [], segmentSlots: [],
      },
      trackCursor: -1,
      updatedAt: Date.now(),
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
  it('stores and retrieves a persisted broadcast record', () => {
    setPersistedBroadcast({
      manifest: makeManifest('b1'),
      trackCursor: -1,
      updatedAt: Date.now(),
    });
    const rec = getPersistedBroadcast();
    expect(rec?.manifest.broadcastId).toBe('b1');
    expect(rec?.trackCursor).toBe(-1);
    expect(typeof rec?.updatedAt).toBe('number');
  });

  it('returns undefined when no broadcast is persisted', () => {
    expect(getPersistedBroadcast()).toBeUndefined();
  });

  it('clears the persisted broadcast', () => {
    setPersistedBroadcast({
      manifest: makeManifest('b2'),
      trackCursor: 0,
      updatedAt: Date.now(),
    });
    clearPersistedBroadcast();
    expect(getPersistedBroadcast()).toBeUndefined();
  });

  it('rejects and clears a record whose manifest is an array (not an object)', () => {
    // Simulate corrupt data: arrays satisfy typeof===object but aren't
    // a Manifest. The guard must reject them.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setObject, StorageKeys } = require('../../src/services/Storage');
    setObject(StorageKeys.CURRENT_BROADCAST, {
      manifest: [],
      trackCursor: -1,
      updatedAt: Date.now(),
    });
    expect(getPersistedBroadcast()).toBeUndefined();
  });

  it('returns undefined and clears MMKV when legacy raw-Manifest shape is stored', () => {
    // Simulate an install-upgrade where the old shape is still on disk.
    // Write the raw manifest directly under CURRENT_BROADCAST via the
    // low-level JSON helper — bypassing setPersistedBroadcast, which now
    // enforces the new shape.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setObject, StorageKeys } = require('../../src/services/Storage');
    setObject(StorageKeys.CURRENT_BROADCAST, makeManifest('legacy'));

    const result = getPersistedBroadcast();
    expect(result).toBeUndefined();
    // MMKV key should have been wiped as a side effect.
    expect(getPersistedBroadcast()).toBeUndefined();
  });
});

describe('updatePersistedCursor', () => {
  it('overwrites only the trackCursor while preserving manifest + updatedAt', () => {
    const originalUpdatedAt = 1000;
    setPersistedBroadcast({
      manifest: makeManifest('b1'),
      trackCursor: -1,
      updatedAt: originalUpdatedAt,
    });

    updatePersistedCursor(3);

    const rec = getPersistedBroadcast();
    expect(rec?.manifest.broadcastId).toBe('b1');
    expect(rec?.trackCursor).toBe(3);
    expect(rec?.updatedAt).toBe(originalUpdatedAt);
  });

  it('is a no-op when no broadcast is persisted', () => {
    expect(() => updatePersistedCursor(0)).not.toThrow();
    expect(getPersistedBroadcast()).toBeUndefined();
  });
});

describe('broadcast history', () => {
  it('returns an empty list when nothing has been added', () => {
    expect(getBroadcastHistory()).toEqual([]);
  });

  it('adds a broadcast and round-trips the manifest + firstSegmentUrls', () => {
    const manifest = makeManifest('b1');
    const urls = ['https://r2/seg/0/v0.mp3'];
    addBroadcastToHistory(manifest, urls);

    const history = getBroadcastHistory();
    expect(history).toHaveLength(1);
    expect(history[0].manifest.broadcastId).toBe('b1');
    expect(history[0].firstSegmentUrls).toEqual(urls);
    expect(typeof history[0].createdAt).toBe('number');
  });

  it('orders newest first', () => {
    addBroadcastToHistory(makeManifest('b1'), []);
    addBroadcastToHistory(makeManifest('b2'), []);
    addBroadcastToHistory(makeManifest('b3'), []);
    expect(getBroadcastHistory().map(e => e.manifest.broadcastId))
      .toEqual(['b3', 'b2', 'b1']);
  });

  it('dedupes by broadcastId — adding the same id twice does not duplicate the entry', () => {
    const m = makeManifest('b1');
    addBroadcastToHistory(m, ['url-v1']);
    addBroadcastToHistory(m, ['url-v2']);

    const history = getBroadcastHistory();
    expect(history).toHaveLength(1);
    // Most recent add wins so the UI sees the latest firstSegmentUrls
    expect(history[0].firstSegmentUrls).toEqual(['url-v2']);
  });

  it(`caps the list at ${BROADCAST_HISTORY_MAX_ENTRIES} entries (oldest drop off)`, () => {
    for (let i = 0; i < BROADCAST_HISTORY_MAX_ENTRIES + 3; i++) {
      addBroadcastToHistory(makeManifest(`b${i}`), []);
    }
    const history = getBroadcastHistory();
    expect(history).toHaveLength(BROADCAST_HISTORY_MAX_ENTRIES);
    // The first three we added should have been dropped
    const ids = history.map(e => e.manifest.broadcastId);
    expect(ids).not.toContain('b0');
    expect(ids).not.toContain('b1');
    expect(ids).not.toContain('b2');
    expect(ids[0]).toBe(`b${BROADCAST_HISTORY_MAX_ENTRIES + 2}`);
  });

  it('filters out entries older than the retention window', () => {
    // Add an entry "yesterday" by advancing Date.now()
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(realNow - BROADCAST_HISTORY_RETENTION_MS - 1000);
    addBroadcastToHistory(makeManifest('stale'), []);

    // Add a fresh entry "now"
    nowSpy.mockReturnValue(realNow);
    addBroadcastToHistory(makeManifest('fresh'), []);

    const history = getBroadcastHistory();
    expect(history.map(e => e.manifest.broadcastId)).toEqual(['fresh']);

    nowSpy.mockRestore();
  });
});

describe('hasRecentBroadcastHistory', () => {
  it('returns false on a fresh install', () => {
    expect(hasRecentBroadcastHistory()).toBe(false);
  });

  it('returns true after a broadcast lands in history', () => {
    const manifest = {
      broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
      vibe: 'morning' as const, length: 'quick' as const, createdAt: Date.now(),
      tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
      segmentSlots: [],
    };
    addBroadcastToHistory(manifest as any, ['https://cdn/v0.mp3']);
    expect(hasRecentBroadcastHistory()).toBe(true);
  });

  it('returns false when all entries are past the retention window', () => {
    const manifest = {
      broadcastId: 'old', userId: 'u1', playlistId: 'p1',
      vibe: 'morning' as const, length: 'quick' as const, createdAt: 0,
      tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
      segmentSlots: [],
    };
    addBroadcastToHistory(manifest as any, ['https://cdn/v0.mp3']);
    // Advance time past the retention window. getBroadcastHistory prunes
    // expired entries on read; hasRecentBroadcastHistory delegates to it.
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + BROADCAST_HISTORY_RETENTION_MS + 1000);
    try {
      expect(hasRecentBroadcastHistory()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('hasCompletedFirstListen / markFirstListenCompleted', () => {
  it('returns false on a fresh install', () => {
    expect(hasCompletedFirstListen()).toBe(false);
  });

  it('returns true after markFirstListenCompleted is called', () => {
    markFirstListenCompleted();
    expect(hasCompletedFirstListen()).toBe(true);
  });

  it('persists across calls (no retention window)', () => {
    markFirstListenCompleted(1_000_000);
    expect(hasCompletedFirstListen()).toBe(true);
    // Even after a notional very-long delay, the flag stays set.
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 10 * 24 * 60 * 60 * 1000);
    try {
      expect(hasCompletedFirstListen()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

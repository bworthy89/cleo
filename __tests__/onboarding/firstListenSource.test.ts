jest.mock('../../src/services/api', () => ({
  API_BASE_URL: 'http://test',
  authenticatedFetch: jest.fn(),
}));

import { pickFirstListenSource } from '../../src/onboarding/firstListenSource';
import type { MusicPlaylist, MusicTrack } from '../../modules/expo-music-kit';

const validTrack = (id: string): MusicTrack => ({
  id,
  title: `T${id}`,
  artistName: 'A',
  albumTitle: 'Al',
  duration: 200,
  genreNames: [],
  trackNumber: 1,
  discNumber: 1,
  // artworkUrl and isrc are optional
} as MusicTrack);

const playlist = (id: string, name: string): MusicPlaylist => ({
  id,
  name,
  trackCount: 10,
} as MusicPlaylist);

describe('pickFirstListenSource', () => {
  it('returns the first user playlist with >= 5 valid tracks', async () => {
    const deps = {
      fetchPlaylists: jest.fn(async () => [playlist('p1', 'My Mix'), playlist('p2', 'Other')]),
      fetchPlaylistTracks: jest.fn(async (id: string) => {
        if (id === 'p1') return [validTrack('a'), validTrack('b'), validTrack('c'), validTrack('d'), validTrack('e')];
        return [];
      }),
      listFeatured: jest.fn(async () => []),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('user');
    if (result.kind !== 'user') throw new Error('expected user');
    expect(result.playlistId).toBe('p1');
    expect(result.playlistName).toBe('My Mix');
    expect(result.tracks).toHaveLength(5);
    // Should NOT have queried p2 because p1 already qualified.
    expect(deps.fetchPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it('skips playlists with fewer than 5 valid tracks and tries the next', async () => {
    const deps = {
      fetchPlaylists: jest.fn(async () => [playlist('small', 'Small'), playlist('big', 'Big')]),
      fetchPlaylistTracks: jest.fn(async (id: string) => {
        if (id === 'small') return [validTrack('a'), validTrack('b')];
        if (id === 'big') return Array.from({ length: 8 }, (_, i) => validTrack(`b${i}`));
        return [];
      }),
      listFeatured: jest.fn(async () => []),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('user');
    if (result.kind !== 'user') throw new Error('expected user');
    expect(result.playlistId).toBe('big');
  });

  it('falls back to featured when no playlist qualifies', async () => {
    const featuredEntry = {
      id: 'feat-1',
      title: 'Tonight',
      description: 'A featured set.',
      vibe: 'feelGood' as const,
      length: 'standard' as const,
      baked: true,
      createdAt: Date.now(),
      manifest: { broadcastId: 'feat-1', segmentSlots: [] } as any,
    };
    const deps = {
      fetchPlaylists: jest.fn(async () => [playlist('p1', 'Empty')]),
      fetchPlaylistTracks: jest.fn(async () => []),
      listFeatured: jest.fn(async () => [featuredEntry]),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('featured');
    if (result.kind !== 'featured') throw new Error('expected featured');
    expect(result.featured.id).toBe('feat-1');
  });

  it('returns kind: none when fetchPlaylists throws AND featured registry is empty', async () => {
    const deps = {
      fetchPlaylists: jest.fn(async () => {
        throw new Error('not authorized');
      }),
      fetchPlaylistTracks: jest.fn(async () => []),
      listFeatured: jest.fn(async () => []),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('none');
  });
});

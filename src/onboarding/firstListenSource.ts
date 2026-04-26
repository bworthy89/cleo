import type { MusicPlaylist, MusicTrack } from '../../modules/expo-music-kit';
import type { FeaturedBroadcast } from '../engines/BroadcastCurationClient';
import { sanitizeTracksForBake } from '../engines/BroadcastManifestClient';

export type FirstListenSource =
  | {
      kind: 'user';
      playlistId: string;
      playlistName: string;
      // Sanitized tracks ready to send to /broadcast/create.
      tracks: ReturnType<typeof sanitizeTracksForBake>;
    }
  | { kind: 'featured'; featured: FeaturedBroadcast }
  | { kind: 'none' };

export interface FirstListenSourceDeps {
  fetchPlaylists: () => Promise<MusicPlaylist[]>;
  fetchPlaylistTracks: (id: string) => Promise<MusicTrack[]>;
  listFeatured: () => Promise<FeaturedBroadcast[]>;
}

const MIN_TRACKS = 5;

/**
 * Pick the source for a user's first-listen broadcast.
 *
 * Order:
 *   1. First user playlist with ≥5 sanitize-passing tracks. fetchPlaylists()
 *      is already sorted by Apple's lastPlayedDate (most-recent first), so
 *      this is the playlist the user was just listening to.
 *   2. Latest featured broadcast from the registry (pre-baked; instant).
 *   3. kind: 'none' if neither is available — caller decides how to degrade.
 *
 * fetchPlaylists throwing is handled (e.g., user skipped Apple Music auth).
 * Per-playlist fetch errors stop iteration through that playlist but not
 * the whole search.
 */
export async function pickFirstListenSource(
  deps: FirstListenSourceDeps,
): Promise<FirstListenSource> {
  let playlists: MusicPlaylist[] = [];
  try {
    playlists = await deps.fetchPlaylists();
  } catch {
    // Skipped Apple Music auth or other library access failure — continue
    // to featured fallback.
  }

  for (const p of playlists) {
    let raw: MusicTrack[] = [];
    try {
      raw = await deps.fetchPlaylistTracks(p.id);
    } catch {
      continue;
    }
    const sanitized = sanitizeTracksForBake(raw);
    if (sanitized.length >= MIN_TRACKS) {
      return {
        kind: 'user',
        playlistId: p.id,
        playlistName: p.name,
        tracks: sanitized,
      };
    }
  }

  let featured: FeaturedBroadcast[] = [];
  try {
    featured = await deps.listFeatured();
  } catch {
    // Registry unreachable — fall through to none.
  }
  if (featured.length > 0) {
    return { kind: 'featured', featured: featured[0] };
  }

  return { kind: 'none' };
}

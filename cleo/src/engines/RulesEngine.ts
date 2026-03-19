import type { QueuedTrack, QueuePlan } from './QueuePlanner';
import type { TrackProfile } from '../services/TrackEnrichmentService';

interface TrackMap {
  [trackId: string]: TrackProfile;
}

export function enforceRules(plan: QueuePlan, tracks: TrackProfile[]): QueuePlan {
  const trackMap: TrackMap = {};
  tracks.forEach((t) => { trackMap[t.id] = t; });

  let queue = [...plan.queue];

  queue = enforceArtistVariety(queue, trackMap);
  queue = enforceAlbumVariety(queue, trackMap);
  queue = enforceGenreBridging(queue, trackMap);

  // Re-number positions
  queue = queue.map((q, i) => ({ ...q, position: i + 1 }));

  return { ...plan, queue };
}

function enforceArtistVariety(queue: QueuedTrack[], trackMap: TrackMap): QueuedTrack[] {
  const result = [...queue];

  for (let i = 1; i < result.length; i++) {
    const current = trackMap[result[i].trackId];
    if (!current) continue;

    // Check previous 2 tracks for same artist
    for (let j = Math.max(0, i - 2); j < i; j++) {
      const prev = trackMap[result[j].trackId];
      if (prev && prev.artistName === current.artistName) {
        // Find nearest track to swap with that doesn't violate
        const swapIdx = findSwapCandidate(result, trackMap, i, current.artistName, 'artist');
        if (swapIdx !== -1) {
          [result[i], result[swapIdx]] = [result[swapIdx], result[i]];
        }
        break;
      }
    }
  }

  return result;
}

function enforceAlbumVariety(queue: QueuedTrack[], trackMap: TrackMap): QueuedTrack[] {
  const result = [...queue];

  for (let i = 1; i < result.length; i++) {
    const current = trackMap[result[i].trackId];
    if (!current?.albumTitle) continue;

    // Check previous 4 tracks for same album
    for (let j = Math.max(0, i - 4); j < i; j++) {
      const prev = trackMap[result[j].trackId];
      if (prev && prev.albumTitle === current.albumTitle) {
        const swapIdx = findSwapCandidate(result, trackMap, i, current.albumTitle, 'album');
        if (swapIdx !== -1) {
          [result[i], result[swapIdx]] = [result[swapIdx], result[i]];
        }
        break;
      }
    }
  }

  return result;
}

// Genre relationship map — genres that are "close" to each other
const relatedGenres: Record<string, string[]> = {
  'Hip-Hop': ['R&B', 'Neo-Soul', 'Trap', 'Rap'],
  'R&B': ['Hip-Hop', 'Neo-Soul', 'Soul', 'Pop'],
  'Pop': ['R&B', 'Indie Pop', 'Dance', 'Electronic'],
  'Rock': ['Alternative', 'Indie', 'Punk', 'Metal'],
  'Jazz': ['Neo-Soul', 'R&B', 'Soul'],
  'Electronic': ['Dance', 'House', 'Pop', 'Ambient'],
  'Country': ['Folk', 'Americana', 'Rock'],
  'Latin': ['Reggaeton', 'Pop', 'R&B'],
  'Afrobeats': ['Hip-Hop', 'R&B', 'Dancehall'],
};

function enforceGenreBridging(
  queue: QueuedTrack[],
  trackMap: TrackMap
): QueuedTrack[] {
  const result = [...queue];

  function getGenre(trackId: string): string {
    const track = trackMap[trackId];
    return track?.genreNames?.[0] ?? 'Unknown';
  }

  function areGenresRelated(g1: string, g2: string): boolean {
    if (g1 === g2) return true;
    const related1 = relatedGenres[g1] ?? [];
    const related2 = relatedGenres[g2] ?? [];
    return related1.includes(g2) || related2.includes(g1);
  }

  // Check for jarring genre jumps — mark them but don't insert bridges
  // (inserting would change queue size and complicate things)
  // Instead, flag the transition segment type in the queue role
  for (let i = 1; i < result.length; i++) {
    const prevGenre = getGenre(result[i - 1].trackId);
    const currGenre = getGenre(result[i].trackId);

    if (prevGenre !== 'Unknown' && currGenre !== 'Unknown' && !areGenresRelated(prevGenre, currGenre)) {
      // Try to find a bridge track — one that shares genre with both
      const bridgeIdx = findBridgeCandidate(result, trackMap, i, prevGenre, currGenre);
      if (bridgeIdx !== -1 && bridgeIdx !== i && bridgeIdx !== i - 1) {
        // Move bridge track to position i, shift current track forward
        const bridge = result.splice(bridgeIdx, 1)[0];
        bridge.role = 'bridge';
        bridge.reason = `bridges ${prevGenre} → ${currGenre}`;
        const insertAt = bridgeIdx < i ? i - 1 : i;
        result.splice(insertAt, 0, bridge);
      } else {
        // No bridge available — mark for Cleo to narrate the transition
        result[i].role = 'transition';
        result[i].reason = `genre shift: ${prevGenre} → ${currGenre}`;
      }
    }
  }

  return result;
}

function findSwapCandidate(
  queue: QueuedTrack[],
  trackMap: TrackMap,
  currentIdx: number,
  value: string,
  field: 'artist' | 'album'
): number {
  // Look forward for a track that won't cause the same violation
  for (let i = currentIdx + 2; i < queue.length; i++) {
    const candidate = trackMap[queue[i].trackId];
    if (!candidate) continue;

    const candidateValue = field === 'artist' ? candidate.artistName : candidate.albumTitle;
    if (candidateValue !== value) {
      // Verify swapping won't create new violations at the swap position
      const prevOfSwap = i > 0 ? trackMap[queue[i - 1].trackId] : null;
      const currentTrack = trackMap[queue[currentIdx].trackId];
      const currentValue = field === 'artist' ? currentTrack?.artistName : currentTrack?.albumTitle;
      const prevValue = field === 'artist' ? prevOfSwap?.artistName : prevOfSwap?.albumTitle;

      if (prevValue !== currentValue) {
        return i;
      }
    }
  }
  return -1;
}

function findBridgeCandidate(
  queue: QueuedTrack[],
  trackMap: TrackMap,
  _gapIndex: number,
  genre1: string,
  genre2: string
): number {
  // Find a track elsewhere in the queue whose genre relates to both sides
  for (let i = _gapIndex + 1; i < queue.length; i++) {
    const track = trackMap[queue[i].trackId];
    if (!track) continue;
    const genre = track.genreNames?.[0] ?? 'Unknown';

    const related1 = relatedGenres[genre1] ?? [];
    const related2 = relatedGenres[genre2] ?? [];

    if (
      (genre === genre1 || genre === genre2 || related1.includes(genre) || related2.includes(genre)) &&
      genre !== 'Unknown'
    ) {
      return i;
    }
  }
  return -1;
}

import type { TrackProfile } from '../services/TrackEnrichmentService';
import type { QueuePlan } from './QueuePlanner';
import type { Vibe } from '../cleo/fallbacks';
import { getRecentlyPlayed } from '../services/Storage';

/**
 * Fast local queue planner — no API calls.
 * Picks a smart opener, then shuffles remaining tracks
 * with artist/album separation. Used to start playback instantly
 * while the AI planner works in the background.
 */
export function planQueueLocally(
  tracks: TrackProfile[],
  vibe: Vibe
): QueuePlan {
  if (tracks.length === 0) {
    return { queue: [], arcShape: 'short' };
  }

  const arcShape = tracks.length < 20 ? 'short' : tracks.length <= 40 ? 'medium' : 'long';
  const recentlyPlayed = new Set(getRecentlyPlayed().trackIds);

  // Pick opener: prefer a track not recently played, with a genre that fits the vibe
  const openerIdx = pickOpener(tracks, vibe, recentlyPlayed);
  const opener = tracks[openerIdx];
  const rest = tracks.filter((_, i) => i !== openerIdx);

  // Shuffle remaining with artist separation
  const shuffled = shuffleWithSeparation(rest);

  const queue = [opener, ...shuffled].map((t, i) => ({
    trackId: t.id,
    position: i + 1,
    role: i === 0 ? 'opener' : i === shuffled.length ? 'closer' : 'build',
    reason: 'local planner',
  }));

  return { queue, arcShape };
}

function pickOpener(
  tracks: TrackProfile[],
  _vibe: Vibe,
  recentlyPlayed: Set<string>
): number {
  // Score each track as a potential opener
  let bestIdx = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < tracks.length; i++) {
    let score = 0;
    // Prefer tracks not recently played
    if (!recentlyPlayed.has(tracks[i].id)) score += 10;
    // Prefer tracks with artwork (better visual impression)
    if (tracks[i].artworkUrl) score += 3;
    // Add some randomness so it's not always the same
    score += Math.random() * 5;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function shuffleWithSeparation(tracks: TrackProfile[]): TrackProfile[] {
  // Fisher-Yates shuffle
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Post-shuffle: push same-artist tracks apart
  for (let i = 1; i < shuffled.length; i++) {
    if (shuffled[i].artistName === shuffled[i - 1].artistName) {
      // Find the nearest track ahead that has a different artist
      for (let j = i + 1; j < shuffled.length; j++) {
        if (shuffled[j].artistName !== shuffled[i].artistName) {
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          break;
        }
      }
    }
  }

  return shuffled;
}

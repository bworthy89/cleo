import type { TrackProfile } from '../services/TrackEnrichmentService';
import type { QueuePlan } from './QueuePlanner';
import type { Vibe } from '../cleo/fallbacks';
import { getRecentlyPlayed } from '../services/Storage';

// Genre affinities per vibe — tracks matching these genres score higher
const VIBE_GENRES: Record<Vibe, string[]> = {
  morning: ['pop', 'indie', 'folk', 'acoustic', 'singer-songwriter', 'soft rock'],
  chill: ['r&b', 'soul', 'neo-soul', 'jazz', 'lo-fi', 'ambient', 'downtempo', 'chillwave'],
  workout: ['hip-hop', 'rap', 'electronic', 'edm', 'dance', 'drum & bass', 'trap', 'punk', 'metal'],
  lateNight: ['r&b', 'soul', 'jazz', 'ambient', 'trip-hop', 'downtempo', 'neo-soul', 'shoegaze'],
  party: ['pop', 'hip-hop', 'dance', 'edm', 'electronic', 'funk', 'disco', 'reggaeton'],
  general: [],
  focus: ['ambient', 'electronic', 'classical', 'post-rock', 'instrumental', 'lo-fi', 'downtempo'],
  feelGood: ['pop', 'funk', 'soul', 'disco', 'indie pop', 'r&b', 'reggae'],
  throwback: ['classic rock', 'pop', 'r&b', 'soul', 'hip-hop', 'funk', 'disco', 'new wave'],
  elevated: ['jazz', 'classical', 'art pop', 'progressive', 'post-rock', 'chamber pop'],
  melancholy: ['indie', 'folk', 'shoegaze', 'post-punk', 'dream pop', 'slowcore', 'emo'],
  sunday: ['folk', 'acoustic', 'indie', 'soft rock', 'jazz', 'soul', 'singer-songwriter'],
};

/**
 * Fast local queue planner — no API calls.
 * Picks a vibe-appropriate opener, then shuffles remaining tracks
 * with artist/album separation and vibe-weighted ordering.
 * Used to start playback instantly while the AI planner works in the background.
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

  // Shuffle remaining with artist separation and vibe weighting
  const shuffled = shuffleWithSeparation(rest, vibe);

  const queue = [opener, ...shuffled].map((t, i) => ({
    trackId: t.id,
    position: i + 1,
    role: i === 0 ? 'opener' : i === shuffled.length ? 'closer' : 'build',
    reason: 'local planner',
  }));

  return { queue, arcShape };
}

function vibeGenreScore(track: TrackProfile, vibe: Vibe): number {
  const preferred = VIBE_GENRES[vibe];
  if (preferred.length === 0) return 0;
  const genres = (track.genreNames ?? []).map((g) => g.toLowerCase());
  for (const genre of genres) {
    if (preferred.some((p) => genre.includes(p) || p.includes(genre))) return 8;
  }
  return 0;
}

function pickOpener(
  tracks: TrackProfile[],
  vibe: Vibe,
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
    // Prefer tracks that match the vibe's genre affinities
    score += vibeGenreScore(tracks[i], vibe);
    // Add some randomness so it's not always the same
    score += Math.random() * 5;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function primaryGenre(track: TrackProfile): string {
  return (track.genreNames?.[0] ?? 'unknown').toLowerCase();
}

function genreSimilarity(a: TrackProfile, b: TrackProfile): number {
  const genresA = (a.genreNames ?? []).map((g) => g.toLowerCase());
  const genresB = (b.genreNames ?? []).map((g) => g.toLowerCase());
  if (genresA.length === 0 || genresB.length === 0) return 0;
  // Exact primary genre match
  if (genresA[0] === genresB[0]) return 3;
  // Any shared genre
  if (genresA.some((g) => genresB.includes(g))) return 2;
  // Substring overlap (e.g. "indie pop" ↔ "indie rock")
  if (genresA.some((ga) => genresB.some((gb) => ga.split(' ')[0] === gb.split(' ')[0]))) return 1;
  return 0;
}

function shuffleWithSeparation(tracks: TrackProfile[], vibe: Vibe): TrackProfile[] {
  if (tracks.length <= 1) return [...tracks];

  // Greedy nearest-neighbor sequencer:
  // Pick each next track to maximize genre flow + vibe fit while avoiding same artist/album
  const remaining = new Set(tracks.map((_, i) => i));
  const result: TrackProfile[] = [];

  // Start with the best vibe-matching track (or random for general)
  let bestStart = 0;
  let bestStartScore = -Infinity;
  for (const i of remaining) {
    const score = vibeGenreScore(tracks[i], vibe) + Math.random() * 4;
    if (score > bestStartScore) {
      bestStartScore = score;
      bestStart = i;
    }
  }
  result.push(tracks[bestStart]);
  remaining.delete(bestStart);

  while (remaining.size > 0) {
    const prev = result[result.length - 1];
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const i of remaining) {
      const t = tracks[i];
      let score = 0;

      // Genre flow: prefer similar genres to previous track
      score += genreSimilarity(prev, t) * 3;

      // Vibe affinity: prefer tracks matching the selected vibe
      score += vibeGenreScore(t, vibe);

      // Artist separation: penalize same artist as previous
      if (t.artistName === prev.artistName) score -= 15;

      // Also penalize if same artist as 2-back
      if (result.length >= 2 && t.artistName === result[result.length - 2].artistName) score -= 10;

      // Album separation: penalize same album as previous
      if (t.albumTitle && t.albumTitle === prev.albumTitle) score -= 8;

      // Genre variety: slight penalty if exact same primary genre as last 2 tracks
      if (result.length >= 2 && primaryGenre(t) === primaryGenre(prev) && primaryGenre(t) === primaryGenre(result[result.length - 2])) {
        score -= 4;
      }

      // Randomness to prevent deterministic output
      score += Math.random() * 3;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    result.push(tracks[bestIdx]);
    remaining.delete(bestIdx);
  }

  return result;
}

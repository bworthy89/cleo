import { API_BASE_URL } from '../services/api';
import type { TrackProfile } from '../services/TrackEnrichmentService';
import type { Vibe } from '../cleo/fallbacks';
import { getRecentlyPlayed } from '../services/Storage';

export interface QueuedTrack {
  trackId: string;
  position: number;
  role: string;
  reason: string;
}

export interface QueuePlan {
  queue: QueuedTrack[];
  arcShape: 'short' | 'medium' | 'long';
}

function getArcShape(trackCount: number): 'short' | 'medium' | 'long' {
  if (trackCount < 20) return 'short';
  if (trackCount <= 40) return 'medium';
  return 'long';
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Late Night';
}

export async function planQueue(
  tracks: TrackProfile[],
  vibe: Vibe
): Promise<QueuePlan> {
  const arcShape = getArcShape(tracks.length);
  const recentlyPlayed = getRecentlyPlayed().trackIds;

  const trackSummary = tracks.map((t, i) => ({
    index: i,
    id: t.id,
    title: t.title,
    artist: t.artistName,
    album: t.albumTitle ?? '',
    genre: (t.genreNames ?? []).join(', '),
    tags: (t.tags ?? []).join(', '),
    year: t.year ?? '',
    duration: t.duration ?? 0,
  }));

  const vibeLabel = {
    morning: 'Morning Drive — energized but grounded',
    chill: 'Chill Session — relaxed, storytelling, reflective',
    workout: 'Workout — high energy, minimal breaks',
    lateNight: 'Late Night — intimate, slow, atmospheric',
    party: 'Party — loud energy, momentum, crowd pleasers',
  }[vibe];

  const arcDescription = {
    short: 'Short session (<20 tracks): opener → build → peak → close. Every track matters. Get to the peak by track 60-70% through.',
    medium: 'Medium session (20-40 tracks): opener → early build → mid build → peak section (3-4 tracks) → cool down → close. Build gradually.',
    long: 'Long session (40+ tracks): Full arc with multiple peaks and valleys. Build → peak → valley → second build → highest peak → extended cool down → close. Create waves.',
  }[arcShape];

  const systemPrompt = `You are a professional music DJ and playlist curator. Your job is to sequence a playlist into a session that feels like a curated DJ set.

RULES:
- Never place the same artist within 3 tracks of each other
- Never place the same album within 5 tracks of each other
- If adjacent tracks have very different genres, place a bridge track between them that shares elements with both
- Match the session vibe — don't put aggressive tracks in a chill session
- The opener should set the tone perfectly for the vibe
- The peak should contain the most energetic/impactful tracks
- The closer should feel like a natural wind-down

Respond ONLY with valid JSON. No markdown, no explanation.`;

  const userPrompt = `Plan a ${arcShape} DJ set for this vibe: ${vibeLabel}

Time of day: ${getTimeOfDay()}
Arc structure: ${arcDescription}

Available tracks:
${JSON.stringify(trackSummary, null, 2)}

Recently played (avoid these for opener/peak if possible):
${JSON.stringify(recentlyPlayed.slice(0, 20))}

Return JSON in this exact format:
{
  "queue": [
    { "trackId": "<id>", "position": 1, "role": "opener|build|bridge|peak|cooldown|closer", "reason": "<why this track here>" }
  ],
  "arcShape": "${arcShape}"
}

Include ALL tracks. Every track must appear exactly once. Order them to create the best possible listening arc.`;

  try {
    const response = await fetch(`${API_BASE_URL}/generate-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt, userPrompt }),
    });

    if (!response.ok) throw new Error(`Queue planning failed: ${response.status}`);

    const data = await response.json();
    let text = data.text.trim();

    // Extract JSON from response — Gemini may include thinking text, markdown fences, etc.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }
    text = jsonMatch[0];

    const plan: QueuePlan = JSON.parse(text);

    // Validate all tracks are present
    const plannedIds = new Set(plan.queue.map((q) => q.trackId));
    const missingTracks = tracks.filter((t) => !plannedIds.has(t.id));
    if (missingTracks.length > 0) {
      // Append missing tracks at the end
      missingTracks.forEach((t, i) => {
        plan.queue.push({
          trackId: t.id,
          position: plan.queue.length + 1 + i,
          role: 'build',
          reason: 'not placed by AI, appended',
        });
      });
    }

    return plan;
  } catch (error) {
    console.error('Queue planning failed, using original order:', error);
    // Fallback: return tracks in original order
    return {
      queue: tracks.map((t, i) => ({
        trackId: t.id,
        position: i + 1,
        role: i === 0 ? 'opener' : i === tracks.length - 1 ? 'closer' : 'build',
        reason: 'fallback — original playlist order',
      })),
      arcShape,
    };
  }
}

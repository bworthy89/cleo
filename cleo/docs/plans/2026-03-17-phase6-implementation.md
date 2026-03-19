# Phase 6 — Session Engine + Queue Intelligence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI-curated song sequencing with energy arcs, genre bridging, skip adaptation, cold opens, and session persistence — making every session feel like a professional DJ set.

**Architecture:** Four layers: (1) TrackProfile metadata from MusicKit + MusicBrainz, (2) Gemini plans the full queue arc at session start, (3) hard rules engine validates and fixes variety/energy/genre violations, (4) runtime adaptation on skips and session extension. SessionEngine manages lifecycle. QueueManager owns sequencing. Cold opens from PRD library.

**Tech Stack:** Gemini 2.5 Flash (queue planning), MusicBrainz API (track metadata), MMKV (session persistence), existing ExpoMusicKit module

---

### Task 1: Add MusicBrainz enrichment backend route and client service

**Files:**
- Create: `server/src/routes/musicbrainz.ts`
- Modify: `server/src/index.ts`
- Create: `src/services/TrackEnrichmentService.ts`

**Step 1: Create the MusicBrainz proxy route**

The route handles rate limiting server-side (1 req/sec) so the client doesn't worry about it.

`server/src/routes/musicbrainz.ts`:
```typescript
import { Router, Request, Response } from 'express';

export const musicbrainzRouter = Router();

let lastRequestTime = 0;
const MIN_INTERVAL = 1100; // 1.1 seconds between requests

async function rateLimitedFetch(url: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'CleoRadioApp/1.0 (bworthy89@gmail.com)',
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`MusicBrainz: ${response.status}`);
  return response.json();
}

musicbrainzRouter.post('/enrich-musicbrainz', async (req: Request, res: Response) => {
  try {
    const { title, artist } = req.body;
    if (!title || !artist) {
      res.status(400).json({ error: 'title and artist are required' });
      return;
    }

    const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const data = await rateLimitedFetch(
      `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=1&fmt=json`
    );

    const recording = data.recordings?.[0];
    if (!recording) {
      res.json({ found: false });
      return;
    }

    // Get tags if available
    const tags = (recording.tags ?? [])
      .sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 5)
      .map((t: any) => t.name);

    res.json({
      found: true,
      mbid: recording.id,
      title: recording.title,
      artist: recording['artist-credit']?.[0]?.name,
      duration: recording.length ? Math.round(recording.length / 1000) : null,
      tags,
      firstReleaseYear: recording['first-release-date']?.substring(0, 4) ?? null,
    });
  } catch (error) {
    console.error('MusicBrainz error:', error);
    res.status(500).json({ error: 'MusicBrainz lookup failed' });
  }
});
```

**Step 2: Register the route in index.ts**

Add to `server/src/index.ts`:
```typescript
import { musicbrainzRouter } from './routes/musicbrainz';
// ... after other router registrations:
app.use(musicbrainzRouter);
```

**Step 3: Create TrackEnrichmentService**

`src/services/TrackEnrichmentService.ts`:
```typescript
import { API_BASE_URL } from './api';
import { storage, StorageKeys } from './Storage';
import type { MusicTrack } from '../../modules/expo-music-kit';

export interface TrackProfile extends MusicTrack {
  tempo?: number;
  tags?: string[];
  year?: string;
  mbEnriched: boolean;
}

const CACHE_KEY_PREFIX = 'enrichment:';

function getCached(trackId: string): TrackProfile | null {
  const raw = storage.getString(`${CACHE_KEY_PREFIX}${trackId}`);
  return raw ? JSON.parse(raw) : null;
}

function setCache(trackId: string, profile: TrackProfile): void {
  storage.set(`${CACHE_KEY_PREFIX}${trackId}`, JSON.stringify(profile));
}

export async function enrichTrack(track: MusicTrack): Promise<TrackProfile> {
  // Check cache first
  const cached = getCached(track.id);
  if (cached) return cached;

  // Base profile from MusicKit data
  const profile: TrackProfile = {
    ...track,
    tags: [],
    mbEnriched: false,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/enrich-musicbrainz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.found) {
        profile.tags = data.tags ?? [];
        profile.year = data.firstReleaseYear ?? undefined;
        profile.mbEnriched = true;
      }
    }
  } catch {
    // Enrichment failure is non-fatal
  }

  setCache(track.id, profile);
  return profile;
}

export async function enrichTracks(tracks: MusicTrack[]): Promise<TrackProfile[]> {
  const results: TrackProfile[] = [];
  for (const track of tracks) {
    results.push(await enrichTrack(track));
  }
  return results;
}
```

**Step 4: Test MusicBrainz route**

```bash
cd server && npm run dev
curl -X POST http://localhost:3001/enrich-musicbrainz \
  -H "Content-Type: application/json" \
  -d '{"title":"Dreams","artist":"Fleetwood Mac"}'
```

**Step 5: Commit**

```bash
git add server/src/routes/musicbrainz.ts server/src/index.ts src/services/TrackEnrichmentService.ts
git commit -m "feat: add MusicBrainz enrichment with rate limiting and caching"
```

---

### Task 2: Build the AI Queue Planner

**Files:**
- Create: `src/engines/QueuePlanner.ts`

This is the brain — sends track metadata to Gemini, gets back an ordered queue.

**Step 1: Create QueuePlanner**

`src/engines/QueuePlanner.ts`:
```typescript
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

    // Strip markdown code fences if present
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

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
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/engines/QueuePlanner.ts
git commit -m "feat: add AI queue planner — Gemini sequences tracks into DJ-set arc"
```

---

### Task 3: Build the Rules Engine

**Files:**
- Create: `src/engines/RulesEngine.ts`

**Step 1: Create RulesEngine**

`src/engines/RulesEngine.ts`:
```typescript
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
  queue = enforceGenreBridging(queue, trackMap, tracks);

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

function enforceGenreBridging(
  queue: QueuedTrack[],
  trackMap: TrackMap,
  allTracks: TrackProfile[]
): QueuedTrack[] {
  const result = [...queue];

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
      const bridgeIdx = findBridgeCandidate(result, trackMap, i, prevGenre, currGenre, relatedGenres);
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
  gapIndex: number,
  genre1: string,
  genre2: string,
  relatedGenres: Record<string, string[]>
): number {
  // Find a track elsewhere in the queue whose genre relates to both sides
  for (let i = gapIndex + 1; i < queue.length; i++) {
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
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/engines/RulesEngine.ts
git commit -m "feat: add rules engine — artist/album variety + genre bridging"
```

---

### Task 4: Build SessionEngine

**Files:**
- Create: `src/engines/SessionEngine.ts`

**Step 1: Create SessionEngine**

`src/engines/SessionEngine.ts`:
```typescript
import { storage } from '../services/Storage';
import type { TrackProfile } from '../services/TrackEnrichmentService';
import type { Vibe } from '../cleo/fallbacks';
import type { QueuePlan, QueuedTrack } from './QueuePlanner';

export type SessionPhase = 'coldOpen' | 'earlySession' | 'build' | 'peak' | 'resolution' | 'signOff';

export interface Session {
  id: string;
  stationId: string;
  vibe: Vibe;
  startTime: number;
  tracksPlayed: string[];
  skippedTracks: string[];
  currentPhase: SessionPhase;
  queuePlan: QueuePlan | null;
  currentQueueIndex: number;
}

class SessionEngineService {
  private session: Session | null = null;

  startSession(stationId: string, vibe: Vibe): Session {
    this.session = {
      id: `session-${Date.now()}`,
      stationId,
      vibe,
      startTime: Date.now(),
      tracksPlayed: [],
      skippedTracks: [],
      currentPhase: 'coldOpen',
      queuePlan: null,
      currentQueueIndex: 0,
    };
    this.persist();
    return this.session;
  }

  getSession(): Session | null {
    return this.session;
  }

  setQueuePlan(plan: QueuePlan): void {
    if (!this.session) return;
    this.session.queuePlan = plan;
    this.persist();
  }

  getCurrentPhase(): SessionPhase {
    if (!this.session) return 'coldOpen';
    const minutes = this.getSessionDuration();
    const trackCount = this.session.tracksPlayed.length;

    if (trackCount === 0) return 'coldOpen';
    if (minutes < 12) return 'earlySession';
    if (minutes < 35) return 'build';
    if (minutes < 50) return 'peak';
    return 'resolution';
  }

  getSessionDuration(): number {
    if (!this.session) return 0;
    return Math.floor((Date.now() - this.session.startTime) / 60000);
  }

  getNextTrackId(): string | null {
    if (!this.session?.queuePlan) return null;
    const { queue } = this.session.queuePlan;
    if (this.session.currentQueueIndex >= queue.length) return null;
    return queue[this.session.currentQueueIndex].trackId;
  }

  getNextTrackIds(count: number): string[] {
    if (!this.session?.queuePlan) return [];
    const { queue } = this.session.queuePlan;
    const start = this.session.currentQueueIndex;
    return queue.slice(start, start + count).map((q) => q.trackId);
  }

  getCurrentQueueEntry(): QueuedTrack | null {
    if (!this.session?.queuePlan) return null;
    const idx = Math.max(0, this.session.currentQueueIndex - 1);
    return this.session.queuePlan.queue[idx] ?? null;
  }

  advanceTrack(trackId: string): void {
    if (!this.session) return;
    this.session.tracksPlayed.push(trackId);
    this.session.currentQueueIndex++;
    this.session.currentPhase = this.getCurrentPhase();
    this.persist();
  }

  recordSkip(trackId: string): void {
    if (!this.session) return;
    this.session.skippedTracks.push(trackId);
    this.persist();
  }

  getConsecutiveSkips(): number {
    if (!this.session) return 0;
    const { skippedTracks, tracksPlayed } = this.session;
    let count = 0;
    for (let i = skippedTracks.length - 1; i >= 0; i--) {
      const lastPlayed = tracksPlayed[tracksPlayed.length - 1 - count];
      if (skippedTracks[i] === lastPlayed) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  endSession(): void {
    if (!this.session) return;
    // Save to session history
    const historyKey = 'sessionHistory';
    const raw = storage.getString(historyKey);
    const history: Session[] = raw ? JSON.parse(raw) : [];
    history.unshift(this.session);
    if (history.length > 20) history.pop();
    storage.set(historyKey, JSON.stringify(history));
    this.session = null;
  }

  private persist(): void {
    if (!this.session) return;
    storage.set('currentSession', JSON.stringify(this.session));
  }
}

export const sessionEngine = new SessionEngineService();
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/engines/SessionEngine.ts
git commit -m "feat: add SessionEngine with phase tracking, skip recording, persistence"
```

---

### Task 5: Build QueueManager (orchestrates everything)

**Files:**
- Create: `src/engines/QueueManager.ts`

**Step 1: Create QueueManager**

`src/engines/QueueManager.ts`:
```typescript
import { planQueue, type QueuePlan } from './QueuePlanner';
import { enforceRules } from './RulesEngine';
import { enrichTracks, type TrackProfile } from '../services/TrackEnrichmentService';
import { sessionEngine } from './SessionEngine';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import type { Vibe } from '../cleo/fallbacks';
import type { MusicTrack } from '../../modules/expo-music-kit';

class QueueManagerService {
  private trackProfiles: TrackProfile[] = [];
  private enrichmentInProgress = false;

  async initializeSession(
    playlistId: string,
    vibe: Vibe,
    stationId: string
  ): Promise<void> {
    // Start session
    sessionEngine.startSession(stationId, vibe);

    // Fetch tracks from playlist
    const tracks = await musicKitPlayer.fetchPlaylistTracks(playlistId);
    if (tracks.length === 0) return;

    // Start with basic MusicKit metadata
    this.trackProfiles = tracks.map((t) => ({
      ...t,
      tags: [],
      mbEnriched: false,
    }));

    // Plan queue with what we have (genre/title/artist from MusicKit)
    const rawPlan = await planQueue(this.trackProfiles, vibe);
    const validatedPlan = enforceRules(rawPlan, this.trackProfiles);
    sessionEngine.setQueuePlan(validatedPlan);

    // Start playing the first track
    const firstTrackId = validatedPlan.queue[0]?.trackId;
    if (firstTrackId) {
      await musicKitPlayer.play([firstTrackId]);
      sessionEngine.advanceTrack(firstTrackId);
    }

    // Enrich tracks in background (improves future re-plans)
    this.enrichInBackground(tracks);
  }

  async playNextTrack(): Promise<string | null> {
    const nextId = sessionEngine.getNextTrackId();
    if (!nextId) return null;

    await musicKitPlayer.play([nextId]);
    sessionEngine.advanceTrack(nextId);
    return nextId;
  }

  async handleSkip(skippedTrackId: string): Promise<void> {
    sessionEngine.recordSkip(skippedTrackId);

    const consecutiveSkips = sessionEngine.getConsecutiveSkips();
    if (consecutiveSkips >= 2) {
      // Re-plan remaining queue
      await this.replanQueue();
    }
  }

  private async replanQueue(): Promise<void> {
    const session = sessionEngine.getSession();
    if (!session?.queuePlan) return;

    const remainingQueue = session.queuePlan.queue.slice(session.currentQueueIndex);
    const remainingTrackIds = new Set(remainingQueue.map((q) => q.trackId));
    const remainingProfiles = this.trackProfiles.filter((t) => remainingTrackIds.has(t.id));

    if (remainingProfiles.length === 0) return;

    const newPlan = await planQueue(remainingProfiles, session.vibe);
    const validated = enforceRules(newPlan, remainingProfiles);

    // Merge: keep played tracks, replace remaining with new plan
    const playedQueue = session.queuePlan.queue.slice(0, session.currentQueueIndex);
    const mergedPlan: QueuePlan = {
      queue: [
        ...playedQueue,
        ...validated.queue.map((q, i) => ({ ...q, position: playedQueue.length + i + 1 })),
      ],
      arcShape: validated.arcShape,
    };

    sessionEngine.setQueuePlan(mergedPlan);
    console.log('[QueueManager] Re-planned queue after skips');
  }

  private async enrichInBackground(tracks: MusicTrack[]): Promise<void> {
    if (this.enrichmentInProgress) return;
    this.enrichmentInProgress = true;

    try {
      this.trackProfiles = await enrichTracks(tracks);
    } catch {
      // Non-fatal
    } finally {
      this.enrichmentInProgress = false;
    }
  }

  getTrackProfiles(): TrackProfile[] {
    return this.trackProfiles;
  }
}

export const queueManager = new QueueManagerService();
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/engines/QueueManager.ts
git commit -m "feat: add QueueManager — orchestrates enrichment, planning, rules, playback"
```

---

### Task 6: Add cold opens

**Files:**
- Create: `src/cleo/cold-opens.ts`
- Modify: `src/engines/SegmentController.ts`

**Step 1: Create cold opens library**

`src/cleo/cold-opens.ts`:
```typescript
import type { Vibe } from './fallbacks';
import { storage } from '../services/Storage';

interface ColdOpenHistory {
  lastUsedByVibe: Record<string, number>;
  consecutiveDays: number;
  lastSessionDate: string;
  totalSessions: number;
}

const COLD_OPENS: Record<Vibe, string[]> = {
  morning: [
    "Good morning. You showed up — that already puts you ahead. I've got something lined up that's going to make the commute feel shorter than it is. Let's go.",
    "Morning. Coffee optional — this playlist is mandatory. I've been sitting on this first track waiting for the right moment. This is it. Here we go.",
    "You're up. That's the hard part. The rest of this morning? Leave it to me. Let's ease into it.",
  ],
  chill: [
    "Hey. Glad you're here. No agenda, no rush — just you and some music that earned its place in your library. I'll be right here with you. Let's get into it.",
    "You picked the right time to slow down. I've got a whole story lined up for you today — it starts with this first one. Pay attention to how it opens.",
    "Sometimes you don't need words. You just need the right song at the right moment. I'm going to give you that. Starting now.",
  ],
  workout: [
    "Alright. You showed up for yourself today — respect that. I'm not going to talk much. Just know I've got you the whole way through. Let's move.",
    "No long introductions. You've got work to do. I've got the soundtrack. First track hits hard — be ready.",
    "You laced up. You showed up. Now let the music do the rest. Lock in.",
  ],
  lateNight: [
    "It's late. Most people are asleep. But you're here, and I think you know exactly why. I'm not going to overthink it either. This first one sets the whole tone — just let it.",
    "Hey. I see you up late. No judgment — I'm always here. I put something together for exactly this kind of night. Let it breathe.",
    "The city gets quieter around this hour. So do I. This session is just for us. Here's where we start.",
  ],
  party: [
    "Okay. Let's not waste any time — the vibe is already there, I'm just here to keep it going. First track is going to set the whole tone for the night. Turn it up.",
    "You know what this is. I know what this is. Let's not pretend otherwise — we're here to have a good time. Starting right now.",
    "The night is young. The playlist is ready. I'll keep the energy up — you just handle the rest. Here we go.",
  ],
};

const SPECIAL_OPENS: Record<string, string> = {
  firstEver: "Hey — first time here. I'm Cleo. I'm not going to explain too much — the music will do that for me. Just know you're in good hands. Here's how we start.",
  sameDayReturn: "Back already? I respect that. Let's pick up where the energy left off — I've got something different lined up this time.",
  streak3: "Three days in a row. You and me both know this has become a thing. I'm not complaining. Let's get into it.",
  mondayMorning: "Monday. I know. But we're going to get through it together — I've done this before. First track is going to help, I promise.",
  fridayLateNight: "Friday night. Late. That's a very specific energy and I know exactly what it calls for. No warm up needed — we go straight in.",
};

function getHistory(): ColdOpenHistory {
  const raw = storage.getString('coldOpenHistory');
  return raw
    ? JSON.parse(raw)
    : { lastUsedByVibe: {}, consecutiveDays: 0, lastSessionDate: '', totalSessions: 0 };
}

function saveHistory(history: ColdOpenHistory): void {
  storage.set('coldOpenHistory', JSON.stringify(history));
}

export function getColdOpen(vibe: Vibe): string {
  const history = getHistory();
  const today = new Date().toISOString().substring(0, 10);
  const day = new Date().getDay(); // 0=Sun, 1=Mon, 5=Fri
  const hour = new Date().getHours();

  let selectedOpen: string;

  // Priority 1: First session ever
  if (history.totalSessions === 0) {
    selectedOpen = SPECIAL_OPENS.firstEver;
  }
  // Priority 2: Same-day return
  else if (history.lastSessionDate === today) {
    selectedOpen = SPECIAL_OPENS.sameDayReturn;
  }
  // Priority 3: 3+ consecutive days
  else if (history.consecutiveDays >= 2) {
    // Will become 3 after we update
    selectedOpen = SPECIAL_OPENS.streak3;
  }
  // Priority 4: Monday morning
  else if (day === 1 && hour < 12) {
    selectedOpen = SPECIAL_OPENS.mondayMorning;
  }
  // Priority 5: Friday late night
  else if (day === 5 && hour >= 21) {
    selectedOpen = SPECIAL_OPENS.fridayLateNight;
  }
  // Default: vibe-matched, avoid last used
  else {
    const options = COLD_OPENS[vibe];
    const lastUsedIdx = history.lastUsedByVibe[vibe] ?? -1;
    const availableIdxs = options.map((_, i) => i).filter((i) => i !== lastUsedIdx);
    const idx = availableIdxs[Math.floor(Math.random() * availableIdxs.length)] ?? 0;
    selectedOpen = options[idx];
    history.lastUsedByVibe[vibe] = idx;
  }

  // Update history
  const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
  if (history.lastSessionDate === yesterday) {
    history.consecutiveDays++;
  } else if (history.lastSessionDate !== today) {
    history.consecutiveDays = 1;
  }
  history.lastSessionDate = today;
  history.totalSessions++;
  saveHistory(history);

  return selectedOpen;
}
```

**Step 2: Update SegmentController to use cold opens**

In `src/engines/SegmentController.ts`, add cold open support. Import `getColdOpen` and add a `isFirstSegment` flag. When `segmentCount === 0`, return a cold open instead of generating via Gemini.

Add at the top:
```typescript
import { getColdOpen } from '../cleo/cold-opens';
```

Modify `generateNext` to check for cold open:
```typescript
async generateNext(currentTrack: TrackInfo, nextTrack?: TrackInfo): Promise<SegmentResult> {
  // Cold open for first segment
  if (this.segmentCount === 0) {
    const text = getColdOpen(this.currentVibe);
    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;
    return { text, type: 'song_intro' };
  }

  // ... rest of existing logic
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/cleo/cold-opens.ts src/engines/SegmentController.ts
git commit -m "feat: add cold opens with special conditions and session history"
```

---

### Task 7: Wire QueueManager into HomeScreen

**Files:**
- Modify: `src/screens/home/HomeScreen.tsx`
- Modify: `src/engines/AudioCoordinator.ts`

**Step 1: Update HomeScreen to use QueueManager for session start**

When a station card is tapped, instead of directly calling `musicKitPlayer.play()`, call `queueManager.initializeSession()` which handles enrichment, AI planning, rules, and playback.

Import:
```typescript
import { queueManager } from '../../engines/QueueManager';
import { sessionEngine } from '../../engines/SessionEngine';
```

Update `handleStationPress`:
```typescript
const handleStationPress = useCallback(async (station: Station) => {
  try {
    await queueManager.initializeSession(
      station.playlistId,
      (station.defaultVibe as Vibe) ?? 'chill',
      station.id
    );
    setAuthState('playing');
    refreshNowPlaying();
  } catch (error) {
    console.error('Failed to start session:', error);
  }
}, []);
```

**Step 2: Update AudioCoordinator to advance queue on track change**

In `AudioCoordinator.ts`, after Cleo speaks, play the next track from the queue:

```typescript
import { queueManager } from './QueueManager';
import { sessionEngine } from './SessionEngine';

// In handleTrackChange, after synthesizeAndPlay:
// Play next track from queue
const nextId = await queueManager.playNextTrack();
if (nextId) {
  console.log('[AudioCoordinator] Playing next from queue:', nextId);
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/screens/home/HomeScreen.tsx src/engines/AudioCoordinator.ts
git commit -m "feat: wire QueueManager into session start and track advancement"
```

---

### Task 8: Rebuild and test on device

**Step 1: Full rebuild (no native changes, but sync everything)**

Sync to build path, ensure Metro serves from correct directory, backend running.

**Step 2: Test the session flow**

1. Open app, tap a station card
2. Wait 3-5s while Gemini plans the queue (first track plays immediately with MusicKit data)
3. Cleo delivers a cold open
4. Songs play in AI-curated order
5. Genre transitions are smooth
6. Skip 2+ tracks in a row → queue re-plans
7. Segment types rotate (intros, station IDs, shoutouts)

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Phase 6 complete — AI-curated queue with session intelligence"
```

---

## Milestone Verification

Phase 6 is complete when:

- [ ] Session starts with AI-planned queue (not playlist order)
- [ ] Cold open plays on first segment with correct vibe variant
- [ ] Songs flow with intentional energy arc
- [ ] No same artist within 3 tracks
- [ ] Genre jumps have bridge tracks or transition narration
- [ ] 2+ skips trigger queue re-planning
- [ ] Session persists to MMKV
- [ ] MusicBrainz enrichment runs in background
- [ ] Fallback to playlist order if Gemini fails

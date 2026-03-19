# Phase 7 — Track Enrichment + Storytelling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cleo tells real, verified stories about songs using MusicBrainz + Genius data, with graceful fallback to artist context when no data is available.

**Architecture:** TrackEnrichmentService extended to query Genius via existing /enrich-track route. EnrichedFacts added to TrackProfile. SegmentController checks for rich data and selects track_story or artist_context segment types. Verified facts injected into Gemini prompt.

**Tech Stack:** Genius API (via backend proxy), existing MusicBrainz enrichment, Gemini 2.5 Flash

---

### Task 1: Extend TrackEnrichmentService with Genius data

**Files:**
- Modify: `src/services/TrackEnrichmentService.ts`

**Step 1: Add enrichedFacts to TrackProfile and query Genius**

Update `TrackProfile` interface and `enrichTrack` function:

```typescript
import { API_BASE_URL } from './api';
import { storage } from './Storage';
import type { MusicTrack } from '../../modules/expo-music-kit';

export interface EnrichedFacts {
  producer?: string;
  songwriter?: string;
  sample?: string;
  context?: string;
  geniusUrl?: string;
}

export interface TrackProfile extends MusicTrack {
  tempo?: number;
  tags?: string[];
  year?: string;
  mbEnriched: boolean;
  enrichedFacts?: EnrichedFacts;
  hasRichData: boolean;
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
  const cached = getCached(track.id);
  if (cached) return cached;

  const profile: TrackProfile = {
    ...track,
    tags: [],
    mbEnriched: false,
    hasRichData: false,
  };

  // MusicBrainz enrichment
  try {
    const mbResponse = await fetch(`${API_BASE_URL}/enrich-musicbrainz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (mbResponse.ok) {
      const data = await mbResponse.json();
      if (data.found) {
        profile.tags = data.tags ?? [];
        profile.year = data.firstReleaseYear ?? undefined;
        profile.mbEnriched = true;
      }
    }
  } catch {
    // Non-fatal
  }

  // Genius enrichment
  try {
    const geniusResponse = await fetch(`${API_BASE_URL}/enrich-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (geniusResponse.ok) {
      const data = await geniusResponse.json();
      if (data.results && data.results.length > 0) {
        const topResult = data.results[0];
        profile.enrichedFacts = {
          geniusUrl: topResult.url,
        };
        // We have at least a Genius match — mark as having some data
        profile.hasRichData = true;
      }
    }
  } catch {
    // Non-fatal
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

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/services/TrackEnrichmentService.ts
git commit -m "feat: extend enrichment with Genius data and hasRichData flag"
```

---

### Task 2: Add track_story and artist_context segment types

**Files:**
- Modify: `src/cleo/fallbacks.ts`

**Step 1: Add new segment types and fallback lines**

Update the `SegmentType` union to include new types:

```typescript
export type SegmentType =
  | 'song_intro'
  | 'track_story'
  | 'artist_context'
  | 'station_id'
  | 'listener_shoutout'
  | 'session_checkin'
  | 'sign_off';
```

Add fallback entries for the new types to the `fallbacks` array:

```typescript
  {
    type: 'track_story',
    lines: [
      'There\'s a story behind this one that most people don\'t know. Listen a little closer.',
      'The way this track came together — there\'s more to it than you\'d think.',
      'This one has layers. The production alone is worth paying attention to.',
      'Someone put their whole heart into making this. You can hear it.',
      'The story behind this recording is one of my favorites.',
    ],
  },
  {
    type: 'artist_context',
    lines: [
      'This artist has been on a journey. You can hear it in the music.',
      'There\'s a reason this artist keeps coming back to your rotation.',
      'When you listen to enough of their catalog, you start to hear the evolution.',
      'Not everyone can make music that sticks with you like this.',
      'This is someone who understands their craft. Every detail is intentional.',
    ],
  },
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/cleo/fallbacks.ts
git commit -m "feat: add track_story and artist_context segment types with fallbacks"
```

---

### Task 3: Update SegmentController to use enriched facts

**Files:**
- Modify: `src/engines/SegmentController.ts`
- Modify: `src/services/CleoScriptGenerator.ts`

**Step 1: Add enrichedFacts to TrackInfo and SegmentContext**

In `SegmentController.ts`, update the `TrackInfo` interface:

```typescript
import type { EnrichedFacts } from '../services/TrackEnrichmentService';

interface TrackInfo {
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
}
```

Update the rotation to include `track_story` and `artist_context`:

```typescript
const ROTATION: SegmentType[] = [
  'song_intro',
  'artist_context',
  'station_id',
  'song_intro',
  'track_story',
  'listener_shoutout',
  'song_intro',
  'artist_context',
  'session_checkin',
];
```

In `generateNext`, after getting the segment type from rotation, check if `track_story` is eligible:

```typescript
let segmentType = this.getNextSegmentType();

// track_story requires rich data — fall back to artist_context if not available
if (segmentType === 'track_story' && !currentTrack.hasRichData) {
  segmentType = 'artist_context';
}
```

**Step 2: Update CleoScriptGenerator to include verified facts in prompt**

In `src/services/CleoScriptGenerator.ts`, add `enrichedFacts` to `SegmentContext`:

```typescript
import type { EnrichedFacts } from './TrackEnrichmentService';

export interface SegmentContext {
  // ... existing fields ...
  enrichedFacts?: EnrichedFacts;
}
```

In `buildDynamicPrompt`, add the verified facts block after the track info:

```typescript
  if (context.enrichedFacts) {
    const facts = context.enrichedFacts;
    prompt += '\n\nVERIFIED TRACK FACTS (use only what is provided — never invent)';
    if (facts.sample) prompt += `\n- Sample: ${facts.sample}`;
    if (facts.context) prompt += `\n- Context: ${facts.context}`;
    if (facts.producer) prompt += `\n- Producer: ${facts.producer}`;
    if (facts.songwriter) prompt += `\n- Written by: ${facts.songwriter}`;
  }
```

Pass enrichedFacts through in SegmentController's context assembly:

```typescript
const context: SegmentContext = {
  segmentType,
  vibe: this.currentVibe,
  currentTrack,
  nextTrack,
  sessionDurationMinutes: this.getSessionDuration(),
  segmentHistory: this.history.slice(0, 3),
  listenerName: this.listenerName,
  enrichedFacts: currentTrack.enrichedFacts,
};
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/engines/SegmentController.ts src/services/CleoScriptGenerator.ts
git commit -m "feat: inject verified facts into Cleo prompt for track_story segments"
```

---

### Task 4: Pass enrichment data from AudioCoordinator + test

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`
- Modify: `src/engines/QueueManager.ts`

**Step 1: Add method to QueueManager to get enriched profile for a track**

In `QueueManager.ts`, add:

```typescript
getTrackProfile(trackId: string): TrackProfile | undefined {
  return this.trackProfiles.find((t) => t.id === trackId);
}
```

**Step 2: Update AudioCoordinator to pass enriched data**

In `AudioCoordinator.ts`, import QueueManager and pass enrichment data:

```typescript
import { queueManager } from './QueueManager';

// In handleTrackChange, before generating segment:
// Look up enriched profile for current track
const enrichedProfile = currentTrack.id
  ? queueManager.getTrackProfile(currentTrack.id)
  : undefined;

const trackInfo = {
  ...currentTrack,
  enrichedFacts: enrichedProfile?.enrichedFacts,
  hasRichData: enrichedProfile?.hasRichData ?? false,
};

const segment = await segmentController.generateNext(trackInfo, nextTrack);
```

Wait — AudioCoordinator's `TrackInfo` doesn't have `id`. We need to add it.

Update `TrackInfo` interface in AudioCoordinator:

```typescript
interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
}
```

And update HomeScreen to pass the track ID when calling handleTrackChange:

In `HomeScreen.tsx`, the onTrackChanged handler already has the track info from `getNowPlaying()` which includes `id`. Update the call:

```typescript
audioCoordinator.handleTrackChange({
  id: np.id,
  title: np.title,
  artistName: np.artistName,
  albumTitle: np.albumTitle,
});
```

**Step 3: Sync to Metro, test on device**

No native changes — JS only. Reload app, play a session, listen for track_story segments that reference real facts.

**Step 4: Commit**

```bash
git add src/engines/AudioCoordinator.ts src/engines/QueueManager.ts src/screens/home/HomeScreen.tsx
git commit -m "feat: Phase 7 complete — Cleo tells verified stories about songs"
```

---

## Milestone Verification

Phase 7 is complete when:

- [ ] Genius data is fetched alongside MusicBrainz during enrichment
- [ ] track_story segments fire when enriched data is available
- [ ] artist_context fires as fallback when no data
- [ ] Verified facts appear in Cleo's prompt (check console logs)
- [ ] Cleo references real production details in her commentary
- [ ] Rotation includes track_story and artist_context types
- [ ] No crashes when enrichment fails (graceful degradation)

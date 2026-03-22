# ONAY Playlist Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable ONAY to curate and create Apple Music playlists via a conversational chat interface and periodic home screen suggestions.

**Architecture:** Client-driven curation — LLM calls go through the server, catalog search and playlist creation happen on-device via native MusicKit APIs. Tracks are sequenced through the existing QueuePlanner + RulesEngine pipeline before saving.

**Tech Stack:** Swift/MusicKit (catalog search, playlist creation), TypeScript/React Native (curation engine, chat UI), Express (curation endpoint), Ollama `qwen2.5:14b` / Gemini fallback (LLM)

**Spec:** `docs/superpowers/specs/2026-03-22-onay-playlist-generation-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `server/src/routes/curation.ts` | POST `/curate-playlist` endpoint — LLM prompt construction, input validation, response parsing |
| `src/engines/PlaylistCurator.ts` | Client-side orchestrator — LLM call → catalog search → gap-fill → QueuePlanner → RulesEngine |
| `src/screens/curate/AskOnayScreen.tsx` | Chat UI — message list, input bar, playlist preview card, save/broadcast actions |
| `app/(main)/(broadcast)/ask-onay.tsx` | Expo Router route for the Ask ONAY screen |

### Modified Files

| File | Changes |
|------|---------|
| `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` | Add `searchCatalog()` and `createPlaylist()` native functions |
| `modules/expo-music-kit/index.ts` | Export `searchCatalog()` and `createPlaylist()` TypeScript wrappers + types |
| `server/src/index.ts` | Register curation route |
| `server/src/middleware/validate.ts` | Add `curatePlaylistSchema` |
| `src/screens/home/HomeScreenRedesign.tsx` | Add "ASK ONAY" card + "ONAY SUGGESTS" section |
| `src/services/Storage.ts` | Add `ONAY_SUGGESTION` storage key |
| `src/engines/QueueManager.ts` | Add `skipAIUpgrade` flag to `initializeSession()` |

---

## Task 0: QueuePlanner Verification

**Files:**
- Modify: `src/engines/QueuePlanner.ts`
- Modify: `src/engines/RulesEngine.ts`
- Modify: `src/engines/QueueManager.ts`

This is a diagnostic/audit task. Add temporary logging to verify the queue pipeline works correctly before building playlist generation on top of it.

- [ ] **Step 1: Add diagnostic logging to QueuePlanner**

In `src/engines/QueuePlanner.ts`, add logging after `planQueue()` returns a plan. Log the arc shape, track count, and first/last 3 tracks with their roles:

```typescript
// Add at the end of planQueue(), before the return statement
console.log('[QueuePlanner] Plan complete:', {
  arcShape: plan.arcShape,
  trackCount: plan.queue.length,
  opener: plan.queue.slice(0, 3).map(t => `${t.role}: ${tracks.find(tr => tr.id === t.trackId)?.title}`),
  closer: plan.queue.slice(-3).map(t => `${t.role}: ${tracks.find(tr => tr.id === t.trackId)?.title}`),
});
```

- [ ] **Step 2: Add diagnostic logging to RulesEngine**

In `src/engines/RulesEngine.ts`, add logging after `enforceRules()` to report any violations found and fixed:

```typescript
// Add at the end of enforceRules(), before the return statement
console.log('[RulesEngine] Enforcement complete:', {
  artistSwaps: artistSwapCount,
  albumSwaps: albumSwapCount,
  genreBridges: bridgeCount,
});
```

- [ ] **Step 3: Add before/after logging in QueueManager.upgradeQueueInBackground**

In `src/engines/QueueManager.ts`, log the queue order before and after the AI upgrade:

```typescript
// Before AI plan
console.log('[QueueManager] Pre-upgrade queue (first 5):',
  this.trackProfiles.slice(0, 5).map(t => `${t.artistName} - ${t.title}`)
);

// After merge
console.log('[QueueManager] Post-upgrade queue (first 5):',
  mergedOrder.slice(0, 5).map(id => {
    const t = this.trackProfiles.find(tp => tp.id === id);
    return `${t?.artistName} - ${t?.title}`;
  })
);
```

- [ ] **Step 4: Test with a live session**

Run the app on a physical device. Start a broadcast with a playlist of ~20+ tracks. Check the console logs for:
- Arc shape is correct for playlist size
- Opener/closer roles make sense
- RulesEngine reports any swaps
- Post-upgrade queue differs from pre-upgrade (AI actually reordered)
- No duplicate or missing track IDs

Run: Build and test on device, check Xcode console output.

- [ ] **Step 5: Fix any issues found**

If the audit reveals problems (e.g., artist repeats not being caught, arc roles incorrect), fix them before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/engines/QueuePlanner.ts src/engines/RulesEngine.ts src/engines/QueueManager.ts
git commit -m "chore: add queue pipeline diagnostic logging for verification"
```

---

## Task 1: Native MusicKit — Catalog Search

**Files:**
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`
- Modify: `modules/expo-music-kit/index.ts`

Add `searchCatalog()` to the native module. Uses `MusicCatalogSearchRequest` to search the Apple Music catalog for songs.

**MusicKit API reference:**
```swift
// Search request
let request = MusicCatalogSearchRequest(term: "query", types: [Song.self])
let response = try await request.response()
// response.songs is MusicItemCollection<Song>

// Song properties: id, title, artistName, albumTitle, duration, genreNames, artwork
```

- [ ] **Step 1: Add searchCatalog AsyncFunction to Swift module**

In `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`, add the following inside the `definition()` method, after the existing `getUpcomingQueue` function:

```swift
AsyncFunction("searchCatalog") { (query: String, types: [String], limit: Int) -> [[String: Any]] in
    var searchRequest = MusicCatalogSearchRequest(term: query, types: [Song.self])
    searchRequest.limit = limit

    let response = try await searchRequest.response()

    var results: [[String: Any]] = []
    for song in response.songs {
        var dict: [String: Any] = [
            "id": song.id.rawValue,
            "title": song.title,
            "artistName": song.artistName,
            "albumTitle": song.albumTitle ?? "",
            "duration": song.duration ?? 0,
            "genreNames": song.genreNames,
        ]

        if let artwork = song.artwork {
            let url = artwork.url(width: 300, height: 300)
            dict["artworkUrl"] = url?.absoluteString ?? ""
        } else {
            dict["artworkUrl"] = ""
        }

        results.append(dict)
    }

    return results
}
```

- [ ] **Step 2: Add TypeScript wrapper and types in index.ts**

In `modules/expo-music-kit/index.ts`, add the `CatalogSearchResult` type after the existing `UpcomingTrack` type (around line 125), and add the `searchCatalog` function after the existing `getUpcomingQueue` function (around line 129):

```typescript
export interface CatalogSearchResult {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  genreNames: string[];
  artworkUrl: string;
}

export async function searchCatalog(
  query: string,
  types: string[] = ['songs'],
  limit: number = 5
): Promise<CatalogSearchResult[]> {
  return await ExpoMusicKitModule.searchCatalog(query, types, limit);
}
```

- [ ] **Step 3: Test catalog search on device**

Add a temporary test call in any screen to verify it works:

```typescript
import { searchCatalog } from '@/modules/expo-music-kit';
const results = await searchCatalog('Norah Jones Don\'t Know Why', ['songs'], 3);
console.log('Search results:', results);
```

Verify: returns results with valid `id`, `title`, `artistName`, `duration` > 0. Remove the test call after verifying.

- [ ] **Step 4: Commit**

```bash
git add modules/expo-music-kit/ios/ExpoMusicKitModule.swift modules/expo-music-kit/index.ts
git commit -m "feat: add searchCatalog to expo-music-kit native module"
```

---

## Task 2: Native MusicKit — Create Playlist

**Files:**
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`
- Modify: `modules/expo-music-kit/index.ts`

Add `createPlaylist()` to the native module. Must resolve string IDs to `Song` objects via `MusicCatalogResourceRequest<Song>` before passing to `MusicLibrary.shared.createPlaylist()`.

**MusicKit API reference:**
```swift
// Resolve IDs to Song objects
var request = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: musicItemIDs)
let response = try await request.response()
// response.items is MusicItemCollection<Song>

// Create playlist
let playlist = try await MusicLibrary.shared.createPlaylist(
    name: "My Playlist",
    description: "Description",
    items: songs
)
// playlist.id is MusicItemID
```

- [ ] **Step 1: Add createPlaylist AsyncFunction to Swift module**

In `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`, add after the `searchCatalog` function:

```swift
AsyncFunction("createPlaylist") { (name: String, description: String, trackIds: [String]) -> String in
    // Resolve string IDs to MusicItemIDs
    let musicItemIDs = trackIds.map { MusicItemID($0) }

    // Fetch Song objects from catalog by ID
    let resourceRequest = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: musicItemIDs)
    let resourceResponse = try await resourceRequest.response()

    // Preserve the original track order
    let songMap = Dictionary(uniqueKeysWithValues: resourceResponse.items.map { ($0.id.rawValue, $0) })
    let orderedSongs = trackIds.compactMap { songMap[$0] }

    guard !orderedSongs.isEmpty else {
        throw NSError(domain: "ExpoMusicKit", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "No valid songs found for the provided track IDs"
        ])
    }

    // Create the playlist
    let playlist = try await MusicLibrary.shared.createPlaylist(
        name: name,
        description: description,
        items: orderedSongs
    )

    return playlist.id.rawValue
}
```

- [ ] **Step 2: Add TypeScript wrapper in index.ts**

In `modules/expo-music-kit/index.ts`, add after the `searchCatalog` function:

```typescript
export async function createPlaylist(
  name: string,
  description: string,
  trackIds: string[]
): Promise<string> {
  return await ExpoMusicKitModule.createPlaylist(name, description, trackIds);
}
```

- [ ] **Step 3: Test playlist creation on device**

Add a temporary test: search for 3 songs, then create a playlist with their IDs. Verify the playlist appears in the user's Apple Music library. Remove the test call after verifying.

- [ ] **Step 4: Commit**

```bash
git add modules/expo-music-kit/ios/ExpoMusicKitModule.swift modules/expo-music-kit/index.ts
git commit -m "feat: add createPlaylist to expo-music-kit native module"
```

---

## Task 3: Server — Curation Endpoint

**Files:**
- Create: `server/src/routes/curation.ts`
- Modify: `server/src/middleware/validate.ts`
- Modify: `server/src/index.ts`

New `POST /curate-playlist` route. Follows the same pattern as `server/src/routes/segment.ts`.

- [ ] **Step 1: Add validation schema**

In `server/src/middleware/validate.ts`, add after the existing schemas:

```typescript
export const curatePlaylistSchema = z.object({
  prompt: z.string().min(1).max(500),
  trackCount: z.number().int().min(10).max(50).optional().default(20),
  round: z.enum(['initial', 'gap-fill', 'refinement']),
  existingTracks: z.array(z.object({
    title: z.string(),
    artist: z.string(),
  })).optional(),
  unmatchedTracks: z.array(z.object({
    title: z.string(),
    artist: z.string(),
  })).optional(),
  userFeedback: z.string().max(500).optional(),
});
```

- [ ] **Step 2: Create the curation route**

Create `server/src/routes/curation.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { llmProvider } from '../providers/llm/index.js';
import { validate, curatePlaylistSchema } from '../middleware/validate.js';

export const curationRouter = Router();

const VIBES = [
  'morning', 'chill', 'workout', 'lateNight', 'party', 'general',
  'focus', 'feelGood', 'throwback', 'elevated', 'melancholy', 'sunday',
] as const;

function buildSystemPrompt(round: string): string {
  const base = `You are ONAY, an AI radio host with impeccable music taste. You curate playlists that feel like a DJ set — not a random shuffle.

IMPORTANT: Respond with ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.

Response format:
{
  "tracks": [{ "title": "Song Name", "artist": "Artist Name" }],
  "suggestedVibe": "one of: ${VIBES.join(', ')}",
  "playlistTitle": "A creative playlist title",
  "playlistDescription": "A 1-2 sentence pitch for this playlist",
  "conversationalResponse": "What you'd say to the listener about this playlist"
}`;

  if (round === 'initial') {
    return `${base}

Suggest real songs that actually exist. Prefer well-known tracks over deep cuts unless the listener asks for hidden gems. Diversify artists — no more than 2 tracks from the same artist. Match the mood, era, and energy of the request.`;
  }

  if (round === 'gap-fill') {
    return `${base}

The listener's playlist is being built but some of your earlier suggestions weren't found in the Apple Music catalog. Suggest replacements that complement the tracks already confirmed. Match the same mood, energy, and era.`;
  }

  // refinement
  return `${base}

The listener wants to modify their existing playlist. Make targeted swaps based on their feedback — don't regenerate the whole list. Keep tracks they didn't mention. Return the FULL updated track list.`;
}

function buildUserPrompt(body: {
  prompt: string;
  trackCount: number;
  round: string;
  existingTracks?: { title: string; artist: string }[];
  unmatchedTracks?: { title: string; artist: string }[];
  userFeedback?: string;
}): string {
  if (body.round === 'initial') {
    return `Create a ${body.trackCount}-track playlist for: "${body.prompt}"`;
  }

  if (body.round === 'gap-fill') {
    const confirmed = (body.existingTracks || [])
      .map(t => `  - "${t.title}" by ${t.artist}`)
      .join('\n');
    const missed = (body.unmatchedTracks || [])
      .map(t => `  - "${t.title}" by ${t.artist}`)
      .join('\n');
    return `These tracks were confirmed:\n${confirmed}\n\nThese were NOT found on Apple Music — suggest ${body.unmatchedTracks?.length || 0} replacements:\n${missed}`;
  }

  // refinement
  const current = (body.existingTracks || [])
    .map((t, i) => `  ${i + 1}. "${t.title}" by ${t.artist}`)
    .join('\n');
  return `Current playlist:\n${current}\n\nListener feedback: "${body.userFeedback}"`;
}

curationRouter.post('/curate-playlist', validate(curatePlaylistSchema), async (req: Request, res: Response) => {
  try {
    const { prompt, trackCount, round, existingTracks, unmatchedTracks, userFeedback } = req.body;

    // Sanitize inputs — strip control characters
    const sanitizedPrompt = prompt.replace(/[\x00-\x1F\x7F]/g, '');
    const sanitizedFeedback = userFeedback?.replace(/[\x00-\x1F\x7F]/g, '');

    const systemPrompt = buildSystemPrompt(round);
    const userPrompt = buildUserPrompt({
      prompt: sanitizedPrompt,
      trackCount,
      round,
      existingTracks,
      unmatchedTracks,
      userFeedback: sanitizedFeedback,
    });

    const result = await llmProvider.generate({
      systemPrompt,
      userPrompt,
      maxTokens: 4096,
      temperature: 0.9,
    });

    // Parse JSON from LLM response
    let parsed;
    try {
      // Try direct parse first
      parsed = JSON.parse(result.text);
    } catch {
      // Try extracting JSON from markdown code fences
      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try finding JSON object in the text
        const braceMatch = result.text.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          parsed = JSON.parse(braceMatch[0]);
        } else {
          throw new Error('No valid JSON found in LLM response');
        }
      }
    }

    // Validate response shape
    if (!parsed.tracks || !Array.isArray(parsed.tracks)) {
      throw new Error('LLM response missing tracks array');
    }

    // Ensure suggestedVibe is valid
    if (!VIBES.includes(parsed.suggestedVibe)) {
      parsed.suggestedVibe = 'general';
    }

    res.json({
      tracks: parsed.tracks.slice(0, trackCount),
      suggestedVibe: parsed.suggestedVibe,
      playlistTitle: parsed.playlistTitle || 'ONAY\'s Picks',
      playlistDescription: parsed.playlistDescription || 'Curated by ONAY',
      conversationalResponse: parsed.conversationalResponse || 'Here\'s what I put together for you.',
    });
  } catch (error: any) {
    console.error('[Curation] Error:', error.message);
    res.status(500).json({ error: 'Failed to generate playlist suggestions' });
  }
});
```

- [ ] **Step 3: Register the route in server/src/index.ts**

In `server/src/index.ts`, add the import and registration alongside the existing routes:

```typescript
import { curationRouter } from './routes/curation.js';

// Add with the other route registrations (around line 84):
app.use(requireAuth, generationLimiter, curationRouter);
```

- [ ] **Step 4: Test the endpoint**

Start the local server (`cd server && npm run dev`). Test with curl:

```bash
curl -X POST http://localhost:3001/curate-playlist \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <test-token>" \
  -d '{"prompt": "rainy sunday afternoon", "trackCount": 10, "round": "initial"}'
```

Verify: returns JSON with `tracks` array, `suggestedVibe`, `playlistTitle`, `conversationalResponse`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/curation.ts server/src/middleware/validate.ts server/src/index.ts
git commit -m "feat: add /curate-playlist server endpoint"
```

---

## Task 4: Client — PlaylistCurator Engine

**Files:**
- Create: `src/engines/PlaylistCurator.ts`

Orchestrates the full curation flow: LLM → catalog search → gap-fill → QueuePlanner → RulesEngine.

**Key dependencies:**
- `authenticatedFetch` from `src/services/api.ts` — all server calls
- `searchCatalog` from `modules/expo-music-kit/index.ts` — catalog validation
- `planQueue` from `src/engines/QueuePlanner.ts` — arc shaping
- `enforceRules` from `src/engines/RulesEngine.ts` — hard rule enforcement
- `TrackProfile` from `src/services/TrackEnrichmentService.ts` — track data shape

- [ ] **Step 1: Create PlaylistCurator.ts**

Create `src/engines/PlaylistCurator.ts`:

```typescript
import { authenticatedFetch } from '../services/api';
import { searchCatalog, CatalogSearchResult } from '../../modules/expo-music-kit';
import { planQueue } from './QueuePlanner';
import { enforceRules } from './RulesEngine';
import { TrackProfile } from '../services/TrackEnrichmentService';
import type { Vibe } from '../cleo/fallbacks';

export interface CurationRequest {
  prompt: string;
  trackCount?: number;
}

export interface RefinementRequest {
  userFeedback: string;
  existingTracks: { title: string; artist: string }[];
}

interface LLMTrackSuggestion {
  title: string;
  artist: string;
}

interface CurationResponse {
  tracks: LLMTrackSuggestion[];
  suggestedVibe: Vibe;
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
}

export interface CuratedPlaylist {
  tracks: TrackProfile[];
  trackIds: string[];
  suggestedVibe: Vibe;
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
}

const SEARCH_BATCH_SIZE = 5;
const GAP_FILL_THRESHOLD = 0.2; // 20% unmatched triggers gap-fill
const SEARCH_TIMEOUT_MS = 15000;

async function callCurateEndpoint(body: Record<string, unknown>): Promise<CurationResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await authenticatedFetch('/curate-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Curation failed: ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function fuzzyMatch(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a));
}

function findBestMatch(
  suggestion: LLMTrackSuggestion,
  results: CatalogSearchResult[]
): CatalogSearchResult | null {
  for (const result of results) {
    if (
      fuzzyMatch(result.title, suggestion.title) &&
      fuzzyMatch(result.artistName, suggestion.artist)
    ) {
      return result;
    }
  }
  // Fallback: just match title if artist is close
  for (const result of results) {
    if (fuzzyMatch(result.title, suggestion.title)) {
      return result;
    }
  }
  return null;
}

async function searchBatch(
  suggestions: LLMTrackSuggestion[]
): Promise<{ matched: Map<number, CatalogSearchResult>; unmatched: number[] }> {
  const matched = new Map<number, CatalogSearchResult>();
  const unmatched: number[] = [];

  // Process in batches
  for (let i = 0; i < suggestions.length; i += SEARCH_BATCH_SIZE) {
    const batch = suggestions.slice(i, i + SEARCH_BATCH_SIZE);
    const promises = batch.map(async (suggestion, batchIdx) => {
      const globalIdx = i + batchIdx;
      try {
        const query = `${suggestion.title} ${suggestion.artist}`;
        const results = await searchCatalog(query, ['songs'], 5);
        const match = findBestMatch(suggestion, results);
        if (match) {
          matched.set(globalIdx, match);
        } else {
          unmatched.push(globalIdx);
        }
      } catch {
        unmatched.push(globalIdx);
      }
    });
    await Promise.all(promises);
  }

  return { matched, unmatched };
}

function catalogResultToTrackProfile(result: CatalogSearchResult): TrackProfile {
  return {
    id: result.id,
    title: result.title,
    artistName: result.artistName,
    albumTitle: result.albumTitle,
    duration: result.duration,
    genreNames: result.genreNames,
    artworkUrl: result.artworkUrl,
    trackNumber: 0,
    discNumber: 0,
    mbEnriched: false,
    hasRichData: false,
    tags: result.genreNames,
  };
}

export async function curatePlaylist(
  request: CurationRequest
): Promise<CuratedPlaylist> {
  // Step 1: Get LLM suggestions
  const llmResponse = await callCurateEndpoint({
    prompt: request.prompt,
    trackCount: request.trackCount ?? 20,
    round: 'initial',
  });

  // Step 2: Search catalog for each suggestion
  const { matched, unmatched } = await searchBatch(llmResponse.tracks);

  // Step 3: Gap-fill if too many unmatched
  let finalMatched = matched;
  if (unmatched.length / llmResponse.tracks.length > GAP_FILL_THRESHOLD) {
    const unmatchedSuggestions = unmatched.map(i => llmResponse.tracks[i]);
    const matchedSuggestions = Array.from(matched.entries()).map(([i]) => llmResponse.tracks[i]);

    const gapFillResponse = await callCurateEndpoint({
      prompt: request.prompt,
      trackCount: unmatched.length,
      round: 'gap-fill',
      existingTracks: matchedSuggestions,
      unmatchedTracks: unmatchedSuggestions,
    });

    const { matched: gapMatched } = await searchBatch(gapFillResponse.tracks);

    // Merge gap-fill matches
    let nextIdx = llmResponse.tracks.length;
    for (const [, result] of gapMatched) {
      finalMatched.set(nextIdx++, result);
    }
  }

  // Step 4: Build TrackProfiles
  const trackProfiles = Array.from(finalMatched.values()).map(catalogResultToTrackProfile);

  if (trackProfiles.length < 5) {
    throw new Error('Too few tracks matched. Try a different prompt.');
  }

  // Step 5: Sequence via QueuePlanner
  const plan = await planQueue(trackProfiles, llmResponse.suggestedVibe);

  // Step 6: Enforce rules
  const enforcedPlan = enforceRules(plan, trackProfiles);

  // Step 7: Build ordered result
  const orderedTracks = enforcedPlan.queue.map(entry => {
    const profile = trackProfiles.find(t => t.id === entry.trackId);
    return profile!;
  }).filter(Boolean);

  return {
    tracks: orderedTracks,
    trackIds: orderedTracks.map(t => t.id),
    suggestedVibe: llmResponse.suggestedVibe,
    playlistTitle: llmResponse.playlistTitle,
    playlistDescription: llmResponse.playlistDescription,
    conversationalResponse: llmResponse.conversationalResponse,
  };
}

export async function refinePlaylist(
  request: RefinementRequest,
  originalPrompt: string,
  currentVibe: Vibe
): Promise<CuratedPlaylist> {
  // Step 1: Get LLM refinement suggestions
  const llmResponse = await callCurateEndpoint({
    prompt: originalPrompt,
    trackCount: request.existingTracks.length,
    round: 'refinement',
    existingTracks: request.existingTracks,
    userFeedback: request.userFeedback,
  });

  // Step 2: Search catalog for any new tracks
  const { matched } = await searchBatch(llmResponse.tracks);

  // Step 3: Build TrackProfiles
  const trackProfiles = Array.from(matched.values()).map(catalogResultToTrackProfile);

  if (trackProfiles.length < 5) {
    throw new Error('Too few tracks matched after refinement.');
  }

  // Step 4: Re-sequence
  const plan = await planQueue(trackProfiles, currentVibe);
  const enforcedPlan = enforceRules(plan, trackProfiles);

  const orderedTracks = enforcedPlan.queue
    .map(entry => trackProfiles.find(t => t.id === entry.trackId))
    .filter((t): t is TrackProfile => t !== undefined);

  return {
    tracks: orderedTracks,
    trackIds: orderedTracks.map(t => t.id),
    suggestedVibe: llmResponse.suggestedVibe || currentVibe,
    playlistTitle: llmResponse.playlistTitle,
    playlistDescription: llmResponse.playlistDescription,
    conversationalResponse: llmResponse.conversationalResponse,
  };
}
```

- [ ] **Step 2: Verify imports compile**

Run: `npx tsc --noEmit src/engines/PlaylistCurator.ts` (or check the IDE for type errors). Fix any import path issues.

- [ ] **Step 3: Commit**

```bash
git add src/engines/PlaylistCurator.ts
git commit -m "feat: add PlaylistCurator engine for LLM-powered curation"
```

---

## Task 5: QueueManager — Skip AI Upgrade Flag

**Files:**
- Modify: `src/engines/QueueManager.ts`

When a curated playlist is broadcast, the tracks are already sequenced. QueueManager must skip the AI upgrade step.

- [ ] **Step 1: Add skipAIUpgrade parameter to initializeSession**

In `src/engines/QueueManager.ts`, modify the `initializeSession` signature and skip the background upgrade when the flag is set:

```typescript
// Change the method signature (around line 40):
async initializeSession(
  playlistId: string,
  vibe: Vibe,
  stationId: string,
  options?: { skipAIUpgrade?: boolean }
): Promise<void> {
```

Then in the background enrichment chain (around line 96-108), wrap the AI upgrade in a condition:

```typescript
// Replace the existing upgrade call with:
if (!options?.skipAIUpgrade) {
  await new Promise(resolve => setTimeout(resolve, 10000));
  await this.upgradeQueueInBackground(vibe);
}
```

- [ ] **Step 2: Verify existing callers still work**

Check all callers of `initializeSession` — they pass 3 args, so the optional 4th parameter won't break them. Grep to confirm:

```bash
grep -rn 'initializeSession(' src/ --include='*.ts' --include='*.tsx'
```

- [ ] **Step 3: Commit**

```bash
git add src/engines/QueueManager.ts
git commit -m "feat: add skipAIUpgrade option to QueueManager.initializeSession"
```

---

## Task 6: Storage — ONAY Suggestion Key

**Files:**
- Modify: `src/services/Storage.ts`

Add the storage key and helpers for ONAY's periodic suggestions.

- [ ] **Step 1: Add storage key and helpers**

In `src/services/Storage.ts`, add to `StorageKeys`:

```typescript
ONAY_SUGGESTION: 'onay_suggestion',
```

Add helper functions after the existing helpers:

```typescript
export interface OnaySuggestion {
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
  tracks: { title: string; artist: string }[];
  suggestedVibe: string;
  generatedAt: number;
  uid: string;
}

export function getOnaySuggestion(uid: string): OnaySuggestion | undefined {
  const suggestion = getObject<OnaySuggestion>(`${StorageKeys.ONAY_SUGGESTION}:${uid}`);
  if (!suggestion) return undefined;
  // 6-hour TTL
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (Date.now() - suggestion.generatedAt > SIX_HOURS) return undefined;
  return suggestion;
}

export function setOnaySuggestion(uid: string, suggestion: OnaySuggestion): void {
  setObject(`${StorageKeys.ONAY_SUGGESTION}:${uid}`, suggestion);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/Storage.ts
git commit -m "feat: add ONAY suggestion storage key and helpers"
```

---

## Task 7: Ask ONAY — Chat Screen

**Files:**
- Create: `src/screens/curate/AskOnayScreen.tsx`
- Create: `app/(main)/(broadcast)/ask-onay.tsx`

The conversational playlist creation interface.

- [ ] **Step 1: Create the Expo Router route**

Create `app/(main)/(broadcast)/ask-onay.tsx`:

```typescript
import { AskOnayScreen } from '../../../src/screens/curate/AskOnayScreen';

export default function AskOnay() {
  return <AskOnayScreen />;
}
```

- [ ] **Step 2: Create the AskOnayScreen component**

Create `src/screens/curate/AskOnayScreen.tsx`. This is the main chat interface. Key elements:
- Message list (FlatList, inverted)
- Input bar with send button
- Playlist preview card inline in chat
- Save / Take it Live action buttons
- Loading states during generation
- Error handling with retry

```typescript
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Typography, Spacing, Radius, Surface, TextColors } from '../../tokens/design-tokens';
import { curatePlaylist, refinePlaylist, CuratedPlaylist } from '../../engines/PlaylistCurator';
import { createPlaylist, authorize } from '../../../modules/expo-music-kit';
import { queueManager } from '../../engines/QueueManager';
import { addStation } from '../../services/Storage';
import { TrackProfile } from '../../services/TrackEnrichmentService';
import { sessionEngine } from '../../engines/SessionEngine';

type MessageRole = 'user' | 'onay' | 'playlist' | 'loading' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text?: string;
  playlist?: CuratedPlaylist;
}

export function AskOnayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ suggestion?: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'onay',
      text: '\u201CWhat kind of playlist are you in the mood for?\u201D',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentPlaylist, setCurrentPlaylist] = useState<CuratedPlaylist | null>(null);
  const [originalPrompt, setOriginalPrompt] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const messageIdCounter = useRef(1);

  // Handle pre-filled suggestion from home screen "ONAY SUGGESTS" card
  const pendingSuggestionRef = useRef<string | null>(null);

  useEffect(() => {
    if (params.suggestion) {
      try {
        const suggestion = JSON.parse(params.suggestion);
        // Store the prompt in a ref and trigger send directly
        pendingSuggestionRef.current = suggestion.playlistTitle;
      } catch {}
    }
  }, []);

  // Auto-send when pending suggestion is set (runs after mount)
  useEffect(() => {
    if (pendingSuggestionRef.current && !isGenerating) {
      const prompt = pendingSuggestionRef.current;
      pendingSuggestionRef.current = null;
      setInputText(prompt);
      // Directly invoke curation with the prompt text, bypassing inputText state
      (async () => {
        addMessage({ role: 'user', text: prompt });
        setIsGenerating(true);
        const loadingId = addMessage({ role: 'loading' });
        try {
          setOriginalPrompt(prompt);
          const result = await curatePlaylist({ prompt });
          removeMessage(loadingId);
          setCurrentPlaylist(result);
          addMessage({ role: 'onay', text: `\u201C${result.conversationalResponse}\u201D` });
          addMessage({ role: 'playlist', playlist: result });
        } catch (error: any) {
          removeMessage(loadingId);
          addMessage({ role: 'error', text: error.message || 'Something went wrong.' });
        } finally {
          setIsGenerating(false);
        }
      })();
    }
  }, []);

  const nextId = () => String(messageIdCounter.current++);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    const newMsg = { ...msg, id: nextId() };
    setMessages(prev => [...prev, newMsg]);
    return newMsg.id;
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;

    // Block during active broadcast
    const activeSession = sessionEngine.getSession();
    if (activeSession) {
      addMessage({
        role: 'error',
        text: 'Playlist curation is unavailable during an active broadcast. End your session first.',
      });
      return;
    }

    // Check Apple Music subscription
    const authResult = await authorize();
    if (!authResult.canPlayCatalog) {
      addMessage({
        role: 'error',
        text: 'An Apple Music subscription is required to create playlists. Please subscribe in the Music app.',
      });
      return;
    }

    setInputText('');
    addMessage({ role: 'user', text });

    setIsGenerating(true);
    const loadingId = addMessage({ role: 'loading' });

    try {
      let result: CuratedPlaylist;

      if (currentPlaylist) {
        // Refinement round
        result = await refinePlaylist(
          {
            userFeedback: text,
            existingTracks: currentPlaylist.tracks.map(t => ({
              title: t.title,
              artist: t.artistName,
            })),
          },
          originalPrompt,
          currentPlaylist.suggestedVibe
        );
      } else {
        // Initial round
        setOriginalPrompt(text);
        result = await curatePlaylist({ prompt: text });
      }

      removeMessage(loadingId);
      setCurrentPlaylist(result);

      addMessage({ role: 'onay', text: `\u201C${result.conversationalResponse}\u201D` });
      addMessage({ role: 'playlist', playlist: result });
    } catch (error: any) {
      removeMessage(loadingId);
      addMessage({
        role: 'error',
        text: error.message || 'Something went wrong. Try again.',
      });
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, currentPlaylist, originalPrompt, addMessage, removeMessage]);

  const handleSave = useCallback(async (playlist: CuratedPlaylist) => {
    try {
      const description = `${playlist.playlistDescription} \u2014 Curated by ONAY`;
      await createPlaylist(playlist.playlistTitle, description, playlist.trackIds);
      Alert.alert('Saved', `"${playlist.playlistTitle}" added to your Apple Music library.`);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to save playlist. Please try again.');
    }
  }, []);

  const handleTakeLive = useCallback(async (playlist: CuratedPlaylist) => {
    try {
      // Save first
      const description = `${playlist.playlistDescription} \u2014 Curated by ONAY`;
      const playlistId = await createPlaylist(playlist.playlistTitle, description, playlist.trackIds);

      // Create station
      const stationId = `curated-${Date.now()}`;
      const station = {
        id: stationId,
        name: playlist.playlistTitle,
        playlistId,
        defaultVibe: playlist.suggestedVibe,
        artworkUrl: playlist.tracks[0]?.artworkUrl,
        createdAt: new Date().toISOString(),
      };
      addStation(station);

      // Start broadcast with pre-sequenced queue (skip AI upgrade)
      await queueManager.initializeSession(playlistId, playlist.suggestedVibe, stationId, {
        skipAIUpgrade: true,
      });

      router.push({
        pathname: '/(main)/(broadcast)/player',
        params: {
          stationId,
          stationName: playlist.playlistTitle,
          vibe: playlist.suggestedVibe,
          playlistId,
        },
      });
    } catch (error: any) {
      Alert.alert('Error', 'Failed to start broadcast. Please try again.');
    }
  }, [router]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === 'loading') {
      return (
        <View style={styles.loadingBubble}>
          <ActivityIndicator size="small" color={Colors.accent} />
          <Text style={styles.loadingText}>ONAY is curating...</Text>
        </View>
      );
    }

    if (item.role === 'error') {
      return (
        <View style={styles.errorBubble}>
          <Text style={styles.errorText}>{item.text}</Text>
          {originalPrompt && (
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                setInputText(originalPrompt);
                handleSend();
              }}
              accessibilityLabel="Retry"
              accessibilityRole="button"
            >
              <Text style={styles.retryButtonText}>RETRY</Text>
            </Pressable>
          )}
        </View>
      );
    }

    if (item.role === 'user') {
      return (
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{item.text}</Text>
        </View>
      );
    }

    if (item.role === 'onay') {
      return (
        <View style={styles.onayBubble}>
          <View style={styles.onayGoldEdge} />
          <Text style={styles.onayText}>{item.text}</Text>
        </View>
      );
    }

    if (item.role === 'playlist' && item.playlist) {
      return (
        <View style={styles.playlistCard}>
          <View style={styles.playlistGoldEdge} />
          <View style={styles.playlistInner}>
            <Text style={styles.playlistTitle}>{item.playlist.playlistTitle}</Text>
            <Text style={styles.playlistCount}>
              {item.playlist.tracks.length} TRACKS
            </Text>
            {item.playlist.tracks.map((track, idx) => (
              <View key={track.id} style={styles.trackRow}>
                <Text style={styles.trackNumber}>{idx + 1}</Text>
                {track.artworkUrl ? (
                  <Image source={{ uri: track.artworkUrl }} style={styles.trackArt} />
                ) : (
                  <View style={[styles.trackArt, styles.trackArtPlaceholder]} />
                )}
                <View style={styles.trackInfo}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>{track.artistName}</Text>
                </View>
              </View>
            ))}
            <View style={styles.actionRow}>
              <Pressable
                style={styles.actionButton}
                onPress={() => handleSave(item.playlist!)}
                accessibilityLabel="Save to Apple Music"
                accessibilityRole="button"
              >
                <Text style={styles.actionButtonText}>SAVE TO APPLE MUSIC</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.actionButtonPrimary]}
                onPress={() => handleTakeLive(item.playlist!)}
                accessibilityLabel="Take it live"
                accessibilityRole="button"
              >
                <Text style={[styles.actionButtonText, styles.actionButtonPrimaryText]}>
                  TAKE IT LIVE
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    return null;
  }, [handleSave, handleTakeLive]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.backText}>{'\u2190'}</Text>
        </Pressable>
        <Text style={styles.headerLabel}>ONAY</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="What do you want to hear?"
          placeholderTextColor={TextColors.outline}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!isGenerating}
        />
        <Pressable
          style={[styles.sendButton, isGenerating && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={isGenerating}
          accessibilityLabel="Send message"
          accessibilityRole="button"
        >
          <Text style={styles.sendButtonText}>{'\u2191'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  backButton: {
    padding: Spacing.xs,
    marginRight: Spacing.sm,
  },
  backText: {
    color: TextColors.primary,
    fontSize: 24,
  },
  headerLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxWidth: '80%',
  },
  userText: {
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.primary,
  },
  onayBubble: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    maxWidth: '85%',
  },
  onayGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginRight: Spacing.sm,
  },
  onayText: {
    fontFamily: Typography.cleoVoice.family,
    fontSize: 16,
    color: TextColors.primary,
    lineHeight: 24,
    flex: 1,
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.sm,
  },
  loadingText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  errorBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  errorText: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: Colors.error,
  },
  playlistCard: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: Spacing.xs,
  },
  playlistGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginRight: Spacing.sm,
  },
  playlistInner: {
    flex: 1,
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  playlistTitle: {
    fontFamily: Typography.display.family,
    fontSize: 18,
    color: TextColors.primary,
    marginBottom: Spacing.xs,
  },
  playlistCount: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    color: Colors.accent,
    marginBottom: Spacing.md,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: Spacing.sm,
  },
  trackNumber: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: TextColors.outline,
    width: 20,
    textAlign: 'right',
  },
  trackArt: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
  },
  trackArtPlaceholder: {
    backgroundColor: Surface.container,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    fontWeight: '500',
    color: TextColors.primary,
  },
  trackArtist: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.secondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  actionButton: {
    flex: 1,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  actionButtonPrimary: {
    backgroundColor: Colors.accent,
  },
  actionButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.accent,
  },
  actionButtonPrimaryText: {
    color: Surface.base,
  },
  retryButton: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    alignSelf: 'flex-start',
  },
  retryButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.error,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Surface.container,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.primary,
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 40,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: Surface.base,
    fontSize: 18,
    fontWeight: '600',
  },
});
```

- [ ] **Step 3: Verify the route is accessible**

Build and run the app. Navigate to the Ask ONAY screen by pushing the route programmatically (we'll add the home screen card in the next task). Verify the chat UI renders with ONAY's welcome message and the input bar works.

- [ ] **Step 4: Test full curation flow on device**

Type a prompt like "chill jazz for a rainy evening". Verify:
- ONAY responds with a conversational message
- Loading state shows while generating
- Playlist preview card appears with track list
- "Save to Apple Music" creates the playlist
- "Take it Live" navigates to BroadcastScreen

- [ ] **Step 5: Commit**

```bash
git add src/screens/curate/AskOnayScreen.tsx app/\(main\)/\(broadcast\)/ask-onay.tsx
git commit -m "feat: add Ask ONAY chat screen for playlist curation"
```

---

## Task 8: Home Screen — ASK ONAY Card + ONAY SUGGESTS

**Files:**
- Modify: `src/screens/home/HomeScreenRedesign.tsx`

Add two new sections to the home screen:
1. **"ASK ONAY"** card — navigates to the chat screen
2. **"ONAY SUGGESTS"** section — shows periodic playlist suggestion

- [ ] **Step 0: Update UserData interface for onboarding fields**

In `src/services/Storage.ts`, update the `UserData` interface to include the onboarding fields (they're already written by CleoOnboarding but not typed):

```typescript
export interface UserData {
  name?: string;
  appleMusicAuthorized: boolean;
  createdAt: string;
  defaultVibe?: Vibe;
  onboardingMood?: 'focused' | 'energetic' | 'mellow';
  onboardingGoal?: 'discovery' | 'relaxation' | 'work';
  onboardingGenres?: string[];
}
```

Also add cleanup for the suggestion key in `clearUserData()`. Pass `uid` as a parameter to avoid importing Firebase into the storage utility:

```typescript
// Change clearUserData signature:
export function clearUserData(uid?: string): void {
  // Add at the top of the function:
  if (uid) storage.delete(`${StorageKeys.ONAY_SUGGESTION}:${uid}`);
  // ... existing removes stay unchanged
}
```

Update the caller in the sign-out flow to pass the UID before auth state is cleared.

- [ ] **Step 1: Add imports and state for suggestion**

In `HomeScreenRedesign.tsx`, add imports:

```typescript
import { getOnaySuggestion, setOnaySuggestion, OnaySuggestion } from '../../services/Storage';
import { authenticatedFetch } from '../../services/api';
import { getAuth } from 'firebase/auth';
```

Add state (with the existing state declarations):

```typescript
const [onaySuggestion, setOnaySuggestionState] = useState<OnaySuggestion | null>(null);
```

- [ ] **Step 2: Add suggestion fetch logic**

Add a `useEffect` that fires on mount to check for / generate suggestions:

```typescript
useEffect(() => {
  async function fetchSuggestion() {
    try {
      const user = getAuth().currentUser;
      if (!user) return;

      // Check cache first
      const cached = getOnaySuggestion(user.uid);
      if (cached) {
        setOnaySuggestionState(cached);
        return;
      }

      // Fire non-blocking LLM call
      const hour = new Date().getHours();
      const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
      const userData = getUser();

      const response = await authenticatedFetch('/curate-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `It's ${dayOfWeek}, ${hour}:00. Mood: ${userData?.onboardingMood || 'general'}. Goal: ${userData?.onboardingGoal || 'discovery'}. Genres: ${userData?.onboardingGenres?.join(', ') || 'eclectic'}. Suggest a playlist for right now.`,
          trackCount: 20,
          round: 'initial',
        }),
      });

      if (!response.ok) return;
      const data = await response.json();

      const suggestion: OnaySuggestion = {
        playlistTitle: data.playlistTitle,
        playlistDescription: data.playlistDescription,
        conversationalResponse: data.conversationalResponse,
        tracks: data.tracks,
        suggestedVibe: data.suggestedVibe,
        generatedAt: Date.now(),
        uid: user.uid,
      };

      setOnaySuggestion(user.uid, suggestion);
      setOnaySuggestionState(suggestion);
    } catch {
      // Non-blocking — silently fail
    }
  }

  fetchSuggestion();
}, []);
```

- [ ] **Step 3: Add ASK ONAY card to the ScrollView**

In the main ScrollView, add after the greeting section (around line 373) and before the Now Playing card:

```tsx
{/* ASK ONAY */}
<Pressable
  style={styles.askOnayCard}
  onPress={() => router.push('/(main)/(broadcast)/ask-onay')}
  accessibilityLabel="Ask ONAY to curate a playlist"
  accessibilityRole="button"
>
  <View style={styles.askOnayGoldEdge} />
  <View style={styles.askOnayInner}>
    <Text style={styles.sectionLabelGold}>ASK ONAY</Text>
    <Text style={styles.askOnayDescription}>
      Tell me what you want to hear and I'll curate it for you.
    </Text>
  </View>
</Pressable>
```

- [ ] **Step 4: Add ONAY SUGGESTS section**

After the existing "CLEO SAYS" / suggestion card section, add:

```tsx
{onaySuggestion && (
  <View style={styles.suggestSection}>
    <Text style={styles.sectionLabelGold}>ONAY SUGGESTS</Text>
    <Pressable
      style={styles.suggestCard}
      onPress={() => {
        // Navigate to Ask ONAY with pre-filled suggestion
        router.push({
          pathname: '/(main)/(broadcast)/ask-onay',
          params: { suggestion: JSON.stringify(onaySuggestion) },
        });
      }}
      accessibilityLabel={`ONAY suggests: ${onaySuggestion.playlistTitle}`}
      accessibilityRole="button"
    >
      <View style={styles.suggestGoldEdge} />
      <View style={styles.suggestInner}>
        <Text style={styles.suggestTitle}>{onaySuggestion.playlistTitle}</Text>
        <Text style={styles.suggestPitch}>
          {`\u201C${onaySuggestion.playlistDescription}\u201D`}
        </Text>
        <Text style={styles.suggestTrackCount}>
          {onaySuggestion.tracks.length} TRACKS
        </Text>
      </View>
    </Pressable>
  </View>
)}
```

- [ ] **Step 5: Add styles**

Add to the StyleSheet:

```typescript
askOnayCard: {
  flexDirection: 'row',
  marginHorizontal: Spacing.md,
  marginBottom: Spacing.md,
  backgroundColor: Surface.container,
  borderRadius: Radius.sm,
},
askOnayGoldEdge: {
  width: 2,
  backgroundColor: Colors.accent,
  borderTopLeftRadius: Radius.sm,
  borderBottomLeftRadius: Radius.sm,
},
askOnayInner: {
  flex: 1,
  padding: Spacing.md,
},
askOnayDescription: {
  fontFamily: Typography.cleoVoice.family,
  fontSize: 15,
  color: TextColors.secondary,
  marginTop: Spacing.xs,
  fontStyle: 'italic',
},
suggestSection: {
  marginHorizontal: Spacing.md,
  marginBottom: Spacing.md,
},
suggestCard: {
  flexDirection: 'row',
  backgroundColor: Surface.container,
  borderRadius: Radius.sm,
  marginTop: Spacing.sm,
},
suggestGoldEdge: {
  width: 2,
  backgroundColor: Colors.accent,
  borderTopLeftRadius: Radius.sm,
  borderBottomLeftRadius: Radius.sm,
},
suggestInner: {
  flex: 1,
  padding: Spacing.md,
},
suggestTitle: {
  fontFamily: Typography.display.family,
  fontSize: 17,
  color: TextColors.primary,
},
suggestPitch: {
  fontFamily: Typography.cleoVoice.family,
  fontSize: 14,
  color: TextColors.secondary,
  marginTop: Spacing.xs,
  fontStyle: 'italic',
},
suggestTrackCount: {
  fontFamily: Typography.mono.family,
  fontSize: 10,
  letterSpacing: 2,
  color: Colors.accent,
  marginTop: Spacing.sm,
},
sectionLabelGold: {
  fontFamily: Typography.mono.family,
  fontSize: 10,
  letterSpacing: 2.5,
  color: Colors.accent,
  textTransform: 'uppercase',
},
```

- [ ] **Step 6: Test on device**

Verify:
- "ASK ONAY" card appears on the home screen and navigates to the chat
- "ONAY SUGGESTS" card appears after the LLM response arrives (may take a few seconds on first load)
- Tapping the suggestion navigates to Ask ONAY
- Suggestion caches and reappears on re-open within 6 hours

- [ ] **Step 7: Commit**

```bash
git add src/screens/home/HomeScreenRedesign.tsx
git commit -m "feat: add ASK ONAY card and ONAY SUGGESTS to home screen"
```

---

## Task 9: Integration Testing

Full end-to-end testing of the complete playlist generation flow.

- [ ] **Step 1: Test user-initiated flow**

On a physical device with an Apple Music subscription:
1. Open app → tap "ASK ONAY" card
2. Type "upbeat indie for a road trip"
3. Verify ONAY responds conversationally
4. Verify playlist preview card shows with ~20 tracks
5. Tap "Save to Apple Music" → verify playlist appears in Apple Music
6. Ask for refinement: "swap out any pop songs for more indie rock"
7. Verify updated playlist preview

- [ ] **Step 2: Test Take it Live flow**

1. Generate a new playlist
2. Tap "Take it Live"
3. Verify playlist is saved to Apple Music
4. Verify BroadcastScreen opens with ONAY hosting
5. Verify tracks play in the curated order (no AI re-plan)
6. Verify ONAY's commentary works normally

- [ ] **Step 3: Test periodic suggestions**

1. Clear the suggestion cache (remove MMKV key)
2. Open the app
3. Verify "ONAY SUGGESTS" card appears after LLM responds
4. Close and reopen the app within 6 hours → cached suggestion appears immediately
5. Tap the suggestion → navigates to Ask ONAY

- [ ] **Step 4: Test error cases**

1. Disable network → try to curate → verify error message in chat
2. Search for an impossible prompt ("playlist of songs that don't exist by fake artists") → verify graceful handling
3. Test without Apple Music subscription → verify subscription required message

- [ ] **Step 5: Remove diagnostic logging from Task 0**

Remove the temporary `console.log` statements added in Task 0 from QueuePlanner, RulesEngine, and QueueManager.

- [ ] **Step 6: Commit cleanup**

```bash
git add src/engines/QueuePlanner.ts src/engines/RulesEngine.ts src/engines/QueueManager.ts
git commit -m "chore: remove queue pipeline diagnostic logging"
```

---

## Task 10: Deploy Server Changes

**Files:**
- Server at `/home/cleo/cleo-api/` on Hostinger VPS (187.124.69.95)

- [ ] **Step 1: Update Ollama model**

On your PC (where Ollama runs), pull the new model:

```bash
ollama pull qwen2.5:14b
```

Update `OLLAMA_MODEL=qwen2.5:14b` in `server/.env` (both local and production).

- [ ] **Step 2: Deploy server to production**

SSH into the VPS and deploy the updated server with the new `/curate-playlist` route:

```bash
ssh cleo@187.124.69.95
cd /home/cleo/cleo-api
git pull
npm install
pm2 restart cleo-api
```

- [ ] **Step 3: Verify production endpoint**

Test the production endpoint:

```bash
curl -X POST https://api.worthymedia.tech/curate-playlist \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"prompt": "test", "trackCount": 5, "round": "initial"}'
```

- [ ] **Step 4: Build and submit to TestFlight**

Bump `buildNumber` in `app.json`, then:

```bash
npx expo prebuild --platform ios --clean
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild archive ...
xcodebuild -exportArchive ...
```

- [ ] **Step 5: Commit version bump**

```bash
git add app.json
git commit -m "chore: bump build number for playlist generation release"
```

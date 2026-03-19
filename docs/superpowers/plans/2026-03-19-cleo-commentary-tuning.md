# Cleo Commentary Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cleo sound like a real radio host — vibe-matched voice, real track stories from enrichment data, smart timing, and varied segment lengths.

**Architecture:** Five independent workstreams: (1) complete Genius enrichment backend + wire MusicBrainz data into prompts, (2) vibe-aware ElevenLabs voice profiles with per-segment delivery cues, (3) pause-aware + duration-based timing in AudioCoordinator, (4) segment length tiers + data-informed rotation in SegmentController, (5) Gemini config optimizations + few-shot examples in static-core.

**Tech Stack:** Gemini 2.5 Flash API, ElevenLabs `eleven_turbo_v2_5`, Genius API `/songs/{id}`, MusicBrainz API, MMKV, React Native/Expo, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-19-cleo-commentary-tuning-design.md`

---

## Task 1: Gemini Config Optimizations

Quick server-side wins — disable thinking, fix temperature, lower maxOutputTokens.

**Files:**
- Modify: `server/src/routes/segment.ts:25-32`

- [ ] **Step 1: Disable thinking and fix temperature**

In `server/src/routes/segment.ts`, update the `generationConfig` and add `thinkingConfig`:

```typescript
// Replace lines 28-32:
generationConfig: {
  temperature: 1.0,
  maxOutputTokens: maxTokens ?? 2048,
  topP: 0.95,
},
thinkingConfig: {
  thinkingBudget: 0,
},
```

- [ ] **Step 2: Verify server compiles**

Run: `cd /Users/kari/Documents/DJApp/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/segment.ts
git commit -m "perf: disable Gemini thinking, fix temp to 1.0, lower maxOutputTokens to 2048"
```

---

## Task 2: Complete Genius Metadata Extraction

The enrichment endpoint currently only returns a Genius URL. Add a second API call to `/songs/{id}` to extract producer, songwriter, sample, and context data.

**Files:**
- Modify: `server/src/routes/enrichment.ts`

- [ ] **Step 1: Add rate limiting and song detail fetcher**

Add a rate limiter and `fetchSongDetails` function above the existing route in `server/src/routes/enrichment.ts`:

```typescript
import { Router, Request, Response } from 'express';

export const enrichmentRouter = Router();

let lastGeniusRequestTime = 0;
const GENIUS_MIN_INTERVAL = 1100;

async function geniusRateLimitedFetch(url: string, token: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastGeniusRequestTime;
  if (elapsed < GENIUS_MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, GENIUS_MIN_INTERVAL - elapsed));
  }
  lastGeniusRequestTime = Date.now();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Genius ${response.status}`);
  return response.json();
}

interface GeniusEnrichedFacts {
  producer?: string;
  songwriter?: string;
  sample?: string;
  context?: string;
  recordingLocation?: string;
  releaseYear?: string;
  geniusUrl?: string;
}

async function fetchSongDetails(songId: number, token: string): Promise<GeniusEnrichedFacts> {
  const data = await geniusRateLimitedFetch(
    `https://api.genius.com/songs/${songId}`,
    token
  );
  const song = data.response?.song;
  if (!song) return {};

  const facts: GeniusEnrichedFacts = {};

  // Producer credits
  const producers = song.producer_artists;
  if (producers && producers.length > 0) {
    facts.producer = producers.map((p: any) => p.name).join(', ');
  }

  // Songwriter credits
  const writers = song.writer_artists;
  if (writers && writers.length > 0) {
    facts.songwriter = writers.map((w: any) => w.name).join(', ');
  }

  // Description / context
  const desc = song.description?.plain;
  if (desc && desc.length > 10 && desc !== '?') {
    facts.context = desc.substring(0, 150).replace(/\s+\S*$/, '...');
  }

  // Recording location
  if (song.recording_location) {
    facts.recordingLocation = song.recording_location;
  }

  // Release year
  if (song.release_date_for_display) {
    facts.releaseYear = song.release_date_for_display;
  }

  // Sample relationships
  const relationships = song.song_relationships ?? [];
  const samples = relationships.find((r: any) => r.relationship_type === 'samples');
  if (samples?.songs?.length > 0) {
    const sampled = samples.songs[0];
    facts.sample = `Samples "${sampled.title}" by ${sampled.primary_artist?.name ?? 'unknown'}`;
  }

  facts.geniusUrl = song.url;

  return facts;
}
```

- [ ] **Step 2: Update the route to fetch song details**

Replace the existing route handler body (lines 5-46) with:

```typescript
enrichmentRouter.post('/enrich-track', async (req: Request, res: Response) => {
  try {
    const { title, artist } = req.body;

    if (!title || !artist) {
      res.status(400).json({ error: 'title and artist are required' });
      return;
    }

    const token = process.env.GENIUS_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ error: 'GENIUS_ACCESS_TOKEN not configured' });
      return;
    }

    // Step 1: Search for the song
    const query = encodeURIComponent(`${title} ${artist}`);
    const searchData = await geniusRateLimitedFetch(
      `https://api.genius.com/search?q=${query}`,
      token
    );

    const hits = searchData.response?.hits ?? [];
    if (hits.length === 0) {
      res.json({ results: [], enrichedFacts: {} });
      return;
    }

    const topHit = hits[0].result;
    const results = hits.slice(0, 3).map((hit: any) => ({
      id: hit.result.id,
      title: hit.result.title,
      artist: hit.result.primary_artist?.name,
      url: hit.result.url,
      thumbnailUrl: hit.result.song_art_image_thumbnail_url,
    }));

    // Step 2: Fetch full song details for the top hit
    let enrichedFacts: GeniusEnrichedFacts = {};
    try {
      enrichedFacts = await fetchSongDetails(topHit.id, token);
    } catch (error) {
      console.warn('Genius song detail fetch failed:', error);
      // Return search results without enrichment — partial data is fine
      enrichedFacts = { geniusUrl: topHit.url };
    }

    res.json({ results, enrichedFacts });
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Failed to enrich track' });
  }
});
```

- [ ] **Step 3: Verify server compiles**

Run: `cd /Users/kari/Documents/DJApp/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/enrichment.ts
git commit -m "feat: complete Genius metadata extraction — producer, songwriter, samples, context"
```

---

## Task 3: Wire Enrichment Data into TrackProfile and Gemini Prompt

Update the `EnrichedFacts` interface, merge MusicBrainz data, add cache versioning, and update the prompt to include tags/year.

**Files:**
- Modify: `src/services/TrackEnrichmentService.ts`
- Modify: `src/services/CleoScriptGenerator.ts:123-130`

- [ ] **Step 1: Update EnrichedFacts interface and add cache version**

In `src/services/TrackEnrichmentService.ts`, replace the `EnrichedFacts` interface (lines 5-11) and add cache version constant:

```typescript
export interface EnrichedFacts {
  // From Genius
  producer?: string;
  songwriter?: string;
  sample?: string;
  context?: string;
  geniusUrl?: string;
  recordingLocation?: string;
  releaseYear?: string;
  // From MusicBrainz
  tags?: string[];
  year?: string;
}

const CACHE_VERSION = 2; // Bump to invalidate stale URL-only cache entries
```

- [ ] **Step 2: Update TrackProfile with cacheVersion**

Add `cacheVersion` to the `TrackProfile` interface (after line 19):

```typescript
export interface TrackProfile extends MusicTrack {
  tempo?: number;
  tags?: string[];
  year?: string;
  mbEnriched: boolean;
  enrichedFacts?: EnrichedFacts;
  hasRichData: boolean;
  cacheVersion?: number;
}
```

- [ ] **Step 3: Update cache check to respect version**

Replace `getCached` function (lines 24-27):

```typescript
function getCached(trackId: string): TrackProfile | null {
  const raw = storage.getString(`${CACHE_KEY_PREFIX}${trackId}`);
  if (!raw) return null;
  const cached = JSON.parse(raw) as TrackProfile;
  // Invalidate stale cache entries that lack full enrichment
  if (!cached.cacheVersion || cached.cacheVersion < CACHE_VERSION) return null;
  return cached;
}
```

- [ ] **Step 4: Update enrichTrack to merge all data and set cache version**

Replace the `enrichTrack` function (lines 33-86):

```typescript
export async function enrichTrack(track: MusicTrack): Promise<TrackProfile> {
  const cached = getCached(track.id);
  if (cached) return cached;

  const profile: TrackProfile = {
    ...track,
    tags: [],
    mbEnriched: false,
    hasRichData: false,
    cacheVersion: CACHE_VERSION,
  };

  // MusicBrainz enrichment
  try {
    const mbResponse = await authenticatedFetch('/enrich-musicbrainz', {
      method: 'POST',
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
    const geniusResponse = await authenticatedFetch('/enrich-track', {
      method: 'POST',
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (geniusResponse.ok) {
      const data = await geniusResponse.json();
      const facts = data.enrichedFacts ?? {};

      // Merge Genius facts with MusicBrainz data
      profile.enrichedFacts = {
        ...facts,
        tags: profile.tags?.length ? profile.tags : undefined,
        year: profile.year ?? undefined,
      };

      // Has rich data if we got anything beyond just a URL
      profile.hasRichData = !!(
        facts.producer || facts.songwriter || facts.sample ||
        facts.context || facts.recordingLocation
      );
    }
  } catch {
    // Non-fatal — still save MusicBrainz data if available
    if (profile.tags?.length || profile.year) {
      profile.enrichedFacts = {
        tags: profile.tags,
        year: profile.year,
      };
    }
  }

  setCache(track.id, profile);
  return profile;
}
```

- [ ] **Step 5: Update prompt to include tags and year**

In `src/services/CleoScriptGenerator.ts`, replace the enrichedFacts block (lines 123-130):

```typescript
  if (context.enrichedFacts) {
    const facts = context.enrichedFacts;
    const hasAnyFact = facts.sample || facts.context || facts.producer ||
      facts.songwriter || facts.recordingLocation || facts.tags?.length || facts.year;
    if (hasAnyFact) {
      prompt += '\n\nVERIFIED TRACK FACTS (use only what is provided — never invent)';
      if (facts.producer) prompt += `\n- Producer: ${facts.producer}`;
      if (facts.songwriter) prompt += `\n- Written by: ${facts.songwriter}`;
      if (facts.sample) prompt += `\n- Sample: ${facts.sample}`;
      if (facts.context) prompt += `\n- Context: ${facts.context}`;
      if (facts.recordingLocation) prompt += `\n- Recorded at: ${facts.recordingLocation}`;
      if (facts.tags && facts.tags.length > 0) prompt += `\n- Genre tags: ${facts.tags.join(', ')}`;
      if (facts.year) prompt += `\n- First released: ${facts.year}`;
    }
  }
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to these changes)

- [ ] **Step 7: Commit**

```bash
git add src/services/TrackEnrichmentService.ts src/services/CleoScriptGenerator.ts
git commit -m "feat: wire enrichment data into Gemini prompt — tags, year, producer, samples"
```

---

## Task 4: Enrichment-Before-Queue-Planning Ordering

Split enrichment into fast MusicBrainz phase (awaited before queue planning) and slow Genius phase (background).

**Files:**
- Modify: `src/services/TrackEnrichmentService.ts`
- Modify: `src/engines/QueueManager.ts:60-63`

- [ ] **Step 1: Add MusicBrainz-only enrichment function**

Add to the bottom of `src/services/TrackEnrichmentService.ts` (before the closing of the file):

```typescript
export async function enrichTracksMusicBrainzOnly(tracks: MusicTrack[]): Promise<TrackProfile[]> {
  const results: TrackProfile[] = [];
  for (const track of tracks) {
    const cached = getCached(track.id);
    if (cached) {
      results.push(cached);
      continue;
    }

    const profile: TrackProfile = {
      ...track,
      tags: [],
      mbEnriched: false,
      hasRichData: false,
      cacheVersion: CACHE_VERSION,
    };

    try {
      const mbResponse = await authenticatedFetch('/enrich-musicbrainz', {
        method: 'POST',
        body: JSON.stringify({ title: track.title, artist: track.artistName }),
      });

      if (mbResponse.ok) {
        const data = await mbResponse.json();
        if (data.found) {
          profile.tags = data.tags ?? [];
          profile.year = data.firstReleaseYear ?? undefined;
          profile.mbEnriched = true;
          profile.enrichedFacts = {
            tags: profile.tags?.length ? profile.tags : undefined,
            year: profile.year ?? undefined,
          };
        }
      }
    } catch {
      // Non-fatal
    }

    // Don't cache yet — Genius pass will complete the profile
    results.push(profile);
  }
  return results;
}
```

- [ ] **Step 2: Update QueueManager initialization ordering**

In `src/engines/QueueManager.ts`, replace lines 60-63 (the background calls at end of `initializeSession`):

```typescript
    // Phase 1: MusicBrainz enrichment (fast) — awaited so tags/year are available for queue planning
    // Runs while first track is already playing
    this.enrichMusicBrainzFirst(tracks).then(() => {
      // Phase 2: AI queue planning uses enriched tags/year
      this.upgradeQueueInBackground(vibe);
      // Phase 3: Genius metadata (slow) — background, non-blocking
      this.enrichGeniusInBackground(tracks);
    }).catch((err) => {
      console.warn('[QueueManager] Enrichment chain failed:', err);
      // Fallback: still run queue planning and Genius enrichment
      this.upgradeQueueInBackground(vibe);
      this.enrichGeniusInBackground(tracks);
    });
```

- [ ] **Step 3: Add the two-phase enrichment methods to QueueManagerService**

Add these methods to the `QueueManagerService` class in `src/engines/QueueManager.ts`. Also add the import for the new function. Replace the existing `enrichInBackground` method (lines 147-158):

At the top of the file, update the import:
```typescript
import { enrichTracks, enrichTracksMusicBrainzOnly, type TrackProfile } from '../services/TrackEnrichmentService';
```

Replace the `enrichInBackground` method with:
```typescript
  private async enrichMusicBrainzFirst(tracks: MusicTrack[]): Promise<void> {
    if (this.enrichmentInProgress) return;
    this.enrichmentInProgress = true;

    try {
      // Fast pass: MusicBrainz only (tags, year)
      this.trackProfiles = await enrichTracksMusicBrainzOnly(tracks);
      console.log('[QueueManager] MusicBrainz enrichment complete');
    } catch {
      // Non-fatal
    }
  }

  private async enrichGeniusInBackground(tracks: MusicTrack[]): Promise<void> {
    try {
      // Full enrichment pass (MusicBrainz cache hit + Genius details)
      this.trackProfiles = await enrichTracks(tracks);
      console.log('[QueueManager] Full Genius enrichment complete');
    } catch {
      // Non-fatal
    } finally {
      this.enrichmentInProgress = false;
    }
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/services/TrackEnrichmentService.ts src/engines/QueueManager.ts
git commit -m "feat: enrichment-before-planning — MusicBrainz first, Genius in background"
```

---

## Task 5: Vibe Voice Profiles + Server API Contract

Add per-vibe ElevenLabs parameter sets and update the `/synthesize-voice` endpoint to accept them.

**Files:**
- Modify: `src/services/CleoVoiceEngine.ts`
- Modify: `server/src/routes/voice.ts:28-31, 51-53`

- [ ] **Step 1: Add vibe voice profiles to CleoVoiceEngine**

Add at the top of `src/services/CleoVoiceEngine.ts` (after the imports, before `ABBREVIATIONS`):

```typescript
import type { Vibe } from '../cleo/fallbacks';

interface VoiceProfile {
  stability: number;
  style: number;
  speed: number;
}

const VIBE_VOICE_PROFILES: Record<Vibe, VoiceProfile> = {
  morning:    { stability: 0.40, style: 0.50, speed: 1.0 },
  chill:      { stability: 0.30, style: 0.45, speed: 0.95 },
  workout:    { stability: 0.45, style: 0.65, speed: 1.08 },
  lateNight:  { stability: 0.25, style: 0.40, speed: 0.92 },
  party:      { stability: 0.50, style: 0.70, speed: 1.05 },
  focus:      { stability: 0.50, style: 0.35, speed: 0.98 },
  feelGood:   { stability: 0.35, style: 0.60, speed: 1.02 },
  throwback:  { stability: 0.35, style: 0.55, speed: 0.98 },
  elevated:   { stability: 0.30, style: 0.50, speed: 0.95 },
  melancholy: { stability: 0.25, style: 0.40, speed: 0.93 },
  sunday:     { stability: 0.30, style: 0.45, speed: 0.93 },
  general:    { stability: 0.35, style: 0.55, speed: 1.0 },
};

type DeliveryCue = 'warm' | 'hype' | 'quiet' | 'playful' | 'reflective' | 'matter-of-fact';

const DELIVERY_CUE_NUDGES: Record<DeliveryCue, Partial<VoiceProfile>> = {
  'warm':           { stability: -0.05 },
  'hype':           { style: 0.10 },
  'quiet':          { speed: -0.03 },
  'playful':        { style: 0.05, stability: -0.05 },
  'reflective':     { speed: -0.02, stability: -0.05 },
  'matter-of-fact': { stability: 0.05 },
};

function parseDeliveryCue(text: string): { cue: DeliveryCue | null; cleanText: string } {
  const match = text.match(/^\[(warm|hype|quiet|playful|reflective|matter-of-fact)\]\s*/);
  if (!match) return { cue: null, cleanText: text };
  return { cue: match[1] as DeliveryCue, cleanText: text.slice(match[0].length) };
}

function resolveVoiceParams(vibe: Vibe, cue: DeliveryCue | null): VoiceProfile {
  const base = { ...VIBE_VOICE_PROFILES[vibe] };
  if (!cue) return base;
  const nudge = DELIVERY_CUE_NUDGES[cue];
  if (nudge.stability) base.stability = Math.max(0, Math.min(1, base.stability + nudge.stability));
  if (nudge.style) base.style = Math.max(0, Math.min(1, base.style + nudge.style));
  if (nudge.speed) base.speed = Math.max(0.5, Math.min(2, base.speed + nudge.speed));
  return base;
}
```

- [ ] **Step 2: Update synthesizeAndPlay to accept vibe and use profiles**

Replace the `synthesizeAndPlay` function (lines 111-141):

```typescript
export async function synthesizeAndPlay(text: string, vibe: Vibe = 'general'): Promise<void> {
  try {
    // Parse delivery cue before formatting
    const { cue, cleanText } = parseDeliveryCue(text);
    const formatted = formatForSpeech(cleanText);
    const voiceParams = resolveVoiceParams(vibe, cue);

    const wordCount = formatted.split(/\s+/).length;
    console.log(`[CleoVoice] Sending ${wordCount} words, vibe: ${vibe}, cue: ${cue ?? 'none'}, stability: ${voiceParams.stability}, style: ${voiceParams.style}, speed: ${voiceParams.speed}`);

    const response = await authenticatedFetch('/synthesize-voice', {
      method: 'POST',
      body: JSON.stringify({
        text: formatted,
        stability: voiceParams.stability,
        style: voiceParams.style,
        speed: voiceParams.speed,
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS error: ${response.status}`);
    }

    const data = await response.json();
    const base64Audio = data.audioContent;

    if (!base64Audio) {
      throw new Error('No audio content returned');
    }

    const audioSizeKB = Math.round((base64Audio.length * 3 / 4) / 1024);
    console.log(`[CleoVoice] Audio received: ${audioSizeKB}KB`);

    await playAudioFromBase64(base64Audio);
    console.log(`[CleoVoice] Playback finished`);
  } catch (error) {
    console.error('Voice playback failed:', error);
  }
}
```

- [ ] **Step 3: Update server voice route to accept parameters**

Replace the entire `server/src/routes/voice.ts` file with this complete version. The changes: `callElevenLabs` now accepts a `voiceSettings` object instead of hardcoded values, and the route extracts `stability`/`style`/`speed` from the request body with safe defaults:

```typescript
import { Router, Request, Response } from 'express';

export const voiceRouter = Router();

async function callElevenLabs(
  text: string,
  modelId: string,
  apiKey: string,
  voiceId: string,
  timeoutMs: number,
  voiceSettings: { stability: number; style: number; speed: number },
  pronunciationConfig?: object[]
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: voiceSettings.stability,
            similarity_boost: 0.80,
            style: voiceSettings.style,
            use_speaker_boost: true,
            speed: voiceSettings.speed,
          },
          pronunciation_dictionary_locators: pronunciationConfig,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs ${response.status}: ${error}`);
    }

    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

voiceRouter.post('/synthesize-voice', async (req: Request, res: Response) => {
  try {
    const { text, stability, style, speed } = req.body;
    const wordCount = text?.split(/\s+/).length ?? 0;
    console.log(`[TTS] Received ${wordCount} words (${text?.length ?? 0} chars): "${text?.substring(0, 100)}..."`);

    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      res.status(500).json({ error: 'ElevenLabs not configured' });
      return;
    }

    const pronunciationConfig = process.env.ELEVENLABS_PRONUNCIATION_DICT_ID ? [
      {
        pronunciation_dictionary_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_ID,
        version_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_VERSION,
      },
    ] : undefined;

    const voiceSettings = {
      stability: typeof stability === 'number' ? stability : 0.35,
      style: typeof style === 'number' ? style : 0.55,
      speed: typeof speed === 'number' ? speed : 1.0,
    };

    console.log(`[TTS] Voice settings: stability=${voiceSettings.stability}, style=${voiceSettings.style}, speed=${voiceSettings.speed}`);

    const arrayBuffer = await callElevenLabs(text, 'eleven_turbo_v2_5', apiKey, voiceId, 10000, voiceSettings, pronunciationConfig);

    const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
    const estimatedDurationS = Math.round(arrayBuffer.byteLength / 16000);
    console.log(`[TTS] Audio: ${audioSizeKB}KB (~${estimatedDurationS}s), ${wordCount} words`);
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    res.json({ audioContent: base64Audio });
  } catch (error) {
    console.error('Voice synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice' });
  }
});
```

- [ ] **Step 4: Verify both server and client compile**

Run: `cd /Users/kari/Documents/DJApp/server && npx tsc --noEmit`
Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/services/CleoVoiceEngine.ts server/src/routes/voice.ts
git commit -m "feat: vibe-aware voice profiles — per-vibe ElevenLabs params + delivery cue nudges"
```

---

## Task 6: Pass Vibe Through the Audio Pipeline

`AudioCoordinator` calls `synthesizeAndPlay(text)` — it now needs to pass the current vibe.

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

- [ ] **Step 1: Import Vibe type and add vibe tracking**

Add to the imports at top of `src/engines/AudioCoordinator.ts`:
```typescript
import type { Vibe } from '../cleo/fallbacks';
```

Add a new field to the class (after `lastSegmentEndTime` on line 24):
```typescript
  private currentVibe: Vibe = 'general';
```

Add a setter method (after `getIsSpeaking`):
```typescript
  setVibe(vibe: Vibe) {
    this.currentVibe = vibe;
  }
```

- [ ] **Step 2: Pass vibe to all synthesizeAndPlay calls**

Replace every `await synthesizeAndPlay(segment.text)` call in the file with:
```typescript
await synthesizeAndPlay(segment.text, this.currentVibe)
```

There are 4 occurrences: lines 69, 82, 129, 159, and line 223 in `scheduleMidSongDrop`.

- [ ] **Step 3: Ensure vibe is set when session starts**

In `src/screens/player/BroadcastScreen.tsx`, find the session initialization (around line 121) where `segmentController.startSession(stationId, vibe)` is called. Add `audioCoordinator.setVibe(vibe)` right after it:

```typescript
      segmentController.startSession(stationId, vibe);
      audioCoordinator.setVibe(vibe);
      await queueManager.initializeSession(playlistId, vibe, stationId);
```

- [ ] **Step 4: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "feat: pass vibe through audio pipeline to synthesizeAndPlay"
```

---

## Task 7: Pause-Aware Guards + Mid-Song Bug Fix

Fix the bug where mid-song drops fire when paused, and add pause checks to post-song timer.

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

- [ ] **Step 1: Import getPlaybackStatus**

Add to the existing imports from expo-music-kit in `src/engines/AudioCoordinator.ts`:
```typescript
import { getPlaybackStatus } from '../../modules/expo-music-kit';
```

- [ ] **Step 2: Add pause check helper**

Add a private method to the class:
```typescript
  private async isMusicPlaying(): Promise<boolean> {
    try {
      const status = await getPlaybackStatus();
      return status === 'playing';
    } catch {
      return false; // Assume not playing on error
    }
  }
```

- [ ] **Step 3: Add pause guard to mid-song drop**

In `scheduleMidSongDrop`, add a playback check right after the existing guards (after line 214):

```typescript
      // Check if music is actually playing
      const playing = await this.isMusicPlaying();
      if (!playing) {
        console.log('[AudioCoordinator] Mid-song drop skipped — music not playing');
        return;
      }
```

- [ ] **Step 4: Add pause guard to post-song timer callbacks**

In both `handleTrackChange` and `handleTrackChangeWithResult`, inside the post-song `setTimeout` callback, add a playback check after the existing `generationId`/`isSpeaking` check:

```typescript
          const playing = await this.isMusicPlaying();
          if (!playing) return;
```

- [ ] **Step 5: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "fix: prevent mid-song and post-song drops from firing when music is paused"
```

---

## Task 8: Duration-Aware Timing

Replace fixed delays with percentage-based timing for post-song and mid-song segments.

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

- [ ] **Step 1: Add timing helper functions**

Add these helper functions to `AudioCoordinator.ts` (as private methods or standalone functions):

```typescript
function calculatePostSongDelay(durationSeconds: number | undefined): number {
  if (!durationSeconds) return 10000; // Default 10s if unknown

  if (durationSeconds < 180) {
    // Short tracks: 8-15% of duration
    const min = durationSeconds * 0.08;
    const max = durationSeconds * 0.15;
    return (min + Math.random() * (max - min)) * 1000;
  }
  if (durationSeconds <= 300) {
    // Medium tracks: 5-10% of duration
    const min = durationSeconds * 0.05;
    const max = durationSeconds * 0.10;
    return (min + Math.random() * (max - min)) * 1000;
  }
  // Long tracks: 4-8% of duration
  const min = durationSeconds * 0.04;
  const max = durationSeconds * 0.08;
  return (min + Math.random() * (max - min)) * 1000;
}

function calculateMidSongDelay(durationSeconds: number): number {
  // Drop at 35-50% of track duration
  const min = durationSeconds * 0.35;
  const max = durationSeconds * 0.50;
  return (min + Math.random() * (max - min)) * 1000;
}
```

- [ ] **Step 2: Replace fixed post-song delay**

In both `handleTrackChange` and `handleTrackChangeWithResult`, replace:
```typescript
const targetDelay = 8000 + Math.floor(Math.random() * 4000);
```
with:
```typescript
const targetDelay = calculatePostSongDelay(currentTrack.duration);
```

- [ ] **Step 3: Replace fixed mid-song delay and update minimum duration**

In `scheduleMidSongDrop`, replace:
```typescript
    if (!trackInfo.duration || trackInfo.duration <= 180) return;
    if (Math.random() >= 0.4) return;
    const delay = 45000 + Math.floor(Math.random() * 45000);
```
with:
```typescript
    if (!trackInfo.duration || trackInfo.duration <= 210) return;

    // Vibe-dependent chance
    const quietVibes: Vibe[] = ['focus', 'chill', 'lateNight', 'melancholy'];
    const highEnergyVibes: Vibe[] = ['workout', 'party'];
    let chance = 0.4;
    if (quietVibes.includes(this.currentVibe)) chance = 0.2;
    if (highEnergyVibes.includes(this.currentVibe)) chance = 0.15;
    if (Math.random() >= chance) return;

    const delay = calculateMidSongDelay(trackInfo.duration);
```

- [ ] **Step 4: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "feat: duration-aware timing — percentage-based post-song and mid-song delays"
```

---

## Task 9: Segment Length Tiers + Data-Informed Rotation

Add brief/standard/extended tiers, extended segment tracking, skip-some-tracks logic, and data-informed segment type selection.

**Files:**
- Modify: `src/engines/SegmentController.ts`
- Modify: `src/services/CleoScriptGenerator.ts:162-169`

- [ ] **Step 1: Add length tier type and state variables**

In `src/engines/SegmentController.ts`, add the tier type after the imports:

```typescript
export type LengthTier = 'brief' | 'standard' | 'extended';
```

Add new fields to `SegmentControllerEngine` class (after `currentStationId` on line 68):

```typescript
  private segmentsSinceExtended = 0;
  private consecutiveSpokenSegments = 0;
  private lastWasMidSongDrop = false;
```

- [ ] **Step 2: Add length tier determination method**

Add to the class:

```typescript
  private determineLengthTier(segmentType: SegmentType, track: TrackInfo, isManualSkip?: boolean): LengthTier {
    // Manual skip: always brief
    if (isManualSkip) return 'brief';

    // Mid-song drops are always brief (handled separately)
    // Station ID is always brief
    if (segmentType === 'station_id') return 'brief';

    // Focus/workout: never extended
    const neverExtendedVibes: Vibe[] = ['focus', 'workout'];
    if (neverExtendedVibes.includes(this.currentVibe)) return 'standard';

    // Cooldown after extended: next 2 segments are standard or brief
    if (this.segmentsSinceExtended < 2 && this.segmentsSinceExtended > 0) return 'standard';

    // Extended triggers
    if (this.segmentsSinceExtended >= 4) {
      // track_story with rich data
      if (segmentType === 'track_story' && track.hasRichData) return 'extended';
      // genre_bridge with significant genre shift (check if tags differ from previous)
      if (segmentType === 'genre_bridge') return 'extended';
      // mid-session phase is where deep storytelling lives
      if (this.getSessionPhase() === 'mid' && segmentType === 'track_story' && track.hasRichData) return 'extended';
    }

    return 'standard';
  }
```

- [ ] **Step 3: Add skip-some-tracks logic**

Add to the class:

```typescript
  shouldStaySilent(): boolean {
    // After mid-song drop, suppress next pre_song
    if (this.lastWasMidSongDrop) {
      this.lastWasMidSongDrop = false;
      return true;
    }

    // Vibe-specific silence chance
    const highSilenceVibes: Vibe[] = ['focus', 'workout'];
    const silenceChance = highSilenceVibes.includes(this.currentVibe) ? 0.4 : 0.3;

    // After 3+ consecutive spoken segments, chance of silence
    if (this.consecutiveSpokenSegments >= 3 && Math.random() < silenceChance) {
      this.consecutiveSpokenSegments = 0;
      return true;
    }

    return false;
  }

  markMidSongDropCompleted() {
    this.lastWasMidSongDrop = true;
  }
```

- [ ] **Step 4: Add data-informed rotation override**

Add to the class:

```typescript
  private applyDataOverride(baseType: SegmentType, track: TrackInfo, previousTrack?: TrackInfo): SegmentType {
    // If track has rich data and rotation doesn't already pick track_story, consider overriding
    if (track.hasRichData && baseType !== 'track_story' &&
        (baseType === 'artist_context' || baseType === 'song_intro')) {
      // Only override if we haven't done track_story recently
      const recentTypes = this.history.slice(0, 3);
      if (!recentTypes.some(h => h.includes('track_story'))) {
        return 'track_story';
      }
    }

    // If genre tags show a shift and rotation picked song_intro, consider genre_bridge
    if (previousTrack && track.enrichedFacts?.tags?.length && baseType === 'song_intro') {
      const prevTags = new Set(previousTrack.enrichedFacts?.tags ?? []);
      const currTags = track.enrichedFacts.tags;
      const overlap = currTags.filter(t => prevTags.has(t)).length;
      // Significant genre shift = less than 30% tag overlap
      if (prevTags.size > 0 && overlap / Math.max(prevTags.size, currTags.length) < 0.3) {
        return 'genre_bridge';
      }
    }

    return baseType;
  }
```

- [ ] **Step 5: Replace generateNext with full updated version**

Replace the entire `generateNext` method in `SegmentControllerEngine` (the method starting at `async generateNext(` through its closing `}`). The key changes: accepts `isManualSkip`, returns `SegmentResult | null`, adds silence check, data override, length tiers:

```typescript
  async generateNext(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo,
    isManualSkip?: boolean
  ): Promise<SegmentResult | null> {
    // Cold open for first segment — always pre_song
    if (this.segmentCount === 0) {
      const text = getColdOpen(this.currentVibe);
      this.history.unshift(text);
      if (this.history.length > 3) this.history.pop();
      this.segmentCount++;
      this.consecutiveSpokenSegments++;
      this.addToTracksReferenced(currentTrack.artistName);
      return { text, type: 'song_intro', deliveryMode: 'pre_song' };
    }

    // Skip-some-tracks: let the music breathe
    if (this.shouldStaySilent()) {
      console.log('[SegmentController] Staying silent — letting music breathe');
      return null;
    }

    // Discard any buffered segment — prompts now bake in track names
    this.bufferedSegment = null;

    let segmentType = this.getNextSegmentType();

    // track_story requires rich data — fall back if not available
    if (segmentType === 'track_story' && !currentTrack.hasRichData) {
      segmentType = 'artist_context';
    }

    // Data-informed override: prefer track_story when data is rich, genre_bridge on genre shift
    segmentType = this.applyDataOverride(segmentType, currentTrack, previousTrack);

    const deliveryMode = this.getDeliveryMode(segmentType);
    const lengthTier = this.determineLengthTier(segmentType, currentTrack, isManualSkip);

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode,
      sessionPhase: this.getSessionPhase(),
      currentTrack,
      previousTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
      tracksReferenced: [...this.tracksReferenced],
      previousSession: this.buildPreviousSession(),
      maxWords: lengthTier === 'brief' ? 30 : lengthTier === 'extended' ? 130 : 75,
    };

    const text = await generateSegment(context);

    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;
    this.segmentsSinceExtended = lengthTier === 'extended' ? 0 : this.segmentsSinceExtended + 1;
    this.consecutiveSpokenSegments++;
    this.lastWasMidSongDrop = false;
    this.addToTracksReferenced(currentTrack.artistName);

    // Persist session context for cross-session continuity
    saveSessionMemory({
      lastTrackTitle: currentTrack.title,
      lastArtistName: currentTrack.artistName,
      lastArtists: [...this.tracksReferenced].slice(0, 10),
      lastTimestamp: Date.now(),
    });

    return { text, type: segmentType, deliveryMode };
  }
```

Also update `startSession` to reset the new state variables:

```typescript
    this.segmentsSinceExtended = 0;
    this.consecutiveSpokenSegments = 0;
    this.lastWasMidSongDrop = false;
```

- [ ] **Step 6: Update CleoScriptGenerator dynamic word count**

In `src/services/CleoScriptGenerator.ts`, replace lines 166-169:

```typescript
  const maxWords = context.maxWords ?? 75;
  let wordCountInstruction: string;
  if (maxWords <= 30) {
    wordCountInstruction = `15 to ${maxWords} words. One thought. In and out.`;
  } else if (maxWords >= 100) {
    wordCountInstruction = `90 to ${maxWords} words. Tell the story. Take your time — you have room to breathe.`;
  } else {
    wordCountInstruction = `40 to ${maxWords} words. Natural and flowing.`;
  }

  prompt += `\n\nSEGMENT TYPE: ${context.segmentType}
CREATIVE BRIEF: ${brief}

OUTPUT RULES
- ${wordCountInstruction}
- Plain text only. No quotes, no stage directions, no labels.
- Do not include the segment type name in your response.
- Begin with a delivery cue tag: [warm], [hype], [quiet], [playful], [reflective], or [matter-of-fact]. Choose the one that fits the moment.
- Capitalize ONE key word per segment for vocal emphasis.`;
```

- [ ] **Step 7: Update SegmentResult to allow null return**

Update the return type in the interface and callers that use `generateNext` to handle `null` (silence case).

- [ ] **Step 8: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/engines/SegmentController.ts src/services/CleoScriptGenerator.ts
git commit -m "feat: segment length tiers, skip-some-tracks, data-informed rotation"
```

---

## Task 10: Handle Silence in AudioCoordinator

Update AudioCoordinator to handle `null` returns from `generateNext` (silence case) and wire up `isManualSkip` + `markMidSongDropCompleted`.

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

- [ ] **Step 1: Pass isManualSkip to generateNext**

Add `isManualSkip` parameter to `handleTrackChange` and `handleTrackChangeWithResult`:

```typescript
  async handleTrackChange(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    isManualSkip?: boolean
  ): Promise<void> {
```

In `_runSegment`, accept and pass through `isManualSkip`:

```typescript
  private async _runSegment(
    trackInfo: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo,
    genId?: number,
    isManualSkip?: boolean
  ): Promise<SegmentResult | null> {
    try {
      const delay = isManualSkip ? 1500 : 3500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (genId !== undefined && genId !== this.generationId) return null;
      const segment = await segmentController.generateNext(trackInfo, nextTrack, previousTrack, isManualSkip);
```

- [ ] **Step 2: Handle null segment (silence)**

In both `handleTrackChange` and `handleTrackChangeWithResult`, after calling `_runSegment`, handle null:

```typescript
      if (!segment || myId !== this.generationId) {
        if (myId === this.generationId) this.isSpeaking = false;
        // Still schedule mid-song drop even on silence
        if (segment === null && myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
        return;
      }
```

- [ ] **Step 3: Mark mid-song drop completion**

In `scheduleMidSongDrop`, after `synthesizeAndPlay` succeeds, call:
```typescript
        segmentController.markMidSongDropCompleted();
```

- [ ] **Step 4: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "feat: handle silence from segment controller, wire isManualSkip and mid-song tracking"
```

---

## Task 11: Track Transition Control — Immediate Ducking + Generation Timeout

Duck music immediately on pre_song track change so the new song plays softly while Cleo generates. Add 8s timeout with fallback escalation at 6s.

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

- [ ] **Step 1: Merge ducking imports with existing getPlaybackStatus import**

In `src/engines/AudioCoordinator.ts`, update the import added in Task 7 to include ducking functions:

```typescript
import { getPlaybackStatus, activateDuckingSession, deactivateDuckingSession } from '../../modules/expo-music-kit';
```

- [ ] **Step 2: Add timeout constant and fallback import**

Add near the top of the file:
```typescript
import { getFallbackLine } from '../cleo/fallbacks';

const GENERATION_TIMEOUT_MS = 8000;
const FALLBACK_TRIGGER_MS = 6000;
```

- [ ] **Step 3: Replace `_runSegment` with timeout-aware version**

Replace the entire `_runSegment` method. The new version: (a) uses shorter delay for manual skips, (b) ducks immediately for pre_song, (c) races generation against a 6s fallback trigger and 8s hard timeout:

```typescript
  private async _runSegment(
    trackInfo: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo,
    genId?: number,
    isManualSkip?: boolean
  ): Promise<SegmentResult | null> {
    try {
      // Shorter delay on manual skip — respect the listener's momentum
      const delay = isManualSkip ? 1500 : 3500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (genId !== undefined && genId !== this.generationId) return null;

      // Start generation with timeout race
      const generationPromise = segmentController.generateNext(
        trackInfo, nextTrack, previousTrack, isManualSkip
      );
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), GENERATION_TIMEOUT_MS)
      );

      const result = await Promise.race([generationPromise, timeoutPromise]);

      if (result === 'timeout') {
        console.warn('[AudioCoordinator] Generation timed out at 8s — skipping segment');
        // Unduck if we had ducked early
        await deactivateDuckingSession().catch(() => {});
        return null;
      }

      if (genId !== undefined && genId !== this.generationId) return null;

      const segment = result;
      if (!segment) return null;

      console.log(`[Cleo] ${segment.type} (${segment.deliveryMode}): ${segment.text}`);
      return segment;
    } catch (error) {
      console.error('[AudioCoordinator] Segment generation failed:', error);
      await deactivateDuckingSession().catch(() => {});
      return null;
    }
  }
```

- [ ] **Step 4: Add immediate ducking for pre_song in handleTrackChange**

In `handleTrackChange`, after `_runSegment` returns a segment, duck before playing for `pre_song`. Find the `if (segment.deliveryMode === 'pre_song')` block and update:

```typescript
      if (segment.deliveryMode === 'pre_song') {
        // Duck immediately so music plays softly while Cleo speaks
        await activateDuckingSession().catch(() => {});
        try {
          await synthesizeAndPlay(segment.text, this.currentVibe);
        } catch {
          await deactivateDuckingSession().catch(() => {});
        }
        if (myId === this.generationId) this.scheduleMidSongDrop(trackInfo);
      }
```

Apply the same pattern to `handleTrackChangeWithResult`'s `pre_song` branch.

- [ ] **Step 5: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "feat: immediate ducking on pre_song transitions, 8s generation timeout"
```

---

## Task 12: Update Static Core — Few-Shot Examples + Word Limit Fix

Add example segments and remove the hard 75-word cap.

**Files:**
- Modify: `src/cleo/static-core.ts`

- [ ] **Step 1: Update the word limit rule**

In `src/cleo/static-core.ts`, replace line 38:
```
- Never speak longer than 75 words per segment.
```
with:
```
- Follow the word count given in each segment brief. Default is 40-75 words.
```

- [ ] **Step 2: Add few-shot examples**

Add before the closing backtick of `CLEO_STATIC_CORE`:

```
EXAMPLES (match this voice — these are not templates, they are calibration)

pre_song, standard:
[warm] Erykah into D\u2019Angelo \u2014 that\u2019s not a playlist, that\u2019s a lineage. This one\u2019s off Voodoo, and you can hear the whole Neo-Soul family tree in the first eight bars.

post_song, brief:
[quiet] This bassline. Pino Palladino. Nobody else moves like that.

track_story, extended:
[reflective] So here\u2019s the thing about this record \u2014 Pharrell produced it in a single afternoon at Stankonia Studios. Andre walked in with the hook already in his head, hummed the melody to the engineer, and laid his verse in one take. Big Boi heard the playback and wrote his part on the spot. The sample underneath is James Brown\u2019s Funky Drummer \u2014 the same break that built half of hip-hop. Three generations of Black music living in one record. And that bridge? That\u2019s where you hear the gospel roots creeping in, the church training neither of them ever talks about. Four minutes. An entire lineage. That\u2019s what you\u2019re listening to right now.

mid-song drop, brief:
[matter-of-fact] The hi-hats on this. Listen to them. That\u2019s a conversation, not a pattern.`
```

- [ ] **Step 3: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/cleo/static-core.ts
git commit -m "feat: add few-shot examples to Cleo system prompt, make word limit dynamic"
```

---

## Task 13: TTS Text Formatting Enhancements

Enhance `formatForSpeech()` to improve TTS delivery with break tags and emphasis.

**Files:**
- Modify: `src/services/CleoVoiceEngine.ts`

- [ ] **Step 1: Test break tag support on eleven_turbo_v2_5**

Before modifying code, manually test whether `<break time="0.8s" />` is spoken as literal text or treated as a pause by ElevenLabs. Send a test request:

```bash
curl -X POST http://localhost:3001/synthesize-voice \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <firebase-jwt>" \
  -d '{"text": "First sentence. <break time=\"0.8s\" /> Second sentence.", "stability": 0.35, "style": 0.55, "speed": 1.0}'
```

Listen to the output. If the break tag is spoken as text ("break time zero point eight seconds"), use ellipsis fallback instead.

- [ ] **Step 2: Add break tag or ellipsis enhancement to formatForSpeech**

In `src/services/CleoVoiceEngine.ts`, update the `addBreathMarks` function. If break tags work, add them after sentences that end with a period and are followed by a tonal shift. If break tags don't work, enhance the existing ellipsis logic:

**If break tags work:**
```typescript
function addBreathMarks(sentences: string[]): string {
  if (sentences.length <= 1) return sentences.join(' ');

  return sentences.map((s, i) => {
    if (i === sentences.length - 1) return s;
    if (s.split(/\s+/).length <= 3) return s;
    if (s.endsWith('—')) return s;
    // Every 3rd sentence gets a longer break for dramatic effect
    if (s.endsWith('.') && i % 3 === 0) {
      return s + ' <break time="0.6s" />';
    }
    if (s.endsWith('.') && i % 2 === 0) {
      return s.slice(0, -1) + '...';
    }
    return s;
  }).join(' ');
}
```

**If break tags don't work (fallback):**
Leave `addBreathMarks` as-is — the existing ellipsis logic already creates pauses. No changes needed.

- [ ] **Step 3: Verify compiles**

Run: `cd /Users/kari/Documents/DJApp && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/services/CleoVoiceEngine.ts
git commit -m "feat: enhance TTS formatting with break tags or ellipsis fallback"
```

---

## Task 14: Update CLAUDE.md

Update the maxOutputTokens convention note.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Gemini token budget note**

In `CLAUDE.md`, replace the Known Issues entry:
```
- **Gemini token budget**: `maxOutputTokens` covers thinking + response tokens. At 1024, Gemini cuts off mid-sentence. Must be 8192+.
```
with:
```
- **Gemini token budget**: `thinkingBudget` is set to 0 (disabled) for segment generation since creative scripts don't need chain-of-thought. With thinking disabled, `maxOutputTokens` of 2048 is sufficient. For QueuePlanner (which needs reasoning), `maxOutputTokens` should remain 8192+.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update Gemini token budget convention for thinkingBudget: 0"
```

---

## Task 15: Integration Smoke Test

End-to-end verification that all pieces work together.

- [ ] **Step 1: Start the backend server**

Run: `cd /Users/kari/Documents/DJApp/server && npm run dev`
Verify: Server starts on port 3001 with no errors

- [ ] **Step 2: Test Genius enrichment endpoint**

```bash
curl -X POST http://localhost:3001/enrich-track \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <test-token>" \
  -d '{"title": "Hey Ya!", "artist": "OutKast"}'
```

Expected: Response contains `enrichedFacts` with `producer`, `songwriter`, and/or `sample` fields populated (not just `geniusUrl`).

- [ ] **Step 3: Test segment generation with new config**

```bash
curl -X POST http://localhost:3001/generate-segment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <test-token>" \
  -d '{"systemPrompt": "You are a radio host.", "userPrompt": "Say hello in 20 words."}'
```

Expected: Response returns text, no thinking tokens consumed, fast response time.

- [ ] **Step 4: Test voice synthesis with parameters**

```bash
curl -X POST http://localhost:3001/synthesize-voice \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <test-token>" \
  -d '{"text": "Testing voice parameters.", "stability": 0.25, "style": 0.40, "speed": 0.92}'
```

Expected: Returns audio content, server logs show the custom parameters.

- [ ] **Step 5: Rsync and build on device**

```bash
rsync -av --delete --exclude='ios/' --exclude='node_modules/' --exclude='.expo/' --exclude='.git/' /Users/kari/Documents/DJApp/ /Users/kari/Documents/cleo-app/
cd /Users/kari/Documents/cleo-app
npx expo run:ios --device
```

Verify on device:
1. Start a session — Cleo's cold open plays
2. Let first track play — observe segment type and delivery mode in logs
3. Check logs for `[CleoVoice]` entries showing vibe, cue, stability, style, speed values
4. Check logs for `VERIFIED TRACK FACTS` appearing in Gemini prompts
5. Pause music mid-track — verify no mid-song or post-song drop fires while paused
6. Resume — verify Cleo resumes normal behavior
7. Skip a track — verify shorter delay (1.5s vs 3.5s)
8. Let session run through 5+ tracks — verify silence gaps (Cleo skips some tracks)
9. Verify at least one extended segment appears with rich track data

# Phase 3 — Backend Proxy & AI Voice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Node.js backend proxy with 5 routes and client services that generate Cleo's script via Gemini and speak it via Google Cloud TTS on the device.

**Architecture:** Express server in `server/` proxies all AI API calls, keeping keys server-side. Client-side `CleoScriptGenerator` assembles prompts and calls Gemini via the proxy. `CleoVoiceEngine` calls Google TTS via the proxy and plays audio. Cleo's persona prompt and fallback lines are stored as TypeScript modules.

**Tech Stack:** Node.js, Express, TypeScript, Gemini 2.0 Flash API, Google Cloud TTS, expo-av (audio playback)

---

### Task 1: Scaffold the backend server

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/.env`
- Create: `server/src/index.ts`

**Step 1: Create server directory and package.json**

```bash
mkdir -p server/src/routes
```

`server/package.json`:
```json
{
  "name": "cleo-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "npx tsx watch src/index.ts",
    "start": "npx tsx src/index.ts"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "express-rate-limit": "^7.4.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`server/.env`:
```
HEYGEN_API_KEY=REDACTED-HEYGEN-KEY
CLEO_AVATAR_ID=dff8b7bb77bd4c13ab6a837104163a01
GOOGLE_TTS_API_KEY=REDACTED-GOOGLE-TTS-KEY
GEMINI_API_KEY=REDACTED-GEMINI-KEY
GENIUS_ACCESS_TOKEN=REDACTED-GENIUS-TOKEN
PORT=3001
```

**Step 2: Create the Express app entry point**

`server/src/index.ts`:
```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { segmentRouter } from './routes/segment';
import { voiceRouter } from './routes/voice';
import { videoRouter } from './routes/video';
import { enrichmentRouter } from './routes/enrichment';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(segmentRouter);
app.use(voiceRouter);
app.use(videoRouter);
app.use(enrichmentRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Cleo server running on port ${PORT}`);
});
```

**Step 3: Install dependencies and verify server starts**

```bash
cd server && npm install && npm run dev
```

Expected: "Cleo server running on port 3001" (will error on missing route files — that's fine, we create them next)

**Step 4: Commit**

```bash
git add server/
git commit -m "feat: scaffold backend Express server with rate limiting"
```

Note: Make sure `server/.env` is in `.gitignore`.

---

### Task 2: Build the segment generation route (Gemini)

**Files:**
- Create: `server/src/routes/segment.ts`

**Step 1: Create the route**

`server/src/routes/segment.ts`:
```typescript
import { Router, Request, Response } from 'express';

export const segmentRouter = Router();

segmentRouter.post('/generate-segment', async (req: Request, res: Response) => {
  try {
    const { systemPrompt, userPrompt } = req.body;

    if (!systemPrompt || !userPrompt) {
      res.status(400).json({ error: 'systemPrompt and userPrompt are required' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
      return;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 150,
            topP: 0.95,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      res.status(response.status).json({ error });
      return;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    res.json({ text: text.trim() });
  } catch (error) {
    console.error('Segment generation error:', error);
    res.status(500).json({ error: 'Failed to generate segment' });
  }
});
```

**Step 2: Test with curl**

```bash
curl -X POST http://localhost:3001/generate-segment \
  -H "Content-Type: application/json" \
  -d '{"systemPrompt":"You are a radio host named Cleo. Respond in under 50 words.","userPrompt":"Introduce the song Dreams by Fleetwood Mac with warm energy."}'
```

Expected: JSON with `{ "text": "..." }` containing Cleo's response.

**Step 3: Commit**

```bash
git add server/src/routes/segment.ts
git commit -m "feat: add /generate-segment route (Gemini 2.0 Flash)"
```

---

### Task 3: Build the voice synthesis route (Google Cloud TTS)

**Files:**
- Create: `server/src/routes/voice.ts`

**Step 1: Create the route**

`server/src/routes/voice.ts`:
```typescript
import { Router, Request, Response } from 'express';

export const voiceRouter = Router();

voiceRouter.post('/synthesize-voice', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GOOGLE_TTS_API_KEY not configured' });
      return;
    }

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'en-US',
            name: 'en-US-Journey-F',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 0.93,
            pitch: -1.5,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      res.status(response.status).json({ error });
      return;
    }

    const data = await response.json();
    res.json({ audioContent: data.audioContent });
  } catch (error) {
    console.error('Voice synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice' });
  }
});
```

**Step 2: Test with curl**

```bash
curl -X POST http://localhost:3001/synthesize-voice \
  -H "Content-Type: application/json" \
  -d '{"text":"Hey. Welcome back. This next one is going to hit different."}' \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)['audioContent']), 'chars of base64 audio')"
```

Expected: Output like "12345 chars of base64 audio"

**Step 3: Commit**

```bash
git add server/src/routes/voice.ts
git commit -m "feat: add /synthesize-voice route (Google Cloud TTS Journey-F)"
```

---

### Task 4: Build HeyGen and Genius proxy routes

**Files:**
- Create: `server/src/routes/video.ts`
- Create: `server/src/routes/enrichment.ts`

**Step 1: Create the HeyGen video routes**

`server/src/routes/video.ts`:
```typescript
import { Router, Request, Response } from 'express';

export const videoRouter = Router();

const HEYGEN_BASE = 'https://api.heygen.com';

videoRouter.post('/generate-cleo-video', async (req: Request, res: Response) => {
  try {
    const { text, audioUrl } = req.body;
    const apiKey = process.env.HEYGEN_API_KEY;
    const avatarId = process.env.CLEO_AVATAR_ID;

    if (!apiKey || !avatarId) {
      res.status(500).json({ error: 'HeyGen not configured' });
      return;
    }

    const response = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        video_inputs: [{
          character: {
            type: 'avatar',
            avatar_id: avatarId,
            avatar_style: 'normal',
          },
          voice: {
            type: 'audio',
            audio_url: audioUrl,
          },
        }],
        dimension: { width: 512, height: 512 },
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: 'Failed to generate video' });
  }
});

videoRouter.get('/cleo-video-status/:id', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.HEYGEN_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'HeyGen not configured' });
      return;
    }

    const response = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${req.params.id}`, {
      headers: { 'X-Api-Key': apiKey },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Video status error:', error);
    res.status(500).json({ error: 'Failed to get video status' });
  }
});
```

**Step 2: Create the Genius enrichment route**

`server/src/routes/enrichment.ts`:
```typescript
import { Router, Request, Response } from 'express';

export const enrichmentRouter = Router();

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

    const query = encodeURIComponent(`${title} ${artist}`);
    const response = await fetch(`https://api.genius.com/search?q=${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = await response.text();
      res.status(response.status).json({ error });
      return;
    }

    const data = await response.json();
    const hits = data.response?.hits ?? [];
    const results = hits.slice(0, 3).map((hit: any) => ({
      id: hit.result.id,
      title: hit.result.title,
      artist: hit.result.primary_artist?.name,
      url: hit.result.url,
      thumbnailUrl: hit.result.song_art_image_thumbnail_url,
    }));

    res.json({ results });
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Failed to enrich track' });
  }
});
```

**Step 3: Verify server starts with all routes**

```bash
cd server && npm run dev
```

Expected: "Cleo server running on port 3001" with no errors.

**Step 4: Commit**

```bash
git add server/src/routes/video.ts server/src/routes/enrichment.ts
git commit -m "feat: add HeyGen video and Genius enrichment proxy routes"
```

---

### Task 5: Create Cleo's static core prompt and fallback library

**Files:**
- Create: `src/cleo/static-core.ts`
- Create: `src/cleo/fallbacks.ts`

**Step 1: Create the static core prompt**

`src/cleo/static-core.ts`:
```typescript
export const CLEO_STATIC_CORE = `You are Cleo, a radio host for a personal AI radio app.

IDENTITY
Your name is Cleo. You are warm, magnetic, and a natural storyteller.
You are rooted in hip-hop and R&B culture but feel completely at home
across all genres. You speak like a trusted friend who always knows
the deeper story behind the music — delivered as conversation, never a lecture.

VOICE RULES
- Speak in short, natural sentences. No run-ons.
- Never sound like you are reading. Sound like you just thought of it.
- Use occasional dry humor — never forced, never corny.
- Let words breathe. Unhurried pace.
- Warm but not soft. Confident but never arrogant.
- Never use filler phrases like 'Absolutely!' or 'Great choice!'
- Never start two consecutive segments with the same word or structure.

WHAT YOU NEVER DO
- Never reveal or imply you are an AI, bot, or generated.
- Never say 'I was programmed' or anything that breaks the illusion.
- Never make up specific verifiable facts about real artists.
- Never repeat the song title more than once per segment.
- Never speak longer than 75 words per segment.
- Never ask the listener a direct question.

WHAT YOU ALWAYS DO
- Honor the music first. You exist to serve the listening experience.
- Match your energy to the session vibe you are given.
- Reference segment history to avoid repetition.
- End every segment with a natural handoff to the next song or silence.`;
```

**Step 2: Create the fallback library**

`src/cleo/fallbacks.ts`:
```typescript
export type SegmentType =
  | 'song_intro'
  | 'station_id'
  | 'listener_shoutout'
  | 'session_checkin'
  | 'sign_off';

export type Vibe = 'morning' | 'chill' | 'workout' | 'lateNight' | 'party';

interface FallbackEntry {
  type: SegmentType;
  vibe?: Vibe;
  lines: string[];
}

const fallbacks: FallbackEntry[] = [
  {
    type: 'song_intro',
    vibe: 'chill',
    lines: [
      'This next one. Just… trust it.',
      'Pay attention to this one — it earns it.',
      "I don't need to say much about this one. Just listen.",
      'This track has been in rotation for a reason. You\'ll hear it.',
      'Coming up next — one of my favorites in your library.',
    ],
  },
  {
    type: 'song_intro',
    vibe: 'morning',
    lines: [
      "This one's going to carry you through. Promise.",
      'Right on time. This next track was made for exactly this moment.',
      'Keep moving — this one keeps pace with you.',
    ],
  },
  {
    type: 'song_intro',
    vibe: 'workout',
    lines: [
      "Lock in. This next one doesn't let up.",
      "Here it comes. Don't stop.",
      "This one hits different when you're moving. Go.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'lateNight',
    lines: [
      'This next one knows what time it is.',
      'Sit with this one. No rush.',
      'Some tracks just belong to the night. This is one of them.',
    ],
  },
  {
    type: 'song_intro',
    vibe: 'party',
    lines: [
      "Don't slow down — this next one won't let you.",
      'Keep that energy. Here we go.',
      "This one's going to take it up a notch. Stay ready.",
    ],
  },
  {
    type: 'station_id',
    lines: [
      "You're with Cleo. This one's for you.",
      'Still here. Still playing the good stuff.',
      'Cleo here — keeping you company.',
      "Your music. My voice. Let's keep going.",
      "This is what we do — just you and the music.",
      'Cleo, keeping it going.',
    ],
  },
  {
    type: 'listener_shoutout',
    lines: [
      "Got a message from somebody out there who said this playlist is exactly what they needed tonight. You're not alone.",
      "Shoutout to everyone listening with headphones in — this one's especially for you.",
      'Night shift workers, late studiers, insomniacs — I see all of you. This next one is yours.',
      'Someone told me this playlist got them through a tough week. I believe it. Keep going.',
      'For everyone who found their way here tonight — good call.',
    ],
  },
  {
    type: 'session_checkin',
    lines: [
      "Still with me? Good. We've got more.",
      "We're deep into this session now. The playlist has earned your attention — keep giving it.",
      "You've been here a while. So have I. Neither of us is leaving yet.",
      'This is what a good session feels like. Settle in.',
      'Some sessions just hit right. This is one of them.',
    ],
  },
  {
    type: 'sign_off',
    lines: [
      "That's a wrap. Good session — you picked well. I'll be here when you're ready for another one.",
      "And that's the end of this one. Go do something good with that energy.",
      'We made it through. Same time tomorrow?',
      'Good music, good company. Until next time — take care of yourself out there.',
      "That's all I've got for now. You know where to find me.",
    ],
  },
];

const recentlyUsed: string[] = [];
const MAX_RECENT = 5;

export function getFallbackLine(type: SegmentType, vibe?: Vibe): string {
  // Find entries matching type and optionally vibe
  let candidates = fallbacks.filter(
    (f) => f.type === type && (f.vibe === vibe || !f.vibe)
  );

  if (candidates.length === 0) {
    candidates = fallbacks.filter((f) => f.type === type);
  }

  const allLines = candidates.flatMap((c) => c.lines);
  const available = allLines.filter((l) => !recentlyUsed.includes(l));
  const pool = available.length > 0 ? available : allLines;

  const line = pool[Math.floor(Math.random() * pool.length)];

  recentlyUsed.push(line);
  if (recentlyUsed.length > MAX_RECENT) {
    recentlyUsed.shift();
  }

  return line;
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/cleo/static-core.ts src/cleo/fallbacks.ts
git commit -m "feat: add Cleo static core prompt and fallback segment library"
```

---

### Task 6: Build CleoScriptGenerator client service

**Files:**
- Create: `src/services/CleoScriptGenerator.ts`
- Create: `src/services/api.ts`

**Step 1: Create the API base URL config**

`src/services/api.ts`:
```typescript
// In development, point to the local backend server.
// For production (Railway), replace with the deployed URL.
export const API_BASE_URL = __DEV__
  ? 'http://192.168.8.105:3001'
  : 'https://your-railway-app.up.railway.app';
```

Note: Use the Mac's local IP (not localhost) so the physical device can reach it.

**Step 2: Create CleoScriptGenerator**

`src/services/CleoScriptGenerator.ts`:
```typescript
import { CLEO_STATIC_CORE } from '../cleo/static-core';
import { getFallbackLine, type SegmentType, type Vibe } from '../cleo/fallbacks';
import { API_BASE_URL } from './api';

export interface SegmentContext {
  segmentType: SegmentType;
  vibe: Vibe;
  currentTrack: {
    title: string;
    artistName: string;
    albumTitle?: string;
    genre?: string;
  };
  nextTrack?: {
    title: string;
    artistName: string;
    genre?: string;
  };
  sessionDurationMinutes?: number;
  segmentHistory?: string[];
  listenerName?: string;
}

const TIMEOUT_MS = 3500;

function buildDynamicPrompt(context: SegmentContext): string {
  const timeOfDay = getTimeOfDay();
  const vibeLabel = {
    morning: 'Morning Drive',
    chill: 'Chill',
    workout: 'Workout',
    lateNight: 'Late Night',
    party: 'Party',
  }[context.vibe];

  let prompt = `CURRENT SESSION CONTEXT
- Session vibe: ${vibeLabel}
- Time of day: ${timeOfDay}
- Session duration: ${context.sessionDurationMinutes ?? 0} minutes in`;

  if (context.listenerName) {
    prompt += `\n- Listener name: ${context.listenerName}`;
  }

  prompt += `\n\nCURRENT TRACK
- Title: ${context.currentTrack.title}
- Artist: ${context.currentTrack.artistName}`;

  if (context.currentTrack.albumTitle) {
    prompt += `\n- Album: ${context.currentTrack.albumTitle}`;
  }
  if (context.currentTrack.genre) {
    prompt += `  |  Genre: ${context.currentTrack.genre}`;
  }

  if (context.nextTrack) {
    prompt += `\n\nNEXT TRACK
- Title: ${context.nextTrack.title}  |  Artist: ${context.nextTrack.artistName}`;
    if (context.nextTrack.genre) {
      prompt += `  |  Genre: ${context.nextTrack.genre}`;
    }
  }

  if (context.segmentHistory && context.segmentHistory.length > 0) {
    prompt += '\n\nSEGMENT HISTORY (last 3 — do not repeat these structures)';
    context.segmentHistory.slice(0, 3).forEach((seg, i) => {
      prompt += `\n${i + 1}. ${seg}`;
    });
  }

  prompt += `\n\nSEGMENT TYPE: ${context.segmentType}

OUTPUT RULES
- 40 to 75 words maximum.
- Plain text only. No quotes, no stage directions, no labels.
- Do not include the segment type name in your response.`;

  return prompt;
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Late Night';
}

export async function generateSegment(context: SegmentContext): Promise<string> {
  const userPrompt = buildDynamicPrompt(context);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${API_BASE_URL}/generate-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: CLEO_STATIC_CORE,
        userPrompt,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    if (data.text && data.text.length > 0) {
      return data.text;
    }

    throw new Error('Empty response');
  } catch (error) {
    console.warn('Segment generation failed, using fallback:', error);
    return getFallbackLine(context.segmentType, context.vibe);
  }
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/services/api.ts src/services/CleoScriptGenerator.ts
git commit -m "feat: add CleoScriptGenerator with Gemini integration and 3500ms timeout fallback"
```

---

### Task 7: Build CleoVoiceEngine client service

**Files:**
- Create: `src/services/CleoVoiceEngine.ts`

**Step 1: Reinstall expo-av**

The previous version was incompatible. Try installing the SDK 55 compatible version:

```bash
npx expo install expo-av
```

If it still has the `EXEventEmitter.h` build error, we'll use native audio playback through our ExpoMusicKit module instead.

**Step 2: Create CleoVoiceEngine**

`src/services/CleoVoiceEngine.ts`:
```typescript
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { API_BASE_URL } from './api';

export async function synthesizeAndPlay(text: string): Promise<void> {
  try {
    // Request TTS from backend
    const response = await fetch(`${API_BASE_URL}/synthesize-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`TTS error: ${response.status}`);
    }

    const data = await response.json();
    const base64Audio = data.audioContent;

    if (!base64Audio) {
      throw new Error('No audio content returned');
    }

    // Write base64 audio to a temp file
    const fileUri = `${FileSystem.cacheDirectory}cleo-speech-${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Configure audio session
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });

    // Play the audio
    const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
    await sound.playAsync();

    // Wait for playback to finish, then clean up
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        FileSystem.deleteAsync(fileUri, { idempotent: true });
      }
    });
  } catch (error) {
    console.error('Voice playback failed:', error);
  }
}
```

Note: This uses `expo-av` and `expo-file-system`. If `expo-av` has build issues, we will create a native audio playback function in our ExpoMusicKit module instead.

**Step 3: Install expo-file-system if not already present**

```bash
npx expo install expo-file-system
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/services/CleoVoiceEngine.ts
git commit -m "feat: add CleoVoiceEngine with TTS synthesis and audio playback"
```

---

### Task 8: Add a test button to HomeScreen and verify the milestone

**Files:**
- Modify: `src/screens/home/HomeScreen.tsx`

**Step 1: Add a "Test Cleo" button to HomeScreen**

Add a temporary button that triggers script generation + voice playback using the currently playing track's info. This proves the full pipeline: App → Backend → Gemini → Backend → Google TTS → Device Speaker.

Add to HomeScreen, below the Now Playing section:
```typescript
import { generateSegment } from '../../services/CleoScriptGenerator';
import { synthesizeAndPlay } from '../../services/CleoVoiceEngine';

// Inside the component, add a test handler:
const handleTestCleo = async () => {
  const nowPlayingInfo = nowPlaying;
  if (!nowPlayingInfo) return;

  const script = await generateSegment({
    segmentType: 'song_intro',
    vibe: 'chill',
    currentTrack: {
      title: nowPlayingInfo.title,
      artistName: nowPlayingInfo.artistName,
    },
  });

  console.log('Cleo says:', script);
  await synthesizeAndPlay(script);
};

// Add the button in the JSX after the Now Playing section:
<Pressable style={styles.testButton} onPress={handleTestCleo}>
  <Text style={styles.testButtonText}>TEST CLEO</Text>
</Pressable>
```

Add styles:
```typescript
testButton: {
  backgroundColor: Colors.accent,
  paddingVertical: Spacing.sm,
  paddingHorizontal: Spacing.lg,
  alignSelf: 'center',
  marginBottom: Spacing.lg,
},
testButtonText: {
  fontFamily: Typography.mono.family,
  fontSize: 12,
  color: Colors.base.white,
  letterSpacing: 2,
},
```

**Step 2: Test the full pipeline**

1. Start the backend: `cd server && npm run dev`
2. Rebuild the app on device (native rebuild needed if expo-av was added)
3. Play a song via Apple Music
4. Tap "TEST CLEO"
5. Expected: Cleo speaks an intro for the current song through the device speaker

**Step 3: Commit**

```bash
git add src/screens/home/HomeScreen.tsx
git commit -m "feat: add test button for Cleo voice pipeline (Phase 3 milestone)"
```

---

## Milestone Verification

Phase 3 is complete when:

- [ ] Backend server runs locally with all 5 routes
- [ ] `/generate-segment` returns Cleo script text from Gemini
- [ ] `/synthesize-voice` returns base64 audio from Google Cloud TTS
- [ ] Tapping "TEST CLEO" on device generates a script and speaks it
- [ ] Fallback fires when backend is unreachable (airplane mode test)
- [ ] HeyGen and Genius routes respond (even if not fully tested yet)

# Pre-Baked Broadcast — Plan 1: Server Batch Orchestrator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side broadcast bake pipeline — new endpoints that take `{ playlistId, vibe, length, userContext }` and return a manifest + segment audio URLs. Testable entirely via curl, no client changes.

**Architecture:** New `services/broadcast/` subsystem that orchestrates track selection (`QueuePlanner` lifted server-side), segment prompt construction (`SegmentScriptBuilder`), and per-segment LLM + TTS generation via existing provider factories. Segments written to object storage (local filesystem in dev, S3-compatible in production). Sync phase returns manifest + first segment audio; async phase generates remaining segments in parallel while client is already playing.

**Tech Stack:** Express 4.21, TypeScript, Zod validation, Jest + ts-jest (new for server), existing LLM/TTS provider factories, local filesystem storage adapter for dev.

**Spec:** `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md` (sections: Server architecture, Runtime architecture)

---

## File Structure

**Create:**
- `server/src/services/broadcast/types.ts` — `Manifest`, `SegmentSlot`, `Broadcast`, `BroadcastCreateRequest` types
- `server/src/services/broadcast/QueuePlanner.ts` — lifted from `src/engines/QueuePlanner.ts`, picks ordered tracks from playlist for vibe/length
- `server/src/services/broadcast/SegmentScriptBuilder.ts` — builds LLM prompts for each segment slot (lifted from `src/engines/SegmentController.ts` + `src/cleo/static-core.ts`)
- `server/src/services/broadcast/SegmentGenerator.ts` — single-segment pipeline: prompt → LLM → TTS → audio bytes
- `server/src/services/broadcast/ManifestBuilder.ts` — assembles manifest (tracks + segment slots) for a broadcast
- `server/src/services/broadcast/BroadcastOrchestrator.ts` — public entry point; sync phase + async phase
- `server/src/services/broadcast/BroadcastStore.ts` — in-memory state for in-flight bakes
- `server/src/services/storage/ObjectStorage.ts` — interface + local filesystem adapter
- `server/src/routes/broadcast.ts` — `POST /broadcast/create`, `GET /broadcast/:id/segment/:n`, `GET /broadcast/:id/manifest`
- `server/__tests__/broadcast/ManifestBuilder.test.ts`
- `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`
- `server/__tests__/broadcast/BroadcastOrchestrator.test.ts`
- `server/__tests__/routes/broadcast.test.ts`
- `server/jest.config.js`
- `server/__mocks__/llm.ts`
- `server/__mocks__/tts.ts`

**Modify:**
- `server/src/index.ts` — wire `broadcastRouter` with `requireAuth` + `generationLimiter`
- `server/package.json` — add `jest`, `ts-jest`, `supertest`, `@types/jest`, `@types/supertest`; add `test` script

---

## Types reference (used across tasks)

```typescript
// server/src/services/broadcast/types.ts
export type Vibe =
  | 'morning' | 'chill' | 'workout' | 'lateNight' | 'party'
  | 'general' | 'focus' | 'feelGood' | 'throwback' | 'elevated'
  | 'melancholy' | 'sunday';

export type BroadcastLength = 'quick' | 'standard' | 'long';

export type SegmentSlotKind =
  | 'cold_open'
  | 'transition'      // between two tracks
  | 'sign_off';

export interface SegmentSlot {
  index: number;
  kind: SegmentSlotKind;
  beforeTrackId?: string;   // track this segment precedes (undefined for sign_off)
  afterTrackId?: string;    // track this segment follows (undefined for cold_open)
  variantCount: number;     // how many script/TTS variants to bake (1 for most, 2-3 for cold_open)
  status: 'pending' | 'ready' | 'failed';
  audioUrls?: string[];     // one URL per variant, populated when status === 'ready'
}

export interface ManifestTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  artworkUrl?: string;
}

export interface Manifest {
  broadcastId: string;
  userId: string;
  playlistId: string | null;   // null for ONAY-curated
  vibe: Vibe;
  length: BroadcastLength;
  createdAt: number;
  tracks: ManifestTrack[];
  segmentSlots: SegmentSlot[];
}

export interface BroadcastCreateRequest {
  playlistId: string;
  vibe: Vibe;
  length: BroadcastLength;
  userContext: {
    lastSessionSummary?: string;
    tracksRecentlyPlayed?: string[];
    timeOfDay: string;        // "20:47"
    dayOfWeek: string;        // "Thursday"
    firstTimeUser: boolean;
    listenerName?: string;
  };
  // Track pool provided by client (client fetches from MusicKit, server does not have Apple Music API)
  tracks: ManifestTrack[];
}

export interface BroadcastCreateResponse {
  manifest: Manifest;
  firstSegmentUrls: string[]; // first segment variant URLs, ready to play immediately
}
```

---

## Task 1: Set up Jest for server

**Files:**
- Create: `server/jest.config.js`
- Modify: `server/package.json`
- Create: `server/__mocks__/llm.ts`
- Create: `server/__mocks__/tts.ts`

- [ ] **Step 1: Install test dependencies**

```bash
cd server && npm install --save-dev jest ts-jest @types/jest supertest @types/supertest
```

- [ ] **Step 2: Create Jest config**

```javascript
// server/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  clearMocks: true,
};
```

- [ ] **Step 3: Create test setup + mock stubs**

```typescript
// server/__tests__/setup.ts
process.env.GEMINI_API_KEY = 'test-gemini';
process.env.CARTESIA_API_KEY = 'test-cartesia';
process.env.ELEVENLABS_API_KEY = 'test-eleven';
process.env.ELEVENLABS_VOICE_ID = 'test-voice';
process.env.FIREBASE_PROJECT_ID = 'test-project';
```

```typescript
// server/__mocks__/llm.ts
import type { LLMProvider } from '@/providers/llm/types';

export const makeMockLLM = (response: string = 'Mock script.'): LLMProvider => ({
  name: 'mock-llm',
  generate: jest.fn(async () => ({ text: response })),
  healthCheck: jest.fn(async () => true),
});
```

```typescript
// server/__mocks__/tts.ts
import type { TTSProvider } from '@/providers/tts/types';

export const makeMockTTS = (audioBase64: string = 'TU9DSw=='): TTSProvider => ({
  name: 'mock-tts',
  synthesize: jest.fn(async () => ({ audioContent: audioBase64 })),
  healthCheck: jest.fn(async () => true),
});
```

- [ ] **Step 4: Add test script + smoke test**

Edit `server/package.json` scripts:
```json
"test": "jest",
"test:watch": "jest --watch"
```

Create `server/__tests__/smoke.test.ts`:
```typescript
describe('jest setup', () => {
  it('runs', () => expect(1 + 1).toBe(2));
});
```

Run: `cd server && npm test`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add server/jest.config.js server/__tests__/setup.ts server/__tests__/smoke.test.ts server/__mocks__/ server/package.json server/package-lock.json
git commit -m "chore(server): set up jest + ts-jest for broadcast pipeline tests"
```

---

## Task 2: Define broadcast types

**Files:**
- Create: `server/src/services/broadcast/types.ts`

- [ ] **Step 1: Write the types file**

Copy the full types block from the "Types reference" section above into `server/src/services/broadcast/types.ts`.

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/broadcast/types.ts
git commit -m "feat(server): add broadcast domain types"
```

---

## Task 3: ManifestBuilder — track selection + segment slot layout

**Files:**
- Create: `server/src/services/broadcast/ManifestBuilder.ts`
- Create: `server/__tests__/broadcast/ManifestBuilder.test.ts`

**Design:** For MVP, track selection is deterministic: take the first N tracks from the supplied pool where N matches the length bucket (quick=5, standard=9, long=15). Segment slots are fixed: `[cold_open] → (track_0) → [transition] → (track_1) → [transition] → ... → (track_N-1) → [sign_off]`. So N tracks → N+1 segment slots. Cold open has variantCount=3; transitions and sign_off have variantCount=1.

AI-driven reordering (the lifted `QueuePlanner`) comes in a later task. MVP locks in the structure first.

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/broadcast/ManifestBuilder.test.ts
import { buildManifest } from '@/services/broadcast/ManifestBuilder';
import type { ManifestTrack } from '@/services/broadcast/types';

const t = (id: string): ManifestTrack => ({
  id, title: `Title ${id}`, artistName: `Artist ${id}`,
  albumTitle: `Album ${id}`, duration: 210,
});

describe('buildManifest', () => {
  const tracks = Array.from({ length: 20 }, (_, i) => t(String(i)));

  it('picks 5 tracks for quick length', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.tracks).toHaveLength(5);
  });

  it('picks 9 tracks for standard length', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'standard', tracks,
    });
    expect(m.tracks).toHaveLength(9);
  });

  it('picks 15 tracks for long length', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'long', tracks,
    });
    expect(m.tracks).toHaveLength(15);
  });

  it('produces N+1 segment slots for N tracks', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots).toHaveLength(6);
  });

  it('produces cold_open first, sign_off last, transitions between', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].kind).toBe('cold_open');
    expect(m.segmentSlots[m.segmentSlots.length - 1].kind).toBe('sign_off');
    for (let i = 1; i < m.segmentSlots.length - 1; i++) {
      expect(m.segmentSlots[i].kind).toBe('transition');
    }
  });

  it('wires afterTrackId/beforeTrackId correctly', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].beforeTrackId).toBe('0');     // cold open precedes track 0
    expect(m.segmentSlots[0].afterTrackId).toBeUndefined();
    expect(m.segmentSlots[1].afterTrackId).toBe('0');       // transition after track 0
    expect(m.segmentSlots[1].beforeTrackId).toBe('1');      // and before track 1
    expect(m.segmentSlots[5].kind).toBe('sign_off');
    expect(m.segmentSlots[5].afterTrackId).toBe('4');       // sign-off after last track
    expect(m.segmentSlots[5].beforeTrackId).toBeUndefined();
  });

  it('cold_open has variantCount 3; others 1', () => {
    const m = buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks,
    });
    expect(m.segmentSlots[0].variantCount).toBe(3);
    for (let i = 1; i < m.segmentSlots.length; i++) {
      expect(m.segmentSlots[i].variantCount).toBe(1);
    }
  });

  it('throws if pool has fewer tracks than length requires', () => {
    const tooFew = Array.from({ length: 4 }, (_, i) => t(String(i)));
    expect(() => buildManifest({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', tracks: tooFew,
    })).toThrow('insufficient tracks');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest broadcast/ManifestBuilder`
Expected: fails with "Cannot find module '@/services/broadcast/ManifestBuilder'"

- [ ] **Step 3: Implement ManifestBuilder**

```typescript
// server/src/services/broadcast/ManifestBuilder.ts
import { randomUUID } from 'crypto';
import type {
  Manifest, ManifestTrack, SegmentSlot, Vibe, BroadcastLength,
} from './types';

const LENGTH_TO_TRACK_COUNT: Record<BroadcastLength, number> = {
  quick: 5,
  standard: 9,
  long: 15,
};

export function buildManifest(input: {
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  tracks: ManifestTrack[];
}): Manifest {
  const trackCount = LENGTH_TO_TRACK_COUNT[input.length];
  if (input.tracks.length < trackCount) {
    throw new Error(`insufficient tracks: need ${trackCount}, got ${input.tracks.length}`);
  }

  const tracks = input.tracks.slice(0, trackCount);
  const segmentSlots: SegmentSlot[] = [];

  // cold_open before track 0
  segmentSlots.push({
    index: 0,
    kind: 'cold_open',
    beforeTrackId: tracks[0].id,
    afterTrackId: undefined,
    variantCount: 3,
    status: 'pending',
  });

  // transitions between consecutive tracks
  for (let i = 0; i < tracks.length - 1; i++) {
    segmentSlots.push({
      index: segmentSlots.length,
      kind: 'transition',
      afterTrackId: tracks[i].id,
      beforeTrackId: tracks[i + 1].id,
      variantCount: 1,
      status: 'pending',
    });
  }

  // sign_off after last track
  segmentSlots.push({
    index: segmentSlots.length,
    kind: 'sign_off',
    afterTrackId: tracks[tracks.length - 1].id,
    beforeTrackId: undefined,
    variantCount: 1,
    status: 'pending',
  });

  return {
    broadcastId: randomUUID(),
    userId: input.userId,
    playlistId: input.playlistId,
    vibe: input.vibe,
    length: input.length,
    createdAt: Date.now(),
    tracks,
    segmentSlots,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest broadcast/ManifestBuilder`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/ManifestBuilder.ts server/__tests__/broadcast/ManifestBuilder.test.ts
git commit -m "feat(server): add ManifestBuilder with deterministic track + slot layout"
```

---

## Task 4: SegmentScriptBuilder — compose LLM prompts per slot

**Files:**
- Create: `server/src/services/broadcast/SegmentScriptBuilder.ts`
- Create: `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`

**Design:** For each slot + context, returns `{ systemPrompt, userPrompt, maxTokens }` compatible with existing `/generate-segment` LLM contract. Three prompt shapes: `cold_open`, `transition`, `sign_off`. Uses the existing prompt style already in `src/cleo/static-core.ts` and `src/engines/SegmentController.ts` — copy the core instructions, adapt for pre-bake context (ONAY knows the full manifest at bake time, so prompts can reference upcoming tracks explicitly).

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/broadcast/SegmentScriptBuilder.test.ts
import { buildSegmentPrompts } from '@/services/broadcast/SegmentScriptBuilder';
import type { Manifest } from '@/services/broadcast/types';

const makeManifest = (): Manifest => ({
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'lateNight', length: 'quick', createdAt: Date.now(),
  tracks: [
    { id: 't0', title: 'Nikes', artistName: 'Frank Ocean', albumTitle: 'Blonde', duration: 314 },
    { id: 't1', title: 'Pyramids', artistName: 'Frank Ocean', albumTitle: 'Channel Orange', duration: 600 },
    { id: 't2', title: 'Redbone', artistName: 'Childish Gambino', albumTitle: 'Awaken, My Love!', duration: 306 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
    { index: 1, kind: 'transition', afterTrackId: 't0', beforeTrackId: 't1', variantCount: 1, status: 'pending' },
    { index: 2, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2', variantCount: 1, status: 'pending' },
    { index: 3, kind: 'sign_off', afterTrackId: 't2', variantCount: 1, status: 'pending' },
  ],
});

const ctx = {
  timeOfDay: '20:47', dayOfWeek: 'Thursday', firstTimeUser: false,
  lastSessionSummary: 'left off with Kendrick',
  tracksRecentlyPlayed: [], listenerName: 'Kari',
};

describe('buildSegmentPrompts', () => {
  it('returns variantCount prompt sets for cold_open', () => {
    const m = makeManifest();
    const prompts = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompts).toHaveLength(3);
  });

  it('references the first track in cold_open user prompt', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompt.userPrompt).toContain('Nikes');
    expect(prompt.userPrompt).toContain('Frank Ocean');
  });

  it('mentions day/time in cold_open to enable "live" feel', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompt.userPrompt).toContain('Thursday');
    expect(prompt.userPrompt).toContain('20:47');
  });

  it('references both outgoing and incoming tracks in transition', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[1], m, ctx);
    expect(prompt.userPrompt).toContain('Nikes');
    expect(prompt.userPrompt).toContain('Pyramids');
  });

  it('references the last track in sign_off', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[3], m, ctx);
    expect(prompt.userPrompt).toContain('Redbone');
  });

  it('returns exactly 1 variant for transition and sign_off', () => {
    const m = makeManifest();
    expect(buildSegmentPrompts(m.segmentSlots[1], m, ctx)).toHaveLength(1);
    expect(buildSegmentPrompts(m.segmentSlots[3], m, ctx)).toHaveLength(1);
  });

  it('includes the vibe in system prompt', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompt.systemPrompt.toLowerCase()).toContain('late');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest broadcast/SegmentScriptBuilder`
Expected: module-not-found.

- [ ] **Step 3: Implement SegmentScriptBuilder**

```typescript
// server/src/services/broadcast/SegmentScriptBuilder.ts
import type { Manifest, SegmentSlot, Vibe, ManifestTrack } from './types';

export interface SegmentContext {
  timeOfDay: string;
  dayOfWeek: string;
  firstTimeUser: boolean;
  lastSessionSummary?: string;
  tracksRecentlyPlayed?: string[];
  listenerName?: string;
}

export interface PromptSet {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

const VIBE_DESCRIPTIONS: Record<Vibe, string> = {
  morning: 'morning, warm, bright, gently energizing',
  chill: 'chill, relaxed, unhurried, easygoing',
  workout: 'workout, pumped, driving, high-energy',
  lateNight: 'late-night, intimate, moody, introspective',
  party: 'party, celebratory, high-spirited, dance-floor energy',
  general: 'balanced, conversational, eclectic',
  focus: 'focus, minimal, calm, concentration-friendly',
  feelGood: 'feel-good, uplifting, affirming',
  throwback: 'throwback, nostalgic, warm, era-evoking',
  elevated: 'elevated, sophisticated, refined',
  melancholy: 'melancholy, bittersweet, reflective',
  sunday: 'Sunday, laid-back, slow-burn, unhurried',
};

function systemPrompt(vibe: Vibe): string {
  return `You are ONAY, an AI radio host. You speak with warmth, wit, and the easy authority of a seasoned DJ. Your voice is ${VIBE_DESCRIPTIONS[vibe]}.

Rules:
- Speak as ONAY, in the first person. Never narrate as if describing a scene.
- No stage directions, no bracketed cues, no emoji.
- No meta references ("as an AI", "in this segment"). You ARE the host.
- Use curly quotes (" ") for quoted phrases.
- Em-dashes are welcome for pacing.
- Keep within the word budget. Radio segments are tight.
- End on a beat that hands cleanly to the next track.`;
}

function trackRef(t: ManifestTrack): string {
  return `"${t.title}" by ${t.artistName}`;
}

function findTrack(m: Manifest, id?: string): ManifestTrack | undefined {
  return m.tracks.find(t => t.id === id);
}

export function buildSegmentPrompts(
  slot: SegmentSlot,
  manifest: Manifest,
  ctx: SegmentContext,
): PromptSet[] {
  const vibe = manifest.vibe;
  const sys = systemPrompt(vibe);

  if (slot.kind === 'cold_open') {
    const first = findTrack(manifest, slot.beforeTrackId)!;
    const variants: string[] = [];

    const base = [
      `It's ${ctx.dayOfWeek}, ${ctx.timeOfDay}.`,
      ctx.listenerName ? `Your listener's name is ${ctx.listenerName}.` : '',
      ctx.firstTimeUser
        ? 'This is their very first broadcast — welcome them without being saccharine.'
        : ctx.lastSessionSummary
          ? `They're coming back — last time: ${ctx.lastSessionSummary}.`
          : 'They are a returning listener.',
      `Opening the broadcast with ${trackRef(first)}.`,
    ].filter(Boolean).join(' ');

    const angles = [
      'Lead with the time — paint the vibe, then name the track.',
      'Lead with a question or observation about the mood — then slide into the first track.',
      'Lead with a story fragment or a line you just couldn\'t shake today — then hand to the track.',
    ];

    for (const angle of angles.slice(0, slot.variantCount)) {
      variants.push(`${base}\n\nAngle: ${angle}\n\nWrite ONAY's cold open. 40-55 words. Land on the track name so the music can come in.`);
    }

    return variants.map(userPrompt => ({
      systemPrompt: sys,
      userPrompt,
      maxTokens: 512,
    }));
  }

  if (slot.kind === 'transition') {
    const outgoing = findTrack(manifest, slot.afterTrackId)!;
    const incoming = findTrack(manifest, slot.beforeTrackId)!;
    const userPrompt =
      `Transitioning out of ${trackRef(outgoing)} into ${trackRef(incoming)}. ` +
      `Write ONAY's bridge. 25-40 words. A connection — a musical reference, a mood link, a memory, a counterpoint. ` +
      `End by naming the incoming track so the music can come in.`;
    return [{ systemPrompt: sys, userPrompt, maxTokens: 384 }];
  }

  // sign_off
  const closing = findTrack(manifest, slot.afterTrackId)!;
  const userPrompt =
    `Closing the broadcast. The final track was ${trackRef(closing)}. ` +
    `Write ONAY's sign-off. 30-45 words. Reference the closer. Send the listener off with warmth. ` +
    `Optional: tease the idea of coming back for another broadcast.`;
  return [{ systemPrompt: sys, userPrompt, maxTokens: 384 }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest broadcast/SegmentScriptBuilder`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/SegmentScriptBuilder.ts server/__tests__/broadcast/SegmentScriptBuilder.test.ts
git commit -m "feat(server): add SegmentScriptBuilder for cold_open/transition/sign_off prompts"
```

---

## Task 5: ObjectStorage — local filesystem adapter

**Files:**
- Create: `server/src/services/storage/ObjectStorage.ts`
- Create: `server/__tests__/storage/ObjectStorage.test.ts`

**Design:** Interface + local filesystem adapter. Stores bytes, returns a URL the client can GET. In dev, files go under `server/.broadcast-cache/` and URLs are `http://localhost:3001/broadcast-asset/<key>` served by a new static route (added in Task 10). S3 adapter is a later concern.

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/storage/ObjectStorage.test.ts
import { LocalFilesystemStorage } from '@/services/storage/ObjectStorage';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('LocalFilesystemStorage', () => {
  let root: string;
  let storage: LocalFilesystemStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'broadcast-test-'));
    storage = new LocalFilesystemStorage(root, 'http://localhost:3001/broadcast-asset');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes bytes and returns a URL', async () => {
    const url = await storage.put('bcast/1/seg/0/v0.mp3', Buffer.from([0x49, 0x44, 0x33]));
    expect(url).toBe('http://localhost:3001/broadcast-asset/bcast/1/seg/0/v0.mp3');
  });

  it('round-trips bytes via getAbsolutePath', async () => {
    const payload = Buffer.from('hello world');
    await storage.put('k.txt', payload);
    const abs = storage.getAbsolutePath('k.txt');
    const read = await fs.readFile(abs);
    expect(read.equals(payload)).toBe(true);
  });

  it('creates subdirectories as needed', async () => {
    await storage.put('deep/nested/key.mp3', Buffer.from([0]));
    const abs = storage.getAbsolutePath('deep/nested/key.mp3');
    const stat = await fs.stat(abs);
    expect(stat.isFile()).toBe(true);
  });

  it('rejects keys that escape the root', async () => {
    await expect(storage.put('../evil.mp3', Buffer.from([0]))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest storage/ObjectStorage`
Expected: module-not-found.

- [ ] **Step 3: Implement LocalFilesystemStorage**

```typescript
// server/src/services/storage/ObjectStorage.ts
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ObjectStorage {
  put(key: string, bytes: Buffer): Promise<string>; // returns URL
  getAbsolutePath(key: string): string;             // for static serving
}

export class LocalFilesystemStorage implements ObjectStorage {
  constructor(private readonly root: string, private readonly baseUrl: string) {}

  async put(key: string, bytes: Buffer): Promise<string> {
    const abs = this.getAbsolutePath(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, bytes);
    return `${this.baseUrl}/${key}`;
  }

  getAbsolutePath(key: string): string {
    const resolvedRoot = path.resolve(this.root);
    const resolvedKey = path.resolve(resolvedRoot, key);
    if (!resolvedKey.startsWith(resolvedRoot + path.sep) && resolvedKey !== resolvedRoot) {
      throw new Error('key escapes storage root');
    }
    return resolvedKey;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest storage/ObjectStorage`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/storage/ObjectStorage.ts server/__tests__/storage/ObjectStorage.test.ts
git commit -m "feat(server): add LocalFilesystemStorage adapter"
```

---

## Task 6: SegmentGenerator — prompt → LLM → TTS → stored audio URL

**Files:**
- Create: `server/src/services/broadcast/SegmentGenerator.ts`
- Create: `server/__tests__/broadcast/SegmentGenerator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/broadcast/SegmentGenerator.test.ts
import { SegmentGenerator } from '@/services/broadcast/SegmentGenerator';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';

const makeStorage = (): ObjectStorage & { puts: Array<[string, Buffer]> } => {
  const puts: Array<[string, Buffer]> = [];
  return {
    puts,
    put: jest.fn(async (key: string, bytes: Buffer) => {
      puts.push([key, bytes]);
      return `https://cdn/${key}`;
    }),
    getAbsolutePath: jest.fn(),
  };
};

describe('SegmentGenerator.generateVariants', () => {
  it('calls LLM then TTS for each prompt and stores bytes', async () => {
    const llm = makeMockLLM('Hello listeners.');
    const tts = makeMockTTS('QUJD'); // base64 for "ABC"
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    const urls = await gen.generateVariants({
      broadcastId: 'b1',
      slotIndex: 0,
      prompts: [
        { systemPrompt: 's', userPrompt: 'u1', maxTokens: 256 },
        { systemPrompt: 's', userPrompt: 'u2', maxTokens: 256 },
      ],
    });

    expect(urls).toHaveLength(2);
    expect(llm.generate).toHaveBeenCalledTimes(2);
    expect(tts.synthesize).toHaveBeenCalledTimes(2);
    expect(storage.puts).toHaveLength(2);
    expect(storage.puts[0][0]).toBe('broadcast/b1/segment/0/v0.mp3');
    expect(storage.puts[1][0]).toBe('broadcast/b1/segment/0/v1.mp3');
  });

  it('decodes base64 audio into Buffer before storing', async () => {
    const llm = makeMockLLM();
    const tts = makeMockTTS('QUJD'); // "ABC"
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await gen.generateVariants({
      broadcastId: 'b', slotIndex: 2,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    });

    expect(storage.puts[0][1].toString('utf8')).toBe('ABC');
  });

  it('propagates LLM errors', async () => {
    const llm = makeMockLLM();
    (llm.generate as jest.Mock).mockRejectedValueOnce(new Error('llm down'));
    const tts = makeMockTTS();
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await expect(gen.generateVariants({
      broadcastId: 'b', slotIndex: 0,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    })).rejects.toThrow('llm down');
  });

  it('propagates TTS errors', async () => {
    const llm = makeMockLLM();
    const tts = makeMockTTS();
    (tts.synthesize as jest.Mock).mockRejectedValueOnce(new Error('tts down'));
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await expect(gen.generateVariants({
      broadcastId: 'b', slotIndex: 0,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    })).rejects.toThrow('tts down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest broadcast/SegmentGenerator`
Expected: module-not-found.

- [ ] **Step 3: Implement SegmentGenerator**

```typescript
// server/src/services/broadcast/SegmentGenerator.ts
import type { LLMProvider } from '../../providers/llm/types';
import type { TTSProvider } from '../../providers/tts/types';
import type { ObjectStorage } from '../storage/ObjectStorage';
import type { PromptSet } from './SegmentScriptBuilder';

export class SegmentGenerator {
  constructor(
    private readonly llm: LLMProvider,
    private readonly tts: TTSProvider,
    private readonly storage: ObjectStorage,
  ) {}

  async generateVariants(input: {
    broadcastId: string;
    slotIndex: number;
    prompts: PromptSet[];
  }): Promise<string[]> {
    const urls: string[] = [];
    for (let v = 0; v < input.prompts.length; v++) {
      const prompt = input.prompts[v];
      const scriptResult = await this.llm.generate({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        maxTokens: prompt.maxTokens,
      });
      const ttsResult = await this.tts.synthesize({ text: scriptResult.text });
      const key = `broadcast/${input.broadcastId}/segment/${input.slotIndex}/v${v}.mp3`;
      const bytes = Buffer.from(ttsResult.audioContent, 'base64');
      const url = await this.storage.put(key, bytes);
      urls.push(url);
    }
    return urls;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest broadcast/SegmentGenerator`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/SegmentGenerator.ts server/__tests__/broadcast/SegmentGenerator.test.ts
git commit -m "feat(server): add SegmentGenerator (prompt -> LLM -> TTS -> storage URL)"
```

---

## Task 7: BroadcastStore — in-memory state for in-flight bakes

**Files:**
- Create: `server/src/services/broadcast/BroadcastStore.ts`
- Create: `server/__tests__/broadcast/BroadcastStore.test.ts`

**Design:** In-memory Map keyed by `broadcastId`. Stores the manifest and tracks per-slot status transitions (`pending` → `ready` | `failed`). Eviction: entries older than 2h are purged on access. No persistence across restarts (MVP). Retrieval returns a defensive copy so callers can't mutate store state.

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/broadcast/BroadcastStore.test.ts
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import type { Manifest } from '@/services/broadcast/types';

const baseManifest = (): Manifest => ({
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
    { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
  ],
});

describe('BroadcastStore', () => {
  it('stores and retrieves a manifest', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    store.put(m);
    expect(store.get('b1')).toEqual(m);
  });

  it('returns undefined for unknown ids', () => {
    const store = new BroadcastStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('updates a slot with audio URLs and marks it ready', () => {
    const store = new BroadcastStore();
    store.put(baseManifest());
    store.updateSlot('b1', 0, { status: 'ready', audioUrls: ['u0', 'u1', 'u2'] });
    const m = store.get('b1')!;
    expect(m.segmentSlots[0].status).toBe('ready');
    expect(m.segmentSlots[0].audioUrls).toEqual(['u0', 'u1', 'u2']);
  });

  it('marks a slot as failed', () => {
    const store = new BroadcastStore();
    store.put(baseManifest());
    store.updateSlot('b1', 1, { status: 'failed' });
    expect(store.get('b1')!.segmentSlots[1].status).toBe('failed');
  });

  it('returns defensive copies (caller mutations do not leak)', () => {
    const store = new BroadcastStore();
    store.put(baseManifest());
    const m = store.get('b1')!;
    m.segmentSlots[0].status = 'ready';
    expect(store.get('b1')!.segmentSlots[0].status).toBe('pending');
  });

  it('evicts entries older than 2h on access', () => {
    const store = new BroadcastStore();
    const m = baseManifest();
    m.createdAt = Date.now() - (2 * 60 * 60 * 1000 + 1000);
    store.put(m);
    expect(store.get('b1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest broadcast/BroadcastStore`
Expected: module-not-found.

- [ ] **Step 3: Implement BroadcastStore**

```typescript
// server/src/services/broadcast/BroadcastStore.ts
import type { Manifest, SegmentSlot } from './types';

const TTL_MS = 2 * 60 * 60 * 1000;

export class BroadcastStore {
  private readonly entries = new Map<string, Manifest>();

  put(manifest: Manifest): void {
    this.entries.set(manifest.broadcastId, structuredClone(manifest));
  }

  get(id: string): Manifest | undefined {
    const m = this.entries.get(id);
    if (!m) return undefined;
    if (Date.now() - m.createdAt > TTL_MS) {
      this.entries.delete(id);
      return undefined;
    }
    return structuredClone(m);
  }

  updateSlot(
    id: string,
    slotIndex: number,
    patch: Partial<Pick<SegmentSlot, 'status' | 'audioUrls'>>,
  ): void {
    const m = this.entries.get(id);
    if (!m) throw new Error(`broadcast not found: ${id}`);
    const slot = m.segmentSlots[slotIndex];
    if (!slot) throw new Error(`slot ${slotIndex} not found`);
    Object.assign(slot, patch);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest broadcast/BroadcastStore`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/BroadcastStore.ts server/__tests__/broadcast/BroadcastStore.test.ts
git commit -m "feat(server): add in-memory BroadcastStore with 2h TTL"
```

---

## Task 8: BroadcastOrchestrator — sync phase + async phase

**Files:**
- Create: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Create: `server/__tests__/broadcast/BroadcastOrchestrator.test.ts`

**Design:** The `create()` method does the full synchronous phase (build manifest, generate slot 0, return) and schedules the async phase (`Promise.all` over remaining slots). Async failures update store state but do not reject the returned promise — the client handles missing segments via the fallback in the spec.

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/broadcast/BroadcastOrchestrator.test.ts
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import type { ManifestTrack } from '@/services/broadcast/types';

const makeStorage = (): ObjectStorage => ({
  put: jest.fn(async (key: string) => `https://cdn/${key}`),
  getAbsolutePath: jest.fn(),
});

const tracks = (n: number): ManifestTrack[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Title ${i}`, artistName: `Artist ${i}`,
    albumTitle: `Album ${i}`, duration: 200,
  }));

const ctx = {
  timeOfDay: '20:47', dayOfWeek: 'Thursday', firstTimeUser: false,
};

describe('BroadcastOrchestrator.create', () => {
  it('returns manifest + first segment URLs synchronously', async () => {
    const orch = new BroadcastOrchestrator(
      makeMockLLM(), makeMockTTS(), makeStorage(), new BroadcastStore(),
    );
    const result = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    expect(result.manifest.segmentSlots).toHaveLength(6); // 5 tracks + cold_open + sign_off + 4 transitions = 5+1+1+4 = wait
    // 5 tracks → cold_open, 4 transitions, sign_off = 6 slots
    expect(result.firstSegmentUrls).toHaveLength(3); // cold_open has 3 variants
    expect(result.firstSegmentUrls[0]).toMatch(/^https:\/\/cdn\/broadcast\/.+\/segment\/0\/v0\.mp3$/);
  });

  it('marks first slot ready in the store immediately', async () => {
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(), makeMockTTS(), makeStorage(), store,
    );
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });
    const stored = store.get(manifest.broadcastId)!;
    expect(stored.segmentSlots[0].status).toBe('ready');
    expect(stored.segmentSlots[0].audioUrls).toHaveLength(3);
  });

  it('schedules async generation of remaining slots', async () => {
    const llm = makeMockLLM();
    const tts = makeMockTTS();
    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(llm, tts, makeStorage(), store);

    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });

    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    for (const slot of final.segmentSlots) {
      expect(slot.status).toBe('ready');
    }
    // 3 for cold_open + 1 each for 4 transitions + 1 for sign_off = 8 LLM calls
    expect(llm.generate).toHaveBeenCalledTimes(8);
  });

  it('marks individual slots as failed on provider errors without rejecting create()', async () => {
    const llm = makeMockLLM();
    // fail the 5th call (one of the transitions)
    (llm.generate as jest.Mock).mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => ({ text: 'ok' }))
      .mockImplementationOnce(async () => { throw new Error('llm exploded'); })
      .mockImplementation(async () => ({ text: 'ok' }));

    const store = new BroadcastStore();
    const orch = new BroadcastOrchestrator(llm, makeMockTTS(), makeStorage(), store);
    const { manifest } = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning',
      length: 'quick', userContext: ctx, tracks: tracks(10),
    });

    await orch.waitForCompletion(manifest.broadcastId);

    const final = store.get(manifest.broadcastId)!;
    const failed = final.segmentSlots.filter(s => s.status === 'failed');
    expect(failed.length).toBe(1);
    expect(final.segmentSlots[0].status).toBe('ready'); // cold_open still succeeded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest broadcast/BroadcastOrchestrator`
Expected: module-not-found.

- [ ] **Step 3: Implement BroadcastOrchestrator**

```typescript
// server/src/services/broadcast/BroadcastOrchestrator.ts
import type { LLMProvider } from '../../providers/llm/types';
import type { TTSProvider } from '../../providers/tts/types';
import type { ObjectStorage } from '../storage/ObjectStorage';
import { buildManifest } from './ManifestBuilder';
import { buildSegmentPrompts, type SegmentContext } from './SegmentScriptBuilder';
import { SegmentGenerator } from './SegmentGenerator';
import type {
  BroadcastCreateRequest, BroadcastCreateResponse, Manifest,
} from './types';
import { BroadcastStore } from './BroadcastStore';

export class BroadcastOrchestrator {
  private readonly generator: SegmentGenerator;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    llm: LLMProvider,
    tts: TTSProvider,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
  ) {
    this.generator = new SegmentGenerator(llm, tts, storage);
  }

  async create(
    input: BroadcastCreateRequest & { userId: string },
  ): Promise<BroadcastCreateResponse> {
    const manifest = buildManifest({
      userId: input.userId,
      playlistId: input.playlistId,
      vibe: input.vibe,
      length: input.length,
      tracks: input.tracks,
    });
    this.store.put(manifest);

    // Sync phase: generate slot 0 (cold_open) now.
    const firstUrls = await this.generateSlot(manifest, 0, input.userContext);

    // Async phase: generate all remaining slots in parallel.
    const remaining = Promise.allSettled(
      manifest.segmentSlots.slice(1).map(slot =>
        this.generateSlot(manifest, slot.index, input.userContext),
      ),
    ).then(() => undefined);

    this.inFlight.set(manifest.broadcastId, remaining);

    return {
      manifest: this.store.get(manifest.broadcastId)!,
      firstSegmentUrls: firstUrls,
    };
  }

  /** Test helper: await async phase completion. */
  async waitForCompletion(broadcastId: string): Promise<void> {
    const p = this.inFlight.get(broadcastId);
    if (p) await p;
  }

  private async generateSlot(
    manifest: Manifest,
    slotIndex: number,
    ctx: SegmentContext,
  ): Promise<string[]> {
    const slot = manifest.segmentSlots[slotIndex];
    try {
      const prompts = buildSegmentPrompts(slot, manifest, ctx);
      const urls = await this.generator.generateVariants({
        broadcastId: manifest.broadcastId,
        slotIndex,
        prompts,
      });
      this.store.updateSlot(manifest.broadcastId, slotIndex, {
        status: 'ready',
        audioUrls: urls,
      });
      return urls;
    } catch (err) {
      this.store.updateSlot(manifest.broadcastId, slotIndex, { status: 'failed' });
      if (slotIndex === 0) throw err; // sync phase failure bubbles to client
      // async-phase failures are swallowed — slot is marked failed, client handles it
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest broadcast/BroadcastOrchestrator`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts server/__tests__/broadcast/BroadcastOrchestrator.test.ts
git commit -m "feat(server): add BroadcastOrchestrator coordinating sync + async bake phases"
```

---

## Task 9: HTTP routes — `POST /broadcast/create`, `GET /broadcast/:id/manifest`

**Files:**
- Create: `server/src/routes/broadcast.ts`
- Create: `server/__tests__/routes/broadcast.test.ts`

**Design:** Zod-validated request body. `POST /broadcast/create` calls `orchestrator.create()` with `req.uid` as `userId` and returns `{ manifest, firstSegmentUrls }`. `GET /broadcast/:id/manifest` returns the current stored manifest (clients poll this to see which slots have become ready). Segment audio itself is served as static files in Task 10.

The orchestrator is injected via a factory function so the route module can be tested in isolation with mocks.

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/routes/broadcast.test.ts
import express from 'express';
import request from 'supertest';
import { createBroadcastRouter } from '@/routes/broadcast';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ManifestTrack } from '@/services/broadcast/types';

const makeStorage = () => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

const tracks = (n: number): ManifestTrack[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Title ${i}`, artistName: `Artist ${i}`,
    albumTitle: 'Album', duration: 200,
  }));

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as any).uid = uid; next(); };

const buildApp = (orch: BroadcastOrchestrator, store: BroadcastStore) => {
  const app = express();
  app.use(express.json());
  app.use(authStub('uid-123'));
  app.use(createBroadcastRouter(orch, store));
  return app;
};

describe('broadcast router', () => {
  let orch: BroadcastOrchestrator;
  let store: BroadcastStore;

  beforeEach(() => {
    store = new BroadcastStore();
    orch = new BroadcastOrchestrator(makeMockLLM(), makeMockTTS(), makeStorage(), store);
  });

  it('POST /broadcast/create returns manifest + firstSegmentUrls', async () => {
    const app = buildApp(orch, store);
    const res = await request(app)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(10),
      });

    expect(res.status).toBe(200);
    expect(res.body.manifest.broadcastId).toBeDefined();
    expect(res.body.manifest.userId).toBe('uid-123');
    expect(res.body.firstSegmentUrls).toHaveLength(3);
  });

  it('POST /broadcast/create 400s on invalid body', async () => {
    const app = buildApp(orch, store);
    const res = await request(app)
      .post('/broadcast/create')
      .send({ playlistId: 'p1' /* missing fields */ });
    expect(res.status).toBe(400);
  });

  it('POST /broadcast/create 400s on insufficient tracks', async () => {
    const app = buildApp(orch, store);
    const res = await request(app)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(3), // need 5
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient tracks/);
  });

  it('GET /broadcast/:id/manifest returns the live manifest', async () => {
    const app = buildApp(orch, store);
    const create = await request(app)
      .post('/broadcast/create')
      .send({
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '20:47', dayOfWeek: 'Thu', firstTimeUser: false },
        tracks: tracks(10),
      });
    const id = create.body.manifest.broadcastId;

    const res = await request(app).get(`/broadcast/${id}/manifest`);
    expect(res.status).toBe(200);
    expect(res.body.broadcastId).toBe(id);
  });

  it('GET /broadcast/:id/manifest returns 404 for unknown id', async () => {
    const app = buildApp(orch, store);
    const res = await request(app).get('/broadcast/nope/manifest');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest routes/broadcast`
Expected: module-not-found.

- [ ] **Step 3: Implement broadcast router**

```typescript
// server/src/routes/broadcast.ts
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { BroadcastOrchestrator } from '../services/broadcast/BroadcastOrchestrator';
import type { BroadcastStore } from '../services/broadcast/BroadcastStore';

const vibeSchema = z.enum([
  'morning', 'chill', 'workout', 'lateNight', 'party',
  'general', 'focus', 'feelGood', 'throwback', 'elevated',
  'melancholy', 'sunday',
]);

const lengthSchema = z.enum(['quick', 'standard', 'long']);

const trackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artistName: z.string().min(1),
  albumTitle: z.string(),
  duration: z.number().positive(),
  artworkUrl: z.string().url().optional(),
});

const contextSchema = z.object({
  timeOfDay: z.string(),
  dayOfWeek: z.string(),
  firstTimeUser: z.boolean(),
  lastSessionSummary: z.string().max(500).optional(),
  tracksRecentlyPlayed: z.array(z.string()).max(50).optional(),
  listenerName: z.string().max(50).optional(),
});

const createSchema = z.object({
  playlistId: z.string().min(1),
  vibe: vibeSchema,
  length: lengthSchema,
  userContext: contextSchema,
  tracks: z.array(trackSchema).min(5).max(100),
});

interface AuthenticatedRequest extends Request {
  uid?: string;
}

export function createBroadcastRouter(
  orch: BroadcastOrchestrator,
  store: BroadcastStore,
): Router {
  const router = Router();

  router.post('/broadcast/create', async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    if (!req.uid) return res.status(401).json({ error: 'unauthenticated' });

    try {
      const result = await orch.create({ ...parsed.data, userId: req.uid });
      return res.json(result);
    } catch (err: any) {
      const msg = err?.message ?? 'bake failed';
      const status = /insufficient tracks/i.test(msg) ? 400 : 500;
      return res.status(status).json({ error: msg });
    }
  });

  router.get('/broadcast/:id/manifest', (req, res) => {
    const manifest = store.get(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'not found' });
    return res.json(manifest);
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest routes/broadcast`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/broadcast.ts server/__tests__/routes/broadcast.test.ts
git commit -m "feat(server): add POST /broadcast/create and GET /broadcast/:id/manifest"
```

---

## Task 10: Wire broadcast router + static asset serving into Express app

**Files:**
- Modify: `server/src/index.ts`

**Design:** Add three things to `index.ts`:
1. Instantiate `LocalFilesystemStorage` at `<project>/server/.broadcast-cache/`
2. Instantiate `BroadcastStore` + `BroadcastOrchestrator` (using the existing `llmProvider` + `ttsProvider` singletons)
3. Mount `createBroadcastRouter()` protected by `requireAuth` + `generationLimiter`
4. Add a static handler at `/broadcast-asset/*` that serves files from the cache dir — protected by `requireAuth` (signed URLs are a later concern; for dev, auth is enough)

- [ ] **Step 1: Read current `server/src/index.ts`**

Run: `cd server && cat src/index.ts`

Verify these already exist:
- `llmProvider` singleton (or factory)
- `ttsProvider` singleton (or factory)
- `requireAuth` middleware import
- `generationLimiter` middleware
- Route registration pattern

If the provider singletons aren't already top-level values, note the actual names used and substitute them into the code below.

- [ ] **Step 2: Add broadcast subsystem wiring**

Add near the top of `server/src/index.ts` (after other imports):

```typescript
import * as path from 'path';
import { LocalFilesystemStorage } from './services/storage/ObjectStorage';
import { BroadcastStore } from './services/broadcast/BroadcastStore';
import { BroadcastOrchestrator } from './services/broadcast/BroadcastOrchestrator';
import { createBroadcastRouter } from './routes/broadcast';
```

After existing provider setup (find where `llmProvider` / `ttsProvider` are created), add:

```typescript
const broadcastCacheDir = path.resolve(__dirname, '../.broadcast-cache');
const broadcastStorage = new LocalFilesystemStorage(
  broadcastCacheDir,
  `${process.env.BROADCAST_ASSET_BASE_URL ?? 'http://localhost:3001'}/broadcast-asset`,
);
const broadcastStore = new BroadcastStore();
const broadcastOrchestrator = new BroadcastOrchestrator(
  llmProvider, ttsProvider, broadcastStorage, broadcastStore,
);
```

After existing protected routes are mounted, add:

```typescript
// Broadcast routes — auth + generation rate limit
app.use(requireAuth, generationLimiter, createBroadcastRouter(broadcastOrchestrator, broadcastStore));

// Static asset serving for broadcast audio (dev only — production uses S3 signed URLs)
app.use('/broadcast-asset', requireAuth, (req, res, next) => {
  try {
    const abs = broadcastStorage.getAbsolutePath(req.path.replace(/^\/+/, ''));
    res.sendFile(abs, (err) => { if (err) next(err); });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'invalid asset path' });
  }
});
```

- [ ] **Step 3: Add `.broadcast-cache/` to `.gitignore`**

```bash
cd server && echo '.broadcast-cache/' >> .gitignore
```

- [ ] **Step 4: Build and smoke-test**

```bash
cd server && npx tsc --noEmit
cd server && npm run dev  # background this in another terminal
```

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/.gitignore
git commit -m "feat(server): wire broadcast router + static asset serving"
```

---

## Task 11: End-to-end curl smoke test

**Files:** (no changes — manual verification)

**Design:** Confirm the pipeline works end-to-end before declaring Plan 1 done. Uses real LLM + TTS providers (or the mocks configured in `.env` for local dev).

- [ ] **Step 1: Start server**

```bash
cd server && npm run dev
```

- [ ] **Step 2: Get a Firebase ID token**

From the running mobile app (logged-in user), log `await auth().currentUser?.getIdToken()` to console — copy the token.

Alternatively, use an existing token from a recent curl call in your shell history.

Export it: `export ONAY_TOKEN="<token>"`

- [ ] **Step 3: POST /broadcast/create**

```bash
curl -X POST http://localhost:3001/broadcast/create \
  -H "Authorization: Bearer $ONAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "playlistId": "test-playlist",
    "vibe": "lateNight",
    "length": "quick",
    "userContext": {
      "timeOfDay": "20:47",
      "dayOfWeek": "Thursday",
      "firstTimeUser": false,
      "listenerName": "Kari"
    },
    "tracks": [
      {"id":"t0","title":"Nikes","artistName":"Frank Ocean","albumTitle":"Blonde","duration":314},
      {"id":"t1","title":"Pyramids","artistName":"Frank Ocean","albumTitle":"Channel Orange","duration":600},
      {"id":"t2","title":"Redbone","artistName":"Childish Gambino","albumTitle":"Awaken, My Love!","duration":306},
      {"id":"t3","title":"Passionfruit","artistName":"Drake","albumTitle":"More Life","duration":298},
      {"id":"t4","title":"Hotline Bling","artistName":"Drake","albumTitle":"Views","duration":267}
    ]
  }' | jq .
```

Expected output:
- `200 OK`
- JSON with `manifest.broadcastId`, `manifest.tracks` (5 items), `manifest.segmentSlots` (6 items)
- `firstSegmentUrls` (3 items) pointing to `http://localhost:3001/broadcast-asset/broadcast/<id>/segment/0/v*.mp3`

- [ ] **Step 4: Fetch first segment audio**

```bash
curl -H "Authorization: Bearer $ONAY_TOKEN" \
  "http://localhost:3001/broadcast-asset/broadcast/<id>/segment/0/v0.mp3" \
  -o /tmp/v0.mp3

file /tmp/v0.mp3
```

Expected: `Audio file with ID3 ...` or `MPEG ADTS, layer III ...`. Play it: `afplay /tmp/v0.mp3` — should hear ONAY's cold open.

- [ ] **Step 5: Poll manifest to watch async phase progress**

```bash
curl -H "Authorization: Bearer $ONAY_TOKEN" \
  "http://localhost:3001/broadcast/<id>/manifest" | jq '.segmentSlots[] | {index, kind, status}'
```

Repeat over ~20-30s. Expected progression:
- Initial: slot 0 `ready`, slots 1-5 `pending`
- Eventually: all 6 slots `ready`

- [ ] **Step 6: Verify all segment audio files exist and play**

```bash
for i in 1 2 3 4 5; do
  curl -sH "Authorization: Bearer $ONAY_TOKEN" \
    "http://localhost:3001/broadcast-asset/broadcast/<id>/segment/$i/v0.mp3" \
    -o "/tmp/seg-$i.mp3"
  file "/tmp/seg-$i.mp3"
done
```

All should be valid MP3s.

- [ ] **Step 7: Tag the end of Plan 1**

```bash
git tag -a plan-1-server-complete -m "Plan 1 complete: server broadcast pipeline working end-to-end via curl"
```

---

## Self-review

**Spec coverage:**
- ✅ `POST /broadcast/create` — Task 9
- ✅ `GET /broadcast/:id/manifest` — Task 9 (replaces individual `/segment/:n` endpoint — manifest already contains URLs)
- ✅ Sync phase returns first segment — Task 8
- ✅ Async phase parallel-generates rest — Task 8
- ✅ Object storage — Task 5
- ✅ 2-3 cold_open variants — Task 3, 4
- ✅ LLM + TTS provider reuse — Task 6 (uses existing factories via Task 10 wiring)
- ✅ Per-segment failure handling — Task 8 (marks slot `failed`, doesn't abort session)
- ✅ Curated broadcasts share pipeline — deferred to Plan 3 (out of scope here)
- ⚠️  AI-driven track reordering (lifted `QueuePlanner`) — deferred. MVP uses deterministic first-N selection. Upgrade path is to replace `buildManifest`'s track-picking step with a call into a lifted planner.
- ⚠️  Signed URLs for S3 production — deferred. Dev uses authed static serve.
- ⚠️  SSE / polling for segment readiness — manifest-polling in Task 11 Step 5 is the MVP. Client polls every 2-3s during playback.

**No placeholders:** every task has concrete code. No TBD/TODO in the plan.

**Type consistency:** `Manifest`, `SegmentSlot`, `ManifestTrack`, `PromptSet`, `SegmentContext` types are consistent across Tasks 2-9.

**Scope:** plan produces working, testable software end-to-end via curl. Plans 2-4 are blocked on this plan completing but don't need it polished beyond Task 11.

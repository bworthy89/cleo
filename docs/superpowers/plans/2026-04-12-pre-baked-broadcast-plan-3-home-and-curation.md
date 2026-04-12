# Pre-Baked Broadcast — Plan 3: Home Screen + Setup Flow + ONAY-Curated Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing home screen with the new two-stack layout (Featured Broadcasts + Your Broadcast setup), add the "tuning in" animation, and ship the ONAY-curated editorial pipeline so pre-baked broadcasts appear on the home screen for all users.

**Architecture:** Home screen becomes the entry point into the new broadcast flow. Two sources of content: (a) user-sourced broadcasts created on demand via Plan 1's `/broadcast/create`, (b) ONAY-curated broadcasts baked by a server-side editorial job and listed via a new `GET /broadcast/featured` endpoint. The setup flow is a 3-step sheet: playlist picker → vibe picker → length picker. A resume-after-terminate flow checks persisted manifests on app launch.

**Tech Stack:** React Native 0.83 + Expo SDK 55, existing design tokens, Reanimated for tuning-in animation, Express + new routes + scheduled job on server.

**Spec:** `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md` (sections: Product shape, Faking "live")

**Depends on:** Plans 1 and 2 complete.

---

## File Structure

**Create — client:**
- `src/screens/home/HomeBroadcastScreen.tsx` — new two-stack home screen
- `src/components/broadcast/FeaturedBroadcastCard.tsx` — editorial card for curated broadcasts
- `src/components/broadcast/YourBroadcastSetup.tsx` — setup entry point + sheet
- `src/components/broadcast/SetupSheet.tsx` — 3-step bottom sheet (playlist → vibe → length)
- `src/components/broadcast/TuningInOverlay.tsx` — animated "tuning in" screen shown while first segment bakes
- `src/engines/BroadcastCurationClient.ts` — HTTP client for `GET /broadcast/featured`
- `src/engines/BroadcastResumer.ts` — checks persisted manifest on launch, prompts resume
- `__tests__/engines/BroadcastCurationClient.test.ts`
- `__tests__/engines/BroadcastResumer.test.ts`
- `__tests__/components/SetupSheet.test.tsx`

**Create — server:**
- `server/src/services/broadcast/FeaturedBroadcastRegistry.ts` — in-memory + JSON-file-backed registry of curated broadcasts
- `server/src/services/broadcast/bakeFeatured.ts` — CLI job: takes a config JSON, bakes a broadcast with ONAY-curated track list, persists to registry
- `server/src/routes/featured.ts` — `GET /broadcast/featured`
- `server/scripts/bake-featured.ts` — CLI entry point for running `bakeFeatured`
- `server/featured-broadcasts/` — JSON config files + baked output metadata (gitignored for output, tracked for config)
- `server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts`
- `server/__tests__/broadcast/bakeFeatured.test.ts`
- `server/__tests__/routes/featured.test.ts`

**Modify:**
- `app/(main)/(broadcast)/index.tsx` — replace existing `HomeScreenRedesign` import with `HomeBroadcastScreen` (behind flag — see Task 1)
- `app/_layout.tsx` — call `BroadcastResumer.checkOnLaunch()` after auth ready
- `server/src/index.ts` — wire `createFeaturedRouter`
- `server/.gitignore` — ignore baked featured output

---

## Task 1: Feature flag for new home screen

**Files:**
- Create: `src/config/flags.ts`
- Modify: `app/(main)/(broadcast)/index.tsx`

**Design:** One local flag to toggle between old and new home screens. Flag value is a const for now; can be swapped for remote config later.

- [ ] **Step 1: Create flags file**

```typescript
// src/config/flags.ts
export const FLAGS = {
  /** Use the new pre-baked broadcast home screen instead of HomeScreenRedesign. */
  broadcastHome: false,
} as const;
```

- [ ] **Step 2: Branch the home route**

Read `app/(main)/(broadcast)/index.tsx`, then update it to conditionally render:

```tsx
import { FLAGS } from '@/config/flags';
import HomeScreenRedesign from '@/screens/home/HomeScreenRedesign';
import HomeBroadcastScreen from '@/screens/home/HomeBroadcastScreen';

export default function HomeRoute() {
  return FLAGS.broadcastHome ? <HomeBroadcastScreen /> : <HomeScreenRedesign />;
}
```

Stub `HomeBroadcastScreen` so this compiles:

```tsx
// src/screens/home/HomeBroadcastScreen.tsx
import { View, Text } from 'react-native';
import { Colors } from '@/tokens/design-tokens';
export default function HomeBroadcastScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, padding: 24 }}>
      <Text style={{ color: Colors.textPrimary }}>HomeBroadcastScreen (stub)</Text>
    </View>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/config/flags.ts src/screens/home/HomeBroadcastScreen.tsx app/\(main\)/\(broadcast\)/index.tsx
git commit -m "feat(home): scaffold HomeBroadcastScreen behind feature flag"
```

---

## Task 2: Server-side FeaturedBroadcastRegistry

**Files:**
- Create: `server/src/services/broadcast/FeaturedBroadcastRegistry.ts`
- Create: `server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts`

**Design:** Persists a list of featured broadcast records to a JSON file. Each record: `{ id, title, description, vibe, length, artworkUrl, manifest, baked: true | false, createdAt }`. `list()` returns only fully-baked records. `put()` writes through to disk. No database needed for MVP.

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts
import { FeaturedBroadcastRegistry, type FeaturedBroadcast } from '@/services/broadcast/FeaturedBroadcastRegistry';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FeaturedBroadcastRegistry', () => {
  let dir: string;
  let reg: FeaturedBroadcastRegistry;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'featured-'));
    reg = new FeaturedBroadcastRegistry(path.join(dir, 'registry.json'));
    await reg.load();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const mk = (id: string, baked: boolean): FeaturedBroadcast => ({
    id, title: `T ${id}`, description: 'D', vibe: 'morning', length: 'quick',
    baked, createdAt: Date.now(),
    manifest: { broadcastId: id, userId: 'curator', playlistId: null,
      vibe: 'morning', length: 'quick', createdAt: Date.now(),
      tracks: [], segmentSlots: [] },
  });

  it('starts empty', async () => {
    expect(reg.list()).toEqual([]);
  });

  it('put + list returns baked records only', async () => {
    await reg.put(mk('a', true));
    await reg.put(mk('b', false));
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('persists across load cycles', async () => {
    await reg.put(mk('x', true));

    const reg2 = new FeaturedBroadcastRegistry(path.join(dir, 'registry.json'));
    await reg2.load();
    expect(reg2.list()).toHaveLength(1);
    expect(reg2.list()[0].id).toBe('x');
  });

  it('remove deletes a record', async () => {
    await reg.put(mk('a', true));
    await reg.remove('a');
    expect(reg.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest FeaturedBroadcastRegistry`
Expected: module-not-found.

- [ ] **Step 3: Implement registry**

```typescript
// server/src/services/broadcast/FeaturedBroadcastRegistry.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Manifest } from './types';

export interface FeaturedBroadcast {
  id: string;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
}

interface Snapshot { records: FeaturedBroadcast[] }

export class FeaturedBroadcastRegistry {
  private records: FeaturedBroadcast[] = [];

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Snapshot;
      this.records = parsed.records ?? [];
    } catch (err: any) {
      if (err?.code === 'ENOENT') { this.records = []; return; }
      throw err;
    }
  }

  async put(record: FeaturedBroadcast): Promise<void> {
    const idx = this.records.findIndex(r => r.id === record.id);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
    await this.save();
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter(r => r.id !== id);
    await this.save();
  }

  list(): FeaturedBroadcast[] {
    return this.records.filter(r => r.baked).map(r => ({ ...r }));
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ records: this.records }, null, 2));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest FeaturedBroadcastRegistry`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/FeaturedBroadcastRegistry.ts server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts
git commit -m "feat(server): add FeaturedBroadcastRegistry with JSON file persistence"
```

---

## Task 3: bakeFeatured — editorial bake job

**Files:**
- Create: `server/src/services/broadcast/bakeFeatured.ts`
- Create: `server/scripts/bake-featured.ts`
- Create: `server/__tests__/broadcast/bakeFeatured.test.ts`
- Create: `server/featured-broadcasts/late-night-soul.json` (config example)
- Modify: `server/.gitignore`

**Design:** An editorial config file specifies:
```json
{
  "id": "late-night-soul",
  "title": "Late Night Soul",
  "description": "Slow burners and velvet grooves for after the lights go down.",
  "vibe": "lateNight",
  "length": "standard",
  "curatorListenerName": "tonight's listener",
  "tracks": [
    { "id": "1234", "title": "Pyramids", "artistName": "Frank Ocean", "albumTitle": "Channel Orange", "duration": 600 },
    ...
  ]
}
```

`bakeFeatured(configPath)` loads the config, calls `BroadcastOrchestrator.create()` with `userId: 'curator'` and `playlistId: null`, waits for all slots to complete (uses the orchestrator's `waitForCompletion` helper), and writes the baked record into the registry.

Real Apple Music track IDs come from a manual curation process by the editorial team — they're static per featured broadcast. Because the server can't fetch Apple Music metadata on its own, the config file contains the full track data.

- [ ] **Step 1: Write a config example**

```json
// server/featured-broadcasts/late-night-soul.json
{
  "id": "late-night-soul",
  "title": "Late Night Soul",
  "description": "Slow burners and velvet grooves for after the lights go down.",
  "vibe": "lateNight",
  "length": "quick",
  "artworkUrl": "https://example.com/art/late-night-soul.jpg",
  "curatorListenerName": "tonight's listener",
  "tracks": [
    { "id": "1001", "title": "Pyramids", "artistName": "Frank Ocean", "albumTitle": "Channel Orange", "duration": 600 },
    { "id": "1002", "title": "Nikes", "artistName": "Frank Ocean", "albumTitle": "Blonde", "duration": 314 },
    { "id": "1003", "title": "Redbone", "artistName": "Childish Gambino", "albumTitle": "Awaken, My Love!", "duration": 306 },
    { "id": "1004", "title": "Passionfruit", "artistName": "Drake", "albumTitle": "More Life", "duration": 298 },
    { "id": "1005", "title": "Cranes in the Sky", "artistName": "Solange", "albumTitle": "A Seat at the Table", "duration": 251 }
  ]
}
```

Real track IDs must be substituted before first bake. This file stays in git as an example.

- [ ] **Step 2: Write the failing test**

```typescript
// server/__tests__/broadcast/bakeFeatured.test.ts
import { bakeFeatured } from '@/services/broadcast/bakeFeatured';
import { FeaturedBroadcastRegistry } from '@/services/broadcast/FeaturedBroadcastRegistry';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const makeStorage = () => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

describe('bakeFeatured', () => {
  let tmp: string;
  let regPath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bake-'));
    regPath = path.join(tmp, 'registry.json');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('bakes a featured broadcast and stores it in the registry', async () => {
    const configPath = path.join(tmp, 'c.json');
    await fs.writeFile(configPath, JSON.stringify({
      id: 'c1', title: 'Cozy', description: 'D', vibe: 'morning', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`, title: `T${i}`, artistName: 'A', albumTitle: 'AL', duration: 200,
      })),
    }));

    const reg = new FeaturedBroadcastRegistry(regPath);
    await reg.load();
    const orch = new BroadcastOrchestrator(
      makeMockLLM(), makeMockTTS(), makeStorage(), new BroadcastStore(),
    );

    await bakeFeatured({ configPath, orchestrator: orch, registry: reg });

    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c1');
    expect(list[0].baked).toBe(true);
    expect(list[0].manifest.segmentSlots.every(s => s.status === 'ready')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx jest bakeFeatured`
Expected: module-not-found.

- [ ] **Step 4: Implement bakeFeatured**

```typescript
// server/src/services/broadcast/bakeFeatured.ts
import * as fs from 'fs/promises';
import type { BroadcastOrchestrator } from './BroadcastOrchestrator';
import type { FeaturedBroadcastRegistry, FeaturedBroadcast } from './FeaturedBroadcastRegistry';
import type { Manifest, ManifestTrack } from './types';

interface FeaturedConfig {
  id: string;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  curatorListenerName?: string;
  tracks: ManifestTrack[];
}

export async function bakeFeatured(input: {
  configPath: string;
  orchestrator: BroadcastOrchestrator;
  registry: FeaturedBroadcastRegistry;
}): Promise<FeaturedBroadcast> {
  const raw = await fs.readFile(input.configPath, 'utf8');
  const config = JSON.parse(raw) as FeaturedConfig;

  // Mark as not-yet-baked until we complete
  const placeholder: FeaturedBroadcast = {
    id: config.id,
    title: config.title,
    description: config.description,
    vibe: config.vibe,
    length: config.length,
    artworkUrl: config.artworkUrl,
    baked: false,
    createdAt: Date.now(),
    manifest: null as any,
  };
  // Don't persist the not-yet-baked placeholder — list() filters it anyway,
  // but storing incomplete records clutters the file. Bake first, then persist.

  const { manifest } = await input.orchestrator.create({
    userId: 'curator',
    playlistId: null as unknown as string, // orchestrator already accepts null via the types
    vibe: config.vibe,
    length: config.length,
    tracks: config.tracks,
    userContext: {
      timeOfDay: '12:00',
      dayOfWeek: '',
      firstTimeUser: false,
      listenerName: config.curatorListenerName,
    },
  });

  await input.orchestrator.waitForCompletion(manifest.broadcastId);

  const record: FeaturedBroadcast = {
    ...placeholder,
    baked: true,
    manifest,
  };
  await input.registry.put(record);
  return record;
}
```

Note: `BroadcastOrchestrator.create()` accepts `playlistId: string`. To support curated broadcasts with no underlying playlist, update its type:

Open `server/src/services/broadcast/types.ts`:

```typescript
// Change:
export interface BroadcastCreateRequest {
  playlistId: string;
  // ...
}
// To:
export interface BroadcastCreateRequest {
  playlistId: string | null;
  // ...
}
```

And in `ManifestBuilder.buildManifest`, the `playlistId` input is already typed `string | null` — confirmed no change needed.

Run: `cd server && npx tsc --noEmit`
Fix any type errors. The request schema in `routes/broadcast.ts` should remain `z.string().min(1)` — user-sourced broadcasts require a real playlistId. Only the internal orchestrator accepts `null`.

- [ ] **Step 5: Create CLI script**

```typescript
// server/scripts/bake-featured.ts
import 'dotenv/config';
import * as path from 'path';
import { LocalFilesystemStorage } from '../src/services/storage/ObjectStorage';
import { BroadcastStore } from '../src/services/broadcast/BroadcastStore';
import { BroadcastOrchestrator } from '../src/services/broadcast/BroadcastOrchestrator';
import { FeaturedBroadcastRegistry } from '../src/services/broadcast/FeaturedBroadcastRegistry';
import { bakeFeatured } from '../src/services/broadcast/bakeFeatured';
// Import providers — path depends on your repo layout; follow the same pattern as src/index.ts:
import { llmProvider, ttsProvider } from '../src/providers';

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('usage: tsx scripts/bake-featured.ts <config.json>');
    process.exit(1);
  }
  const resolvedConfig = path.resolve(configPath);

  const storage = new LocalFilesystemStorage(
    path.resolve(__dirname, '../.broadcast-cache'),
    `${process.env.BROADCAST_ASSET_BASE_URL ?? 'http://localhost:3001'}/broadcast-asset`,
  );
  const store = new BroadcastStore();
  const orch = new BroadcastOrchestrator(llmProvider, ttsProvider, storage, store);

  const registry = new FeaturedBroadcastRegistry(
    path.resolve(__dirname, '../featured-broadcasts/registry.json'),
  );
  await registry.load();

  console.log(`Baking featured broadcast from ${resolvedConfig}...`);
  const record = await bakeFeatured({ configPath: resolvedConfig, orchestrator: orch, registry });
  console.log(`Done. Baked ${record.id} with ${record.manifest.segmentSlots.length} segments.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

If the providers aren't re-exported from a common location, read `server/src/index.ts` to confirm how they're initialized and either export them from a new `src/providers/index.ts` or inline the initialization in the script.

Add to `server/package.json` scripts:
```json
"bake-featured": "tsx scripts/bake-featured.ts"
```

- [ ] **Step 6: Add .gitignore entry for output**

Append to `server/.gitignore`:
```
featured-broadcasts/registry.json
```

Config files in `server/featured-broadcasts/*.json` remain tracked; only the output registry is ignored.

- [ ] **Step 7: Run test**

Run: `cd server && npx jest bakeFeatured`
Expected: test passes.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/broadcast/bakeFeatured.ts server/__tests__/broadcast/bakeFeatured.test.ts server/scripts/bake-featured.ts server/featured-broadcasts/late-night-soul.json server/.gitignore server/src/services/broadcast/types.ts server/package.json
git commit -m "feat(server): add bakeFeatured CLI + example config for editorial broadcasts"
```

---

## Task 4: `GET /broadcast/featured` route

**Files:**
- Create: `server/src/routes/featured.ts`
- Create: `server/__tests__/routes/featured.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/routes/featured.test.ts
import express from 'express';
import request from 'supertest';
import { createFeaturedRouter } from '@/routes/featured';
import { FeaturedBroadcastRegistry } from '@/services/broadcast/FeaturedBroadcastRegistry';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as any).uid = uid; next(); };

describe('featured router', () => {
  let reg: FeaturedBroadcastRegistry;
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'featured-'));
    reg = new FeaturedBroadcastRegistry(path.join(dir, 'registry.json'));
    await reg.load();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use(authStub('u1'));
    app.use(createFeaturedRouter(reg));
    return app;
  };

  it('returns an empty array when nothing is baked', async () => {
    const res = await request(buildApp()).get('/broadcast/featured');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ broadcasts: [] });
  });

  it('returns baked featured broadcasts in list form', async () => {
    await reg.put({
      id: 'a', title: 'A', description: 'd', vibe: 'morning', length: 'quick',
      baked: true, createdAt: 1,
      manifest: { broadcastId: 'a', userId: 'curator', playlistId: null,
        vibe: 'morning', length: 'quick', createdAt: 1, tracks: [], segmentSlots: [] },
    });
    const res = await request(buildApp()).get('/broadcast/featured');
    expect(res.status).toBe(200);
    expect(res.body.broadcasts).toHaveLength(1);
    expect(res.body.broadcasts[0]).toEqual(expect.objectContaining({
      id: 'a', title: 'A', manifest: expect.any(Object),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest routes/featured`
Expected: module-not-found.

- [ ] **Step 3: Implement router**

```typescript
// server/src/routes/featured.ts
import { Router } from 'express';
import type { FeaturedBroadcastRegistry } from '../services/broadcast/FeaturedBroadcastRegistry';

export function createFeaturedRouter(registry: FeaturedBroadcastRegistry): Router {
  const router = Router();
  router.get('/broadcast/featured', (_req, res) => {
    res.json({ broadcasts: registry.list() });
  });
  return router;
}
```

- [ ] **Step 4: Wire into index.ts**

Read `server/src/index.ts`. After the broadcast router wiring from Plan 1 Task 10, add:

```typescript
import * as path from 'path';  // if not already imported
import { FeaturedBroadcastRegistry } from './services/broadcast/FeaturedBroadcastRegistry';
import { createFeaturedRouter } from './routes/featured';

const featuredRegistry = new FeaturedBroadcastRegistry(
  path.resolve(__dirname, '../featured-broadcasts/registry.json'),
);
featuredRegistry.load().catch(err => console.error('featured registry load failed', err));

app.use(requireAuth, createFeaturedRouter(featuredRegistry));
```

Note: `featured` uses `requireAuth` but no `generationLimiter` (it's a cheap read).

- [ ] **Step 5: Run tests**

Run: `cd server && npx jest routes/featured`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/featured.ts server/__tests__/routes/featured.test.ts server/src/index.ts
git commit -m "feat(server): add GET /broadcast/featured route"
```

---

## Task 5: Client BroadcastCurationClient

**Files:**
- Create: `src/engines/BroadcastCurationClient.ts`
- Create: `__tests__/engines/BroadcastCurationClient.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/engines/BroadcastCurationClient.test.ts
import { BroadcastCurationClient } from '@/engines/BroadcastCurationClient';

jest.mock('@/services/api', () => ({
  API_BASE_URL: 'http://test',
  authenticatedFetch: jest.fn(),
}));
import { authenticatedFetch } from '@/services/api';

describe('BroadcastCurationClient', () => {
  beforeEach(() => (authenticatedFetch as jest.Mock).mockReset());

  it('fetches featured broadcasts', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ broadcasts: [
        { id: 'a', title: 'A', description: 'D', vibe: 'morning', length: 'quick',
          baked: true, createdAt: 1,
          manifest: { broadcastId: 'a', segmentSlots: [] } },
      ] }),
    });
    const client = new BroadcastCurationClient();
    const list = await client.listFeatured();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  it('returns empty list on non-ok response', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({}),
    });
    const client = new BroadcastCurationClient();
    const list = await client.listFeatured();
    expect(list).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest BroadcastCurationClient`
Expected: module-not-found.

- [ ] **Step 3: Implement client**

```typescript
// src/engines/BroadcastCurationClient.ts
import { API_BASE_URL, authenticatedFetch } from '@/services/api';
import type { Manifest } from './BroadcastPlayer.types';

export interface FeaturedBroadcast {
  id: string;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
}

export class BroadcastCurationClient {
  async listFeatured(): Promise<FeaturedBroadcast[]> {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/broadcast/featured`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body.broadcasts ?? []) as FeaturedBroadcast[];
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest BroadcastCurationClient`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engines/BroadcastCurationClient.ts __tests__/engines/BroadcastCurationClient.test.ts
git commit -m "feat(broadcast): add client for featured broadcasts list"
```

---

## Task 6: SetupSheet — 3-step picker

**Files:**
- Create: `src/components/broadcast/SetupSheet.tsx`
- Create: `__tests__/components/SetupSheet.test.tsx` (optional, see step below)

**Design:** A modal sheet with three screens stacked: playlist → vibe → length. State is local to the sheet. On final "Start" tap, fires an `onSubmit({ playlistId, vibe, length })` callback. Uses the existing `VibePicker` visual language and design tokens. No backdrop-click-to-dismiss during step transitions; explicit back button at top.

- [ ] **Step 1: Implement the sheet**

```tsx
// src/components/broadcast/SetupSheet.tsx
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Image } from 'react-native';
import { Colors, Spacing, Typography, Radius } from '@/tokens/design-tokens';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import type { Manifest } from '@/engines/BroadcastPlayer.types';

type Vibe = Manifest['vibe'];
type Length = Manifest['length'];

const VIBES: { id: Vibe; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'chill', label: 'Chill' },
  { id: 'workout', label: 'Workout' },
  { id: 'lateNight', label: 'Late Night' },
  { id: 'party', label: 'Party' },
  { id: 'focus', label: 'Focus' },
  { id: 'feelGood', label: 'Feel Good' },
  { id: 'throwback', label: 'Throwback' },
  { id: 'elevated', label: 'Elevated' },
  { id: 'melancholy', label: 'Melancholy' },
  { id: 'sunday', label: 'Sunday' },
  { id: 'general', label: 'General' },
];

const LENGTHS: { id: Length; label: string; subtitle: string }[] = [
  { id: 'quick', label: 'Quick Set', subtitle: '~15 min · 5 tracks' },
  { id: 'standard', label: 'Standard', subtitle: '~30 min · 9 tracks' },
  { id: 'long', label: 'Long Drive', subtitle: '~60 min · 15 tracks' },
];

export interface SetupResult {
  playlistId: string;
  vibe: Vibe;
  length: Length;
}

interface Props {
  visible: boolean;
  playlists: MusicPlaylist[];
  onClose: () => void;
  onSubmit: (result: SetupResult) => void;
}

export function SetupSheet({ visible, playlists, onClose, onSubmit }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [length, setLength] = useState<Length | null>(null);

  const reset = () => { setStep(0); setPlaylistId(null); setVibe(null); setLength(null); };
  const close = () => { reset(); onClose(); };

  const submit = () => {
    if (!playlistId || !vibe || !length) return;
    onSubmit({ playlistId, vibe, length });
    reset();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: Colors.background, padding: Spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.lg }}>
          <Pressable onPress={step === 0 ? close : () => setStep((step - 1) as any)} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={{ color: Colors.accent, ...Typography.mono }}>{step === 0 ? 'CANCEL' : 'BACK'}</Text>
          </Pressable>
          <Text style={{ color: Colors.textSecondary, ...Typography.mono }}>STEP {step + 1} / 3</Text>
        </View>

        {step === 0 && (
          <>
            <Text style={{ color: Colors.textPrimary, ...Typography.display, marginBottom: Spacing.md }}>Pick a source</Text>
            <ScrollView>
              {playlists.map(p => (
                <Pressable key={p.id} onPress={() => { setPlaylistId(p.id); setStep(1); }}
                  accessibilityRole="button" accessibilityLabel={`Pick playlist ${p.name}`}
                  style={{ flexDirection: 'row', alignItems: 'center', padding: Spacing.md,
                    backgroundColor: Colors.surface, borderRadius: Radius.sm, marginBottom: Spacing.sm,
                    borderLeftWidth: 2, borderLeftColor: playlistId === p.id ? Colors.accent : 'transparent' }}>
                  {p.artworkUrl && <Image source={{ uri: p.artworkUrl }} style={{ width: 48, height: 48, marginRight: Spacing.sm }} />}
                  <Text style={{ color: Colors.textPrimary }}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={{ color: Colors.textPrimary, ...Typography.display, marginBottom: Spacing.md }}>Pick a vibe</Text>
            <ScrollView>
              {VIBES.map(v => (
                <Pressable key={v.id} onPress={() => { setVibe(v.id); setStep(2); }}
                  accessibilityRole="button" accessibilityLabel={`Pick vibe ${v.label}`}
                  style={{ padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.sm,
                    marginBottom: Spacing.sm,
                    borderLeftWidth: 2, borderLeftColor: vibe === v.id ? Colors.accent : 'transparent' }}>
                  <Text style={{ color: Colors.textPrimary }}>{v.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={{ color: Colors.textPrimary, ...Typography.display, marginBottom: Spacing.md }}>Pick a length</Text>
            {LENGTHS.map(l => (
              <Pressable key={l.id} onPress={() => setLength(l.id)}
                accessibilityRole="button" accessibilityLabel={`Pick length ${l.label}`}
                style={{ padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.sm,
                  marginBottom: Spacing.sm,
                  borderLeftWidth: 2, borderLeftColor: length === l.id ? Colors.accent : 'transparent' }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '600' }}>{l.label}</Text>
                <Text style={{ color: Colors.textSecondary }}>{l.subtitle}</Text>
              </Pressable>
            ))}
            <Pressable onPress={submit} disabled={!length}
              accessibilityRole="button" accessibilityLabel="Start broadcast"
              style={{ padding: Spacing.md, backgroundColor: length ? Colors.accent : Colors.surface,
                borderRadius: Radius.sm, marginTop: Spacing.lg, alignItems: 'center' }}>
              <Text style={{ color: length ? Colors.onAccent : Colors.textSecondary, ...Typography.mono }}>START BROADCAST</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `Colors.onAccent` exists — if not, use `Colors.background` or similar from the design tokens.

- [ ] **Step 3: Commit**

```bash
git add src/components/broadcast/SetupSheet.tsx
git commit -m "feat(broadcast): add 3-step setup sheet (playlist/vibe/length)"
```

---

## Task 7: TuningInOverlay — animated masking of first-segment bake

**Files:**
- Create: `src/components/broadcast/TuningInOverlay.tsx`

**Design:** Full-screen overlay. Radio-dial style static animation (pulsing concentric circles + randomly-jittering dots) with "TUNING IN" text. Uses existing `useAppActive()` to pause animations when backgrounded. Fades out when `visible` becomes false.

- [ ] **Step 1: Implement overlay**

```tsx
// src/components/broadcast/TuningInOverlay.tsx
import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { Colors, Spacing, Typography } from '@/tokens/design-tokens';
import { useAppActive } from '@/hooks/useAppActive';

interface Props { visible: boolean }

export function TuningInOverlay({ visible }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.6)).current;
  const appActive = useAppActive();

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  useEffect(() => {
    if (!visible || !appActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringScale, { toValue: 1.1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ringScale, { toValue: 0.6, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, appActive, ringScale]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        ...StyleSheet_absoluteFill,
        backgroundColor: Colors.background,
        opacity,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View style={{
        width: 160, height: 160, borderRadius: 80,
        borderWidth: 2, borderColor: Colors.accent,
        transform: [{ scale: ringScale }],
      }} />
      <Text style={{ color: Colors.accent, ...Typography.mono, marginTop: Spacing.lg, letterSpacing: 4 }}>
        TUNING IN
      </Text>
    </Animated.View>
  );
}

const StyleSheet_absoluteFill = {
  position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0,
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/broadcast/TuningInOverlay.tsx
git commit -m "feat(broadcast): add tuning-in overlay with pulsing ring animation"
```

---

## Task 8: FeaturedBroadcastCard + YourBroadcastSetup components

**Files:**
- Create: `src/components/broadcast/FeaturedBroadcastCard.tsx`
- Create: `src/components/broadcast/YourBroadcastSetup.tsx`

- [ ] **Step 1: FeaturedBroadcastCard**

```tsx
// src/components/broadcast/FeaturedBroadcastCard.tsx
import { View, Text, Pressable, Image } from 'react-native';
import { Colors, Spacing, Typography, Radius } from '@/tokens/design-tokens';
import type { FeaturedBroadcast } from '@/engines/BroadcastCurationClient';

interface Props {
  broadcast: FeaturedBroadcast;
  onPress: () => void;
}

export function FeaturedBroadcastCard({ broadcast, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${broadcast.title}`}
      style={{
        backgroundColor: Colors.surface,
        borderLeftWidth: 2,
        borderLeftColor: Colors.accent,
        padding: Spacing.md,
        borderRadius: Radius.sm,
        marginBottom: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {broadcast.artworkUrl && (
        <Image source={{ uri: broadcast.artworkUrl }}
          style={{ width: 64, height: 64, borderRadius: Radius.sm, marginRight: Spacing.md }} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textPrimary, ...Typography.display, fontSize: 18 }}>
          {broadcast.title}
        </Text>
        <Text style={{ color: Colors.textSecondary, marginTop: 2 }} numberOfLines={2}>
          {broadcast.description}
        </Text>
        <Text style={{ color: Colors.accent, ...Typography.mono, marginTop: Spacing.xs }}>
          {broadcast.vibe.toUpperCase()} · {broadcast.length.toUpperCase()}
        </Text>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 2: YourBroadcastSetup**

```tsx
// src/components/broadcast/YourBroadcastSetup.tsx
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Colors, Spacing, Typography, Radius } from '@/tokens/design-tokens';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import { SetupSheet, type SetupResult } from './SetupSheet';

interface Props {
  playlists: MusicPlaylist[];
  onSubmit: (result: SetupResult) => void;
}

export function YourBroadcastSetup({ playlists, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Start your own broadcast"
        style={{
          backgroundColor: Colors.surface,
          borderLeftWidth: 2, borderLeftColor: Colors.accent,
          padding: Spacing.lg, borderRadius: Radius.sm,
        }}
      >
        <Text style={{ color: Colors.accent, ...Typography.mono, marginBottom: Spacing.xs }}>
          START YOUR BROADCAST
        </Text>
        <Text style={{ color: Colors.textPrimary, ...Typography.display, fontSize: 22 }}>
          Pick a playlist. Pick a vibe. Hit play.
        </Text>
        <Text style={{ color: Colors.textSecondary, marginTop: Spacing.xs }}>
          ONAY builds the set and takes you through.
        </Text>
      </Pressable>

      <SetupSheet
        visible={open}
        playlists={playlists}
        onClose={() => setOpen(false)}
        onSubmit={(r) => { setOpen(false); onSubmit(r); }}
      />
    </>
  );
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/broadcast/FeaturedBroadcastCard.tsx src/components/broadcast/YourBroadcastSetup.tsx
git commit -m "feat(broadcast): add FeaturedBroadcastCard + YourBroadcastSetup components"
```

---

## Task 9: HomeBroadcastScreen — wire it all together

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 1: Implement the screen**

```tsx
// src/screens/home/HomeBroadcastScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography } from '@/tokens/design-tokens';
import { musicPlayer, type MusicPlaylist } from '@/services/MusicKitPlayer';
import {
  BroadcastCurationClient,
  type FeaturedBroadcast,
} from '@/engines/BroadcastCurationClient';
import { BroadcastManifestClient } from '@/engines/BroadcastManifestClient';
import { broadcastPlayer } from '@/engines/BroadcastPlayer';
import { FeaturedBroadcastCard } from '@/components/broadcast/FeaturedBroadcastCard';
import { YourBroadcastSetup } from '@/components/broadcast/YourBroadcastSetup';
import { TuningInOverlay } from '@/components/broadcast/TuningInOverlay';
import type { SetupResult } from '@/components/broadcast/SetupSheet';

export default function HomeBroadcastScreen() {
  const router = useRouter();
  const [featured, setFeatured] = useState<FeaturedBroadcast[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [tuning, setTuning] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [feats, pls] = await Promise.all([
          new BroadcastCurationClient().listFeatured(),
          musicPlayer.fetchPlaylists().catch(() => [] as MusicPlaylist[]),
        ]);
        if (!mounted) return;
        setFeatured(feats);
        setPlaylists(pls);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const playFeatured = useCallback(async (fb: FeaturedBroadcast) => {
    setTuning(true);
    try {
      const firstSlot = fb.manifest.segmentSlots[0];
      const firstUrls = firstSlot?.audioUrls ?? [];
      await broadcastPlayer.start(fb.manifest, firstUrls);
      router.push('/(main)/(broadcast)/broadcast-player');
    } catch (err: any) {
      Alert.alert('Broadcast unavailable', err?.message ?? 'Try again.');
    } finally {
      setTuning(false);
    }
  }, [router]);

  const playUserSourced = useCallback(async (result: SetupResult) => {
    setTuning(true);
    try {
      const tracks = await musicPlayer.fetchPlaylistTracks(result.playlistId);
      const client = new BroadcastManifestClient();
      const { manifest, firstSegmentUrls } = await client.createBroadcast({
        playlistId: result.playlistId,
        vibe: result.vibe,
        length: result.length,
        userContext: {
          timeOfDay: new Date().toTimeString().slice(0, 5),
          dayOfWeek: new Date().toLocaleDateString(undefined, { weekday: 'long' }),
          firstTimeUser: false,
        },
        tracks: tracks.slice(0, 20).map(t => ({
          id: t.id, title: t.title, artistName: t.artistName,
          albumTitle: t.albumTitle, duration: t.duration, artworkUrl: t.artworkUrl,
        })),
      });
      await broadcastPlayer.start(manifest, firstSegmentUrls);
      router.push('/(main)/(broadcast)/broadcast-player');
    } catch (err: any) {
      Alert.alert('Broadcast unavailable', err?.message ?? 'Try again.');
    } finally {
      setTuning(false);
    }
  }, [router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: Colors.background }} contentContainerStyle={{ padding: Spacing.lg }}>
        <Text style={{ color: Colors.accent, ...Typography.mono, marginBottom: Spacing.xs, letterSpacing: 3 }}>
          TONIGHT ON ONAY
        </Text>
        <View style={{ height: 2, width: 40, backgroundColor: Colors.accent, marginBottom: Spacing.md }} />

        {featured.length === 0 ? (
          <Text style={{ color: Colors.textSecondary, marginBottom: Spacing.xl }}>
            New broadcasts coming soon.
          </Text>
        ) : (
          featured.map(fb => (
            <FeaturedBroadcastCard key={fb.id} broadcast={fb} onPress={() => playFeatured(fb)} />
          ))
        )}

        <View style={{ height: Spacing.xl }} />

        <YourBroadcastSetup playlists={playlists} onSubmit={playUserSourced} />
      </ScrollView>

      <TuningInOverlay visible={tuning} />
    </>
  );
}
```

- [ ] **Step 2: Flip the feature flag and test on device**

Edit `src/config/flags.ts`: set `broadcastHome: true`.

Build app, launch on device. Expected:
- Home screen shows "TONIGHT ON ONAY" heading, featured list (or empty message), and "START YOUR BROADCAST" card below.
- Tapping a featured card shows the tuning-in overlay, then navigates to the player.
- Tapping "START YOUR BROADCAST" opens the 3-step sheet; completing it fires tuning-in → player.

- [ ] **Step 3: Verify the existing HomeScreenRedesign still works by toggling the flag off**

Set `broadcastHome: false` and confirm old behavior is untouched. Set back to `true`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx src/config/flags.ts
git commit -m "feat(home): implement HomeBroadcastScreen with featured + your-broadcast stacks"
```

---

## Task 10: BroadcastResumer — resume-after-terminate flow

**Files:**
- Create: `src/engines/BroadcastResumer.ts`
- Create: `__tests__/engines/BroadcastResumer.test.ts`
- Modify: `app/_layout.tsx`

**Design:** On app launch (after auth is ready), check `getPersistedBroadcast()`. If one exists and was persisted within the last 2 hours, prompt to resume. Accepting re-fetches the manifest from server (in case server state has changed) and starts the player. Declining clears the persisted state.

The `BroadcastPlayer.start()` should also call `setPersistedBroadcast(manifest)` on entry and `clearPersistedBroadcast()` on clean session end. Add these hooks.

- [ ] **Step 1: Update BroadcastPlayer to persist/clear manifest**

In `src/engines/BroadcastPlayer.ts`:

Add imports:
```typescript
import { setPersistedBroadcast, clearPersistedBroadcast } from '@/services/Storage';
```

In `start()`, after `this.manifest = manifest`:
```typescript
setPersistedBroadcast(manifest);
```

At the point where the session ends cleanly (after the last `runSegmentAt`):
```typescript
this.state = 'ended';
clearPersistedBroadcast();
this.endedPromiseResolve?.();
```

And in `end()`:
```typescript
clearPersistedBroadcast();
```

- [ ] **Step 2: Write the failing test**

```typescript
// __tests__/engines/BroadcastResumer.test.ts
import { BroadcastResumer } from '@/engines/BroadcastResumer';
import * as Storage from '@/services/Storage';
import type { Manifest } from '@/engines/BroadcastPlayer.types';

jest.mock('@/services/Storage');

describe('BroadcastResumer', () => {
  const base: Manifest = {
    broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
    vibe: 'morning', length: 'quick', createdAt: Date.now(),
    tracks: [], segmentSlots: [],
  };

  beforeEach(() => jest.resetAllMocks());

  it('returns null when nothing is persisted', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(undefined);
    const resumer = new BroadcastResumer();
    expect(await resumer.check()).toBeNull();
  });

  it('returns null and clears storage when persisted is older than 2h', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue({
      ...base, createdAt: Date.now() - (2 * 60 * 60 * 1000 + 1000),
    });
    const resumer = new BroadcastResumer();
    expect(await resumer.check()).toBeNull();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });

  it('returns the manifest when persisted within 2h', async () => {
    const fresh = { ...base, createdAt: Date.now() - 60 * 1000 };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(fresh);
    const resumer = new BroadcastResumer();
    expect((await resumer.check())?.broadcastId).toBe('b1');
  });

  it('decline() clears persisted state', async () => {
    const resumer = new BroadcastResumer();
    await resumer.decline();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest BroadcastResumer`
Expected: module-not-found.

- [ ] **Step 4: Implement Resumer**

```typescript
// src/engines/BroadcastResumer.ts
import {
  getPersistedBroadcast, clearPersistedBroadcast,
} from '@/services/Storage';
import type { Manifest } from './BroadcastPlayer.types';

const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

export class BroadcastResumer {
  async check(): Promise<Manifest | null> {
    const m = getPersistedBroadcast();
    if (!m) return null;
    if (Date.now() - m.createdAt > RESUME_WINDOW_MS) {
      clearPersistedBroadcast();
      return null;
    }
    return m;
  }

  async decline(): Promise<void> {
    clearPersistedBroadcast();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest BroadcastResumer`
Expected: 4 tests pass.

- [ ] **Step 6: Wire into app launch**

In `app/_layout.tsx`, inside the auth-ready effect that already exists, add:

```typescript
import { BroadcastResumer } from '@/engines/BroadcastResumer';
import { BroadcastManifestClient } from '@/engines/BroadcastManifestClient';
import { broadcastPlayer } from '@/engines/BroadcastPlayer';
import { Alert } from 'react-native';

// Inside the existing useEffect triggered on auth ready (look for where
// `authState === 'ready'` is set), add:
const resumer = new BroadcastResumer();
const persisted = await resumer.check();
if (persisted) {
  Alert.alert(
    'Resume broadcast?',
    `${persisted.tracks.length} tracks left in your session.`,
    [
      { text: 'Start fresh', style: 'cancel', onPress: () => resumer.decline() },
      {
        text: 'Resume',
        onPress: async () => {
          const firstSlot = persisted.segmentSlots.find(s => s.status === 'ready');
          const urls = firstSlot?.audioUrls ?? [];
          broadcastPlayer.start(persisted, urls).catch((e) => console.warn('resume failed', e));
        },
      },
    ],
  );
}
```

Where exactly this hooks into `_layout.tsx` depends on the current structure — read the file first, then add the resume check after any existing "navigate to home" logic. If auth readiness is tracked via a flag (`authState`), put this inside the effect that fires when it becomes `'ready'`.

- [ ] **Step 7: Test on device**

1. Start a broadcast on device.
2. Kill the app mid-session (swipe up in App Switcher).
3. Relaunch.
4. Expect the Alert with "Resume broadcast?" offering Start fresh / Resume.

- [ ] **Step 8: Commit**

```bash
git add src/engines/BroadcastResumer.ts __tests__/engines/BroadcastResumer.test.ts src/engines/BroadcastPlayer.ts app/_layout.tsx
git commit -m "feat(broadcast): add resume-after-terminate flow with 2h window"
```

---

## Task 11: End-to-end smoke test + tag

- [ ] **Step 1: Run full test suite**

```bash
npx jest
cd server && npx jest
```

Expected: all tests pass.

- [ ] **Step 2: Bake a real featured broadcast**

On the server, put real Apple Music track IDs into `server/featured-broadcasts/late-night-soul.json` (or a new config file), then:

```bash
cd server && npm run bake-featured featured-broadcasts/late-night-soul.json
```

Expected: "Baked late-night-soul with N segments."

- [ ] **Step 3: Device test — full user flow**

On a physical iPhone with a real Apple Music account:
1. Open app → HomeBroadcastScreen renders.
2. "TONIGHT ON ONAY" section shows the baked featured broadcast.
3. Tap the featured card → tuning-in overlay → broadcast plays.
4. Kill app mid-session.
5. Relaunch → resume Alert appears → tap Resume → broadcast continues.
6. Go back to home → tap "START YOUR BROADCAST" → pick playlist → pick vibe → pick length → tap START.
7. Tuning-in overlay appears, then user-sourced broadcast plays through.

- [ ] **Step 4: Tag**

```bash
git tag -a plan-3-home-and-curation-complete -m "Plan 3 complete: home screen + setup + curation pipeline working end-to-end"
```

---

## Self-review

**Spec coverage:**
- ✅ Two-stack home screen — Task 9
- ✅ Setup flow (playlist → vibe → length) — Task 6
- ✅ Tuning-in animation — Task 7
- ✅ ONAY-curated broadcasts — Tasks 2-5
- ✅ Resume-after-terminate — Task 10
- ⚠️  Sign-off referencing the last track by name — already handled in Plan 1's `SegmentScriptBuilder` (sign_off prompts mention `afterTrackId`'s title)
- ⚠️  Ambient texture / vibe-specific stingers — Plan 2's stingers are generic placeholders. Polish pass is deferred; not blocking.

**No placeholders:** every task has concrete code. Track IDs in the featured config are documented as requiring real values before running the bake CLI.

**Type consistency:** `FeaturedBroadcast`, `SetupResult`, `Manifest` consistent across client + server. Client `FeaturedBroadcast` mirrors the server record shape.

**Scope:** plan produces a working end-to-end product: home, setup, featured, curation, resume. The old `HomeScreenRedesign` still exists untouched — Plan 4 deletes it along with other dead client code.

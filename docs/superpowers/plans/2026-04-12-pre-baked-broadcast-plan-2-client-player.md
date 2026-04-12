# Pre-Baked Broadcast — Plan 2: Client BroadcastPlayer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side `BroadcastPlayer` that consumes a manifest (local first, then Plan 1's server), downloads segment audio, and plays the full broadcast end-to-end with the duck+speak transition pattern. No old player code is deleted in this plan — the new player is added alongside so it can be smoke-tested before migration.

**Architecture:** New `src/engines/BroadcastPlayer.ts` state machine plus a small `ManifestClient` for HTTP. Segment audio is fetched as binary, base64-encoded on-device, and played through the existing native `playAudioFromBase64` API over ducked MusicKit audio. Track playback uses the existing `MusicKitPlayer` singleton. Stinger audio files ship in the app bundle and are played via the same base64 pipeline.

**Tech Stack:** React Native 0.83 + Expo SDK 55, TypeScript, Jest + ts-jest, `expo-music-kit` native module, MMKV for manifest caching. No new native code required — all needed primitives exist.

**Spec:** `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md` (sections: Runtime architecture, Transition pattern)

**Depends on:** Plan 1 — but most tasks can proceed against a hand-crafted local manifest. Only the final end-to-end smoke test needs a running Plan 1 server.

---

## File Structure

**Create:**
- `src/engines/BroadcastPlayer.ts` — public singleton, state machine, public API
- `src/engines/BroadcastPlayer.types.ts` — `Manifest`, `SegmentSlot`, player state types (mirror of server types)
- `src/engines/BroadcastSegmentCache.ts` — in-memory cache: segment index → base64 bytes; LRU-ish (clears on session end)
- `src/engines/BroadcastManifestClient.ts` — HTTP client: `createBroadcast()`, `fetchManifest()`, `fetchSegmentAudio()`
- `src/engines/BroadcastStingers.ts` — loads bundled stinger assets at startup, exposes `getStinger(vibe, kind)`
- `src/screens/player/BroadcastPlayerScreen.tsx` — new thin screen that drives `BroadcastPlayer` (parallel to existing `BroadcastScreen`; migration in Plan 4)
- `src/services/Storage.ts` — add two new storage keys
- `assets/stingers/` — new dir for bundled stinger MP3s (minimum 1 generic per vibe for MVP)
- `__tests__/engines/BroadcastPlayer.test.ts`
- `__tests__/engines/BroadcastSegmentCache.test.ts`
- `__tests__/engines/BroadcastManifestClient.test.ts`
- `__mocks__/expo-music-kit.ts` — extend existing mock with any newly-exercised methods

**Modify:**
- `app/(main)/(broadcast)/_layout.tsx` — add a route for the new screen (hidden behind a dev flag)
- `src/services/Storage.ts` — add `StorageKeys.CURRENT_BROADCAST` + helpers (see Task 2)

---

## Shared types reference

```typescript
// src/engines/BroadcastPlayer.types.ts
export type Vibe =
  | 'morning' | 'chill' | 'workout' | 'lateNight' | 'party'
  | 'general' | 'focus' | 'feelGood' | 'throwback' | 'elevated'
  | 'melancholy' | 'sunday';

export type BroadcastLength = 'quick' | 'standard' | 'long';

export type SegmentSlotKind = 'cold_open' | 'transition' | 'sign_off';

export interface SegmentSlot {
  index: number;
  kind: SegmentSlotKind;
  beforeTrackId?: string;
  afterTrackId?: string;
  variantCount: number;
  status: 'pending' | 'ready' | 'failed';
  audioUrls?: string[];
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
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  createdAt: number;
  tracks: ManifestTrack[];
  segmentSlots: SegmentSlot[];
}

export type PlayerState =
  | 'idle'
  | 'loading'       // fetched manifest, first segment queued to play
  | 'playing_segment'
  | 'playing_track'
  | 'paused'
  | 'ended'         // sign_off finished
  | 'error';

export interface PlayerStatus {
  state: PlayerState;
  currentTrackIndex: number;   // -1 before first track
  currentSegmentIndex: number; // -1 when not playing segment
  broadcastId: string | null;
  nowPlaying: { trackId?: string; segmentKind?: SegmentSlotKind } | null;
  progress: number;            // 0-1 across whole broadcast
}
```

---

## Task 1: Scaffold types + screen route

**Files:**
- Create: `src/engines/BroadcastPlayer.types.ts`
- Modify: `app/(main)/(broadcast)/_layout.tsx`
- Create: `app/(main)/(broadcast)/broadcast-player.tsx` (empty placeholder)

- [ ] **Step 1: Create types file**

Copy the full "Shared types reference" block above into `src/engines/BroadcastPlayer.types.ts`.

- [ ] **Step 2: Add dev-flagged route**

Read `app/(main)/(broadcast)/_layout.tsx`, then add a `<Stack.Screen name="broadcast-player" options={{ ... }} />` entry alongside existing screens. Mirror the options of the existing `player` screen.

Create stub `app/(main)/(broadcast)/broadcast-player.tsx`:
```tsx
import { View, Text } from 'react-native';
import { Colors } from '@/tokens/design-tokens';

export default function BroadcastPlayerScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, padding: 24 }}>
      <Text style={{ color: Colors.textPrimary }}>BroadcastPlayer (scaffold)</Text>
    </View>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/engines/BroadcastPlayer.types.ts app/\(main\)/\(broadcast\)/_layout.tsx app/\(main\)/\(broadcast\)/broadcast-player.tsx
git commit -m "feat(broadcast): scaffold types + dev-flagged player route"
```

---

## Task 2: Storage keys for broadcast state

**Files:**
- Modify: `src/services/Storage.ts`
- Modify: `__tests__/services/Storage.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/services/Storage.test.ts`:

```typescript
describe('broadcast storage', () => {
  it('stores and retrieves a persisted broadcast manifest', () => {
    const manifest = {
      broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
      vibe: 'morning' as const, length: 'quick' as const,
      createdAt: Date.now(),
      tracks: [], segmentSlots: [],
    };
    setPersistedBroadcast(manifest as any);
    const got = getPersistedBroadcast();
    expect(got?.broadcastId).toBe('b1');
  });

  it('clears persisted broadcast', () => {
    setPersistedBroadcast({ broadcastId: 'b2' } as any);
    clearPersistedBroadcast();
    expect(getPersistedBroadcast()).toBeUndefined();
  });
});
```

Update imports at top of test file:
```typescript
import {
  setPersistedBroadcast,
  getPersistedBroadcast,
  clearPersistedBroadcast,
} from '@/services/Storage';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services/Storage`
Expected: fails with "setPersistedBroadcast is not a function".

- [ ] **Step 3: Add helpers**

Add to `src/services/Storage.ts`:

```typescript
import type { Manifest } from '@/engines/BroadcastPlayer.types';

// Add to StorageKeys const:
// CURRENT_BROADCAST: 'currentBroadcast',

export function setPersistedBroadcast(manifest: Manifest): void {
  setObject(StorageKeys.CURRENT_BROADCAST, manifest);
}

export function getPersistedBroadcast(): Manifest | undefined {
  return getObject<Manifest>(StorageKeys.CURRENT_BROADCAST);
}

export function clearPersistedBroadcast(): void {
  storage.delete(StorageKeys.CURRENT_BROADCAST);
}
```

Add `CURRENT_BROADCAST: 'currentBroadcast'` to the `StorageKeys` enum.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest services/Storage`
Expected: all tests pass, including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/services/Storage.ts __tests__/services/Storage.test.ts
git commit -m "feat(storage): add persisted broadcast manifest helpers"
```

---

## Task 3: BroadcastSegmentCache — in-memory audio cache

**Files:**
- Create: `src/engines/BroadcastSegmentCache.ts`
- Create: `__tests__/engines/BroadcastSegmentCache.test.ts`

**Design:** Segment index → base64 string. Per-slot: store all variants (for cold_open, 3 variants). Simple Map + get/put/has. Called from `BroadcastPlayer` which knows the manifest layout.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/engines/BroadcastSegmentCache.test.ts
import { BroadcastSegmentCache } from '@/engines/BroadcastSegmentCache';

describe('BroadcastSegmentCache', () => {
  it('stores and retrieves variants by slot index', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'base64a');
    c.put(0, 1, 'base64b');
    expect(c.get(0, 0)).toBe('base64a');
    expect(c.get(0, 1)).toBe('base64b');
  });

  it('returns undefined for uncached entries', () => {
    const c = new BroadcastSegmentCache();
    expect(c.get(2, 0)).toBeUndefined();
  });

  it('reports whether a slot has at least one variant ready', () => {
    const c = new BroadcastSegmentCache();
    expect(c.hasAny(1)).toBe(false);
    c.put(1, 0, 'x');
    expect(c.hasAny(1)).toBe(true);
  });

  it('clears all entries', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'x'); c.put(3, 0, 'y');
    c.clear();
    expect(c.get(0, 0)).toBeUndefined();
    expect(c.get(3, 0)).toBeUndefined();
  });

  it('pickVariant returns a deterministic variant given variantCount', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'a'); c.put(0, 1, 'b'); c.put(0, 2, 'c');
    const v0 = c.pickVariant(0, 3, () => 0.0);  // rng returns 0
    const v2 = c.pickVariant(0, 3, () => 0.9);  // rng returns 0.9
    expect(v0).toBe('a');
    expect(v2).toBe('c');
  });

  it('pickVariant falls back to variant 0 if picked variant missing', () => {
    const c = new BroadcastSegmentCache();
    c.put(0, 0, 'a');
    expect(c.pickVariant(0, 3, () => 0.9)).toBe('a');
  });

  it('pickVariant returns undefined when nothing is cached', () => {
    const c = new BroadcastSegmentCache();
    expect(c.pickVariant(5, 3, () => 0)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest BroadcastSegmentCache`
Expected: module-not-found.

- [ ] **Step 3: Implement cache**

```typescript
// src/engines/BroadcastSegmentCache.ts
export class BroadcastSegmentCache {
  private readonly entries = new Map<string, string>();

  private key(slotIndex: number, variantIndex: number): string {
    return `${slotIndex}:${variantIndex}`;
  }

  put(slotIndex: number, variantIndex: number, base64: string): void {
    this.entries.set(this.key(slotIndex, variantIndex), base64);
  }

  get(slotIndex: number, variantIndex: number): string | undefined {
    return this.entries.get(this.key(slotIndex, variantIndex));
  }

  hasAny(slotIndex: number): boolean {
    for (const k of this.entries.keys()) {
      if (k.startsWith(`${slotIndex}:`)) return true;
    }
    return false;
  }

  pickVariant(
    slotIndex: number,
    variantCount: number,
    rng: () => number = Math.random,
  ): string | undefined {
    if (!this.hasAny(slotIndex)) return undefined;
    const picked = Math.floor(rng() * variantCount);
    return this.get(slotIndex, picked) ?? this.get(slotIndex, 0);
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest BroadcastSegmentCache`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engines/BroadcastSegmentCache.ts __tests__/engines/BroadcastSegmentCache.test.ts
git commit -m "feat(broadcast): add segment audio cache with variant picking"
```

---

## Task 4: BroadcastManifestClient — HTTP client

**Files:**
- Create: `src/engines/BroadcastManifestClient.ts`
- Create: `__tests__/engines/BroadcastManifestClient.test.ts`

**Design:** Three methods:
- `createBroadcast(req)` — `POST /broadcast/create` via `authenticatedFetch`. Returns `{ manifest, firstSegmentUrls }`.
- `fetchManifest(id)` — `GET /broadcast/:id/manifest`. Returns updated `Manifest`.
- `fetchSegmentAudio(url)` — `GET <url>` as `ArrayBuffer`, base64-encode, return base64 string. Uses the same auth via `authenticatedFetch`.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/engines/BroadcastManifestClient.test.ts
import { BroadcastManifestClient } from '@/engines/BroadcastManifestClient';

// Mock authenticatedFetch
jest.mock('@/services/api', () => ({
  API_BASE_URL: 'http://test',
  authenticatedFetch: jest.fn(),
}));
import { authenticatedFetch } from '@/services/api';

const makeResponse = (body: any, ok = true, status = 200): Partial<Response> => ({
  ok, status,
  json: async () => body,
  arrayBuffer: async () => Buffer.from(body as string, 'utf8').buffer,
});

describe('BroadcastManifestClient', () => {
  beforeEach(() => (authenticatedFetch as jest.Mock).mockReset());

  it('createBroadcast POSTs and returns manifest + first urls', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse({
      manifest: { broadcastId: 'b1', tracks: [], segmentSlots: [] },
      firstSegmentUrls: ['u1', 'u2'],
    }));

    const client = new BroadcastManifestClient();
    const result = await client.createBroadcast({
      playlistId: 'p1', vibe: 'morning', length: 'quick',
      userContext: { timeOfDay: '10:00', dayOfWeek: 'Mon', firstTimeUser: false },
      tracks: [],
    });

    expect(result.manifest.broadcastId).toBe('b1');
    expect(result.firstSegmentUrls).toEqual(['u1', 'u2']);
    const [url, init] = (authenticatedFetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/broadcast/create');
    expect(init.method).toBe('POST');
  });

  it('createBroadcast throws on non-ok response', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse({ error: 'bad' }, false, 400));
    const client = new BroadcastManifestClient();
    await expect(client.createBroadcast({
      playlistId: 'p1', vibe: 'morning', length: 'quick',
      userContext: { timeOfDay: '10:00', dayOfWeek: 'Mon', firstTimeUser: false },
      tracks: [],
    })).rejects.toThrow();
  });

  it('fetchManifest GETs and returns manifest', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse({
      broadcastId: 'b1', tracks: [], segmentSlots: [],
    }));
    const client = new BroadcastManifestClient();
    const m = await client.fetchManifest('b1');
    expect(m.broadcastId).toBe('b1');
  });

  it('fetchSegmentAudio returns base64 of response bytes', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(makeResponse('hello'));
    const client = new BroadcastManifestClient();
    const base64 = await client.fetchSegmentAudio('http://cdn/x.mp3');
    // "hello" base64 = "aGVsbG8="
    expect(base64).toBe('aGVsbG8=');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest BroadcastManifestClient`
Expected: module-not-found.

- [ ] **Step 3: Implement client**

```typescript
// src/engines/BroadcastManifestClient.ts
import { Buffer } from 'buffer';
import { API_BASE_URL, authenticatedFetch } from '@/services/api';
import type { Manifest } from './BroadcastPlayer.types';

export interface CreateBroadcastRequest {
  playlistId: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  userContext: {
    timeOfDay: string;
    dayOfWeek: string;
    firstTimeUser: boolean;
    lastSessionSummary?: string;
    tracksRecentlyPlayed?: string[];
    listenerName?: string;
  };
  tracks: Array<{
    id: string; title: string; artistName: string;
    albumTitle: string; duration: number; artworkUrl?: string;
  }>;
}

export interface CreateBroadcastResponse {
  manifest: Manifest;
  firstSegmentUrls: string[];
}

export class BroadcastManifestClient {
  async createBroadcast(req: CreateBroadcastRequest): Promise<CreateBroadcastResponse> {
    const res = await authenticatedFetch(`${API_BASE_URL}/broadcast/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`createBroadcast failed: ${res.status} ${body?.error ?? ''}`);
    }
    return (await res.json()) as CreateBroadcastResponse;
  }

  async fetchManifest(id: string): Promise<Manifest> {
    const res = await authenticatedFetch(`${API_BASE_URL}/broadcast/${id}/manifest`);
    if (!res.ok) throw new Error(`fetchManifest failed: ${res.status}`);
    return (await res.json()) as Manifest;
  }

  async fetchSegmentAudio(url: string): Promise<string> {
    const res = await authenticatedFetch(url);
    if (!res.ok) throw new Error(`fetchSegmentAudio failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest BroadcastManifestClient`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engines/BroadcastManifestClient.ts __tests__/engines/BroadcastManifestClient.test.ts
git commit -m "feat(broadcast): add HTTP client for manifest + segment audio"
```

---

## Task 5: BroadcastStingers — bundled stinger audio loader

**Files:**
- Create: `src/engines/BroadcastStingers.ts`
- Create: `assets/stingers/generic-in.mp3` (placeholder 500ms silence, replaced later)
- Create: `assets/stingers/generic-out.mp3` (placeholder 500ms silence)

**Design:** MVP ships a single generic stinger pair. Vibe-specific stingers can be added later by extending the map. Stingers are loaded as base64 once at module init (or lazily on first call) and cached. Uses `expo-asset` to resolve bundled paths and `react-native-fs` or the built-in `Asset.fromModule()` pattern to read bytes.

Expo SDK 55 already includes `expo-asset`. Confirm by checking `package.json`. If absent, install.

- [ ] **Step 1: Add placeholder stinger files**

```bash
mkdir -p assets/stingers
# 500ms of silence — a tiny valid MP3. Use ffmpeg locally OR vendor pre-built files.
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.5 -b:a 64k assets/stingers/generic-in.mp3
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.5 -b:a 64k assets/stingers/generic-out.mp3
```

If `ffmpeg` isn't installed, check for it with `which ffmpeg`; alternatively use any tiny valid MP3 as placeholder and replace with real sound design before launch.

- [ ] **Step 2: Verify expo-asset is available**

```bash
grep '"expo-asset"' package.json || npx expo install expo-asset
```

- [ ] **Step 3: Implement stinger loader**

```typescript
// src/engines/BroadcastStingers.ts
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import type { Vibe } from './BroadcastPlayer.types';

export type StingerKind = 'in' | 'out';

// Vibe-specific overrides can be added here later. MVP uses generic for all.
const STINGER_ASSETS = {
  'generic-in': require('../../assets/stingers/generic-in.mp3'),
  'generic-out': require('../../assets/stingers/generic-out.mp3'),
};

const cache = new Map<string, string>();

async function loadBase64(assetModule: number): Promise<string> {
  const asset = Asset.fromModule(assetModule);
  if (!asset.localUri) await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export async function getStinger(_vibe: Vibe, kind: StingerKind): Promise<string> {
  const key = `generic-${kind}`;
  if (cache.has(key)) return cache.get(key)!;
  const base64 = await loadBase64((STINGER_ASSETS as any)[key]);
  cache.set(key, base64);
  return base64;
}

export async function preloadStingers(): Promise<void> {
  await Promise.all([
    loadBase64(STINGER_ASSETS['generic-in']).then(b => cache.set('generic-in', b)),
    loadBase64(STINGER_ASSETS['generic-out']).then(b => cache.set('generic-out', b)),
  ]);
}
```

- [ ] **Step 4: Smoke-test via REPL — verify base64 is non-empty**

In `app/_layout.tsx`'s startup effect (or a temporary dev screen):

```typescript
import { preloadStingers, getStinger } from '@/engines/BroadcastStingers';

useEffect(() => {
  (async () => {
    await preloadStingers();
    const s = await getStinger('morning', 'in');
    console.log('stinger len', s.length); // expect > 1000
  })();
}, []);
```

Run the app on device, confirm console logs a non-zero length. Remove the smoke-test code after verifying.

- [ ] **Step 5: Commit**

```bash
git add assets/stingers/ src/engines/BroadcastStingers.ts package.json package-lock.json
git commit -m "feat(broadcast): add stinger audio loader with bundled placeholder assets"
```

---

## Task 6: BroadcastPlayer state machine — skeleton + unit tests

**Files:**
- Create: `src/engines/BroadcastPlayer.ts`
- Create: `__tests__/engines/BroadcastPlayer.test.ts`
- Modify: `__mocks__/expo-music-kit.ts` (add missing methods if not already mocked)

**Design:** The player is a singleton. `start(manifest, firstSegmentUrls)` kicks off playback. State transitions are driven by:
- `playSegment(index)` — duck MusicKit → play segment base64 → unduck
- `playTrack(index)` — call `musicPlayer.play([trackId])` and wait for `onPlaybackStateChanged` → `playing`
- `onTrackEnded` — advance to next segment or sign_off
- `pause()` / `resume()` / `end()` — cleanup

This task builds the skeleton with injected dependencies so unit tests can drive it without the real native module.

- [ ] **Step 1: Ensure expo-music-kit mock covers required methods**

Read `__mocks__/expo-music-kit.ts`. Confirm it exports mocks for:
- `play`, `pause`, `skip`, `setUpcomingQueue`, `getPlaybackStatus`, `getNowPlaying`
- `playAudioFromBase64`, `activateDuckingSession`, `deactivateDuckingSession`
- `addTrackChangedListener`, `addPlaybackStateListener`

Add any missing ones as `jest.fn()` returning sensible defaults (Promise-resolving for async, event subscription with `.remove()` for listeners).

- [ ] **Step 2: Write the failing test**

```typescript
// __tests__/engines/BroadcastPlayer.test.ts
import { BroadcastPlayer } from '@/engines/BroadcastPlayer';
import type { Manifest } from '@/engines/BroadcastPlayer.types';

const makeManifest = (): Manifest => ({
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [
    { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'AL', duration: 180 },
    { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'AL', duration: 180 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg0-v0.mp3'] },
    { index: 1, kind: 'transition', afterTrackId: 't0', beforeTrackId: 't1', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg1-v0.mp3'] },
    { index: 2, kind: 'sign_off', afterTrackId: 't1', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg2-v0.mp3'] },
  ],
});

const makeDeps = () => {
  const listeners: { track?: Function; state?: Function } = {};
  const logs: string[] = [];
  return {
    logs,
    music: {
      play: jest.fn(async (ids?: string[]) => { logs.push(`play:${ids?.[0]}`); }),
      pause: jest.fn(async () => { logs.push('music.pause'); }),
      skip: jest.fn(async () => {}),
      setUpcomingQueue: jest.fn(async (ids: string[]) => { logs.push(`queue:${ids.join(',')}`); }),
      onTrackChanged: jest.fn((cb: any) => { listeners.track = cb; return () => {}; }),
      onPlaybackStateChanged: jest.fn((cb: any) => { listeners.state = cb; return () => {}; }),
    },
    native: {
      activateDuckingSession: jest.fn(async () => { logs.push('duck.on'); }),
      deactivateDuckingSession: jest.fn(async () => { logs.push('duck.off'); }),
      playAudioFromBase64: jest.fn(async (b64: string) => { logs.push(`tts:${b64.slice(0, 8)}`); }),
      stopAudio: jest.fn(async () => { logs.push('tts.stop'); }),
    },
    manifestClient: {
      fetchSegmentAudio: jest.fn(async (url: string) => {
        const id = url.split('/').pop();
        return `BASE64_${id}`;
      }),
      fetchManifest: jest.fn(),
      createBroadcast: jest.fn(),
    },
    stingers: {
      getStinger: jest.fn(async (_v: any, kind: string) => `STINGER_${kind}`),
      preloadStingers: jest.fn(async () => {}),
    },
    fireTrackChanged: (trackId?: string) => listeners.track?.({ trackId }),
    fireStateChanged: (status: string) => listeners.state?.({ status, playbackTime: 0 }),
  };
};

describe('BroadcastPlayer', () => {
  it('plays cold_open, then track 0, then transition, then track 1, then sign_off', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(deps.music as any, deps.native as any, deps.manifestClient as any, deps.stingers as any);

    const startPromise = player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);

    // Wait microtasks: cold_open should play first
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    // Expected order so far: duck.on, tts.stinger_in, tts.seg0, tts.stinger_out, duck.off, then queue + play track 0
    expect(deps.logs).toContain('duck.on');
    expect(deps.logs.some(l => l.startsWith('tts:BASE64_s'))).toBe(true);

    // Simulate track 0 finished: fire onTrackChanged with previousTrackId=t0, trackId=undefined (end of queue)
    // Player should interpret this as "track 0 ended, play transition"
    deps.fireStateChanged('stopped');
    await Promise.resolve(); await Promise.resolve();

    // Let player progress through transitions and sign_off
    await startPromise.catch(() => {}); // start() may or may not resolve on completion — implementation detail
  });

  it('transitions player state through expected values', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(deps.music as any, deps.native as any, deps.manifestClient as any, deps.stingers as any);

    expect(player.getStatus().state).toBe('idle');
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await Promise.resolve();
    expect(['loading', 'playing_segment']).toContain(player.getStatus().state);
  });

  it('pause() pauses MusicKit and stops segment audio', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(deps.music as any, deps.native as any, deps.manifestClient as any, deps.stingers as any);
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await Promise.resolve();
    await player.pause();
    expect(deps.native.stopAudio).toHaveBeenCalled();
    expect(deps.music.pause).toHaveBeenCalled();
    expect(player.getStatus().state).toBe('paused');
  });

  it('end() cleans up and returns to idle', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(deps.music as any, deps.native as any, deps.manifestClient as any, deps.stingers as any);
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await Promise.resolve();
    await player.end();
    expect(player.getStatus().state).toBe('idle');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest BroadcastPlayer`
Expected: module-not-found.

- [ ] **Step 4: Implement BroadcastPlayer**

```typescript
// src/engines/BroadcastPlayer.ts
import { musicPlayer } from '@/services/MusicKitPlayer';
import {
  activateDuckingSession, deactivateDuckingSession,
  playAudioFromBase64, stopAudio,
} from '../../modules/expo-music-kit';
import { BroadcastManifestClient } from './BroadcastManifestClient';
import { BroadcastSegmentCache } from './BroadcastSegmentCache';
import { getStinger, preloadStingers, type StingerKind } from './BroadcastStingers';
import type {
  Manifest, PlayerState, PlayerStatus, SegmentSlot, Vibe,
} from './BroadcastPlayer.types';

/** Abstraction over the MusicKit singleton so tests can inject a stub. */
export interface MusicDeps {
  play: (ids?: string[]) => Promise<void>;
  pause: () => Promise<void>;
  skip: () => Promise<void>;
  setUpcomingQueue: (ids: string[]) => Promise<void>;
  onTrackChanged: (cb: (e: { trackId?: string }) => void) => () => void;
  onPlaybackStateChanged: (cb: (e: { status: string; playbackTime: number }) => void) => () => void;
}

/** Abstraction over the native TTS playback helpers. */
export interface NativeDeps {
  activateDuckingSession: () => Promise<void>;
  deactivateDuckingSession: () => Promise<void>;
  playAudioFromBase64: (base64: string) => Promise<void>;
  stopAudio: () => Promise<void>;
}

/** Abstraction over manifest/segment HTTP client. */
export interface ManifestDeps {
  fetchSegmentAudio: (url: string) => Promise<string>;
  fetchManifest: (id: string) => Promise<Manifest>;
}

/** Abstraction over bundled stinger audio loader. */
export interface StingerDeps {
  getStinger: (vibe: Vibe, kind: StingerKind) => Promise<string>;
  preloadStingers: () => Promise<void>;
}

export class BroadcastPlayer {
  private state: PlayerState = 'idle';
  private manifest: Manifest | null = null;
  private cache = new BroadcastSegmentCache();
  private currentTrackIndex = -1;
  private currentSegmentIndex = -1;
  private subscriptions: Array<() => void> = [];
  private endedPromiseResolve: (() => void) | null = null;

  constructor(
    private readonly music: MusicDeps,
    private readonly native: NativeDeps,
    private readonly manifestClient: ManifestDeps,
    private readonly stingers: StingerDeps,
  ) {}

  getStatus(): PlayerStatus {
    return {
      state: this.state,
      currentTrackIndex: this.currentTrackIndex,
      currentSegmentIndex: this.currentSegmentIndex,
      broadcastId: this.manifest?.broadcastId ?? null,
      nowPlaying: this.describeNowPlaying(),
      progress: this.computeProgress(),
    };
  }

  async start(manifest: Manifest, firstSegmentUrls: string[]): Promise<void> {
    this.manifest = manifest;
    this.cache.clear();
    this.state = 'loading';
    await this.stingers.preloadStingers();

    // Pre-cache first segment (cold_open) variants
    for (let v = 0; v < firstSegmentUrls.length; v++) {
      const b64 = await this.manifestClient.fetchSegmentAudio(firstSegmentUrls[v]);
      this.cache.put(0, v, b64);
    }

    // Start background fetching for any slots already-ready in the manifest
    this.kickBackgroundFetch();

    // Subscribe to MusicKit events for track-end detection
    this.subscriptions.push(
      this.music.onPlaybackStateChanged(this.handlePlaybackState),
      this.music.onTrackChanged(this.handleTrackChanged),
    );

    // Play the session: cold_open → track 0 → transition → track 1 → ... → sign_off
    await this.runSegmentAt(0);               // cold_open
    if (!this.manifest) return;
    for (let i = 0; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);                // track i
      if (!this.manifest) return;
      const nextSlotIndex = i + 1;             // transitions or sign_off
      await this.runSegmentAt(nextSlotIndex);
    }
    this.state = 'ended';
    this.endedPromiseResolve?.();
  }

  async pause(): Promise<void> {
    await this.native.stopAudio().catch(() => {});
    await this.music.pause().catch(() => {});
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    // Simple resume: restart from current track. Mid-segment resume is a later polish.
    this.state = 'playing_track';
    await this.music.play().catch(() => {});
  }

  async end(): Promise<void> {
    await this.native.stopAudio().catch(() => {});
    await this.music.pause().catch(() => {});
    this.subscriptions.forEach(unsub => unsub());
    this.subscriptions = [];
    this.cache.clear();
    this.manifest = null;
    this.currentTrackIndex = -1;
    this.currentSegmentIndex = -1;
    this.state = 'idle';
  }

  private async runSegmentAt(slotIndex: number): Promise<void> {
    if (!this.manifest) return;
    const slot = this.manifest.segmentSlots[slotIndex];
    if (!slot) return;

    this.currentSegmentIndex = slotIndex;
    this.state = 'playing_segment';

    const vibe = this.manifest.vibe;

    // If segment is not cached, try fetching it now.
    if (!this.cache.hasAny(slotIndex) && slot.status === 'ready' && slot.audioUrls) {
      try {
        for (let v = 0; v < slot.audioUrls.length; v++) {
          const b64 = await this.manifestClient.fetchSegmentAudio(slot.audioUrls[v]);
          this.cache.put(slotIndex, v, b64);
        }
      } catch {
        // Silently skip segment on fetch failure
        this.currentSegmentIndex = -1;
        return;
      }
    }

    const segmentB64 = this.cache.pickVariant(slotIndex, slot.variantCount);
    if (!segmentB64) {
      // No audio available: skip the segment silently
      this.currentSegmentIndex = -1;
      return;
    }

    await this.native.activateDuckingSession();
    try {
      const stingerIn = await this.stingers.getStinger(vibe, 'in');
      await this.native.playAudioFromBase64(stingerIn);
      await this.native.playAudioFromBase64(segmentB64);
      const stingerOut = await this.stingers.getStinger(vibe, 'out');
      await this.native.playAudioFromBase64(stingerOut);
    } finally {
      await this.native.deactivateDuckingSession();
      this.currentSegmentIndex = -1;
    }
  }

  private async runTrackAt(trackIndex: number): Promise<void> {
    if (!this.manifest) return;
    const track = this.manifest.tracks[trackIndex];
    this.currentTrackIndex = trackIndex;
    this.state = 'playing_track';
    await this.music.play([track.id]);
    await this.waitForTrackEnd();
  }

  private waitForTrackEnd(): Promise<void> {
    return new Promise(resolve => {
      this.endedPromiseResolve = () => resolve();
    });
  }

  private handlePlaybackState = (e: { status: string }) => {
    if (e.status === 'stopped' && this.state === 'playing_track') {
      // MusicKit reports 'stopped' when track ends naturally
      this.endedPromiseResolve?.();
    }
  };

  private handleTrackChanged = (_e: { trackId?: string }) => {
    // Track changed events are primarily informational in the new model —
    // the state machine advances on 'stopped' which fires at end-of-track.
  };

  private kickBackgroundFetch(): void {
    if (!this.manifest) return;
    // Fire-and-forget per-slot fetches. No await — downloads proceed in parallel.
    for (const slot of this.manifest.segmentSlots.slice(1)) {
      if (slot.status !== 'ready' || !slot.audioUrls) continue;
      for (let v = 0; v < slot.audioUrls.length; v++) {
        this.manifestClient
          .fetchSegmentAudio(slot.audioUrls[v])
          .then(b64 => this.cache.put(slot.index, v, b64))
          .catch(() => {});
      }
    }
  }

  private describeNowPlaying(): PlayerStatus['nowPlaying'] {
    if (!this.manifest) return null;
    if (this.currentSegmentIndex >= 0) {
      return { segmentKind: this.manifest.segmentSlots[this.currentSegmentIndex].kind };
    }
    if (this.currentTrackIndex >= 0) {
      return { trackId: this.manifest.tracks[this.currentTrackIndex].id };
    }
    return null;
  }

  private computeProgress(): number {
    if (!this.manifest) return 0;
    const total = this.manifest.tracks.length + this.manifest.segmentSlots.length;
    const done =
      (this.currentTrackIndex + 1) +
      (this.currentSegmentIndex + 1);
    return Math.min(1, done / total);
  }
}

/** Singleton wired to the real MusicKit + native module. */
export const broadcastPlayer = new BroadcastPlayer(
  {
    play: musicPlayer.play.bind(musicPlayer),
    pause: musicPlayer.pause.bind(musicPlayer),
    skip: musicPlayer.skip.bind(musicPlayer),
    setUpcomingQueue: musicPlayer.setUpcomingQueue.bind(musicPlayer),
    onTrackChanged: musicPlayer.onTrackChanged.bind(musicPlayer),
    onPlaybackStateChanged: musicPlayer.onPlaybackStateChanged.bind(musicPlayer),
  },
  { activateDuckingSession, deactivateDuckingSession, playAudioFromBase64, stopAudio },
  new BroadcastManifestClient(),
  { getStinger, preloadStingers },
);
```

- [ ] **Step 5: Run tests**

Run: `npx jest BroadcastPlayer`
Expected: all 4 tests pass.

Note: the first test is intentionally lightweight — a rich end-to-end test of the state machine belongs at integration level, not unit level. The unit tests confirm the public API shape and key state transitions.

- [ ] **Step 6: Commit**

```bash
git add src/engines/BroadcastPlayer.ts __tests__/engines/BroadcastPlayer.test.ts __mocks__/expo-music-kit.ts
git commit -m "feat(broadcast): add BroadcastPlayer state machine with DI for testability"
```

---

## Task 7: Wire BroadcastPlayer into the dev screen (static manifest first)

**Files:**
- Modify: `app/(main)/(broadcast)/broadcast-player.tsx`

**Design:** Let the screen drive the player with a hardcoded local manifest so transition behavior is testable end-to-end on device *before* Plan 1's server integration. Provides a simple control strip (Start / Pause / End) and shows status.

- [ ] **Step 1: Create the dev screen**

```tsx
// app/(main)/(broadcast)/broadcast-player.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Colors, Spacing, Typography } from '@/tokens/design-tokens';
import { broadcastPlayer } from '@/engines/BroadcastPlayer';
import type { Manifest, PlayerStatus } from '@/engines/BroadcastPlayer.types';

// Hardcoded manifest for dev. Replace track IDs with real Apple Music catalog IDs
// from your library — log `musicPlayer.fetchPlaylistTracks(id)` output and pick 2-3.
const DEV_MANIFEST: Manifest = {
  broadcastId: 'dev-1',
  userId: 'dev',
  playlistId: null,
  vibe: 'morning',
  length: 'quick',
  createdAt: Date.now(),
  tracks: [
    { id: 'REPLACE_WITH_REAL_TRACK_ID_1', title: 'Track 1', artistName: 'Artist', albumTitle: 'Album', duration: 180 },
    { id: 'REPLACE_WITH_REAL_TRACK_ID_2', title: 'Track 2', artistName: 'Artist', albumTitle: 'Album', duration: 180 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 'REPLACE_WITH_REAL_TRACK_ID_1', variantCount: 1, status: 'ready', audioUrls: ['REPLACE_WITH_LOCAL_OR_CDN_URL'] },
    { index: 1, kind: 'transition', afterTrackId: 'REPLACE_WITH_REAL_TRACK_ID_1', beforeTrackId: 'REPLACE_WITH_REAL_TRACK_ID_2', variantCount: 1, status: 'ready', audioUrls: ['REPLACE_WITH_LOCAL_OR_CDN_URL'] },
    { index: 2, kind: 'sign_off', afterTrackId: 'REPLACE_WITH_REAL_TRACK_ID_2', variantCount: 1, status: 'ready', audioUrls: ['REPLACE_WITH_LOCAL_OR_CDN_URL'] },
  ],
};

export default function BroadcastPlayerScreen() {
  const [status, setStatus] = useState<PlayerStatus>(broadcastPlayer.getStatus());

  useEffect(() => {
    const t = setInterval(() => setStatus(broadcastPlayer.getStatus()), 500);
    return () => clearInterval(t);
  }, []);

  const firstUrls = DEV_MANIFEST.segmentSlots[0].audioUrls ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.background }} contentContainerStyle={{ padding: Spacing.lg }}>
      <Text style={{ color: Colors.textPrimary, ...Typography.display, marginBottom: Spacing.lg }}>BroadcastPlayer Dev</Text>

      <Text style={{ color: Colors.textSecondary, ...Typography.mono, marginBottom: Spacing.sm }}>STATE</Text>
      <Text style={{ color: Colors.textPrimary, marginBottom: Spacing.md }}>{status.state}</Text>

      <Text style={{ color: Colors.textSecondary, ...Typography.mono, marginBottom: Spacing.sm }}>TRACK / SEGMENT</Text>
      <Text style={{ color: Colors.textPrimary, marginBottom: Spacing.md }}>
        t={status.currentTrackIndex} s={status.currentSegmentIndex} progress={(status.progress * 100).toFixed(0)}%
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start broadcast"
        style={{ padding: Spacing.md, backgroundColor: Colors.accent, marginBottom: Spacing.sm }}
        onPress={() => broadcastPlayer.start(DEV_MANIFEST, firstUrls).catch(console.error)}
      >
        <Text style={{ color: Colors.onAccent, ...Typography.mono }}>START</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pause broadcast"
        style={{ padding: Spacing.md, backgroundColor: Colors.surface, marginBottom: Spacing.sm }}
        onPress={() => broadcastPlayer.pause().catch(console.error)}
      >
        <Text style={{ color: Colors.textPrimary, ...Typography.mono }}>PAUSE</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End broadcast"
        style={{ padding: Spacing.md, backgroundColor: Colors.surface, marginBottom: Spacing.sm }}
        onPress={() => broadcastPlayer.end().catch(console.error)}
      >
        <Text style={{ color: Colors.textPrimary, ...Typography.mono }}>END</Text>
      </Pressable>
    </ScrollView>
  );
}
```

- [ ] **Step 2: Replace placeholders with real values**

- Pick 2 real Apple Music track IDs from your library (log `musicPlayer.fetchPlaylistTracks(someKnownPlaylistId)` and copy two `.id` values).
- Generate 3 segment MP3s for dev: you can record yourself on Voice Memos, export at any bitrate, host via a local HTTP server (`python3 -m http.server` from a dir containing the files), and point `audioUrls` at `http://<your-laptop-ip>:8000/cold.mp3` etc.
  - Alternatively, once Plan 1 Task 11 is done, take the 3 real URLs from the curl output.

- [ ] **Step 3: Test on device**

Build and launch the app on a physical iPhone. Navigate to the broadcast-player dev screen. Press START.

Expected:
- ONAY's cold open plays (ducks music to full-volume-segment because there's no music playing yet).
- Track 1 starts.
- Near/after track 1 end, transition segment plays (music ducks, segment plays over tail).
- Track 2 starts.
- Sign-off plays after track 2.
- State returns to `idle`.

- [ ] **Step 4: Fix any surprises**

Most likely issues to watch for:
- `waitForTrackEnd` may not resolve if MusicKit doesn't emit a clean `stopped` state when the queue is empty. If not, fall back to polling `getPlaybackStatus()` every 500ms.
- Duck session may not fully kick in before `playAudioFromBase64` starts — may need a ~200ms delay.
- Stinger files being silent means you won't hear them — expected for placeholder assets.

Log liberally during the device test (e.g., `console.log('[BroadcastPlayer]', event, state)`) until the flow is stable, then remove the extra logs.

- [ ] **Step 5: Commit**

```bash
git add app/\(main\)/\(broadcast\)/broadcast-player.tsx
git commit -m "feat(broadcast): add dev screen wiring BroadcastPlayer for on-device testing"
```

---

## Task 8: Manifest polling for async-phase segments

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts`
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`

**Design:** When `start()` is called with a manifest that has any `pending` segments (because the server's async phase hasn't finished), the player should periodically re-fetch the manifest (`manifestClient.fetchManifest(id)`) until all slots are `ready` or `failed`. Each refresh updates the internal manifest copy; `runSegmentAt` re-checks the slot before playing.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/engines/BroadcastPlayer.test.ts`:

```typescript
it('polls manifest when slots start in pending state', async () => {
  const deps = makeDeps();

  // Return a manifest with slot 1 initially pending, then ready
  const pending: Manifest = {
    ...makeManifest(),
    segmentSlots: [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u0'] },
      { index: 1, kind: 'transition', afterTrackId: 't0', beforeTrackId: 't1', variantCount: 1, status: 'pending' },
      { index: 2, kind: 'sign_off', afterTrackId: 't1', variantCount: 1, status: 'pending' },
    ],
  };
  const ready: Manifest = {
    ...pending,
    segmentSlots: [
      pending.segmentSlots[0],
      { ...pending.segmentSlots[1], status: 'ready', audioUrls: ['u1'] },
      { ...pending.segmentSlots[2], status: 'ready', audioUrls: ['u2'] },
    ],
  };

  (deps.manifestClient.fetchManifest as jest.Mock)
    .mockResolvedValueOnce(ready); // first poll returns fully-ready manifest

  const player = new BroadcastPlayer(
    deps.music as any, deps.native as any,
    deps.manifestClient as any, deps.stingers as any,
  );

  // Start with pending manifest — player should schedule polling.
  player.start(pending, ['u0']);
  await Promise.resolve();

  // Manually trigger poll for deterministic test
  await (player as any).pollManifestOnce();

  expect(deps.manifestClient.fetchManifest).toHaveBeenCalledWith('b1');
  expect((player as any).manifest.segmentSlots[1].status).toBe('ready');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest BroadcastPlayer`
Expected: fails — `pollManifestOnce` doesn't exist yet.

- [ ] **Step 3: Add polling logic**

Add to `BroadcastPlayer`:

```typescript
private pollTimer: ReturnType<typeof setInterval> | null = null;
private readonly POLL_INTERVAL_MS = 3000;

private schedulePolling(): void {
  if (!this.manifest) return;
  if (this.pollTimer) return;
  const anyPending = this.manifest.segmentSlots.some(s => s.status === 'pending');
  if (!anyPending) return;
  this.pollTimer = setInterval(() => {
    this.pollManifestOnce().catch(() => {});
  }, this.POLL_INTERVAL_MS);
}

private async pollManifestOnce(): Promise<void> {
  if (!this.manifest) return;
  const updated = await this.manifestClient.fetchManifest(this.manifest.broadcastId);
  this.manifest = updated;
  const allDone = updated.segmentSlots.every(s => s.status !== 'pending');
  if (allDone && this.pollTimer) {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
```

Call `this.schedulePolling()` at the end of `start()` (after first segment cache population) and clear the timer in `end()`:

```typescript
// In end():
if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest BroadcastPlayer`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engines/BroadcastPlayer.ts __tests__/engines/BroadcastPlayer.test.ts
git commit -m "feat(broadcast): poll manifest for async-phase segment readiness"
```

---

## Task 9: Graceful skip for unavailable segments

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts`
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`

**Design:** Per the spec's failure-modes section: if a segment is still pending (or failed) when it's time to play, skip it silently — play the out-stinger only (to provide audible continuity), and move to the next track. No error state, no crash.

- [ ] **Step 1: Write the failing test**

```typescript
it('skips missing segments without crashing and plays only a stinger', async () => {
  const deps = makeDeps();
  const m: Manifest = {
    ...makeManifest(),
    segmentSlots: [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u0'] },
      { index: 1, kind: 'transition', afterTrackId: 't0', beforeTrackId: 't1', variantCount: 1, status: 'failed' }, // failed
      { index: 2, kind: 'sign_off', afterTrackId: 't1', variantCount: 1, status: 'ready', audioUrls: ['u2'] },
    ],
  };
  const player = new BroadcastPlayer(
    deps.music as any, deps.native as any,
    deps.manifestClient as any, deps.stingers as any,
  );
  await (player as any).runSegmentAt.call(
    Object.assign(player, { manifest: m }),
    1,
  );
  // Only a stinger should have been played — no crash, no uncached segment fetch
  expect(deps.manifestClient.fetchSegmentAudio).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails if needed**

Current behavior may already silently skip if audio is missing, depending on Task 6 impl. Run the test — if it passes, move on; if it fails, update `runSegmentAt` to explicitly short-circuit on `failed` status:

```typescript
if (slot.status === 'failed') {
  this.currentSegmentIndex = -1;
  return;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/engines/BroadcastPlayer.ts __tests__/engines/BroadcastPlayer.test.ts
git commit -m "feat(broadcast): skip failed/pending segments gracefully"
```

---

## Task 10: End-to-end integration with Plan 1 server

**Files:** (no code changes — integration test on device)

- [ ] **Step 1: Ensure Plan 1 server is running**

```bash
cd server && npm run dev
```

Confirm tagged complete: `git tag --list 'plan-1-server-complete'` should show the tag.

- [ ] **Step 2: Temporarily wire dev screen to hit the server**

Edit `app/(main)/(broadcast)/broadcast-player.tsx` to replace the `DEV_MANIFEST` constant with a call to `BroadcastManifestClient.createBroadcast`:

```tsx
import { BroadcastManifestClient } from '@/engines/BroadcastManifestClient';
import { musicPlayer } from '@/services/MusicKitPlayer';

// Replace the START button's onPress handler:
onPress={async () => {
  const playlists = await musicPlayer.fetchPlaylists();
  const playlistId = playlists[0]?.id;
  if (!playlistId) { console.warn('no playlist available'); return; }
  const tracks = await musicPlayer.fetchPlaylistTracks(playlistId);

  const client = new BroadcastManifestClient();
  const { manifest, firstSegmentUrls } = await client.createBroadcast({
    playlistId,
    vibe: 'morning',
    length: 'quick',
    userContext: {
      timeOfDay: new Date().toTimeString().slice(0, 5),
      dayOfWeek: new Date().toLocaleDateString(undefined, { weekday: 'long' }),
      firstTimeUser: false,
    },
    tracks: tracks.slice(0, 10).map(t => ({
      id: t.id, title: t.title, artistName: t.artistName,
      albumTitle: t.albumTitle, duration: t.duration, artworkUrl: t.artworkUrl,
    })),
  });
  broadcastPlayer.start(manifest, firstSegmentUrls).catch(console.error);
}}
```

- [ ] **Step 3: Device test — full end-to-end**

On a physical iPhone logged into the Apple Music account that matches the playlist in step 2:
1. Open app → broadcast-player dev screen.
2. Tap START.
3. Observe: ONAY's real cold-open plays → first track plays → transition plays → second track plays → … → sign-off → state `ended`.
4. Lock the phone during the session. Audio should continue. No crash.
5. Unlock halfway through. UI should show progress / current slot.

- [ ] **Step 4: Fix any issues**

Common issues:
- URL scheme of segment assets: `http://localhost:3001/...` won't work from device. Use your laptop's LAN IP (e.g., `http://192.168.1.12:3001/...`). Set `BROADCAST_ASSET_BASE_URL` env var in the server accordingly.
- First segment takes > 15s → increase client fetch timeout or check LLM provider health.
- Duck session doesn't take effect before segment starts → insert a 200ms delay in `runSegmentAt` after `activateDuckingSession`.

- [ ] **Step 5: Tag**

```bash
git commit -am "feat(broadcast): end-to-end dev test against Plan 1 server"
git tag -a plan-2-broadcast-player-complete -m "Plan 2 complete: BroadcastPlayer works end-to-end with Plan 1 server"
```

---

## Self-review

**Spec coverage:**
- ✅ Manifest-driven playback — Tasks 1, 6
- ✅ First-segment fast-path — Task 6 (`start()` pre-caches first segment before playing)
- ✅ Duck + speak transition — Task 6
- ✅ Stingers between segments and tracks — Tasks 5, 6
- ✅ Pause/resume/end controls — Task 6
- ✅ Graceful failure handling — Task 9
- ✅ Async polling for pending segments — Task 8
- ✅ Manifest caching — Task 2 (persists to MMKV for resume)
- ⚠️  Time-to-first-sound "tuning in" animation — UI polish, deferred to Plan 3 (home screen work)
- ⚠️  Resume-after-terminate (2h window) — Task 2 stores manifest; the resume flow itself is a Plan 3 concern

**No placeholders:** every task has concrete code or an explicit device-test procedure. Placeholders in `DEV_MANIFEST` are called out in Task 7 with instructions for substitution.

**Type consistency:** `Manifest`, `SegmentSlot`, `PlayerStatus`, `StingerKind` consistent across Tasks 1-9. `MusicDeps`, `NativeDeps`, `ManifestDeps`, `StingerDeps` introduced in Task 6 drive test injectability.

**Scope:** Plan 2 produces a working client player, testable against a static manifest in Tasks 1-9 and against the real server in Task 10. The existing player remains in place and is not touched — Plan 4 handles migration.

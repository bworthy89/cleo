# Cartesia TTS Cost Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce monthly Cartesia TTS bill by ~30-40% via server-side filesystem cache and tiered word budgets.

**Architecture:** A `CachingTTSProvider` decorator wraps the existing `TTSProviderFactory` singleton, intercepting `synthesize()` calls with SHA-256 hash lookups against a local filesystem cache. Separately, a `WORD_BUDGET` map in `SegmentController.ts` caps `maxWords` per segment type via `Math.min`.

**Tech Stack:** Node.js `crypto` (SHA-256), `fs/promises` (cache I/O), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-24-cartesia-tts-caching-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/src/providers/tts/cache.ts` | Create | `CachingTTSProvider` — filesystem cache wrapping any `TTSProvider` |
| `server/src/providers/tts/index.ts` | Modify | Wrap `TTSProviderFactory` singleton with `CachingTTSProvider` |
| `src/engines/SegmentController.ts` | Modify | Add `WORD_BUDGET` map, apply `Math.min` ceiling at line 274 |
| `.gitignore` | Modify | Add `server/.cache/` |

---

### Task 1: Create `CachingTTSProvider`

**Files:**
- Create: `server/src/providers/tts/cache.ts`

- [ ] **Step 1: Create the caching provider**

```typescript
// server/src/providers/tts/cache.ts
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { TTSProvider, TTSRequest, TTSResponse } from './types';

export class CachingTTSProvider implements TTSProvider {
  readonly name: string;
  private inner: TTSProvider;
  private cacheDir: string;
  private ready: Promise<void>;

  constructor(inner: TTSProvider) {
    this.inner = inner;
    this.name = `cached:${inner.name}`;
    this.cacheDir = process.env.TTS_CACHE_DIR || join(homedir(), '.cache', 'cleo-tts');
    this.ready = mkdir(this.cacheDir, { recursive: true }).then(() => {});
  }

  // Cache key includes voice ID and model ID so changing either
  // automatically invalidates stale entries. stability and style are
  // excluded intentionally — they affect tone subtly, not content,
  // and including them would fragment the cache on vibe changes.
  private getCacheKey(request: TTSRequest): string {
    const voiceId = process.env.CARTESIA_VOICE_ID || '';
    const modelId = process.env.CARTESIA_MODEL_ID || 'sonic-3';
    const input = `${request.text}|${request.speed}|${voiceId}|${modelId}`;
    return createHash('sha256').update(input).digest('hex');
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    await this.ready;
    const hash = this.getCacheKey(request);
    const cachePath = join(this.cacheDir, hash);

    // Try cache read
    try {
      const fileInfo = await stat(cachePath);
      if (fileInfo.size > 0) {
        const audioContent = await readFile(cachePath, 'utf-8');
        console.log(`[TTS:cache] HIT ${hash.slice(0, 8)}`);
        return { audioContent };
      }
      // Empty file — treat as miss, clean up
      await unlink(cachePath).catch(() => {});
    } catch {
      // File doesn't exist — cache miss, fall through
    }

    // Cache miss — synthesize
    console.log(`[TTS:cache] MISS ${hash.slice(0, 8)} — synthesizing`);
    const result = await this.inner.synthesize(request);

    // Atomic write: temp file then rename
    const tmpPath = `${cachePath}.tmp.${process.pid}`;
    try {
      await writeFile(tmpPath, result.audioContent, 'utf-8');
      await rename(tmpPath, cachePath);
    } catch (err) {
      console.warn(`[TTS:cache] Write failed:`, (err as Error).message);
      await unlink(tmpPath).catch(() => {});
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/tts/cache.ts
git commit -m "feat(server): add CachingTTSProvider with filesystem cache"
```

---

### Task 2: Wire cache into provider factory

**Files:**
- Modify: `server/src/providers/tts/index.ts:160`

- [ ] **Step 1: Import and wrap the factory singleton**

At the top of `server/src/providers/tts/index.ts`, add the import:

```typescript
import { CachingTTSProvider } from './cache';
```

At the bottom, replace line 160:

```typescript
export const ttsProvider = new TTSProviderFactory();
```

With:

```typescript
const _factory = new TTSProviderFactory();

// Wrap the factory with filesystem caching.
// The adapter gives TTSProviderFactory a TTSProvider interface so
// CachingTTSProvider can wrap it. Name is static ('factory') because
// getStatus().active is not yet populated at module load time.
const _cache = new CachingTTSProvider({
  name: 'factory',
  synthesize: (req: TTSRequest) => _factory.synthesize(req),
  healthCheck: async () => true,
});

export const ttsProvider = {
  synthesize: (req: TTSRequest) => _cache.synthesize(req),
  getStatus: () => _factory.getStatus(),
  destroy: () => _factory.destroy(),
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/tts/index.ts
git commit -m "feat(server): wire CachingTTSProvider into TTS factory"
```

---

### Task 3: Add `server/.cache/` to `.gitignore` and document `TTS_CACHE_DIR`

**Files:**
- Modify: `.gitignore`
- Modify: `server/.env.example` (if it exists; create if not)

- [ ] **Step 1: Add the cache directory to gitignore**

Append to `.gitignore`:

```
# TTS audio cache
server/.cache/
```

- [ ] **Step 2: Add `TTS_CACHE_DIR` to env example**

Append to `server/.env.example`:

```
# Optional: override TTS cache directory (default: ~/.cache/cleo-tts/)
# TTS_CACHE_DIR=/path/to/cache
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore server/.env.example
git commit -m "chore: gitignore server TTS cache, document TTS_CACHE_DIR"
```

---

### Task 4: Add tiered word budgets to `SegmentController`

**Files:**
- Modify: `src/engines/SegmentController.ts:46,274,321`

- [ ] **Step 1: Add the `WORD_BUDGET` map and eject constant**

After the existing `ROTATION` array (after line 46 in `SegmentController.ts`), add:

```typescript
// Per-segment-type word caps. Applied as Math.min(lengthTier, budget)
// so the budget never increases words beyond what the tier assigns.
// Uses Partial because not all SegmentType values need a cap
// (e.g., 'sign_off' has no budget — it uses the tier value as-is).
const WORD_BUDGET: Partial<Record<SegmentType, number>> = {
  song_intro: 30,
  artist_context: 35,
  track_story: 40,
  post_track_reflection: 40,
  genre_bridge: 30,
  station_id: 25,
  session_checkin: 30,
  listener_shoutout: 30,
};

// Eject transitions use their own generation path (not the rotation),
// so they have a separate constant rather than a map entry.
const EJECT_WORD_BUDGET = 35;
```

- [ ] **Step 2: Apply the budget cap to `generateNext`**

At line 274, change:

```typescript
      maxWords: lengthTier === 'brief' ? 30 : lengthTier === 'extended' ? 130 : 75,
```

To:

```typescript
      maxWords: Math.min(
        lengthTier === 'brief' ? 30 : lengthTier === 'extended' ? 130 : 75,
        WORD_BUDGET[segmentType] ?? 75
      ),
```

- [ ] **Step 3: Apply the eject budget**

At line 321 (inside `generateEjectTransition`), change:

```typescript
      maxWords: 40,
```

To:

```typescript
      maxWords: EJECT_WORD_BUDGET,
```

The mid-song drop at line 407 (`maxWords: 25`) stays unchanged — it's already at the target.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/engines/SegmentController.ts
git commit -m "feat: add tiered word budgets to reduce TTS character usage"
```

---

### Task 5: Deploy to production

**Files:**
- Remote: `/home/cleo/cleo-api/src/providers/tts/cache.ts` (create)
- Remote: `/home/cleo/cleo-api/src/providers/tts/index.ts` (modify)

The production server is a Fastify codebase at `/home/cleo/cleo-api/` on the Hostinger VPS (<VPS_HOST>). It compiles TypeScript via `npx tsc` — the compiler handles import resolution, so no manual `.js` extension changes are needed in the source `.ts` files.

- [ ] **Step 1: Copy cache.ts to production VPS**

```bash
scp server/src/providers/tts/cache.ts root@<VPS_HOST>:/home/cleo/cleo-api/src/providers/tts/cache.ts
```

- [ ] **Step 2: Update production index.ts to wire the cache**

SSH in and apply the same wrapping pattern from Task 2 to the production `index.ts`. The production file has the same `TTSProviderFactory` structure. Add the import and replace the singleton export.

- [ ] **Step 3: Rebuild and restart**

```bash
ssh root@<VPS_HOST> 'cd /home/cleo/cleo-api && npx tsc && fuser -k 3100/tcp; sleep 2; nohup node dist/index.js > server.log 2>&1 &'
```

- [ ] **Step 4: Verify health**

```bash
ssh root@<VPS_HOST> 'sleep 3; curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health'
```

Expected: `200`

- [ ] **Step 5: Test a TTS call and verify cache log**

```bash
ssh root@<VPS_HOST> 'tail -5 server.log'
```

Look for `[TTS:cache] MISS` on first call, `[TTS:cache] HIT` on repeated text.

- [ ] **Step 6: Commit**

```bash
git add server/src/providers/tts/cache.ts server/src/providers/tts/index.ts
git commit -m "chore: deploy TTS caching to production"
```

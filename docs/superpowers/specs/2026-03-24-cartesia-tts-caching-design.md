# Cartesia TTS Cost Reduction — Filesystem Cache + Tiered Word Budgets

**Date:** 2026-03-24
**Goal:** Reduce monthly Cartesia TTS bill by ~30-40% through server-side caching of synthesized audio and tighter word budgets on AI-generated scripts.

---

## Problem

Cartesia bills per character. Every TTS call costs credits regardless of whether the same text was synthesized before. ONAY re-synthesizes identical static text (cold opens, fallback lines) across sessions, and dynamic scripts run longer than necessary for some segment types.

---

## Approach 1: Server-Side TTS Filesystem Cache

### How It Works

A caching wrapper sits between the voice route and the TTS provider. Before calling Cartesia, the server hashes the request to produce a cache key. If a matching file exists on disk, it returns the cached audio — zero Cartesia characters consumed. Otherwise it calls Cartesia, writes the result to disk, then returns it.

### Cache Design

- **Cache directory:** Configurable via `TTS_CACHE_DIR` env var. Defaults to `~/.cache/cleo-tts/` on production, `server/.cache/tts/` locally (gitignored).
- **Key:** Full SHA-256 hex (64 chars) of `text + speed + voiceId + modelId`. Voice ID and model ID are included so changing the voice or upgrading the model automatically invalidates the cache without manual cleanup.
- **Stored format:** Raw base64 string written to file (same format the route already returns — no transcoding)
- **Atomic writes:** Write to a temp file (`${hash}.tmp.${pid}`) then `rename()` to the final path. This prevents concurrent requests from reading a half-written file.
- **No TTL / no eviction:** TTS audio doesn't go stale and disk is cheap.
- **Cache layer location:** `server/src/providers/tts/cache.ts` — implements `TTSProvider`, wraps any inner provider.

### Where the Cache Layer Sits

The cache wraps the entire `TTSProviderFactory` output, not individual providers. This means:
- A cache hit skips the entire provider chain (including health checks) — fastest path
- If the active provider switches (e.g., Cartesia goes down, ElevenLabs takes over), a cached Cartesia result will still be served for previously-cached text. This is acceptable — the audio content is correct regardless of which provider generated it, and cost savings are the priority.
- The `CachingTTSProvider` wraps the factory's `synthesize` method. `healthCheck()` delegates to the inner provider.

### Cache Key Inputs

`text`, `speed`, `voiceId`, and `modelId` are included in the hash. `stability` and `style` are excluded because:
- They affect vocal quality subtly, not content
- Including them would fragment the cache (vibe changes would miss on identical text)
- The cost savings from higher hit rates outweigh the minor tonal variation

### Error Handling

- If the cache directory doesn't exist on startup, create it recursively
- If a cache read fails (corrupt file, permissions), delete the bad file and fall through to the live provider
- If a cached file is empty (0 bytes), treat as a miss
- If a cache write fails, log a warning and return the live result — don't block the response

### Observability

Log cache hit/miss on every call: `[TTS:cache] HIT ${hash.slice(0,8)}` or `[TTS:cache] MISS ${hash.slice(0,8)} — synthesizing`. This makes it easy to monitor hit rate in production.

---

## Approach 2: Tiered Word Budgets

### How It Works

The word budget system applies `Math.min(existingMaxWords, budgetCap)` — the tiered cap acts as a ceiling on the existing `lengthTier` system in `SegmentController.ts`, never increasing a budget beyond what the tier already assigns.

### Existing System

`SegmentController.determineLengthTier()` assigns `maxWords` based on context:
- `brief` (manual skip, station_id): 30 words
- `standard` (default): 75 words
- `extended` (rich data, genre bridge, cooldown elapsed): 130 words

These values are passed to `CleoScriptGenerator.generateSegment()` via `context.maxWords`.

### Tiered Budget Caps

The budget cap is a per-segment-type ceiling. The final `maxWords` is `Math.min(lengthTier maxWords, budgetCap)`.

| Segment Type | Budget Cap | Effect on `brief` (30) | Effect on `standard` (75) | Effect on `extended` (130) |
|---|---|---|---|---|
| `song_intro` | 30 | 30 (unchanged) | 30 (capped) | 30 (capped) |
| `artist_context` | 35 | 30 (unchanged) | 35 (capped) | 35 (capped) |
| `track_story` | 40 | 30 (unchanged) | 40 (capped) | 40 (capped) |
| `post_track_reflection` | 40 | 30 (unchanged) | 40 (capped) | 40 (capped) |
| `genre_bridge` | 30 | 30 (unchanged) | 30 (capped) | 30 (capped) |
| `station_id` | 25 | 25 (capped) | 25 (capped) | 25 (capped) |
| `session_checkin` | 30 | 30 (unchanged) | 30 (capped) | 30 (capped) |
| `listener_shoutout` | 30 | 30 (unchanged) | 30 (capped) | 30 (capped) |
| `eject_transition` | 35 | — (eject uses own path) | — | — |
| `mid_song_drop` | 25 | — (already hardcoded 25) | — | — |

### Where It's Applied

In `SegmentController.ts`, after computing the `lengthTier` maxWords, apply the budget cap:

```typescript
const WORD_BUDGET: Record<SegmentType, number> = { ... };
const tierMaxWords = lengthTier === 'brief' ? 30 : lengthTier === 'extended' ? 130 : 75;
const maxWords = Math.min(tierMaxWords, WORD_BUDGET[segmentType] ?? tierMaxWords);
```

The `WORD_BUDGET` map lives in `SegmentController.ts` since that's where `maxWords` is already computed. No changes needed in `CleoScriptGenerator.ts` — it already respects whatever `maxWords` is passed to it.

### No Hard Truncation

If Gemini exceeds the cap, the script plays as-is. The cap is guidance only. Gemini follows explicit word caps reliably.

---

## Estimated Impact

### Static Text (Cache)

- ~170 static texts (72 cold opens + ~100 fallback lines), plus fallback lines triggered on Gemini timeouts
- Average ~150 chars each = ~25,500 characters paid once, then free forever
- Returning users reuse cold opens and fallbacks heavily — cache pays for itself within a few sessions

### Dynamic Text (Word Budgets)

- Average session: ~10 dynamic segments
- Current average: ~40 words (~200 chars) per segment → ~2,000 chars/session
- With tiered caps: ~30 words (~150 chars) average → ~1,500 chars/session
- **~25% reduction on dynamic TTS per session**

### Combined

For an active user doing 2 sessions/day:
- Before: ~4,000 chars/day dynamic + repeated static re-synthesis
- After: ~3,000 chars/day dynamic + static cached
- **~30-40% monthly cost reduction** once the cache warms up

---

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `server/src/providers/tts/cache.ts` | Create | `CachingTTSProvider` — filesystem cache wrapping `TTSProviderFactory.synthesize()` |
| `server/src/providers/tts/index.ts` | Modify | Wrap the factory output with `CachingTTSProvider` |
| `src/engines/SegmentController.ts` | Modify | Add `WORD_BUDGET` map, apply `Math.min` ceiling to existing `maxWords` computation |
| `.gitignore` | Modify | Add `server/.cache/` |
| `server/.env.example` | Modify | Add `TTS_CACHE_DIR` (optional) |

---

## Out of Scope

- WebSocket migration (latency optimization, not cost)
- Redis-based caching (audio blobs are too large for Redis)
- Cache eviction policies (disk is cheap, manual cleanup on voice change)
- Client-side caching (server cache covers all clients)

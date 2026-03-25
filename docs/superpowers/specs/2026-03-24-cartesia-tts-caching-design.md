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

- **Cache directory:** `~/.cache/cleo-tts/` on the VPS; `server/.cache/tts/` locally (gitignored)
- **Key:** SHA-256 of `text + speed` → first 16 hex chars as filename
- **Stored format:** Raw base64 string written to file (same format the route already returns — no transcoding)
- **No TTL / no eviction:** TTS audio doesn't go stale and disk is cheap. Manual `rm` clears the cache if the voice ID or model changes.
- **Cache layer location:** `server/src/providers/tts/cache.ts` — implements `TTSProvider`, wraps any inner provider. This means it works transparently for Cartesia, ElevenLabs, or any future provider.

### What Gets Cached

- Every TTS call — dynamic or static
- If ONAY says the same thing twice (fallback lines, cold opens reused across sessions), the second time is free
- Eject transitions that get regenerated due to queue revalidation but produce identical text

### Cache Key Inputs

Only `text` and `speed` are included in the hash. `stability` and `style` are excluded because:
- They affect vocal quality subtly, not content
- Including them would fragment the cache (vibe changes would miss on identical text)
- The cost savings from higher hit rates outweigh the minor tonal variation

### Error Handling

- If the cache directory doesn't exist on startup, create it
- If a cache read fails (corrupt file, permissions), fall through to the live provider
- If a cache write fails, log a warning and return the live result — don't block the response

---

## Approach 2: Tiered Word Budgets

### How It Works

Each segment type gets a word cap injected into the Gemini prompt. Shorter scripts mean fewer characters sent to TTS. The cap is prompt guidance, not server-side truncation — cutting mid-sentence would sound broken.

### Tier Definitions

| Segment Type | Current ~Length | New Cap |
|---|---|---|
| `song_intro` | 30-50 words | 30 words |
| `artist_context` | 35-50 words | 35 words |
| `track_story` | 40-60 words | 40 words |
| `post_track_reflection` | 35-55 words | 40 words |
| `genre_bridge` | 30-45 words | 30 words |
| `station_id` | 20-35 words | 25 words |
| `session_checkin` | 25-40 words | 30 words |
| `listener_shoutout` | 25-40 words | 30 words |
| `eject_transition` | 20-40 words | 25 words |
| `mid_song_drop` | Already 25 | 25 words |

### Where It's Applied

In `CleoScriptGenerator.ts`, the segment type is already passed into `generateSegment`. A `WORD_BUDGET` map provides the cap per type, and the prompt template includes a line like:

```
Keep this to ${cap} words or fewer. Be concise — every word should earn its place.
```

This replaces any existing length guidance in the prompt.

### No Hard Truncation

If Gemini exceeds the cap, the script plays as-is. The cap is guidance only. Gemini follows explicit word caps reliably.

---

## Estimated Impact

### Static Text (Cache)

- ~170 static texts (72 cold opens + ~100 fallback lines)
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
| `server/src/providers/tts/cache.ts` | Create | `CachingTTSProvider` wrapping any `TTSProvider` with filesystem cache |
| `server/src/providers/tts/index.ts` | Modify | Wrap the provider chain with the caching layer |
| `src/services/CleoScriptGenerator.ts` | Modify | Add `WORD_BUDGET` map and inject cap into Gemini prompt |
| `.gitignore` | Modify | Add `server/.cache/` |

---

## Out of Scope

- WebSocket migration (latency optimization, not cost)
- Redis-based caching (audio blobs are too large for Redis)
- Cache eviction policies (disk is cheap, manual `rm` on voice change)
- Client-side caching (server cache covers all clients)

# Chatterbox TTS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ElevenLabs as primary TTS with self-hosted Chatterbox Turbo, validated via a cloud GPU benchmark before any hardware purchase.

**Architecture:** New Chatterbox TTS provider slots into the existing provider factory pattern (primary → fallback). A sibling `SegmentPreloader` pre-generates pre-song bridges alongside the existing eject preloader. Emotion tags pass through client-side formatting but are stripped server-side when ElevenLabs is the active fallback.

**Tech Stack:** Chatterbox Turbo (350M param TTS), `travisvn/chatterbox-tts-api` (OpenAI-compatible server), Docker + CUDA, Vast.ai (cloud benchmark), Pangolin tunnel (self-hosted exposure)

**Spec:** `docs/superpowers/specs/2026-03-22-chatterbox-tts-migration-design.md`

**Deliberately deferred (per spec "What Can Be Cut"):**
- **Chatterbox-native vibe profiles**: Current implementation derives Chatterbox params from ElevenLabs params via formula. Per-vibe Chatterbox-tuned values (spec Phase 4 table) are deferred until listening tests during device validation.
- **Delivery cue nudge remapping**: Existing nudges operate on `stability`/`style`/`speed` which map through the formula. Chatterbox-specific nudge values are deferred.
- **Production Fastify deployment**: Mirror server changes to `/home/cleo/cleo-api/` on VPS after device validation passes locally.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/src/providers/tts/chatterbox.ts` | Chatterbox TTS provider — calls OpenAI-compatible `/v1/audio/speech` endpoint, maps `stability`/`style`/`speed` to `exaggeration`/`cfg`/`speed` |
| `src/engines/SegmentPreloader.ts` | Pre-generates pre-song bridge script + TTS mid-track, caches for instant playback on track change |
| `benchmark/chatterbox-benchmark.sh` | Cloud GPU benchmark script — deploys Chatterbox, runs latency tests, records results |

### Modified Files
| File | Change |
|------|--------|
| `server/src/providers/tts/index.ts` | Swap provider priority: Chatterbox primary, ElevenLabs fallback. Update `ProviderStatus` interface. |
| `server/src/providers/tts/elevenlabs.ts` | Add `stripEmotionTags()` to remove Chatterbox tags before forwarding to ElevenLabs API |
| `src/services/CleoVoiceEngine.ts` | Update `formatForSpeech()` to allowlist Chatterbox emotion tags instead of stripping them |
| `src/engines/AudioCoordinator.ts` | Wire up `SegmentPreloader`, use cached pre-song bridge when available on track change |
| `src/engines/QueueManager.ts` | Add `segmentPreloader.revalidateNextTrack()` after AI queue upgrade |
| `src/cleo/static-core.ts` | Add emotion tag instructions to ONAY's system prompt |
| `server/.env` | Add `CHATTERBOX_BASE_URL`, `CHATTERBOX_VOICE` |

---

## Task 1: Cloud GPU Benchmark Script

**Files:**
- Create: `benchmark/chatterbox-benchmark.sh`

This is a manual task — the user runs this on a Vast.ai RTX 3060 instance. The script automates setup and benchmarking.

- [ ] **Step 1: Create the benchmark script**

```bash
#!/bin/bash
# Chatterbox Turbo Benchmark — run on Vast.ai RTX 3060
# Usage: bash chatterbox-benchmark.sh /path/to/cleo.wav

set -e

VOICE_REF="${1:?Usage: bash chatterbox-benchmark.sh /path/to/cleo.wav}"

echo "=== Chatterbox Turbo Benchmark ==="
echo "GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'unknown')"
echo "VRAM: $(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null || echo 'unknown')"

# 1. Start Chatterbox API server
echo -e "\n--- Starting Chatterbox API server ---"
docker run -d --gpus all \
  -p 4123:4123 \
  -v "$(dirname "$VOICE_REF")":/voices \
  --name chatterbox-bench \
  travisvn/chatterbox-tts-api

echo "Waiting for server to start..."
for i in $(seq 1 60); do
  curl -s http://localhost:4123/ > /dev/null 2>&1 && break
  sleep 2
done
echo "Server ready."

# 2. Upload reference voice
VOICE_FILENAME=$(basename "$VOICE_REF")
echo -e "\n--- Reference voice: $VOICE_FILENAME ---"

# 3. Benchmark function
benchmark() {
  local label="$1"
  local text="$2"
  local words=$(echo "$text" | wc -w)

  echo -e "\n--- $label ($words words) ---"
  local start=$(date +%s%N)

  curl -s -X POST http://localhost:4123/v1/audio/speech \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"chatterbox\",
      \"input\": \"$text\",
      \"voice\": \"/voices/$VOICE_FILENAME\",
      \"response_format\": \"wav\"
    }" -o "/tmp/bench_${label// /_}.wav"

  local end=$(date +%s%N)
  local elapsed_ms=$(( (end - start) / 1000000 ))
  local elapsed_s=$(echo "scale=2; $elapsed_ms / 1000" | bc)
  local filesize=$(stat -f%z "/tmp/bench_${label// /_}.wav" 2>/dev/null || stat -c%s "/tmp/bench_${label// /_}.wav")
  local filesize_kb=$((filesize / 1024))

  echo "Time: ${elapsed_s}s | File: ${filesize_kb}KB | Words: $words"
}

# 4. Run benchmarks
echo -e "\n=== Running benchmarks ==="

benchmark "short" "Welcome back to the frequency, you're locked in tonight."

benchmark "medium" "That last track carried something heavy in its bones. The kind of weight that only shows up when a producer stops trying to impress and starts trying to tell the truth. And speaking of truth, wait until you hear what is coming next."

benchmark "long" "You know what I love about nights like this? Every track feels like it was placed here on purpose. That last one had this quiet confidence to it, like it did not need to shout to be heard. The production was stripped back just enough to let the vocals do the heavy lifting. And the way it ended, that slow fade, it is the kind of thing that makes you hold your breath for a second before the next song drops."

# 5. Run 3x medium for consistency
echo -e "\n=== Consistency test (3x medium) ==="
for i in 1 2 3; do
  benchmark "medium_run_$i" "That last track carried something heavy in its bones. The kind of weight that only shows up when a producer stops trying to impress and starts trying to tell the truth."
done

# 6. VRAM usage
echo -e "\n=== VRAM Usage ==="
nvidia-smi --query-gpu=memory.used,memory.total --format=csv

echo -e "\n=== Benchmark complete ==="
echo "Audio files saved to /tmp/bench_*.wav — listen and compare against ElevenLabs."
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/chatterbox-benchmark.sh
git commit -m "feat: add Chatterbox Turbo cloud GPU benchmark script"
```

**GATE: The user must run this benchmark on Vast.ai and report results before proceeding. If sub-4s for medium segments → continue. If not → stop and reassess.**

---

## Task 2: Chatterbox TTS Provider

**Files:**
- Create: `server/src/providers/tts/chatterbox.ts`

- [ ] **Step 1: Create the Chatterbox provider**

```typescript
import { TTSProvider, TTSRequest, TTSResponse } from './types';

export class ChatterboxProvider implements TTSProvider {
  readonly name = 'chatterbox';
  private baseUrl: string;
  private voice: string;

  constructor() {
    this.baseUrl = process.env.CHATTERBOX_BASE_URL || 'http://localhost:4123';
    this.voice = process.env.CHATTERBOX_VOICE || 'cleo';
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      // Map ElevenLabs-style params to Chatterbox-native params:
      // style (0-1) → exaggeration (0-1): direct mapping
      // stability (0-1) → cfg: inverted (low stability = high cfg)
      // speed → speed: direct pass-through
      const exaggeration = request.style;
      const cfg = 0.5 + (1 - request.stability) * 0.3;
      const speed = request.speed;

      const response = await fetch(`${this.baseUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'chatterbox',
          input: request.text,
          voice: this.voice,
          speed,
          exaggeration,
          cfg,
          response_format: 'wav',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[TTS:chatterbox] Error (${response.status}): ${error.substring(0, 300)}`);
        throw new Error(`Chatterbox ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
      console.log(`[TTS:chatterbox] Audio: ${audioSizeKB}KB, voice: ${this.voice}, exag: ${exaggeration.toFixed(2)}, cfg: ${cfg.toFixed(2)}`);

      return { audioContent: Buffer.from(arrayBuffer).toString('base64') };
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/`, {
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors related to `chatterbox.ts`

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/tts/chatterbox.ts
git commit -m "feat: add Chatterbox TTS provider with parameter mapping"
```

---

## Task 3: Update Provider Factory

**Files:**
- Modify: `server/src/providers/tts/index.ts`

- [ ] **Step 1: Update imports and ProviderStatus interface**

In `server/src/providers/tts/index.ts`, replace the Orpheus import and update `ProviderStatus`:

Replace:
```typescript
import { OrpheusProvider } from './orpheus';
```
With:
```typescript
import { ChatterboxProvider } from './chatterbox';
```

Replace the `ProviderStatus` interface:
```typescript
interface ProviderStatus {
  active: string;
  orpheus: { healthy: boolean; lastCheck: string | null };
  elevenlabs: { healthy: boolean; lastCheck: string | null };
}
```
With:
```typescript
interface ProviderStatus {
  active: string;
  chatterbox: { healthy: boolean; lastCheck: string | null };
  elevenlabs: { healthy: boolean; lastCheck: string | null };
}
```

- [ ] **Step 2: Update constructor — Chatterbox primary, ElevenLabs fallback**

Replace the constructor body:
```typescript
constructor() {
  try {
    this.primary = new ChatterboxProvider();
  } catch (e) {
    console.warn('[TTS] Chatterbox provider unavailable:', (e as Error).message);
  }

  try {
    this.fallback = new ElevenLabsProvider();
  } catch (e) {
    console.warn('[TTS] ElevenLabs provider unavailable:', (e as Error).message);
  }

  this.runHealthChecks();
  const interval = Number(process.env.HEALTH_CHECK_INTERVAL_MS) || 30000;
  this.healthInterval = setInterval(() => this.runHealthChecks(), interval);
}
```

- [ ] **Step 3: Update getStatus() to use new field names**

In the `getStatus()` method, replace the field names in the return object. The actual code (lines 97-107 of `index.ts`) has `elevenlabs` first (primary) and `orpheus` second (fallback):

Replace `elevenlabs:` (the primary block) with `chatterbox:` and replace `orpheus:` (the fallback block) with `elevenlabs:`:

```typescript
return {
  active,
  chatterbox: {
    healthy: this.primaryHealthy,
    lastCheck: this.lastPrimaryCheck?.toISOString() ?? null,
  },
  elevenlabs: {
    healthy: this.fallbackHealthy,
    lastCheck: this.lastFallbackCheck?.toISOString() ?? null,
  },
};
```

- [ ] **Step 4: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/src/providers/tts/index.ts
git commit -m "feat: swap TTS priority to Chatterbox primary, ElevenLabs fallback"
```

---

## Task 4: Add Emotion Tag Stripping to ElevenLabs Provider

**Files:**
- Modify: `server/src/providers/tts/elevenlabs.ts`

When Chatterbox is down and ElevenLabs is the active fallback, emotion tags like `[laugh]` must be stripped — ElevenLabs would speak them as literal words.

- [ ] **Step 1: Add stripEmotionTags helper and call it in synthesize()**

Add this function above the class definition in `elevenlabs.ts`:

```typescript
const CHATTERBOX_EMOTION_TAGS = /\[(laugh|chuckle|sigh|gasp|cough|sniff|groan|shush)\]\s*/g;

function stripEmotionTags(text: string): string {
  return text.replace(CHATTERBOX_EMOTION_TAGS, '').replace(/  +/g, ' ').trim();
}
```

In the `synthesize` method, strip tags before sending to ElevenLabs. Add this as the first line inside `try`:

```typescript
const cleanText = stripEmotionTags(request.text);
```

Then use `cleanText` instead of `request.text` in the JSON body:
```typescript
text: cleanText,
```

- [ ] **Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/tts/elevenlabs.ts
git commit -m "feat: strip Chatterbox emotion tags in ElevenLabs fallback"
```

---

## Task 5: Add Environment Variables

**Files:**
- Modify: `server/.env`
- Modify: `server/.env.example` (if it exists)

- [ ] **Step 1: Add Chatterbox env vars**

Add to `server/.env`:
```
# Chatterbox TTS (self-hosted via Pangolin tunnel)
CHATTERBOX_BASE_URL=https://tts.yourdomain.com
CHATTERBOX_VOICE=cleo
```

Add the same lines (without real values) to `server/.env.example` if it exists.

- [ ] **Step 2: Commit .env.example only** (`.env` is gitignored)

```bash
git add server/.env.example
git commit -m "feat: add Chatterbox env vars to .env.example"
```

---

## Task 6: Update formatForSpeech() — Emotion Tag Allowlist

**Files:**
- Modify: `src/services/CleoVoiceEngine.ts`

The current regex `[\(\[][^\)\]]{0,40}[\)\]]` strips ALL bracketed content. Chatterbox emotion tags like `[laugh]` must pass through.

- [ ] **Step 1: Add the emotion tag allowlist**

In `CleoVoiceEngine.ts`, find the `formatForSpeech` function. Replace this line (line 127):

```typescript
.replace(/[\(\[][^\)\]]{0,40}[\)\]]/g, '')
```

With:

```typescript
// Strip stage directions but preserve Chatterbox emotion tags
.replace(/[\(\[][^\)\]]{0,40}[\)\]]/g, (match) => {
  const emotionTags = /^\[(laugh|chuckle|sigh|gasp|cough|sniff|groan|shush)\]$/;
  return emotionTags.test(match) ? match : '';
})
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/CleoVoiceEngine.ts
git commit -m "feat: allowlist Chatterbox emotion tags in formatForSpeech"
```

---

## Task 7: Update System Prompt — Emotion Tags

**Files:**
- Modify: `src/cleo/static-core.ts`

- [ ] **Step 1: Add emotion tag instructions**

In `src/cleo/static-core.ts`, add the following as a new section between `VOICE RULES` and `STORYTELLING` (insert after line 18 "Write for breath..." and before line 20 "STORYTELLING"):

```
EMOTION TAGS
You may use emotion tags sparingly to add natural paralinguistic sounds.
Available tags: [laugh] [chuckle] [sigh] [gasp] [shush]
- Use at most one per segment. Never two in a row.
- Place before the sentence they color: "[sigh] That track just hits different at 2am."
- Only use when the emotion genuinely fits the moment. Never for decoration.
- [chuckle] and [laugh] suit surprising or ironic moments.
- [sigh] suits reflective or melancholy moments.
- [gasp] suits genuine surprise at a track transition.
- Do NOT use [cough], [sniff], or [groan] — they sound unnatural for radio.
```

- [ ] **Step 2: Commit**

```bash
git add src/cleo/static-core.ts
git commit -m "feat: add Chatterbox emotion tag instructions to ONAY system prompt"
```

---

## Task 8: SegmentPreloader — Pre-Song Bridge Pre-Generation

**Files:**
- Create: `src/engines/SegmentPreloader.ts`

This is a sibling to `TransitionPreloader`. It pre-generates the `pre_song` bridge for the next track, so when the eject misses or track auto-advances, the cached audio plays instantly instead of waiting for live generation.

- [ ] **Step 1: Create SegmentPreloader**

```typescript
/**
 * SegmentPreloader — pre-generates the pre_song bridge script + TTS
 * for the next track, cached for instant playback on track change.
 *
 * Sibling to TransitionPreloader (which handles eject transitions).
 * State machine: idle → generating → ready → done
 */

import { segmentController } from './SegmentController';
import { synthesize } from '../services/CleoVoiceEngine';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import type { Vibe } from '../cleo/fallbacks';
import type { SegmentResult } from './SegmentController';
import type { TrackInfo } from '../types/TrackInfo';
import { logger } from '../services/logger';

type PreloaderState = 'idle' | 'generating' | 'ready' | 'done';

// Start pre-song generation 5s after the eject preloader (which triggers at 25s)
const PRE_GEN_DELAY_SEC = 30;

class SegmentPreloaderEngine {
  private state: PreloaderState = 'idle';
  private vibe: Vibe = 'general';
  private isSpeakingCheck: (() => boolean) | null = null;
  private generationId = 0;

  private currentTrack: TrackInfo | null = null;
  private previousTrack: TrackInfo | null = null;

  private cachedSegment: SegmentResult | null = null;
  private cachedBase64: string | null = null;
  private generatedNextTrackTitle: string | null = null;

  private preGenFired = false;
  private unsubscribePlayback: (() => void) | null = null;

  // ── Public API ─────────────────────────────────────────────────────

  setVibe(vibe: Vibe): void {
    this.vibe = vibe;
  }

  setIsSpeakingCheck(fn: () => boolean): void {
    this.isSpeakingCheck = fn;
  }

  /**
   * Start monitoring for pre-song pre-generation.
   * Call after the eject preloader has been started for the same track.
   */
  startForTrack(
    currentTrack: TrackInfo,
    previousTrack?: TrackInfo
  ): void {
    this.reset();

    const durationSec = currentTrack.duration ?? 0;
    if (durationSec < 35) {
      // Track too short — pre-gen wouldn't complete before track ends
      return;
    }

    this.currentTrack = currentTrack;
    this.previousTrack = previousTrack ?? null;
    this.state = 'idle';
    this.preGenFired = false;

    console.log(`[SegmentPreloader] Started for "${currentTrack.title}" — pregen at ${PRE_GEN_DELAY_SEC}s`);

    // Poll playback time every 2s
    const pollInterval = setInterval(async () => {
      if (!this.currentTrack) return;
      try {
        const time = await musicKitPlayer.getPlaybackTime();

        if (!this.preGenFired && time >= PRE_GEN_DELAY_SEC) {
          const speaking = this.isSpeakingCheck ? this.isSpeakingCheck() : false;
          if (!speaking) {
            this.preGenFired = true;
            console.log(`[SegmentPreloader] Pre-gen trigger at ${time.toFixed(1)}s`);
            this.beginGeneration();
          }
        }
      } catch (err) {
        logger.warn('SegmentPreloader', 'Poll error', err);
      }
    }, 2000);

    this.unsubscribePlayback = () => clearInterval(pollInterval);
  }

  /**
   * Get the cached pre-song segment + audio, or null if not ready.
   * Consumes the cache (state → done).
   */
  consume(): { segment: SegmentResult; base64: string } | null {
    if (this.state !== 'ready' || !this.cachedSegment || !this.cachedBase64) {
      return null;
    }

    const result = { segment: this.cachedSegment, base64: this.cachedBase64 };
    this.state = 'done';
    console.log('[SegmentPreloader] Cache consumed — state: done');
    return result;
  }

  /**
   * Check if the cached next track still matches MusicKit's actual queue.
   * Called after AI queue upgrade reorders the queue.
   */
  revalidateNextTrack(): void {
    if (this.state !== 'ready' || !this.generatedNextTrackTitle) return;

    musicKitPlayer.getNextInQueue().then((realNext) => {
      if (!realNext || this.state !== 'ready') return;
      if (realNext.title !== this.generatedNextTrackTitle) {
        console.log(
          `[SegmentPreloader] Queue reordered: "${this.generatedNextTrackTitle}" → "${realNext.title}" — regenerating`
        );
        this.cachedSegment = null;
        this.cachedBase64 = null;
        this.generatedNextTrackTitle = null;
        this.state = 'idle';
        this.beginGeneration();
      }
    }).catch(() => {});
  }

  cancel(): void {
    this.reset();
  }

  getState(): PreloaderState {
    return this.state;
  }

  // ── Internal ───────────────────────────────────────────────────────

  private async beginGeneration(): Promise<void> {
    if (this.state !== 'idle') return;

    this.state = 'generating';
    const myGenId = ++this.generationId;
    console.log('[SegmentPreloader] State: generating');

    try {
      const currentTrack = this.currentTrack!;

      // Fetch the real next track from MusicKit's queue
      let nextTrack: TrackInfo | undefined;
      try {
        const realNext = await musicKitPlayer.getNextInQueue();
        if (realNext) {
          nextTrack = { title: realNext.title, artistName: realNext.artistName };
          console.log(`[SegmentPreloader] Real next in queue: "${realNext.title}" by ${realNext.artistName}`);
        }
      } catch (err) {
        logger.warn('SegmentPreloader', 'getNextInQueue failed', err);
      }

      if (!nextTrack) {
        console.log('[SegmentPreloader] No next track in queue — skipping pre-gen');
        this.state = 'idle';
        return;
      }

      this.generatedNextTrackTitle = nextTrack.title ?? null;

      // Generate a pre_song bridge: "previous" = current playing track,
      // "current" = next track (which becomes current after transition)
      const segment = await segmentController.generateNext(
        nextTrack,           // the track ONAY will be introducing
        undefined,           // we don't know what comes after
        currentTrack,        // the track that just finished (will be "previous")
        false                // not a manual skip
      );

      if (myGenId !== this.generationId) return;

      if (!segment || !segment.text) {
        console.log('[SegmentPreloader] Generation returned empty segment');
        this.state = 'idle';
        return;
      }

      // Force pre_song delivery — the AudioCoordinator cached path always
      // plays immediately with ducking, regardless of what SegmentController chose.
      segment.deliveryMode = 'pre_song';
      this.cachedSegment = segment;
      console.log(`[SegmentPreloader] Script generated (${segment.text.split(' ').length} words)`);

      // Synthesize TTS with retry (same pattern as TransitionPreloader)
      let base64Audio: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (myGenId !== this.generationId) return;
        base64Audio = await synthesize(segment.text, this.vibe);
        if (base64Audio) break;
        console.log(`[SegmentPreloader] TTS attempt ${attempt + 1} returned null, retrying in ${(attempt + 1) * 3}s...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
        if (myGenId !== this.generationId) return;
      }

      if (myGenId !== this.generationId) return;
      if (!base64Audio) {
        console.log('[SegmentPreloader] TTS synthesis failed after 3 attempts');
        this.state = 'idle';
        return;
      }

      this.cachedBase64 = base64Audio;
      this.state = 'ready';
      console.log('[SegmentPreloader] State: ready — script + TTS cached');
    } catch (err) {
      console.log('[SegmentPreloader] Generation/synthesis error:', err);
      this.state = 'idle';
    }
  }

  private reset(): void {
    if (this.unsubscribePlayback) {
      this.unsubscribePlayback();
      this.unsubscribePlayback = null;
    }

    this.state = 'idle';
    this.currentTrack = null;
    this.previousTrack = null;
    this.cachedSegment = null;
    this.cachedBase64 = null;
    this.generatedNextTrackTitle = null;
    this.preGenFired = false;
  }
}

export const segmentPreloader = new SegmentPreloaderEngine();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/engines/SegmentPreloader.ts
git commit -m "feat: add SegmentPreloader for pre-song bridge pre-generation"
```

---

## Task 9: Wire SegmentPreloader into AudioCoordinator

**Files:**
- Modify: `src/engines/AudioCoordinator.ts`

The AudioCoordinator needs to:
1. Start the SegmentPreloader when a new track begins
2. Check for cached pre-song audio before doing live generation on track change
3. Manage the preloader's lifecycle (vibe, speaking check, revalidation)

- [ ] **Step 1: Add import and constructor wiring**

Add import at top of `AudioCoordinator.ts`:
```typescript
import { segmentPreloader } from './SegmentPreloader';
```

In the constructor, add after `transitionPreloader.setIsSpeakingCheck(() => this.isSpeaking);`:
```typescript
segmentPreloader.setIsSpeakingCheck(() => this.isSpeaking);
```

- [ ] **Step 2: Update setVibe and setIsAppActiveCheck**

In `setVibe()`, add:
```typescript
segmentPreloader.setVibe(vibe);
```

- [ ] **Step 3: Update handleTrackStart to also start SegmentPreloader**

In `handleTrackStart()`, after the `transitionPreloader.startForTrack(...)` call, add:

```typescript
// Start pre-song bridge preloader (staggered — triggers at 30s, after eject at 25s)
segmentPreloader.startForTrack(
  { ...trackInfo, genreNames: currentTrack.genreNames },
  previous ?? undefined
);
```

- [ ] **Step 4: Add playCachedAudio import**

Update the existing import line:
```typescript
import { synthesizeAndPlay } from '../services/CleoVoiceEngine';
```
To:
```typescript
import { synthesizeAndPlay, playCachedAudio } from '../services/CleoVoiceEngine';
```

- [ ] **Step 5: Update handleTrackChangeWithResult to consume cached pre-song BEFORE cancelPendingTimer**

**Critical ordering**: The SegmentPreloader cache must be consumed *before* `cancelPendingTimer()` clears it. In `handleTrackChangeWithResult`, the current first line is `this.cancelPendingTimer()`. Replace the beginning of the method (from `this.cancelPendingTimer()` through the offline check) with:

```typescript
// Consume cached pre-song BEFORE cancelPendingTimer destroys it.
// Only on non-manual skips — manual skips invalidate the cache (wrong track).
const cachedPreSong = isManualSkip ? null : segmentPreloader.consume();

this.cancelPendingTimer();
const myId = this.generationId;

// Skip commentary when offline — music continues, ONAY stays quiet
const netState = await NetInfo.fetch();
if (!(netState.isConnected ?? true)) {
  console.log('[AudioCoordinator] Offline — skipping commentary');
  this.isSpeaking = false;
  return null;
}

// Use cached pre-song bridge if available (zero-latency path)
if (cachedPreSong) {
  console.log('[AudioCoordinator] Using cached pre-song bridge from SegmentPreloader');
  this.isSpeaking = true;
  this.previousTrack = currentTrack;

  // Force pre_song delivery — play immediately with ducking
  onSegmentReady?.(cachedPreSong.segment);
  try {
    await activateDuckingSession().catch(() => {});
    await playCachedAudio(cachedPreSong.base64);
    await deactivateDuckingSession().catch(() => {});
    const trackInfo = this.enrichTrack(currentTrack);
    if (myId === this.generationId) {
      this.scheduleMidSongDrop(trackInfo);
      this.lastSegmentEndTime = Date.now();
      this.isSpeaking = false;
    }
  } catch (error) {
    logger.error('AudioCoordinator', 'Cached pre-song playback failed', error);
    this.isSpeaking = false;
    await deactivateDuckingSession().catch(() => {});
  }
  return cachedPreSong.segment;
}
```

- [ ] **Step 6: Do NOT add segmentPreloader.cancel() to cancelPendingTimer**

The SegmentPreloader is cancelled explicitly: consumed before `cancelPendingTimer` on natural track changes, or discarded via `segmentPreloader.cancel()` in the `handleTrackStart` flow (which calls `startForTrack` → `reset()`). Adding it to `cancelPendingTimer()` would destroy the cache before it can be consumed. The lifecycle is:
- Natural track change: consume → cancelPendingTimer → handleTrackStart (resets preloader for new track)
- Manual skip: skip consume → cancelPendingTimer → handleTrackStart (resets preloader for new track)

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/engines/AudioCoordinator.ts
git commit -m "feat: wire SegmentPreloader into AudioCoordinator for cached pre-song bridges"
```

---

## Task 10: Wire SegmentPreloader Revalidation in QueueManager

**Files:**
- Modify: `src/engines/QueueManager.ts` (find the `upgradeQueueInBackground` method)

After the AI queue upgrade calls `setUpcomingQueue`, the SegmentPreloader's cached next track may be stale. Add revalidation.

- [ ] **Step 1: Add import and revalidation call**

Add import at top of `QueueManager.ts`:
```typescript
import { segmentPreloader } from './SegmentPreloader';
```

In the `upgradeQueueInBackground` method, find where `transitionPreloader.revalidateNextTrack()` is called. Add immediately after:
```typescript
segmentPreloader.revalidateNextTrack();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/engines/QueueManager.ts
git commit -m "feat: revalidate SegmentPreloader after AI queue upgrade"
```

---

## Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Chatterbox to Tech Stack section**

In the `AI & Voice` section, add after the Orpheus line:
```
- Chatterbox Turbo (self-hosted, 350M param) — primary voice synthesis with voice cloning
```

Update the Orpheus line to note it's no longer primary:
```
- Orpheus TTS (self-hosted via Pangolin tunnel) — legacy voice synthesis (inactive)
```

- [ ] **Step 2: Add Chatterbox env vars**

In the `Environment Variables` section, add:
```
CHATTERBOX_BASE_URL
CHATTERBOX_VOICE
```

- [ ] **Step 3: Add known issue about emotion tags**

In the `Known Issues & Gotchas` section, add:
```
- **Chatterbox emotion tags in ElevenLabs fallback**: When Chatterbox is down, ElevenLabs serves as fallback. The ElevenLabs provider strips Chatterbox emotion tags (`[laugh]`, `[sigh]`, etc.) server-side so they aren't spoken as literal words. The client (`formatForSpeech`) passes them through regardless of active provider.
- **SegmentPreloader lifecycle is NOT managed by cancelPendingTimer**: Unlike other pending timers, the SegmentPreloader is NOT cancelled inside `cancelPendingTimer()`. On natural track changes, the cache is consumed before `cancelPendingTimer` runs. On manual skips, the cache is skipped (wrong track) and `startForTrack` resets it when the new track begins. The preloader's `reset()` is called internally by `startForTrack`.
- **SegmentPreloader advances segment rotation**: The preloader calls `generateNext()` which advances `rotationIndex` in SegmentController. When both an eject fires AND a cached pre-song is consumed, two rotation slots are used for one transition. This is an accepted trade-off — segment type variety remains sufficient with 9 types, and the alternative (peeking without advancing) would require new SegmentController API surface.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Chatterbox TTS provider and SegmentPreloader to CLAUDE.md"
```

---

## Task 12: Device Validation

This is a manual testing task. No code changes.

- [ ] **Step 1: Start local server with Chatterbox configured**

Ensure `server/.env` has `CHATTERBOX_BASE_URL` pointing to your Pangolin tunnel and the Chatterbox API server is running on your Windows machine.

Run: `cd server && npm run dev`
Verify: Console shows `[TTS] Primary (chatterbox) recovered — switching back`

- [ ] **Step 2: Test eject transitions**

Play a full track on device. Verify:
- Eject transition fires near track end
- Voice sounds like ONAY (cloned from `cleo.wav`)
- Crossfade works (old track fades, ONAY speaks, new track fades in)

- [ ] **Step 3: Test pre-song bridges (cached)**

Let a track auto-advance (don't skip). Verify:
- Console shows `[AudioCoordinator] Using cached pre-song bridge from SegmentPreloader`
- Bridge plays instantly (~0ms perceived latency)
- Content references the correct previous and current tracks

- [ ] **Step 4: Test manual skip (cache miss)**

Skip a track manually. Verify:
- Console shows live generation (not cached)
- Latency is acceptable (sub-4s with Chatterbox)
- Content correctly references the new track

- [ ] **Step 5: Test fallback**

Stop the Chatterbox server. Verify:
- Console shows `[TTS] Primary (chatterbox) went down — will use fallback`
- Next segment uses ElevenLabs
- Emotion tags (if any in the script) are NOT spoken as words

- [ ] **Step 6: Test emotion tags**

Play several tracks and listen for emotion tags. Verify:
- Tags sound natural (actual laughs/sighs, not spoken words)
- Tags appear at most once per segment
- No tag is spoken as literal text


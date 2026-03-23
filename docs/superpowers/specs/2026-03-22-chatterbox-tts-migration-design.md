# Chatterbox TTS Migration — Design Spec

**Date**: 2026-03-22
**Goal**: Replace ElevenLabs as primary TTS with self-hosted Chatterbox Turbo for voice-cloned ONAY speech at sub-4s latency, eliminating ongoing API costs.

---

## Problem

Orpheus TTS (current primary) generates in ~13s — too slow for pre-song bridges, breaking the radio flow. ElevenLabs (current fallback, effectively primary) delivers in ~2-3s but incurs ongoing API costs. Chatterbox Turbo offers voice cloning from reference audio (`cleo.wav`) with quality that matches or exceeds ElevenLabs (95/100 vs 90/100 in blind evaluations), plus emotion tags for natural radio host delivery.

**Constraint**: The existing AMD RX 6700 XT with ROCm is not viable — Chatterbox breaks on repeated generations due to ROCm tensor mismatch bugs (validated in benchmarks on 2026-03-22). An NVIDIA GPU with CUDA is required.

---

## Success Criteria

- Chatterbox Turbo generates typical ONAY segments (20-60 words) in **sub-4s** on an RTX 3060 12GB
- Voice clone from `cleo.wav` sounds recognizably like the ElevenLabs ONAY voice
- Natural track transitions (eject + auto-advance) have **zero perceived TTS latency** via pre-generation
- Manual skip fallback latency is **sub-4s** (Chatterbox) or **sub-3s** (ElevenLabs fallback)
- ElevenLabs remains as automatic fallback if Chatterbox server is down

---

## Phase 1: Cloud GPU Benchmark (~$0.04, ~1 hour)

De-risk the GPU purchase with a Vast.ai RTX 3060 rental.

### Setup
- Rent **Vast.ai RTX 3060** instance (~$0.03-0.04/hr)
- Deploy `travisvn/chatterbox-tts-api` via Docker (CUDA pre-configured)
- Upload `cleo.wav` as the default reference voice

### Benchmark Script
Test with typical ONAY segments at three lengths:

| Type | Words | Example |
|------|-------|---------|
| Short (11 words) | 11 | "Welcome back to the frequency, you're locked in tonight" |
| Medium (30 words) | 30 | A typical pre-song bridge (2-3 sentences) |
| Long (60 words) | 60 | A full eject transition script |

**Measure for each**:
- Total generation time (seconds)
- VRAM usage
- Audio duration (to compute RTF)

**Listen and compare**: Play Chatterbox output side-by-side with ElevenLabs output for the same scripts. Assess voice similarity, naturalness, expressiveness.

### Exit Criteria
- **Go**: Sub-4s for medium segments AND voice sounds right → proceed to Phase 2
- **Explore**: Speed OK but voice needs work → test different `exaggeration`/`cfg` settings, try longer reference audio
- **No-go**: Can't hit sub-4s on RTX 3060 → optionally test RTX 3090 ($0.10/hr) to find the speed floor; re-evaluate hardware budget

---

## Phase 2: GPU Swap & Local Chatterbox Server (~$250, ~1 day)

### Hardware
- Buy **used RTX 3060 12GB** (~$250 on eBay)
- Swap into existing Windows machine (AMD Ryzen 9 3900X)
- Chatterbox Turbo uses ~4.5GB VRAM — 12GB gives comfortable headroom

### Server Deployment
- Install `travisvn/chatterbox-tts-api` with Docker + CUDA
- Configure `cleo.wav` as default reference voice at startup
- Expose via **Pangolin tunnel** (same pattern as current Orpheus setup)
- Server runs on a configured port (default 4123)

### ONAY Server Integration

**New file**: `server/src/providers/tts/chatterbox.ts`

Implements the existing `TTSProvider` interface:
```typescript
interface TTSProvider {
  name: string;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  healthCheck(): Promise<boolean>;
}
```

- **Endpoint**: `POST ${CHATTERBOX_BASE_URL}/v1/audio/speech`
- **Request payload**: OpenAI-compatible format with `voice` set to the reference voice path
- **Response**: WAV audio → base64 (same as Orpheus and ElevenLabs)
- **Timeout**: 20s with AbortController
- **Health check**: GET to base URL with 2s timeout

**Provider priority update** in `server/src/providers/tts/index.ts`:
- Primary: **Chatterbox**
- Fallback: **ElevenLabs**
- Orpheus: removed from active chain (kept in codebase for reference)

**New env vars** in `server/.env`:
```
CHATTERBOX_BASE_URL=https://tts.yourdomain.com  # Pangolin tunnel endpoint
CHATTERBOX_VOICE=cleo                            # reference voice name
```

**No client-side changes needed** — the `/synthesize-voice` route returns `{ audioContent: base64 }` regardless of provider. CleoVoiceEngine, AudioCoordinator, TransitionPreloader all work unchanged.

---

## Phase 3: Segment Pre-Generation Expansion (~1 day code)

### Current Pre-Generation (eject transitions only)
- TransitionPreloader generates eject script + TTS at ~25s into each track
- State machine: `idle → generating → ready → fired → done`
- On miss/skip: falls back to live generation (the slow path)

### Expanded Pre-Generation (all delivery modes)

Add pre-song bridge pre-generation alongside the existing eject pre-gen:

1. **~25s into track**: Eject transition pre-gen starts (existing, unchanged)
2. **~30s into track** (or after eject pre-gen completes): Pre-song bridge pre-gen starts
   - Uses `getNextInQueue()` for accurate next-track naming
   - Generates a `pre_song` delivery mode script via SegmentController
   - Synthesizes TTS and caches base64 audio in memory
3. **Natural track change (eject fires)**: Play cached eject audio (existing)
4. **Natural track change (eject misses)**: Play cached pre-song bridge (~0ms latency)
5. **Manual skip (cache miss)**: Live generation via Chatterbox → ElevenLabs fallback

**Implementation options**:
- **Option A**: Extend `TransitionPreloader` with a second state machine for pre-song
- **Option B**: Create a sibling `SegmentPreloader` class with the same pattern

Option A is simpler since both pre-gens share the same lifecycle (track start → pre-gen → cache → fire/discard on track change).

**Rate limit protection**: Stagger the two pre-gens. The pre-song pre-gen only starts after the eject pre-gen completes or fails. This prevents concurrent TTS requests that could overload the Chatterbox server or hit ElevenLabs 429s.

**Queue revalidation**: After AI queue upgrade (runs at ~65s), both cached segments are checked against the new next track. If it changed, both regenerate.

---

## Phase 4: Emotion Tags & Voice Tuning

### Emotion Tags in Scripts

Chatterbox Turbo supports inline paralinguistic tags:
`[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[cough]`, `[sniff]`, `[groan]`, `[shush]`

**System prompt update** (`src/cleo/static-core.ts`):
Add instruction for ONAY to use emotion tags naturally in scripts:
- `"[sigh] That track just hits different at 2am"`
- `"[chuckle] I wasn't expecting to play that one next, but here we are"`

**formatForSpeech() update** (`src/services/CleoVoiceEngine.ts`):
The current regex strips all bracketed content as stage directions. Add an allowlist so Chatterbox emotion tags pass through:
```
Allowed: [laugh], [chuckle], [sigh], [gasp], [cough], [sniff], [groan], [shush]
Stripped: all other [bracketed] or (parenthesized) content
```

### Vibe-Based Voice Profiles

Current ElevenLabs profiles use `stability`/`style`/`speed`. Chatterbox uses different parameters:
- **`exaggeration`** (0-1): Controls expressiveness/emotion intensity
- **`speed`** (speaking rate)
- **`cfg`** (classifier-free guidance): Controls adherence to reference voice

Map the 12 vibes to Chatterbox equivalents. Exact values determined during Phase 2 listening tests:

| Vibe | ElevenLabs stability/style/speed | Chatterbox exaggeration/speed (estimated) |
|------|----------------------------------|-------------------------------------------|
| morning | 0.40 / 0.50 / 1.0 | 0.4 / 1.0 |
| chill | 0.30 / 0.45 / 0.95 | 0.3 / 0.95 |
| workout | 0.45 / 0.65 / 1.08 | 0.6 / 1.08 |
| lateNight | 0.25 / 0.40 / 0.92 | 0.3 / 0.92 |
| party | 0.50 / 0.70 / 1.05 | 0.7 / 1.05 |
| focus | 0.50 / 0.35 / 0.98 | 0.2 / 0.98 |
| feelGood | 0.35 / 0.60 / 1.02 | 0.5 / 1.02 |
| throwback | 0.35 / 0.55 / 0.98 | 0.4 / 0.98 |
| elevated | 0.30 / 0.50 / 0.95 | 0.4 / 0.95 |
| melancholy | 0.25 / 0.40 / 0.93 | 0.3 / 0.93 |
| sunday | 0.30 / 0.45 / 0.93 | 0.3 / 0.93 |
| general | 0.35 / 0.55 / 1.0 | 0.4 / 1.0 |

### Delivery Cue Nudges
Map existing nudges to Chatterbox `exaggeration` adjustments:
- `warm`: -0.05 exaggeration
- `hype`: +0.10 exaggeration
- `quiet`: -0.03 speed
- `playful`: +0.08 exaggeration
- `reflective`: -0.02 speed, -0.05 exaggeration
- `matter-of-fact`: -0.10 exaggeration

---

## Phase 5: Device Validation

Full broadcast session on physical device:

1. **Eject transitions**: Verify pre-generated Chatterbox audio fires correctly with crossfade
2. **Pre-song bridges**: Verify pre-generated bridges play with ~0ms latency on natural track change
3. **Mid-song drops**: Verify on-demand generation at scheduled time
4. **Manual skips**: Verify live Chatterbox generation within sub-4s
5. **Fallback**: Kill Chatterbox server, verify ElevenLabs takes over seamlessly
6. **Voice quality**: Compare full session feel against an ElevenLabs-only session
7. **Emotion tags**: Verify tags render as natural paralinguistic sounds, not spoken text
8. **Vibe profiles**: Test 3-4 different vibes, tune `exaggeration`/`speed` values

---

## Fallback Chain

At every phase, the existing provider factory ensures no voice outage:

```
Chatterbox (primary, self-hosted)
  ↓ health check fails or synthesize errors
ElevenLabs (fallback, cloud API)
```

Health checks run every 30s. Automatic recovery when primary comes back online. The `/synthesize-voice` route is unchanged — callers never know which provider served the request.

---

## What Can Be Cut

- **Phase 3 (pre-generation expansion)**: Nice-to-have if Chatterbox is already sub-4s. The 3.5s natural delay + sub-4s generation = ~7s gap, which is at the edge of acceptable. Pre-generation makes it feel instant.
- **Phase 4 emotion tags**: Additive polish. Can ship without them and add later.
- **Phase 4 vibe profiles**: Can start with a single default profile and tune per-vibe later.

---

## Cost Summary

| Item | Cost | When |
|------|------|------|
| Vast.ai RTX 3060 rental (1 hr) | ~$0.04 | Phase 1 |
| Used RTX 3060 12GB | ~$250 | Phase 2 (only if Phase 1 passes) |
| ElevenLabs (fallback only) | Minimal ongoing | Ongoing |
| **Total upfront** | **~$250** | |

---

## Files Modified

### Server (Phase 2)
- `server/src/providers/tts/chatterbox.ts` — new file, Chatterbox provider
- `server/src/providers/tts/index.ts` — update provider priority
- `server/.env` — add `CHATTERBOX_BASE_URL`, `CHATTERBOX_VOICE`

### Client (Phase 3)
- `src/engines/TransitionPreloader.ts` — add pre-song bridge pre-generation
- `src/engines/AudioCoordinator.ts` — use cached pre-song bridge when available

### Client (Phase 4)
- `src/cleo/static-core.ts` — add emotion tag instructions to system prompt
- `src/services/CleoVoiceEngine.ts` — allowlist emotion tags in `formatForSpeech()`, add Chatterbox vibe profiles

# Pre-Baked Broadcast Architecture

**Date:** 2026-04-12
**Status:** Design approved, ready for implementation planning
**Driver:** iOS background CPU constraints make in-session real-time generation unreliable. Bursty Gemini + TTS calls during backgrounded playback trigger `RESOURCE_NOTIFY` terminations. Existing mitigations (observation throttling, animation pausing, native cache trimming) have been exhausted.

---

## Problem

ONAY's current architecture generates host commentary in real time between tracks: eject pre-gen fires ~25s into each track, calls Gemini for a script, synthesizes TTS via Cartesia/ElevenLabs/Orpheus, caches the result, and fires a three-layer native crossfade. This works reliably in the foreground. It does not work reliably when the app is backgrounded — the LLM + TTS bursts exceed iOS's 48s-per-60s background CPU budget, and the app gets terminated.

All feasible client-side mitigations are in place. The remaining fix is structural: stop generating in-session.

## Decision

Reshape the product from **live reactive radio** to a **pre-baked broadcast episode**. The entire session (track order + all host commentary) is generated server-side before playback begins. The client becomes a dumb player that interleaves cached audio segments with MusicKit track playback.

This trades the "live" feel for reliability. The tradeoff is acceptable because a locked, polished broadcast episode is a coherent product — and because several "faking live" techniques preserve the feel without runtime generation.

---

## Product shape

### Home screen — two content stacks

**Tonight on ONAY (editorial, pre-baked once, shared across all users)**
Curated broadcasts produced manually or by scheduled job: "Late Night Soul," "Sunday Wind-Down," "Monday Reset." Refreshed weekly or daily. Near-zero marginal cost per listen. Doubles as onboarding content for users who haven't connected Apple Music.

**Your Broadcast (user-sourced, baked on demand)**
User picks a playlist → vibe → length (Quick 15min / Standard 30min / Long 60min). Server bakes a fresh broadcast against that source material.

### Playback — locked episode

- **No skip button.** Broadcast plays beginning to end, like a podcast episode.
- Controls: pause/resume, volume, end-session.
- ONAY opens with a cold open, takes the listener through an arc, signs off cleanly.
- When the broadcast ends, the user picks the next one.
- No stations concept. No infinite shuffle. No library mode. Every listen is a finite episode.

---

## Runtime architecture

### Session start — target time-to-first-sound: ~8 seconds

1. User taps a broadcast. Client shows a "tuning in" animation (subtle radio-dial static, ONAY orb warming up). Masks ~3-5s of network latency with content that fits the product metaphor.
2. Client fetches playlist track metadata from Apple Music (existing code path).
3. Client `POST /broadcast/create` with `{ playlistId, vibe, length, userContext }`.
4. Server responds synchronously with **manifest** (ordered tracks + segment slots) + **first segment audio** (cold open + transition into track 1). Target: 5-8s.
5. Client begins playback: ONAY's cold open plays via AVAudioPlayer, then MusicKit starts track 1.
6. While track 1 plays (2-4 min), client pulls segments 2..N as the server completes them. All cached in memory + MMKV before track 1 ends.

### Mid-session — pure playback

- No LLM calls, no TTS calls, no enrichment, no queue upgrades.
- Each segment is a pre-rendered AAC file cached locally.
- Transition pattern: **duck + speak** (see Transition Pattern below).
- Background CPU drops to MusicKit playback + AVAudioPlayer for segments + throttled observation. Well under iOS budget.

### Session end

- Final segment is ONAY's sign-off. Plays after the last track, then session closes cleanly.
- Cached segments persist in MMKV for 2 hours (for resume-after-terminate) then clear.

### Transition pattern — duck + speak, plus stingers

Three-layer native crossfade (`playEjectTransition`) is removed. Replaced with the existing proven **duck + speak** pattern already used for mid-song drops:

1. Near the end of each track (last ~6s), MusicKit audio is ducked (not stopped).
2. ONAY's pre-baked segment plays via AVAudioPlayer over the ducked tail.
3. Track ends naturally. Segment continues if still speaking.
4. When the segment finishes, MusicKit advances to the next track.

**Pre-baked stingers** (500ms radio sweeps/whooshes) play between track-end and segment-start, and between segment-end and next-track-start. Sells the "produced radio show" feel without any runtime audio layering. Stingers vary by vibe (late-night = soft shimmer, morning = brighter sweep).

---

## Server architecture

### New endpoint: `POST /broadcast/create`

**Request:**
```json
{
  "playlistId": "...",
  "vibe": "lateNight",
  "length": "standard",
  "userContext": {
    "lastSessionSummary": "...",
    "tracksRecentlyPlayed": [...],
    "timeOfDay": "20:47",
    "dayOfWeek": "Thursday",
    "firstTimeUser": false
  }
}
```

**Synchronous phase (returns to client within ~5-8s):**
1. Fetch playlist track metadata (existing adapter).
2. Run existing `QueuePlanner` logic server-side to pick + order tracks for the requested length/vibe.
3. Assemble manifest: `{ broadcastId, tracks: [...], segmentSlots: [cold_open, transition_1, ..., sign_off] }`.
4. Generate + render **first segment only** (cold open + transition into track 1) via existing Gemini + TTS providers.
5. Return `{ manifest, firstSegmentUrl }`.

**Async phase (fires immediately after sync phase; client pulls as ready):**
6. Parallel-generate remaining segments using the existing `/generate-segment` route.
7. Parallel-synthesize TTS via existing Cartesia → ElevenLabs → Orpheus fallback chain.
8. Stream each segment to S3-compatible object storage as it completes.
9. Client pulls via `GET /broadcast/:id/segment/:n`. Polling vs server-sent-events is an implementation-plan decision; polling is acceptable given the low segment count (~10 per broadcast).

### Storage

- Segments: AAC files in S3-compatible object storage. Signed URLs, 24h expiry.
- Client caches segments to device memory + MMKV for the session.
- No persistent server-side storage beyond 24h. ONAY-curated broadcasts use longer retention (decided per-broadcast).

### ONAY-curated broadcasts

- Use the same pipeline, baked offline by an editorial job (manual trigger or cron).
- Same manifest schema.
- Served from a shared pool — every user pulls the same AAC files.
- Storage cost amortizes to near-zero per listen.

### Cost estimate

Rough back-of-envelope: **~$0.10-0.30 per user-sourced broadcast** in LLM + TTS, depending on length and provider mix. ONAY-curated broadcasts amortize to near-zero per listen after the initial bake.

---

## Faking "live"

All techniques bake at session-start time but feel spontaneous at play time.

### Baked-in freshness (server-side, at bake time)

- **Timestamp injection:** "8:47 on a Thursday" — current minute baked into the cold open prompt.
- **Weather / time-of-day framing** (if permissions allow): "rain on the windows tonight."
- **Cross-session memory:** "welcome back — last time you left off with Kendrick" (from existing `SessionMemory`).
- **Listening-history callbacks:** "you haven't pulled up Prince in a few weeks" (from Apple Music recently-played).
- **First-time-vs-return-user branching** (already exists in `cold-opens.ts`).

### Variant picking (client-side, at play time)

- Server bakes 2-3 cold-open variants per session with different opening lines.
- Client picks the variant based on context at tap time: same-day return, evening vs morning, first-time-today.
- Creates the feeling that ONAY noticed the user just tapped play.

### Ambient texture

- Never pure silence between segments — low room tone / vinyl hiss bed under stingers.
- Optional: faint studio-presence murmur under ONAY's voice, baked into the TTS render.
- Stingers vary by vibe.

### Sign-off that references the session

- Final segment mentions specific tracks that played: "we closed with that Frank Ocean cut..." Manifest is known at bake time, so the outro can name tracks by name.
- Optionally teases the next suggested broadcast.

### What we deliberately skip

- No real-time reactivity to skip/pause/resume (no skip exists; pause is just pause).
- No in-session regeneration. The broadcast is the broadcast.

---

## Failure modes

### Network drops mid-bake (between segments landing)

- Client has manifest + partial segment cache. Plays what it has.
- If the next segment is not yet cached by track-end, skip the ONAY segment silently → stinger → next track. User hears music keep flowing. No error state.
- Background retry: client polls for missing segments every 10s while still in session.

### Network drops before first segment returns

- 15s timeout on `/broadcast/create` → show "broadcast unavailable, try again" with retry button. User hasn't invested anything yet.

### Server bake failure on a mid-session segment

- Server's parallel generator has per-segment retry (existing Cartesia → ElevenLabs → Orpheus fallback).
- If all providers fail on one segment, server returns a "skip this slot" marker. Client plays stinger only between those tracks. One missing ONAY moment out of ~9 is survivable.

### User pauses for 30+ minutes, then resumes

- Broadcast resumes at the same position. Time references ("8:47 on a Thursday") may be stale — accepted tradeoff.
- Polish: if resume gap > 1 hour, drop a stinger and skip the next transition segment to avoid a wildly stale reference. Feels like a station break.

### User ends session mid-broadcast

- Clean close. `SessionMemory` saves last track + rough position for the next session's "welcome back" line.
- Pre-baked sign-off does not play — it only fires when the broadcast completes naturally.

### App backgrounded during bake

- Async segment downloads continue (standard `URLSession` background download behavior).
- No LLM / TTS happening client-side, so no CPU spike risk.

### App terminated during session

- Manifest + cached segments persist in MMKV. On relaunch, offer "resume broadcast" if within 2 hours.

### Apple Music track unavailable at play time (rare — track pulled from catalog)

- MusicKit throws. Client advances to the next track in the manifest and plays the pre-baked transition anyway. ONAY may reference a track that didn't play — a rare, accepted misalignment.

---

## Migration path

### Keep as-is

- `expo-music-kit` native module's MusicKit playback, queue plumbing, AVAudioPlayer for segment playback, ducking session. Stop calling `playEjectTransition` and the eject-queue observation paths.
- Server's `/generate-segment` and `/synthesize-voice` routes — called by the new batch orchestrator instead of by the client.
- All Gemini prompt engineering (`static-core.ts`, `cold-opens.ts`, `fallbacks.ts`, `CleoScriptGenerator.ts` logic). Lifts server-side.
- Firebase auth, `authenticatedFetch`, rate limiting.
- `SessionMemory` MMKV persistence.
- Design tokens, UI components, typography, Gold Edition visual language.
- Onboarding flow, profile screen, archive screen (repurposed to show past broadcasts).

### Rewrite client-side

- `HomeScreenRedesign` → two stacks (featured broadcasts + "Your Broadcast" setup). Stations concept removed.
- `BroadcastScreen` → much simpler. No eject timing UI, no editorial insight pre-gen, no speaking overlay firing on `onSegmentReady`. Plays cached manifest.
- `SessionEngine` → replaced by `BroadcastPlayer`. New state machine: fetch manifest, play tracks, play cached segments between them, handle resume. No phase progression, no queue upgrade, no mid-song scheduling.
- `AudioCoordinator` → collapses into `BroadcastPlayer`. Duck + speak pattern stays; everything else goes.
- `SessionArcScreen` → reframed to show the current broadcast's full manifest upfront (nothing is dynamic, so all ~9 tracks are visible from the start).

### Delete entirely

- `TransitionPreloader` (all of it).
- `SegmentController` (logic moves server-side).
- `QueuePlanner` client-side caller (logic moves server-side).
- `QueueManager.upgradeQueueInBackground`.
- Client-side eject timing, `onEjectTrackChanged` handling, eject fallback logic, `generationId` cancellation dance.
- Mid-song drop scheduling on client.
- `post_song` delivery mode on client.

### Add new

- Server: `/broadcast/create`, `/broadcast/:id/segment/:n`, batch orchestrator, AAC object storage, ONAY-curated editorial bake job.
- Client: `BroadcastPlayer`, manifest caching, segment pre-fetch queue, stinger library.

### Suggested build order

1. Server-side batch orchestrator + storage. Test via curl — no client changes yet.
2. Client `BroadcastPlayer` against a hardcoded local manifest. Proves the transition pattern works end-to-end.
3. Wire up `/broadcast/create` + segment streaming to replace the hardcoded manifest.
4. Home screen rework + ONAY-curated broadcasts pipeline.
5. Failure-mode hardening, stinger polish.
6. Migrate existing users — kill the old player, ship the new one.

---

## Non-goals

- Skip-a-track support.
- Real-time reactivity to user behavior mid-session.
- Infinite / continuous playback.
- Preserving the "stations" mental model.
- Server-side mixing of Apple Music audio (licensing prohibits this).
- Full backwards compatibility with the existing client player — this is a replacement, not an addition.

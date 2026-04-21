# ONAY Playlist Generation — Design Spec

**Date:** 2026-03-22
**Branch:** v1.2
**Status:** Draft

---

## Overview

ONAY gains the ability to curate and create playlists in the user's Apple Music library. Two modes of creation:

- **User-initiated:** The user asks ONAY to build a playlist via a conversational chat interface (e.g., "make me a rainy Sunday playlist"). ONAY interprets the request, suggests tracks, validates them against the Apple Music catalog, sequences them through the existing queue pipeline, and saves the result to Apple Music.
- **ONAY-initiated:** ONAY proactively suggests playlist concepts on the home screen based on time of day, user preferences, and listening history. The user taps to preview, then saves or broadcasts.

Both modes produce real Apple Music playlists that can be played as broadcast sessions with full ONAY commentary.

---

## Prerequisites — QueuePlanner Verification

Before building playlist generation, audit the existing queue pipeline to confirm it produces well-ordered queues.

### What to Verify

- QueuePlanner's Gemini prompt produces correct arc shapes (opener → build → peak → cooldown → closer) for short (<20), medium (20-40), and long (40+) playlists
- RulesEngine enforcement fixes violations: artist separation (no repeat within 2), album separation (within 4), genre bridging between unrelated adjacent tracks
- `upgradeQueueInBackground` successfully reorders the MusicKit queue mid-session
- Local fast plan → AI upgrade handoff works cleanly (no duplicate or dropped tracks)

### How to Verify

- Add logging/diagnostics that dump before/after queue order during a live session
- Compare AI-planned order against rules (artist repeats? genre clashes without bridges?)
- Test with different playlist sizes (~15, ~30, ~50+) and vibes
- Fix any issues found before proceeding

---

## Section 1: Native MusicKit Additions

Two new capabilities added to `modules/expo-music-kit/`.

### Catalog Search — `searchCatalog(query, types, limit)`

- Wraps `MusicCatalogSearchRequest` in Swift
- Search by text query (e.g., "Norah Jones Don't Know Why")
- Filter by type: songs, artists, albums
- Returns array of `MusicTrack`-compatible objects:
  ```typescript
  {
    id: string;
    title: string;
    artistName: string;
    albumTitle: string;
    artworkUrl: string;
    duration: number;       // seconds (matches MusicTrack.duration)
    genreNames: string[];
  }
  ```
- Limit parameter (default 5 per query)
- Exposed to TypeScript as `ExpoMusicKit.searchCatalog()`

### Playlist Creation — `createPlaylist(name, description, trackIds)`

- Wraps `MusicLibrary.shared.createPlaylist(name:description:items:)` in Swift
- Takes a name, description, and array of Apple Music catalog track IDs
- **Implementation note:** The Swift side must resolve string IDs to `Song` objects via `MusicCatalogResourceRequest<Song>` before passing to `createPlaylist(items:)`. This resolution is internal to the native module — the TypeScript API accepts string IDs.
- Creates the playlist in the user's Apple Music library
- Returns the new playlist ID
- Exposed to TypeScript as `ExpoMusicKit.createPlaylist()`

Both require existing Apple Music authorization. Catalog search requires an active Apple Music subscription (`canPlayCatalog` flag already tracked). **PlaylistCurator must check `canPlayCatalog` before starting** and surface a clear message in the chat UI if the user lacks a subscription.

---

## Section 2: Server-Side Curation Endpoint

New route: **`POST /curate-playlist`**, protected by `requireAuth`.

### Request Schema

```typescript
{
  prompt: string;              // "rainy Sunday afternoon vibes"
  trackCount?: number;         // default 20, range 10-50
  round: "initial" | "gap-fill" | "refinement";
  existingTracks?: Array<{     // for gap-fill/refinement: tracks already in the playlist
    title: string;
    artist: string;
  }>;
  unmatchedTracks?: Array<{    // for gap-fill: suggestions not found in catalog
    title: string;
    artist: string;
  }>;
  userFeedback?: string;       // for refinement: "swap out the Coldplay", "make it more upbeat"
}
```

### Response Schema

```typescript
{
  tracks: Array<{
    title: string;
    artist: string;
  }>;
  suggestedVibe: Vibe;         // one of the 12 vibes, derived from prompt
  playlistTitle: string;       // LLM-generated concept title
  playlistDescription: string; // ONAY's pitch line for the playlist
  conversationalResponse: string; // ONAY's chat message to the user
}
```

### Behavior

- **Initial round:** Sends user's prompt to LLM with system prompt: "You are ONAY, an AI radio host. Suggest {trackCount} songs that match this request. Return JSON with artist and track name for each, plus a playlist title, description, suggested vibe, and a conversational response."
- **Gap-fill round:** Sends unmatched tracks + existing matched tracks, asks LLM for replacements that complement the existing set. Same response format.
- **Refinement round:** Sends current playlist + `userFeedback` string. LLM makes targeted swaps (not full regeneration) and returns the updated track list. Same response format.

### LLM Provider

Uses the existing Ollama-primary / Gemini-fallback provider abstraction. Ollama model upgraded globally to `qwen2.5:14b` (via `OLLAMA_MODEL` env var) for stronger music knowledge. This affects all Ollama calls (segment generation, queue planning, playlist curation). Gemini remains the fallback. Monitor segment generation quality after upgrade — if regressions appear, the provider abstraction can be extended to support per-route model selection.

### Input Validation

- `prompt`: sanitize for prompt injection (strip control characters, cap at 500 chars)
- `trackCount`: clamp to 10-50, default 20
- `maxTokens` for LLM: set based on `trackCount` (50 tracks × ~30 tokens/track JSON ≈ 1500, plus metadata — use 4096 for headroom)
- `userFeedback`: sanitize same as `prompt`, cap at 500 chars

### Why a Dedicated Endpoint

The `/generate-segment` route is tuned for short radio commentary with delivery modes and session phase context. Playlist curation returns structured track lists, not spoken scripts. Separate route keeps both clean.

### Latency Budget

A full playlist generation involves up to 3 sequential LLM calls: initial curation, gap-fill (if needed), and QueuePlanner sequencing (via `/generate-segment`). Plus parallel catalog searches. Expected total: 10-20s. The chat UI must show progressive feedback (ONAY's conversational response appears immediately after the first LLM call; catalog search + sequencing happen behind a loading state).

---

## Section 3: Client-Side Curation Engine

New engine: **`src/engines/PlaylistCurator.ts`**

### Generation Flow

1. **Receive prompt** from chat UI (or periodic suggestion trigger)
2. **Call `/curate-playlist`** (initial round) → get ~20 track suggestions (artist + title pairs) + metadata (title, description, vibe, conversational response)
3. **Catalog search loop** — for each suggestion, call `ExpoMusicKit.searchCatalog("{title} {artist}", ["songs"], 5)`. Match by fuzzy title + artist comparison. Collect hits and misses. Batch 5 searches at a time to avoid hammering the device.
4. **Gap-fill** (if >20% unmatched) — call `/curate-playlist` (gap-fill round) with misses and hits. Search catalog for replacements. One round only.
5. **Build TrackProfiles** — convert catalog results into `TrackProfile` format
6. **Sequence via QueuePlanner** — pass validated tracks + `suggestedVibe` to `planQueue()` for arc shaping (opener → build → peak → cooldown → closer)
7. **Enforce via RulesEngine** — run planned order through hard rules (artist separation, album separation, genre bridging)
8. **Return final ordered list** to the UI for preview

### Track Count

Default 20 tracks. If the user specifies a length in their prompt (e.g., "a long playlist for my flight"), the LLM interprets it and picks an appropriate count (10-50 range, clamped server-side).

---

## Section 4: Chat UI — "Ask ONAY" Screen

Dedicated screen accessible from a card on the home screen.

### Navigation

- Home screen card labeled **"ASK ONAY"** (mono gold label) navigates to this screen
- New route at `app/(main)/(broadcast)/ask-onay.tsx` within the existing broadcast stack
- Back button returns to home

### Screen Layout

- **Header:** "ONAY" in DM Mono gold label style, back button
- **Message list:** scrollable conversation
  - ONAY's messages: EB Garamond Italic (her voice font), gold left-edge accent on bubbles
  - User's messages: Inter, right-aligned
- **Input bar:** text input at bottom with send button. Placeholder: *"What do you want to hear?"*
- **Playlist preview card:** appears inline in chat when generation completes
  - Gold left-edge card with scrollable track list (artwork thumbnail + track name + artist)
  - Two action buttons: **"Save to Apple Music"** and **"Take it Live"**

### Conversation Flow

1. User types prompt → sends to server via `authenticatedFetch`
2. ONAY responds with conversational message ("Let me put something together for a rainy Sunday...") — appears immediately after first LLM response
3. Loading state while catalog search + sequencing runs (~5-10s)
4. ONAY presents playlist preview with commentary ("Here's 20 tracks — I opened with Norah Jones and built toward Radiohead by the end.")
5. User can **save**, **take it live**, or **ask for changes** ("swap out the Coldplay", "make it more upbeat")

### Refinement

If the user asks for changes, a refinement round runs:
- Calls `/curate-playlist` with `round: "refinement"`, current playlist as `existingTracks`, and the user's message as `userFeedback`
- LLM makes targeted swaps (not full regeneration)
- Catalog validates replacements
- Re-sequences through QueuePlanner + RulesEngine
- Updated preview shown in chat

### Error Handling

- **Server unreachable / LLM timeout:** Show error message in chat with retry button. Use 15s timeout (consistent with TTS timeout convention).
- **Catalog search failures:** Skip failed tracks, proceed with what matched. If <5 tracks matched total, show error suggesting the user try a different prompt.
- **No subscription (`canPlayCatalog` false):** Show message explaining Apple Music subscription is required for playlist creation. Check before starting generation.

### Conversation Persistence

Chat history is **ephemeral** — not persisted to MMKV. Navigating away clears the conversation. The generated playlist itself is saved to Apple Music (durable), so losing the chat is low-stakes. If the user backgrounds during generation, the in-flight request completes and the result appears when they return (React state survives backgrounding).

---

## Section 5: ONAY's Periodic Suggestions

Proactive playlist concepts on the home screen.

### Trigger Logic

- Runs on app open, gated by 6-hour cooldown (MMKV timestamp)
- Context sent to `/curate-playlist`:
  - Time of day, day of week
  - User's onboarding preferences (mood, goal, genres)
  - Listening history (recently played artists, skipped tracks, favorite vibes)
- System prompt: "You are ONAY. Based on this listener's profile and the current moment, suggest a playlist concept and tracks."

### Home Screen Placement

- New section: **"ONAY SUGGESTS"** (mono gold label)
- Gold left-edge card showing:
  - Playlist concept title (e.g., "Sunday Morning Slowdown")
  - 1-2 sentence pitch from ONAY in EB Garamond Italic
  - Track count
- Only one suggestion at a time — new one replaces old

### Generation Timing

- On app open: LLM call fires **non-blocking** (fire-and-forget from home screen's perspective). Home screen renders immediately; the "ONAY SUGGESTS" card appears only after the LLM response arrives. If Ollama is down and Gemini fallback is slow, the card simply doesn't appear — no impact on home screen load.
- Full catalog search + sequencing happens when user **taps the card** (with loading state)
- Avoids adding latency to home screen load

### Persistence

- Suggestion concept cached in MMKV with 6-hour TTL, keyed by user ID (e.g., `onay_suggestion:{uid}`)
- Refreshes on next app open after cooldown expires

---

## Section 6: Save + Broadcast Handoff

### "Save to Apple Music"

- Calls `ExpoMusicKit.createPlaylist(name, description, trackIds)` with sequenced track IDs
- Name: LLM-generated concept title
- Description: ONAY's pitch line + "Curated by ONAY"
- On success: toast confirmation
- Playlist appears in home screen's playlist grid (readable via `fetchPlaylists`)

### "Take it Live"

- Creates the Apple Music playlist first (same as save)
- Initializes broadcast session: `queueManager.initializeSession(newPlaylistId, suggestedVibe, stationId)`
- **Skips AI queue upgrade** — tracks already sequenced by QueuePlanner + RulesEngine during curation. Queue plan passed directly to QueueManager.
- Creates a new Station entry with playlist name and vibe
- Navigates to BroadcastScreen — ONAY starts hosting immediately

### Refinement via Chat

- User types feedback in chat, another curation round runs
- Previous playlist state passed as context for targeted swaps (not full regeneration)
- Re-sequences through QueuePlanner + RulesEngine after swaps

---

## Architecture Diagram

```
User prompt / Periodic trigger
        │
        ▼
┌──────────────────┐
│  PlaylistCurator  │  (src/engines/)
│                  │
│  1. /curate-playlist (initial)
│     └─ Ollama (qwen2.5:14b) / Gemini fallback
│  2. searchCatalog() × N  (native, parallel batches of 5)
│  3. /curate-playlist (gap-fill) if >20% unmatched
│     └─ searchCatalog() for replacements
│  4. QueuePlanner.planQueue()  (arc shaping)
│  5. RulesEngine.enforce()     (hard rules)
│                  │
│  Output: ordered track list + metadata
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Chat UI / Home  │
│  Preview card    │
│  Save / Broadcast│
└──────────────────┘
        │
        ▼
┌──────────────────────────────┐
│  ExpoMusicKit.createPlaylist │  (native Swift)
│  → Apple Music library       │
└──────────────────────────────┘
        │ (if "Take it Live")
        ▼
┌──────────────────────────────┐
│  QueueManager.initializeSession │
│  → BroadcastScreen              │
│  (pre-sequenced, no re-plan)    │
└──────────────────────────────┘
```

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Playlist storage | Apple Music library (native API) | Persists outside the app, user owns it |
| Track sourcing | LLM suggests → catalog validates → gap-fill | Best accuracy; every track guaranteed playable |
| Sequencing | QueuePlanner + RulesEngine | Reuses proven pipeline; consistent with broadcast quality |
| User interaction | Conversational chat | Fits ONAY's personality; handles freeform requests naturally |
| ONAY-initiated | Periodic suggestions on home screen | Low-friction discovery without notification spam |
| LLM model | Ollama `qwen2.5:14b` primary, Gemini fallback | Stronger music knowledge within 12GB VRAM budget |
| Track count | Default 20, user can request 10-50 | Covers common use cases without overcomplicating |
| Chat location | Dedicated screen via home screen card | Gives conversation space without adding a tab |
| Broadcast handoff | Save first, then start session with pre-sequenced queue | Playlist persists; no redundant re-planning |
| Concurrency | Playlist curation disabled during active broadcast | Avoids rate limit contention between curation + segment/TTS/eject calls |

# Phase 6 — Session Engine + Queue Intelligence Design

**Goal:** Intelligent song sequencing that creates a curated DJ-set arc, with AI-powered queue planning, hard rules enforcement, and runtime adaptation.

**Architecture:** Four-layer system — metadata foundation, AI sequencing via Gemini, deterministic rules engine, and runtime adaptation for skips and session length changes. Cold opens and session persistence via MMKV.

## Layer 1: Track Metadata

Every track gets a TrackProfile from MusicKit + MusicBrainz:
- id, title, artistName, albumTitle, genre, duration, year
- tempo (BPM from MusicBrainz)
- tags (from MusicBrainz — "chill", "upbeat", "acoustic", etc.)
- MusicBrainz enrichment runs in background at 1 req/sec while first tracks play

## Layer 2: AI Queue Planning

One Gemini call at session start. Input: full track list with metadata, vibe, time of day, playlist size, recently played. Output: ordered queue with role and reasoning per track.

Arc shapes by playlist size:
- Short (<20): opener → build → peak → close
- Medium (20-40): opener → early build → mid build → peak → cool down → close
- Long (40+): full arc with multiple peaks and valleys

## Layer 3: Hard Rules Engine

Validates AI queue, fixes violations:
- No same artist within 3 tracks
- No same album within 5 tracks
- No recently played tracks (last 50)
- Adjacent tracks can't jump >30% energy
- Genre jumps require bridge track insertion
- Vibe enforcement (filter inappropriate energy levels)

Rules only modify when violated — AI order stands if clean.

## Layer 4: Runtime Adaptation

- **Skips**: 2+ consecutive skips trigger Gemini re-plan with skip context. Cleo acknowledges via `skip_reaction` segment.
- **Session extension**: If listener plays past original arc, start second arc cycle with remaining tracks.
- **Cold opens**: Priority-based selection (first ever, same-day return, streak, day-specific, vibe-matched). History in MMKV.
- **Mid-session events**: 30-min checkin, genre shift transition segment, wind-down energy decrease.

## Milestone

Session starts with AI-curated queue. Songs flow with intentional energy arc. Genre bridges inserted automatically. Skips trigger re-planning. Cold opens vary by context.

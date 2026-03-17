# Phase 7 — Track Enrichment + Storytelling Design

**Goal:** Cleo tells real stories about songs using verified data from MusicBrainz + Genius, with graceful fallback to artist context when no data is available.

**Architecture:** TrackEnrichmentService queries both MusicBrainz (tags, year) and Genius (producer, songwriter, samples, annotations). Enriched facts injected into SegmentController's dynamic prompt. track_story segment type only fires when rich data exists. Enrichment pre-fetches 3 tracks ahead.

## Data Sources

- MusicBrainz: tags, year, duration (already working)
- Genius: producer, songwriter, sample info, annotations/context (via existing /enrich-track route)
- Both merged into TrackProfile.enrichedFacts

## Fact Priority for track_story

1. Sample source (highest storytelling value)
2. Behind-the-scenes context (Genius annotations)
3. Producer credits
4. Songwriter credits
5. Cultural context (lowest priority)

## Segment Type Changes

- `track_story`: only eligible when enrichedFacts has data. Prompt includes VERIFIED TRACK FACTS block.
- `artist_context`: safe fallback when no verified data. Gemini speaks about the artist generally.
- Both added to rotation pool in SegmentController.

## Pre-fetching

Enrichment runs 3 tracks ahead of current playback position in the queue.

## Milestone

Cleo tells a real, verified story about a song's production, samples, or writers.

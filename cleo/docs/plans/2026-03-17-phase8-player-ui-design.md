# Phase 8 — PlayerScreen + Pull Quote + Subtitles Design

**Goal:** Build the hero PlayerScreen with editorial layout, word-by-word subtitles, pull quote overlays, and ON AIR indicator that pulses during Cleo's speech.

**Architecture:** PlayerScreen as the main listening experience. WordByWordSubtitle component for real-time text reveal. PullQuoteOverlay for track_story segments. OnAirIndicator pulses during speech. State-based navigation from HomeScreen (React Navigation deferred to Phase 9).

## PlayerScreen Layout

- Station name + ON AIR indicator (mono, wide tracking)
- Thin accent color rule
- Album art (full bleed, no rounded corners)
- Song title (52pt Playfair Display, uppercase)
- Artist name + year (16pt Work Sans)
- ON AIR pulse indicator (glows during Cleo speech)
- Cleo's words (EB Garamond italic 18pt, word-by-word reveal)
- Thin progress line

## Components

- `PlayerScreen` — main layout, receives track data + Cleo state
- `WordByWordSubtitle` — splits text to words, 40ms stagger fade-in
- `PullQuoteOverlay` — full-screen overlay for track_story, 28pt EB Garamond italic, dimmed backdrop, clause-by-clause fade, 1s hold, upward dissolve
- `OnAirIndicator` — pulses when Cleo is speaking

## Pull Quote Behavior

- Only on track_story segments
- 70% opacity backdrop over album art
- Text fades in per clause
- Holds 1 second after speech
- Dissolves upward, 600ms

## Navigation

- HomeScreen → PlayerScreen via state toggle (no React Navigation yet)
- Back button on PlayerScreen returns to HomeScreen

## Milestone

PlayerScreen displays current track with editorial layout. Cleo's words appear word-by-word. Pull quotes fire on track_story segments.

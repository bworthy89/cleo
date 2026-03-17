# Phase 5 — Audio Coordination & Core Handoff Design

**Goal:** Automatic radio loop — music plays, song ends, Cleo speaks an intro, music resumes at full volume.

**Architecture:** SegmentController decides what to say and pre-loads segments. AudioCoordinator handles AVAudioSession ducking and TTS playback. Native module additions for ducking control. onTrackChanged event triggers the full sequence automatically.

## Components

- **SegmentController**: segment type rotation, history tracking (last 3), context assembly, pre-loading buffer
- **AudioCoordinator**: AVAudioSession ducking activation/deactivation, TTS playback orchestration
- **Native additions**: activateDuckingSession(), deactivateDuckingSession() in ExpoMusicKit

## Handoff Sequence

1. Song ends → onTrackChanged fires
2. 1-2s natural delay
3. SegmentController picks segment type, generates script (or uses pre-loaded buffer)
4. AudioCoordinator activates ducking session (music volume drops automatically)
5. TTS audio plays (Cleo speaks)
6. AudioCoordinator deactivates ducking session (music ramps back)
7. Pre-load next segment into buffer

## Milestone

Full radio loop working automatically without user intervention.

# Phase 9 — Onboarding + Full Navigation Design

**Goal:** Complete app flow from first launch through onboarding to radio sessions, with proper Expo Router navigation and settings screens.

**Architecture:** Expo Router file-based navigation with three route groups: (onboarding), (main), (settings). Onboarding gates on first-launch check via MMKV. Existing screens migrated to route files. Components/engines/services stay in src/.

## Navigation Structure

- `app/_layout.tsx` — Root layout (fonts, splash screen)
- `app/index.tsx` — Redirect based on onboarding completion
- `app/(onboarding)/` — Welcome, Music Auth, Vibe Setup, First Station
- `app/(main)/` — HomeScreen, PlayerScreen
- `app/(settings)/` — Profile, Host Settings, History

## Onboarding Screens

1. Welcome — Cleo intro, tagline, Get Started button
2. Music Auth — Apple Music permission with context copy
3. Vibe Setup — Name input + vibe card selection (5 vibes)
4. First Station — Playlist grid, select first station

Only shows on first launch (MMKV user key check).

## Settings Screens

- Profile — edit name, Apple Music status
- Host Settings — toggle commentary, pull quote toggle
- History — past sessions list (date, station, duration, tracks)

## Migration

- App.tsx → app/_layout.tsx
- HomeScreen → app/(main)/index.tsx
- PlayerScreen → app/(main)/player.tsx
- New onboarding + settings screens as route files

## Milestone

Complete app flow: first launch → onboarding → home → player → settings. All navigation works with back gestures.

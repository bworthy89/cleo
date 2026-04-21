# E2E Tests (Maestro)

UI tests that run on the iOS Simulator.

## Setup

```bash
# Install Maestro (requires Java 17+)
curl -fsSL "https://get.maestro.mobile.dev" | bash

# Install Java if needed
brew install openjdk@17
```

## Running

```bash
# Run all tests
maestro test e2e/

# Run a single test
maestro test e2e/01-app-launch.yaml

# Run with verbose output
maestro test --debug-output e2e/
```

## Prerequisites

- iOS Simulator booted with the app installed
- Metro bundler running (`npx expo start --dev-client`)
- Or a release build installed on the simulator

## Test Coverage

| Test | What it validates |
|------|------------------|
| 01-app-launch | App loads, defaults to broadcast tab |
| 02-tab-navigation | All 4 tabs accessible and render content |
| 03-broadcast-home | Greeting, stations, playlists sections |
| 04-onay-profile | Character, personality, ecosystem, account |
| 05-archive-screen | Header, filter tabs, tab switching |
| 06-station-creation | Playlist tap opens vibe picker |
| 07-personality-selection | Can switch between AI personalities |
| 08-error-boundary | Rapid tab switching doesn't crash |
| 09-sign-out-flow | Sign out dialog appears, cancel works |

## Limitations

- Cannot test Apple Music playback (requires subscription + auth)
- Cannot test ONAY voice generation (requires backend + API keys)
- Cannot test eject transitions (requires active playback)
- Login flow not tested (requires Firebase credentials)

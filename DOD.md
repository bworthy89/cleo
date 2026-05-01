# Definition of Done

Per the dev-pipeline spec ([`docs/superpowers/specs/2026-05-01-dev-pipeline-design.md`](docs/superpowers/specs/2026-05-01-dev-pipeline-design.md), Tier 2). Solo-dev hygiene rules + a per-change-type checklist that catches the failure modes we keep hitting. Skip steps deliberately, not by accident.

## Workflow rules

### One branch at a time

Don't open a new feature branch while another is half-done. Either:

- **Finish + merge**, or
- **Commit, push, document state in today's daily note**, then `git checkout main && git checkout -b new-thing`, or
- **Stash with a meaningful message** (`git stash push -m "wip: <what + blocker>"`), document in today's daily note.

Eliminates the "pile of half-finished branches" problem at the cost of a moment of state-capture. The 2026-05-01 OTA work demonstrated the cost of skipping this — the music-kit WIP had to be repeatedly stashed and popped because it lived in the working tree alongside unrelated work.

### Single-mode sessions when possible

Either client OR server work in a session, not interleaved. Saves the ~15 min context-switching tax. When a change genuinely spans both (a new API endpoint + the screen that calls it), batch the server side first to completion, then switch.

Soft rule — easily violated when bug-chasing — but worth defaulting to.

---

## DOD by change type

### Server logic change

- [ ] Affected jest tests pass (`cd server && npm test` or run the specific suite)
- [ ] `cd server && npm run smoke:bake` passes (catches pipeline regressions in 5–10s; uses the canned 5-track fixture)
- [ ] **Push to `staging` branch** → auto-deploy fires (~30s end-to-end). Watch GH Actions: https://github.com/bworthy89/cleo/actions. If red, fix before proceeding. If green, staging tier is now live with your change.
- [ ] Smoke-test on staging: either local-device install with `EXPO_PUBLIC_API_URL=https://staging.api.worthymedia.tech` in `.env.local` and bake from the app, OR `curl https://staging.api.worthymedia.tech/health` plus `ssh cleo@<VPS_HOST> 'pm2 logs cleo-broadcast-staging --lines 50 --nostream'` for any new code paths exercised
- [ ] **Merge `staging` → `main` and push** — prod auto-deploys in ~30s. Watch GH Actions for green health check.
- [ ] PM2 logs sane for ~5 min after prod deploy: `ssh cleo@<VPS_HOST> 'pm2 logs cleo-broadcast --lines 100 --nostream'` shows no health-check flap, no Sentry spike, no 5xx pattern. (`[skip deploy]` in commit message bypasses auto-deploy — use only for docs-only commits, never code.)

### Client JS/UI change

- [ ] Renders correctly on simulator (`npm start` + `i`)
- [ ] Renders correctly on device (`SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`), or explicitly noted as "needs device test"
- [ ] OTA-pushable: change is purely JS/TS (no native deps, no `app.json` plugin changes, no `ios/` edits). Guard script auto-validates this — it'll refuse the push if working-tree `runtimeVersion` doesn't match the latest TestFlight build's
- [ ] Published: `npm run update:prod -- --message "..."` (full rollout, for trivial) OR `npm run update:prod:safe -- --message "..."` (25% rollout, for non-trivial). Both go through `scripts/guard-update.mjs`
- [ ] Sentry watched ~30 min after push; if crash rate spikes, `eas update:republish --group <prev-id> --platform ios` (NOT `--branch` — EAS rejects the combo). **Caveat:** Sentry source-map upload is currently broken (LATER item in `docs/index.md`); JS crashes will be unmapped until fixed

### Native iOS change

- [ ] Clean local rebuild: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device` (override needed because local builds can't read EAS secrets)
- [ ] Audio session behavior verified on physical device: broadcast through to a track, pause + resume mid-broadcast, background → foreground transitions, lock screen / Now Playing controls
- [ ] Bumped via `npm run bump:build` — pick the right mode:
  - **Default** (`npm run bump:build`): build number only. Use when no native deps changed, no Swift changed, no plugin config changed. Preserves the OTA chain (old binaries can still receive OTAs from this build's runtime).
  - **`-- --release patch|minor|major`**: build number + `expo.version` + `runtimeVersion` (app.json) + `EXUpdatesRuntimeVersion` (Expo.plist), all in lockstep. Use when adding/changing native deps (`react-native-*`, `expo-*` with native, `@react-native-*`), modifying `modules/expo-music-kit/`, or any Swift change. Intentionally breaks the OTA chain — old binaries on the previous runtime won't receive OTAs from this build (correct: the JS bundle now expects native APIs they don't have)
- [ ] EAS production build succeeded: `eas build --profile production --platform ios --non-interactive`. Watch the build log for the Sentry source-map upload step — currently silently failing (LATER fix)
- [ ] EAS submit succeeded: `eas submit --profile production --platform ios --latest`
- [ ] TestFlight build installed on device, opened once to register on the production update channel
- [ ] Smoke a basic flow: cold launch → onboarding-or-resume routes correctly → start a broadcast → first track plays → cold open audio plays

# Dev Pipeline Design

**Status:** Draft / sketch — not yet scheduled.
**Author:** Captured from analysis on `claude/analyze-beta-testing-plan-QEqqM`.
**Date:** 2026-05-01.

---

## Problem

Solo-developer workflow on a stack that spans React Native + Expo + custom Swift native module + Express + multiple LLM/TTS providers. The current dev loop has six painful boundaries, none of which are particularly badly chosen, but together they make routine testing feel disproportionately tedious:

1. **TestFlight via EAS** — 30–60 min round-trip (build + Apple processing + install). Used reflexively for changes that don't need it.
2. **Local device build** (`expo run:ios --device`) — 5–10 min. Required for any Swift change.
3. **Simulator + Metro** — <30s. Sufficient for most JS/UI work, but MusicKit doesn't work here.
4. **Server `npm run dev`** — seconds. Hot-reload may or may not be wired.
5. **Jest** — 1–10s. Wired but not running in watch.
6. **Manual SSH+PM2 deploy** — multi-minute, multi-step, scary. Documented in `server/DEPLOY.md` as a 9-step ritual.

Lived consequence: every change defaults to the slowest viable loop because the boundaries between loops aren't enforced. A typo fix gets a TestFlight build. A pure-logic refactor gets device-tested. A server change gets prod-deployed because there's nowhere else to send it.

Layered on top of the loop friction, solo-dev workflow problems compound:

- **Half-finished branches pile up.** No "you must finish this before opening another" gate.
- **Mid-session context loss.** Sit down to fix bug X, notice issue Y, refactor Z, end the day with no clear "what did I finish."
- **No clear definition of done.** Compiles? Tests pass? On TestFlight? Tester confirmed? Different changes have different answers, none written down.
- **Forgotten context.** A change last week, a tester report this week, no thread to pull.
- **Mode switching cost.** Client work and server work in the same session each cost ~15 min of re-orientation.
- **"What should I work on" decision fatigue.** Plausible options compete; no ranking.
- **Deploy friction shapes behavior.** Server changes pile up because shipping them is unpleasant.

This doc proposes a layered set of changes — testing-loop fixes first, workflow hygiene second, automation last — ranked by ratio of pain-relief to effort.

---

## The loops you actually run

| Loop | Round-trip | Required for | Used today for |
|---|---|---|---|
| TestFlight via EAS | 30–60 min | Final pre-release validation | Routine UI tweaks (overkill) |
| Local device build | 5–10 min | Native (Swift) module changes | Native + JS work bundled |
| Simulator + Metro reload | <30s | Most JS/UI, navigation, hooks, non-audio engines | Underused |
| Server `npm run dev` | seconds | All server changes | Used, but server tests aren't in watch |
| Jest watch | 1–10s | Pure logic (engines, services, sequencer, prompts) | Not running by default |
| Smoke bake (proposed) | 5–10s | End-to-end pipeline sanity without iOS | Doesn't exist |
| Staging server (proposed) | <1 min push, <2 min deploy | Server changes against real R2/Gemini/VoxCPM | Doesn't exist |

The new entries (smoke bake, staging server) plug the two gaps where today's only options are "test in production" or "TestFlight cycle."

---

## The workspace

Before the loops or the automation, the spine: a single local-first markdown vault that holds NOW/NEXT/LATER, daily notes, half-thoughts, and the existing `docs/superpowers/` specs and plans. Every loop in the rest of this document feeds back into the vault — what got shipped today, what's blocked, what to pick up tomorrow. The vault is where the work is *organized*; the tiers below are how the work is *executed*.

**Vault location: the repo's own `docs/` directory.**

```text
docs/                              ← Obsidian vault root
  Conventions.md → ../CLAUDE.md    ← symlink to project-root CLAUDE.md; renamed so
                                     Claude Code's CLAUDE.md auto-discovery doesn't
                                     load it a second time, but Obsidian still
                                     indexes it as `[[Conventions]]`
  superpowers/
    specs/                         ← already there; backlinkable as [[2026-05-01-sqlite-migration-design]]
    plans/                         ← already there
  daily/                           ← NEW, gitignored — Daily Notes auto-create here
    2026-05-13.md
    2026-05-14.md
  index.md                         ← NEW — NOW/NEXT/LATER lives here
  ideas/                           ← NEW, gitignored — quick capture for half-thoughts
  .obsidian/                       ← Obsidian config + plugin settings, gitignored
```

Add to `.gitignore`:

```text
docs/.obsidian/
docs/daily/
docs/ideas/
```

Specs and plans stay versioned in git. Daily notes, half-thoughts, and Obsidian config stay personal. The vault sees them all as one navigable graph, with the root-level `CLAUDE.md` (project rules + conventions) one click away from any daily note via `[[Conventions]]`.

**Plugins — start with two, resist adding more:**

- **Daily Notes** (built-in core plugin, just enable). Configures `docs/daily/` as the daily-note folder, `YYYY-MM-DD` as the filename format. Opening Obsidian creates today's note automatically; that's the WORKLOG, no remembering required.
- **Tasks** (community plugin). Treats every `- [ ]` across every file in the vault as a queryable task. The plan docs in `docs/superpowers/plans/` already use checkbox syntax — every unchecked box across every plan + today's daily + `index.md` becomes one unified list, queried via:
  ```tasks
  not done
  group by filename
  sort by priority
  ```

**Don't install yet:** Dataview, Kanban, Templater, Calendar, custom graph view tweaks. They're tempting and they'll calcify the vault's structure before you know what shape you actually want it in. Add only when you catch yourself doing manual work the plugin would automate.

**`docs/index.md` — the NOW/NEXT/LATER home:**

```markdown
# Index

## NOW
- [ ] SQLite Phase 2 — EnrichmentCache + FeaturedRegistry + CuratorPublishBudget

## NEXT
- [ ] SQLite Phase 3 — EventRecorder + retention call sites
- [ ] SQLite Phase 4 — backfill + deploy
- [ ] SQLite Phase 5 — admin endpoints
- [ ] Sentry source-map upload (beta blocker)

## LATER
- [ ] In-app feedback mailto link in SettingsDrawer
- [ ] Native Swift cleanup (eject code, beginTTSBackgroundTask leftovers)
- [ ] Maestro flows for login → bake → playback
- [ ] Reactotron setup
```

Rule: don't pick from NEXT until NOW is empty. The Tasks plugin's "all open tasks" view aggregates this with every other `- [ ]` in the vault, so the daily note's tasks and the index's tasks land together.

**WORKLOG via Daily Notes:**

The end-of-day entry that would have lived in `WORKLOG.md` instead lives in today's daily note:

```markdown
# 2026-05-13

## Worked on
- SQLite Phase 1 done, tests green
- Found one identity-assertion test that needed updating; fixed
- Pushed to `feat/sqlite-store`

## Tomorrow
- Phase 2 — three more stores following the Phase 1 template

## Blocked / open
- Drizzle yes/no — leaning no
```

Backlinks make this navigable: write `[[2026-05-01-sqlite-migration-design]]` in your daily note and click through to the spec. Reference `[[Conventions]]` to jump straight into project conventions when something feels off. A week later when you're trying to remember why a thing happened, the daily note has the trail.

**Sync — pick one before the vault has anything in it:**

- **Obsidian Sync** ($8/mo, official, end-to-end encrypted, just works). Recommended. Treat as a dev-tool subscription.
- **iCloud Drive** (free, Apple-native, occasional file-lock conflicts on iOS). Acceptable.
- **Git** (free, requires Working Copy on iOS, manual). High friction, not recommended for daily notes.
- **Syncthing** (free, P2P, requires both devices online or a relay). Most setup, low overhead once running.

For "whatever is easiest," Obsidian Sync at $8/mo is the answer. Cheap, no maintenance, works between Mac dev box and the iPhone you're testing the app on.

**Cost:** ~30 min total — install Obsidian, point at `docs/`, symlink `CLAUDE.md` in as `Conventions.md`, enable Daily Notes, install Tasks, write a starter `index.md`, configure sync. **Payoff:** the workspace foundation that every loop below feeds into.

---

## Tier 1 — Testing-loop fixes (highest leverage)

### 1. Expo OTA updates (highest absolute payoff)

Install + configure `expo-updates` so JS-only changes can ship in ~2 min instead of a 30–60 min EAS+TestFlight round-trip. **Not currently installed** — `package.json` has no `expo-updates` dep, and the `runtimeVersion: "1.1.2"` in `app.json` is currently inert (and has already drifted from `version: "1.2.0"`, demonstrating exactly the manual-bump failure mode).

```bash
# After install + config:
eas update --branch production --message "fix: profile typo"
# ↑ Ships to every TestFlight build already installed on testers' devices.
```

**What can OTA-update:** screens, components, hooks, engines (`BroadcastPlayer`, `Scrobbler`, etc.), services, prompts, copy, design tokens, anything purely JS+TS.

**What still needs a rebuild:** anything that changes the native fingerprint — Swift native module (`modules/expo-music-kit/ios/...`), new dependencies, `app.json` plugin config, EAS profile changes, Live Activity widget. With `fingerprint` runtime policy (below), this is enforced automatically: the runtime version changes, and OTAs published from the new build don't reach old binaries.

**Setup — five pieces, in order:**

1. **Install + configure `expo-updates`.** `npx expo install expo-updates`, add the plugin to `app.json`'s `plugins` array, run prebuild locally to regenerate the iOS Updates plist entries (CLAUDE.md notes prebuild no longer runs in EAS, so this is manual + committed).
2. **Switch to fingerprint runtime versioning.** Replace the static `runtimeVersion: "1.1.2"` in `app.json` with `runtimeVersion: { "policy": "fingerprint" }`. Expo hashes native deps + config; bumps automatically when native changes, stays put for JS-only changes. Catches the cases `appVersion` policy misses (e.g. a new native dep without a marketing version bump).
3. **Single channel: `production`.** No `preview` channel — there's no preview-builds cohort to ship to, and a solo-dev "promote from preview to production" loop is theater. For risky changes, use `eas update --branch production --rollout-percentage 25` and watch Sentry; for trivial ones, full rollout. Defer a `staging` channel until Phase 3 lands the staging server.
4. **Sentry source-map upload — bundled, not deferred.** Without source maps, every JS crash post-OTA reads `<unknown>:0` and OTA becomes a debugging regression. Required:
   - Create a Sentry write-scope auth token in the Sentry web UI.
   - Add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` as EAS secrets (`eas secret:create`).
   - Configure the `@sentry/react-native` plugin in `app.json` with org + project.
   - Flip `SENTRY_DISABLE_AUTO_UPLOAD` from `"true"` to `"false"` in `eas.json` production env.
   - For OTA pushes: `eas update` uploads source maps automatically once configured.
5. **Foreground update check with broadcast guard.** Default `expo-updates` checks at cold start only — a rollback only reaches a tester on next quit-and-relaunch. Add an `AppState` hook in `app/_layout.tsx` that calls `Updates.checkForUpdateAsync()` on foreground transition. Critically: **never `Updates.reloadAsync()` mid-broadcast** (would interrupt audio). Gate the reload on `BroadcastPlayer.isPlaying === false`; if an update is queued and the user is playing, defer the reload until the next cold start.

**Rollback playbook (document this somewhere greppable):**

```bash
eas update:list --branch production           # find the previous group ID
eas update:republish --group <prev-id> --branch production
eas update:list --branch production           # confirm republished group is at top
```

Caveat: testers need to relaunch the app for the rollback to take effect (or trigger via the foreground hook from step 5).

**Scripts to add:**

```json
"update:prod": "eas update --branch production",
"update:prod:safe": "eas update --branch production --rollout-percentage 25"
```

**Cost:** ~1 full day (revised from spec's original "half day" once source-map upload, fingerprint policy, foreground hook, and rollback dry-run are included). **Payoff:** the 80% of polish/tweak work that's JS-only stops requiring a build cycle, AND post-OTA crashes remain debuggable.

### 2. Smoke-bake script

A single command that proves the broadcast pipeline works end-to-end without touching the iOS app.

```bash
npm run smoke:bake
# POSTs to local /broadcast/create with 5 canned tracks (real Apple Music IDs, fixed)
# Asserts:
#   - 200 response with manifest + firstSegmentUrls populated
#   - manifest.segmentSlots[0].status === 'ready'
#   - manifest.segmentSlots.length matches expected for length=quick
#   - All slot statuses become non-pending within 30s (poll /broadcast/:id/manifest)
#   - bake_status (after SQLite migration) ends as 'completed'
# Logs: time-to-slot-zero, time-to-completion, per-slot status
```

**Where it lives:** `server/scripts/smoke-bake.ts`, runnable via `npm run smoke:bake` from the server dir.

**Inputs:** A canned `tracks.json` checked into the repo. Five real Apple Music IDs, three vibes worth of test runs.

**Run cadence:** every server change. Becomes the "did I break generation" gate that today only exists as full-stack integration on a device.

**Cost:** ~30 min to write. **Payoff:** catches ~90% of pipeline regressions in 5–10 seconds.

### 3. Jest watch in a dedicated terminal tab

Already exists at `server/package.json` (`"test:watch": "jest --watch"`). Just run it.

```bash
cd server && npm run test:watch
# Pin this tab. Every file save reruns affected tests in ~1s.
```

The 21 `BroadcastOrchestrator` tests will tell you if you broke the pipeline before any curl invocation. The deterministic-sequencer goldens (`sequencer-goldens.test.ts`) catch sequencing regressions in milliseconds.

Add an equivalent root-level script for client tests:

```json
"test:watch": "jest --watch --runInBand"
```

**Cost:** zero. **Payoff:** instant feedback on logic changes.

### 4. Staging server (kills the "deploy to prod to test" problem)

> **Resolved 2026-05-01.** This section is the original sketch; the resolved design (R2 / Firebase / DB-state / curator / quota choices) lives in [`2026-05-01-staging-server-design.md`](2026-05-01-staging-server-design.md). Implementation plan: [`docs/superpowers/plans/2026-05-01-staging-server-implementation.md`](../plans/2026-05-01-staging-server-implementation.md).

Run a second instance of the broadcast server on the same VPS, on a different port, behind a different Caddy hostname, with a separate database file.

**Setup:**

- Second PM2 app: `cleo-broadcast-staging`, port `3103`.
- Second Caddy block: `staging.api.worthymedia.tech` → `localhost:3103`.
- Separate `.broadcast-cache/cleo-staging.db`, separate `.env.staging` with its own LLM/TTS keys (or shared, depending on cost).
- Branch convention: push to `staging` branch → auto-deploy to staging server (see Tier 3 automation).
- Client env override: `EXPO_PUBLIC_API_URL=https://staging.api.worthymedia.tech` for dev builds via a `.env.staging` at project root.

**What this enables:**

- Server changes tested against real R2, real Gemini, real VoxCPM — without prod risk.
- Schema changes (post-SQLite migration) tested before production deploy.
- TTS provider tuning (e.g. swapping `TTS_PRIMARY` between VoxCPM and Cartesia) without affecting users.
- Burning down a corrupted state without backup-and-restore drills.

**Cost:** ~half day setup. **Payoff:** removes the "I have to deploy to prod to know if it works" anti-pattern entirely.

### 5. Server hot-reload (verify wired)

Confirm `server/package.json`'s `dev` script uses `tsx watch` or `nodemon` so file changes restart the process automatically. If not, add it.

```json
"dev": "tsx watch src/index.ts"
```

**Cost:** zero (likely already done). **Payoff:** removes the manual `Ctrl-C; npm run dev` cycle.

---

## Tier 2 — Workflow hygiene (small, daily, compounding)

(The Obsidian vault — the spine the rest of these hygiene rules write into — is covered in [The workspace](#the-workspace) above.)

### 1. One-branch-at-a-time rule

Don't open a new feature branch while another is half-done. Either:

- Finish and merge, **or**
- Commit, push, document state in today's daily note, then `git checkout main && git checkout -b new-thing`, **or**
- `git stash push -m "wip: sqlite phase 1, blocked on identity test"` with a meaningful message, document in today's daily note.

This single rule eliminates the "pile of half-finished branches" problem at the cost of forcing a moment of state-capture.

### 2. Definition of Done by change type

Three checklists, written once. Either tape them to a wall, save as `DOD.md`, or stick them in `.github/PULL_REQUEST_TEMPLATE.md`.

**Server logic change:**
- [ ] Affected jest tests pass
- [ ] `npm run smoke:bake` passes
- [ ] Deployed to staging
- [ ] Staging smoke-tested by hand (one bake via curl)
- [ ] Merged to main → auto-deploys to prod

**Client JS/UI change:**
- [ ] Renders correctly on simulator
- [ ] Renders correctly on device (or explicitly noted as "needs device test")
- [ ] OTA-pushable (fingerprint runtime policy auto-validates this; if the runtime version changed locally, you need a native build instead)
- [ ] Published: `npm run update:prod -- --message "..."` for trivial; `npm run update:prod:safe -- --message "..."` (25% rollout) for non-trivial
- [ ] Sentry watched for ~30 min after push; if crash rate spikes, `eas update:republish --group <prev-id> --branch production`

**Native iOS change:**
- [ ] Clean local rebuild (`expo run:ios --device`)
- [ ] Audio session behavior verified on physical device
- [ ] EAS production build succeeded
- [ ] TestFlight build installed and basic flow tested
- [ ] `CURRENT_PROJECT_VERSION` in pbxproj + `app.json` `ios.buildNumber` bumped in lockstep

### 3. Single-mode sessions when possible

Either client OR server work in a session, not interleaved. Saves the ~15 min context-switching tax. When a change genuinely spans both (a new API endpoint + the screen that calls it), batch the server side first to completion, then switch.

This is a soft rule — easily violated when bug-chasing — but worth defaulting to.

---

## Tier 3 — Automation (set-and-forget safety net)

### 1. CI on push (prevents regressions)

`.github/workflows/test.yml`:

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: cd server && npm ci && npm test
```

**Cost:** ~1 hour to set up + debug. **Payoff:** stops "I forgot to run tests, shipped a regression" Saturdays. No more "trust the developer" commits.

Add a status badge to the README to make breakage visible.

### 2. Auto-deploy on push to staging / main

GitHub Action that SSHes to the VPS and runs the deploy steps. Replaces the 9-step `server/DEPLOY.md` ritual.

```yaml
on:
  push:
    branches: [main, staging]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to staging
        if: github.ref_name == 'staging'
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: cleo
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/cleo-broadcast-staging
            git pull origin staging
            npm ci --production=false
            npm run build
            pm2 reload cleo-broadcast-staging

      - name: Deploy to production
        if: github.ref_name == 'main'
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: cleo
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/cleo-broadcast
            git pull origin main
            npm ci --production=false
            npm run build
            pm2 reload cleo-broadcast
```

Note: the production app and directory are `cleo-broadcast` (matches the existing CLAUDE.md / `server/DEPLOY.md` topology), not `cleo-broadcast-main`. The staging counterpart is `cleo-broadcast-staging`. Branch-specific steps (rather than `${{ github.ref_name }}` interpolation in paths) keep the deploy script honest about which environment it's writing to.

**Cost:** ~half day setup including secrets management. **Payoff:** server deploys become `git push`. Removes the deploy-friction-shapes-behavior anti-pattern.

### 3. Pre-push hook (lighter than pre-commit)

`husky` configured to run `npm run typecheck` before push. Catches obvious mistakes without slowing down individual commits.

```text
.husky/pre-push:
  npm run typecheck
```

Skip pre-commit entirely. Pre-commit hooks that run tests slow you down enough that you'll start `--no-verify`-ing them. Pre-push runs once per push (cheap), still catches breakage before CI.

**Cost:** ~15 min. **Payoff:** prevents the "pushed broken main" scenario.

### 4. Build-number bump script

Today: bump `CURRENT_PROJECT_VERSION` in 4 places in pbxproj + `ios.buildNumber` in `app.json`. Easy to mis-sync, ASC rejects duplicate build numbers.

Replace with `npm run bump:build`:

```js
// scripts/bump-build.ts (sketch)
// 1. Read pbxproj, find CURRENT_PROJECT_VERSION (4 occurrences), bump all
// 2. Read app.json, bump expo.ios.buildNumber to match
// 3. Stage both files
// 4. Print "bumped build to N. Don't forget to commit."
```

**Cost:** ~30 min. **Payoff:** removes the "shipped duplicate build number, ASC rejected" failure mode.

---

## A normal session, after all of this

**Vault first.**

1. Open Obsidian. Today's daily note auto-creates: `docs/daily/2026-05-13.md`.
2. Glance at yesterday's daily for context (Obsidian's previous-day link or the file list).
3. Open `docs/index.md`. Pick from NOW. The Tasks plugin's aggregated view shows every open `- [ ]` across plans and notes if you want a wider read.

**Then the loops.** Three terminal tabs:

1. `server` — `npm run dev` (hot-reload)
2. `tests` — `npm run test:watch` in `server/`
3. `metro` — only if doing client work

Make changes. Tests run automatically. Smoke-bake when touching the pipeline.

- JS-only client change → `npm run update:prod` (or `:prod:safe` for 25% rollout) (~2 min)
- Native client change → `expo run:ios --device` (5–10 min); fingerprint policy bumps the runtime, so previous OTAs stay scoped to old binaries
- Server change → push to `staging` → auto-deploys → curl-test → push to `main` → auto-deploys to prod

If a half-thought lands mid-session — a bug to investigate later, an idea for a feature, a tester comment to follow up on — drop it in `docs/ideas/` (gitignored, capture-only) instead of letting it derail the current task.

**Vault last.** Write the daily note's "Worked on" / "Tomorrow" / "Blocked" sections (~2 min). Move any completed `- [ ]` from `index.md`'s NOW into "Worked on." Promote one item from NEXT to NOW.

No more "did I run tests" / "did I deploy" / "what was I doing." Each loop is short enough that you stay in flow, and the vault holds the context across sessions.

---

## Sequencing

Ordered by ratio of pain-relief to effort. Phase 0 first — the rest of the phases write into it.

**Phase 0 — Workspace setup (~30 min)** — the foundation everything else feeds into
- 0.1 Install Obsidian, point at `docs/`, enable Daily Notes, install Tasks plugin, configure sync (Obsidian Sync recommended)
- 0.2 Add `docs/.obsidian/` + `docs/daily/` + `docs/ideas/` to `.gitignore`
- 0.3 Symlink `CLAUDE.md` into the vault under a different filename: `ln -s ../CLAUDE.md docs/Conventions.md` — Claude Code keeps loading the root `CLAUDE.md` from project root and the vault gets a `[[Conventions]]` backlink target without triggering a second auto-load (the rename matters: a `docs/CLAUDE.md` symlink would double-load ~40KB of conventions per session)
- 0.4 Write a starter `docs/index.md` with NOW/NEXT/LATER seeded from current work

**Phase 1 — Tier 1 testing-loop fixes (~2 days total)**
- 1.1 Expo OTA wiring with source maps + fingerprint runtime + foreground hook + rollback playbook (1 day) — biggest absolute win, but full-day not half-day once source-map upload is bundled in (don't ship OTA without it)
- 1.2 Smoke-bake script (30 min) — fastest payoff
- 1.3 Jest watch in a tab (zero) — do today
- 1.4 Server hot-reload verification (zero–15 min)

**Phase 2 — Workflow hygiene (~30 min total, daily compounding)**
- 2.1 Definition-of-done checklists written down (~30 min) — either in `DOD.md` or as the body of `.github/PULL_REQUEST_TEMPLATE.md`
- 2.2 One-branch-at-a-time rule adopted (zero — it's a behavior change)

**Phase 3 — Staging environment (~half day)**
- 3.1 Second PM2 process + Caddy block on the VPS
- 3.2 `.env.staging` provisioning
- 3.3 Client `EXPO_PUBLIC_API_URL` override for dev builds
- 3.4 Smoke-test a deploy

**Phase 4 — Automation safety net (~2 hours total)**
- 4.1 CI workflow on push (1 hour)
- 4.2 Pre-push hook (15 min)
- 4.3 Build-number bump script (30 min)

**Phase 5 — Auto-deploy (~half day)**
- 5.1 GitHub Action with SSH deploy
- 5.2 Secrets configured in repo settings
- 5.3 Test by pushing a no-op change to `staging`
- 5.4 Update `server/DEPLOY.md` to point at the action

**Total: ~2.5 days of focused work.** Each phase is independently usable. Phase 0 first — it's the workspace the rest of the phases feed into. Phase 1 alone returns most of the loop value.

---

## Out of scope

- **Detox / Maestro / XCUITest end-to-end tests.** Worth doing, but a multi-week effort and not what's currently bleeding. Defer past beta.
- **Reactotron / Flipper.** Useful for client debugging but not the core friction. Optional add-on.
- **Multi-environment secret management** (Doppler, 1Password CLI, etc.). The two-environment story (staging + prod) doesn't need it yet.
- **Code review / PR templates.** Solo dev; no review to template.
- **Linear / Notion / Jira integration.** Obsidian (see [The workspace](#the-workspace) above) replaces these for a solo dev — local-first, markdown-native, free aside from the optional sync subscription, and the vault is the existing `docs/` directory so specs and plans become first-class navigable notes. Revisit only if a collaborator joins and shared boards become necessary.
- **Replacing Hostinger as the host.** Separate decision. Discussed in the broader infra notes; not part of dev pipeline.

---

## Open questions

- **EAS build channel naming.** Resolved 2026-05-01: single `production` channel for now, with `--rollout-percentage` for risky pushes. Add a `staging` channel later when Phase 3's staging server lands so internal builds can target staging by default.
- **Staging cost.** Sharing prod LLM/TTS keys with staging means staging usage burns the same quota. Acceptable for low staging volume; consider a separate Gemini key if staging tests start dominating the 20 RPM cap.
- **Smoke-bake fixture freshness.** Canned Apple Music IDs in `tracks.json` will go stale (deletions, regional unavailability). Plan: refresh the fixture quarterly or whenever the smoke fails on data, not logic.
- **Obsidian sync choice.** Obsidian Sync ($8/mo) recommended for "easiest." iCloud Drive viable but flaky on iOS. Decide before the vault accumulates content — switching sync providers later is a manual rsync exercise.
- **Vault scope creep.** Obsidian's plugin ecosystem is enormous and most of it is a trap. Discipline: Daily Notes + Tasks only at first. Add Dataview / Kanban / Templater only when manual work justifies them, not preemptively.
- **WORKLOG ownership if a collaborator joins later.** Today: gitignored, personal. If a second dev joins, switch to a per-developer file or move to a shared format. Not a near-term concern.
- **Definition of Done strictness.** Treat the checklists as a default that can be skipped knowingly, or as a hard gate? Lean default — the point is to make skipping deliberate, not impossible.

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

## Tier 1 — Testing-loop fixes (highest leverage)

### 1. Expo OTA updates (highest absolute payoff)

Configure `expo-updates` against the TestFlight build channel so JS-only changes can ship in ~2 min instead of a 30–60 min EAS+TestFlight round-trip.

```bash
# After config:
eas update --branch production --message "fix: profile typo"
# ↑ Ships to every TestFlight build already installed on testers' devices.
```

**What can OTA-update:** screens, components, hooks, engines (`BroadcastPlayer`, `Scrobbler`, etc.), services, prompts, copy, design tokens, anything purely JS+TS.

**What still needs a rebuild:** Swift native module (`modules/expo-music-kit/ios/...`), `app.json` config, new dependencies, EAS build profile changes, asset catalog (icons), Live Activity widget.

**Setup:**

- Add `expo-updates` to `app.json` with `runtimeVersion` (already at `1.1.2` per app.json).
- Configure update channels: `production` for TestFlight + App Store, `preview` for internal builds.
- Add `npm run update:prod` and `npm run update:preview` scripts.

**Cost:** ~half day. **Payoff:** the 80% of polish/tweak work that's JS-only stops requiring a build cycle.

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

### 1. Obsidian as the workspace (vault, Daily Notes, NOW/NEXT/LATER, task aggregation)

Replaces what would otherwise be three separate text files (WORKLOG, NOW/NEXT/LATER, scattered notes) with a single local-first markdown workspace that already overlaps with this repo's existing `docs/` structure.

**Vault location: the repo's own `docs/` directory.**

```text
docs/                              ← Obsidian vault root
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

Specs and plans stay versioned in git. Daily notes, half-thoughts, and Obsidian config stay personal. The vault sees them all as one navigable graph.

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

Backlinks make this navigable: write `[[2026-05-01-sqlite-migration-design]]` in your daily note and click through to the spec. A week later when you're trying to remember why a thing happened, the daily note has the trail.

**Sync — pick one before the vault has anything in it:**

- **Obsidian Sync** ($8/mo, official, end-to-end encrypted, just works). Recommended. Treat as a dev-tool subscription.
- **iCloud Drive** (free, Apple-native, occasional file-lock conflicts on iOS). Acceptable.
- **Git** (free, requires Working Copy on iOS, manual). High friction, not recommended for daily notes.
- **Syncthing** (free, P2P, requires both devices online or a relay). Most setup, low overhead once running.

For "whatever is easiest," Obsidian Sync at $8/mo is the answer. Cheap, no maintenance, works between Mac dev box and the iPhone you're testing the app on.

**Cost:** ~30 min total — install Obsidian, point it at `docs/`, enable Daily Notes, install Tasks, write a starter `index.md`, configure sync. **Payoff:** WORKLOG happens automatically, every plan-doc checkbox shows up in one query, half-formed thoughts have somewhere to land on phone, specs/plans gain backlinks for free.

### 3. One-branch-at-a-time rule

Don't open a new feature branch while another is half-done. Either:

- Finish and merge, **or**
- Commit, push, document state in WORKLOG, then `git checkout main && git checkout -b new-thing`, **or**
- `git stash push -m "wip: sqlite phase 1, blocked on identity test"` with a meaningful message, document in WORKLOG.

This single rule eliminates the "pile of half-finished branches" problem at the cost of forcing a moment of state-capture.

### 4. Definition of Done by change type

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
- [ ] OTA-pushable (no native changes)
- [ ] Pushed via `eas update --branch preview` for self-test
- [ ] Promoted to `production` channel after confirmation

**Native iOS change:**
- [ ] Clean local rebuild (`expo run:ios --device`)
- [ ] Audio session behavior verified on physical device
- [ ] EAS production build succeeded
- [ ] TestFlight build installed and basic flow tested
- [ ] `CURRENT_PROJECT_VERSION` in pbxproj + `app.json` `ios.buildNumber` bumped in lockstep

### 5. Single-mode sessions when possible

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

Morning:

1. Open Obsidian. Today's daily note auto-creates: `docs/daily/2026-05-13.md`.
2. Glance at yesterday's daily for context (Obsidian's previous-day link or the file list).
3. Open `docs/index.md`. Pick from NOW. The Tasks plugin's aggregated view shows every open `- [ ]` across plans and notes if you want a wider read.

Three terminal tabs open:
1. `server` — `npm run dev` (hot-reload)
2. `tests` — `npm run test:watch` in `server/`
3. `metro` — only if doing client work

Make changes. Tests run automatically. Smoke-bake when touching the pipeline.

- JS-only client change → `eas update --branch preview` to see it on a device build (~2 min)
- Native client change → `expo run:ios --device` (5–10 min)
- Server change → push to `staging` → auto-deploys → curl-test → push to `main` → auto-deploys to prod

If a half-thought lands mid-session — a bug to investigate later, an idea for a feature, a tester comment to follow up on — drop it in `docs/ideas/` (gitignored, capture-only) instead of letting it derail the current task.

End of session — write the daily note's "Worked on" / "Tomorrow" / "Blocked" sections (~2 min). Move any completed `- [ ]` from `index.md`'s NOW into "Worked on." Promote one item from NEXT to NOW.

No more "did I run tests" / "did I deploy" / "what was I doing." Each loop is short enough that you stay in flow, and the workspace remembers context for you across sessions.

---

## Sequencing

Ordered by ratio of pain-relief to effort:

**Phase 1 — Tier 1 testing-loop fixes (~1.5 days total)**
- 1.1 Expo OTA wiring (half day) — biggest absolute win
- 1.2 Smoke-bake script (30 min) — fastest payoff
- 1.3 Jest watch in a tab (zero) — do today
- 1.4 Server hot-reload verification (zero–15 min)

**Phase 2 — Workflow hygiene (~1 hour total, daily compounding)**
- 2.1 Obsidian vault setup (~30 min): install Obsidian, point at `docs/`, enable Daily Notes, install Tasks plugin, configure sync (Obsidian Sync recommended), add `docs/.obsidian/` + `docs/daily/` + `docs/ideas/` to `.gitignore`, write a starter `docs/index.md` with NOW/NEXT/LATER seeded from current work
- 2.2 Definition-of-done checklists written down (~30 min) — either in `DOD.md` or as the body of `.github/PULL_REQUEST_TEMPLATE.md`
- 2.3 One-branch-at-a-time rule adopted (zero — it's a behavior change)

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

**Total: ~2.5 days of focused work.** Each phase is independently usable; no phase blocks the next. Phase 1 alone returns most of the value.

---

## Out of scope

- **Detox / Maestro / XCUITest end-to-end tests.** Worth doing, but a multi-week effort and not what's currently bleeding. Defer past beta.
- **Reactotron / Flipper.** Useful for client debugging but not the core friction. Optional add-on.
- **Multi-environment secret management** (Doppler, 1Password CLI, etc.). The two-environment story (staging + prod) doesn't need it yet.
- **Code review / PR templates.** Solo dev; no review to template.
- **Linear / Notion / Jira integration.** Obsidian (see Tier 2) replaces these for a solo dev — local-first, markdown-native, free aside from the optional sync subscription, and the vault is the existing `docs/` directory so specs and plans become first-class navigable notes. Revisit only if a collaborator joins and shared boards become necessary.
- **Replacing Hostinger as the host.** Separate decision. Discussed in the broader infra notes; not part of dev pipeline.
- **Sentry source-map upload.** Important for production crash debugging, but a separate work item; not part of the dev *loop*.

---

## Open questions

- **EAS build channel naming.** `production` for TestFlight + App Store, `preview` for internal? Or do you want a `staging` channel pointed at the staging server so internal device builds hit staging by default? Latter is cleaner; former is closer to standard.
- **Staging cost.** Sharing prod LLM/TTS keys with staging means staging usage burns the same quota. Acceptable for low staging volume; consider a separate Gemini key if staging tests start dominating the 20 RPM cap.
- **Smoke-bake fixture freshness.** Canned Apple Music IDs in `tracks.json` will go stale (deletions, regional unavailability). Plan: refresh the fixture quarterly or whenever the smoke fails on data, not logic.
- **Obsidian sync choice.** Obsidian Sync ($8/mo) recommended for "easiest." iCloud Drive viable but flaky on iOS. Decide before the vault accumulates content — switching sync providers later is a manual rsync exercise.
- **Vault scope creep.** Obsidian's plugin ecosystem is enormous and most of it is a trap. Discipline: Daily Notes + Tasks only at first. Add Dataview / Kanban / Templater only when manual work justifies them, not preemptively.
- **WORKLOG ownership if a collaborator joins later.** Today: gitignored, personal. If a second dev joins, switch to a per-developer file or move to a shared format. Not a near-term concern.
- **Definition of Done strictness.** Treat the checklists as a default that can be skipped knowingly, or as a hard gate? Lean default — the point is to make skipping deliberate, not impossible.

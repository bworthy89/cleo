# Auto-Deploy Design (Dev Pipeline Phase 5)

**Status:** Resolved 2026-05-01. Implementation tracked in [`docs/superpowers/plans/2026-05-01-auto-deploy-implementation.md`](../plans/2026-05-01-auto-deploy-implementation.md).
**Parent spec:** [`2026-05-01-dev-pipeline-design.md`](2026-05-01-dev-pipeline-design.md), Tier 3 #2 — this doc resolves the choices that section left implicit.

---

## Goal

Replace the manual SSH-and-pull (staging) and rsync-and-pm2-reload (prod) deploy rituals with a GitHub Actions workflow that fires on push to `staging` and `main` branches respectively. The workflow SSHes to the VPS as `cleo`, pulls the latest code, builds, reloads PM2, and verifies via a `/health` curl. Failure aborts loudly so we don't silently ship broken code.

End state: `git push origin staging` ships to staging in ~90s; `git push origin main` ships to prod in ~90s. Manual deploys remain available as an escape hatch but are no longer the primary path.

## Resolved choices

The parent spec (Tier 3 #2) sketched the workflow shape but left five sub-decisions implicit. Each is locked in below.

### 1. Scope — both tiers, not just staging

Auto-deploy both `staging` and `main` (= staging tier and prod tier). Staging-only would mean prod still needs `server/DEPLOY.md`'s 9-step rsync ritual every time, which keeps the deploy-friction-shapes-behavior anti-pattern alive for the half of changes that ship to prod.

### 2. Prod deploy method — migrate from rsync to git-pull (mirror staging)

Prod currently lives at `/home/cleo/cleo-broadcast/` with files rsync'd flat from local `./server/`. There's no `.git` directory. CI can't `git pull` against it without a layout migration.

Two paths considered:

- **(A) Migrate prod to git-pull (chosen).** One-time ~30s downtime. Clone repo to `/home/cleo/cleo-broadcast-new`, build it, copy over `.env` + `featured-broadcasts/registry.json` + enrichment cache, stop+swap+restart PM2. Both tiers then deploy identically.
- **(B) Keep prod's rsync, run rsync from CI runner.** No prod migration but asymmetry persists between tiers. Every future ops change has to be implemented twice (one for git-pull staging, one for rsync prod). Tax compounds.

Chose A for symmetry. ~30s of downtime is acceptable given today's tester-only beta state.

### 3. Branch model — `staging` branch is the staging tier's source, `main` is prod's

- Push to `staging` → staging tier deploys
- Merge `staging → main` → prod tier deploys

Workflow:
1. Make changes on a feature branch (or directly on `staging` for trivial work)
2. Merge into `staging` (= push to `staging`) → auto-deploys to staging
3. Smoke-test on staging via local-device install + bake (per `server/DEPLOY.md` Step 9 pattern)
4. If green: merge `staging → main` (= push to `main`) → auto-deploys to prod

The trunk-based alternative (every push to `main` deploys to staging; tag a release to deploy to prod) was considered but rejected — solo dev has no tag-discipline muscle memory and accidentally untagged work could ship to prod.

### 4. Health check — yes, fail the workflow on non-200

After `pm2 reload`, the workflow `curl`s `/health` (with a brief retry to give PM2 a beat to come back up) and exits non-zero on non-200. Cheap insurance — without it, a syntax error in committed code that crashes the server post-reload silently leaves the prior PM2 process replaced by a crash-looping new one. With it, the workflow goes red and pings GitHub's normal failure channels.

### 5. Concurrency — queue, not cancel

Deploys queue per-tier. If two pushes to `main` land back-to-back, they deploy sequentially. The alternative (cancel-in-progress) saves a few seconds but risks the second push missing a state change from the first. Queueing is the safer default.

### 6. `[skip deploy]` lever (commit message convention)

Commit messages containing `[skip deploy]` short-circuit the workflow. For docs-only commits, plan/spec edits, daily notes, etc — anything that doesn't change runtime behavior. Saves CI minutes and avoids needless PM2 reloads.

Not the same as GitHub's built-in `[skip ci]` — that skips ALL workflows including the test suite. We want tests to run for docs-only commits (catches typos in code blocks, etc), just not deploy.

## Topology (post-migration)

```
local Mac
  │
  ├── git push origin staging  ──┐
  │                              │
  │                          GitHub Actions
  │                              │
  │                              ├── deploy-staging job
  │                              │     SSH cleo@VPS
  │                              │     cd /home/cleo/cleo-broadcast-staging
  │                              │     git pull origin staging
  │                              │     cd server && npm ci && npm run build
  │                              │     pm2 reload cleo-broadcast-staging
  │                              │     curl localhost:3103/health
  │                              │
  │                              └── deploy-prod job   (only on push to main)
  │                                    SSH cleo@VPS
  │                                    cd /home/cleo/cleo-broadcast        (post-migration: full repo, server in /server)
  │                                    git pull origin main
  │                                    cd server && npm ci && npm run build
  │                                    pm2 reload cleo-broadcast
  │                                    curl localhost:3102/health
  │
  └── git push origin main     ──┘

VPS:
  /home/cleo/cleo-broadcast/             (post-migration: full repo clone)
    .git/
    server/                              (where PM2's cwd points)
      .env                               (preserved from pre-migration)
      dist/                              (built by deploy)
      .broadcast-cache/
      .enrichment-cache/
      featured-broadcasts/registry.json  (preserved)
  /home/cleo/cleo-broadcast-staging/     (already this layout)
    .git/
    server/
      .env, dist/, etc.
  /home/cleo/cleo-broadcast-old-2026-05-01/   (one-week rollback window)
```

## Risk surface

**Migration step (one-time).** Brief prod downtime (~30s) during PM2 stop/swap/restart. Mitigation: keep the old directory as `cleo-broadcast-old-2026-05-01` for ≥1 week so we can reverse-swap if something goes sideways.

**Auto-deploy in general.** Faster ship loop = faster bad-ship loop. Counterweights: (a) pre-push hook + CI catches obvious breakage before workflow runs, (b) staging tier deploys first (you smoke-test), (c) health check fails the workflow if PM2's reloaded process can't serve traffic.

**Workflow secret leakage.** GitHub stores `VPS_SSH_KEY` as a secret — encrypted at rest, only decrypted into the runner's env. Risk surface is malicious actions in the runner image or in third-party action dependencies. Mitigation: pin `appleboy/ssh-action` to a SHA, not a tag.

**Out of scope:**
- **Per-environment Sentry tags** (so staging events can be filtered out of prod dashboards) — can layer on later if Sentry signal/noise gets messy.
- **Slack/Discord notifications** on deploy success/failure — GitHub's email alerts are sufficient for solo dev. Add only if you join a team.
- **Database migrations.** No structured DB yet (post-SQLite-migration this becomes a real concern).
- **Canary / staged prod rollouts.** OTA already has `--rollout-percentage`; for native+server bundles, a canary tier is overkill at current scale.

## Cost summary

- One-time prod migration: ~30 min including verification + ~30s of prod downtime
- Ongoing: zero added cost (GitHub Actions free tier covers this volume; no new VPS resource use)

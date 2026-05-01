# Auto-Deploy Implementation Plan (Phase 5)

> **For agentic workers:** USER-side tasks (T3 GH secrets, T7+T8 push-to-test) need the user's hands. Mine: SSH key gen on VPS, prod migration, workflow file, docs.

**Goal:** Wire `git push` → auto-deploy for both staging and prod tiers per [`auto-deploy-design.md`](../specs/2026-05-01-auto-deploy-design.md).

---

## Ordering rationale

The prod migration (T4) and the workflow file (T6) can be done in either order — workflow can be written against the post-migration layout before migration runs (workflow won't actually fire until pushed, and prod won't auto-deploy until migration is done). I'll put migration first because it's higher-risk; if migration fails or surfaces unknowns, we re-plan before writing the workflow.

```
T1 design+plan
   │
T2 SSH keygen on VPS
   │
T3 user adds 3 GH secrets
   │
T4 prod migration  ──┐
                     ├── T6 workflow file  ──→  T7 test staging deploy  ──→  T8 test prod deploy  ──→  T9 docs
T5 staging branch  ──┘
```

T4 (migration) is the only risky step — has its own rollback story. T7 + T8 are the smoke gates that catch breakage before declaring Phase 5 done.

---

## Task 2: Generate dedicated GH Actions deploy SSH key (CLAUDE)

**Where:** SSH into VPS as cleo.

### Steps

- [ ] `ssh-keygen -t ed25519 -C "github-actions-deploy 2026-05-01" -f ~/.ssh/github_actions_deploy -N ""`
- [ ] `cat ~/.ssh/github_actions_deploy.pub >> ~/.ssh/authorized_keys` (so GH Actions can SSH IN as cleo)
- [ ] Print the PRIVATE key content for the user to paste into GH secret (next task). NEVER commit this.

### Done when

- Pubkey is in cleo's authorized_keys
- Private key content is shown to the user (one-shot — clear terminal scrollback after)

---

## Task 3: Add 3 GitHub Actions secrets (USER)

**Where:** https://github.com/bworthy89/cleo/settings/secrets/actions/new

### Steps

- [ ] Add `VPS_SSH_KEY` = paste the entire private key from T2 (including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`)
- [ ] Add `VPS_HOST` = `<VPS_HOST>`
- [ ] Add `VPS_USER` = `cleo`
- [ ] Verify all three appear under Repository secrets

### Done when

- `gh secret list` (locally, if `gh` CLI available) or the dashboard shows three project-scoped secrets

---

## Task 4: Migrate prod to git-pull layout (CLAUDE, ~30s downtime)

**Where:** SSH cleo@<VPS_HOST>.

### Pre-flight

- [ ] Confirm prod is healthy: `pm2 status cleo-broadcast` shows online + low restart count
- [ ] Confirm backup of `.env` exists (already does; multiple `.env.bak*` files in `/home/cleo/cleo-broadcast/`)
- [ ] Confirm SSH github auth still works on the VPS (we set this up earlier today): `ssh -T git@github.com` returns "successfully authenticated"

### Steps

- [ ] **Clone alongside (no downtime yet):**
  ```bash
  cd /home/cleo
  git clone git@github.com:bworthy89/cleo cleo-broadcast-new
  cd cleo-broadcast-new/server
  npm ci
  npm run build
  ```

- [ ] **Stage state files into the new dir (no downtime yet):**
  ```bash
  cp /home/cleo/cleo-broadcast/.env /home/cleo/cleo-broadcast-new/server/.env
  mkdir -p /home/cleo/cleo-broadcast-new/server/{logs,.broadcast-cache,.enrichment-cache,featured-broadcasts}
  cp /home/cleo/cleo-broadcast/featured-broadcasts/registry.json /home/cleo/cleo-broadcast-new/server/featured-broadcasts/ 2>/dev/null || echo "no registry.json yet — skipping"
  cp -r /home/cleo/cleo-broadcast/.enrichment-cache/* /home/cleo/cleo-broadcast-new/server/.enrichment-cache/ 2>/dev/null || true
  ```

- [ ] **Cutover (downtime starts):**
  ```bash
  pm2 stop cleo-broadcast
  pm2 delete cleo-broadcast
  mv /home/cleo/cleo-broadcast /home/cleo/cleo-broadcast-old-2026-05-01
  mv /home/cleo/cleo-broadcast-new /home/cleo/cleo-broadcast
  PORT=3102 pm2 start /home/cleo/cleo-broadcast/server/dist/index.js \
    --name cleo-broadcast \
    --cwd /home/cleo/cleo-broadcast/server
  pm2 save
  ```

- [ ] **Verify:**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3102/health   # → 200
  curl -s -o /dev/null -w "%{http_code}\n" https://api.worthymedia.tech/health   # → 200
  pm2 logs cleo-broadcast --lines 30 --nostream    # check for clean startup
  ```

- [ ] **Soak ~5 min**, then mark done. Old dir stays as `cleo-broadcast-old-2026-05-01` for ≥1 week.

### Rollback (if any verification fails)

```bash
pm2 stop cleo-broadcast
pm2 delete cleo-broadcast
mv /home/cleo/cleo-broadcast /home/cleo/cleo-broadcast-failed-2026-05-01
mv /home/cleo/cleo-broadcast-old-2026-05-01 /home/cleo/cleo-broadcast
PORT=3102 pm2 start /home/cleo/cleo-broadcast/dist/index.js \
  --name cleo-broadcast \
  --cwd /home/cleo/cleo-broadcast
pm2 save
```

(Note: the old dir's PM2 cwd was the directory itself, not `/server` — different from the new layout.)

---

## Task 5: Create staging branch on origin (CLAUDE)

```bash
git push origin main:staging
```

Creates `staging` branch from current `main` HEAD.

---

## Task 6: Write `.github/workflows/deploy.yml` (CLAUDE)

**Files:** `.github/workflows/deploy.yml` (new)

### Workflow shape

```yaml
name: deploy
on:
  push:
    branches: [staging, main]
concurrency:
  group: deploy-${{ github.ref_name }}
  cancel-in-progress: false  # queue, don't cancel

jobs:
  staging:
    if: github.ref_name == 'staging' && !contains(github.event.head_commit.message, '[skip deploy]')
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@<pin SHA>
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/cleo-broadcast-staging
            git pull origin staging
            cd server && npm ci && npm run build
            pm2 reload cleo-broadcast-staging
      - name: health check
        run: |
          for i in 1 2 3 4 5; do
            sleep 2
            code=$(curl -s -o /dev/null -w "%{http_code}" https://staging.api.worthymedia.tech/health)
            [ "$code" = "200" ] && echo "OK ($code)" && exit 0
            echo "attempt $i: got $code, retrying..."
          done
          echo "health check failed after 5 attempts"
          exit 1

  prod:
    if: github.ref_name == 'main' && !contains(github.event.head_commit.message, '[skip deploy]')
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@<pin SHA>
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/cleo-broadcast
            git pull origin main
            cd server && npm ci && npm run build
            pm2 reload cleo-broadcast
      - name: health check
        run: |
          for i in 1 2 3 4 5; do
            sleep 2
            code=$(curl -s -o /dev/null -w "%{http_code}" https://api.worthymedia.tech/health)
            [ "$code" = "200" ] && echo "OK ($code)" && exit 0
            echo "attempt $i: got $code, retrying..."
          done
          echo "health check failed after 5 attempts"
          exit 1
```

### Notes

- `appleboy/ssh-action` SHA pinning is for security (avoid trusting tags that can be moved). Look up the latest stable SHA at https://github.com/appleboy/ssh-action/releases.
- `concurrency.group` per branch means staging and prod deploys can overlap, but two staging pushes serialize.
- `[skip deploy]` is a literal substring check on the head commit message.
- Health check has 5 retries × 2s = up to 10s of grace for PM2 to come back up after `reload`.

### Done when

- File committed and pushed to `staging` branch (so the workflow file exists when staging tries to deploy).

---

## Task 7: Test staging auto-deploy end-to-end (USER + CLAUDE-observe)

### Steps

- [ ] User: make a trivial JS-only change on `staging` branch (e.g. tweak a comment in `server/src/index.ts`)
- [ ] User: `git push origin staging`
- [ ] Watch GH Actions: https://github.com/bworthy89/cleo/actions — should see "deploy" workflow's "staging" job kick off
- [ ] Job should complete green: SSH succeeds, git pull pulls the new commit, build succeeds, pm2 reload succeeds, health check returns 200
- [ ] On VPS: `pm2 logs cleo-broadcast-staging --lines 30 --nostream` should show the reload and the new code's startup banner
- [ ] CLAUDE: tail staging logs during the deploy to narrate what happens

### Done when

- Workflow run is green
- New commit's behavior is observable on staging (e.g. comment change visible via git pull on VPS)

---

## Task 8: Test prod auto-deploy end-to-end (USER + CLAUDE-observe)

### Steps

- [ ] User: `git checkout main && git merge staging --ff-only && git push origin main`
- [ ] Watch GH Actions for "deploy" workflow's "prod" job
- [ ] Same verification pattern as T7 but for `cleo-broadcast` PM2 + `api.worthymedia.tech`
- [ ] User: open ONAY on phone (TestFlight build), bake a 5-track quick → confirm cold open + tracks play. Sanity check that the prod tier's broadcast pipeline still works post-migration.

### Done when

- Workflow run is green
- A bake from TestFlight works against prod

---

## Task 9: Update CLAUDE.md / DOD.md / server/DEPLOY.md (CLAUDE)

After T8 verifies. Docs should describe verified reality.

### CLAUDE.md

- Backend section: prod tier description updates to mention git-pull layout (was rsync); path stays `/home/cleo/cleo-broadcast/` but now has `.git` subdir + `server/` subdir
- Build Environment: add a "Deploys" sub-section pointing at the auto-deploy workflow + the `[skip deploy]` lever
- Known Issues: drop any "use rsync to deploy prod" wisdom; replace with "git push triggers deploy"

### DOD.md

- Server-change checklist: simplify to "merge to staging branch → wait for green CI + green deploy → smoke staging → merge staging → main → wait for green deploy → 5 min log soak"
- Drop the manual SSH steps

### server/DEPLOY.md

- Add a top-of-doc note: "Auto-deploy is primary. This doc is the manual fallback / disaster-recovery procedure."
- Keep the rsync section as-is (legacy / escape hatch).
- Add a "Manual deploy via auto-deploy escape hatch" section: how to trigger the workflow manually via `gh workflow run deploy.yml --ref staging` (or main) when needed.

### docs/index.md

- Move "Dev pipeline Phase 5 — auto-deploy" out of LATER (it's done!).
- Promote whatever's next in NEXT (Sentry source-map fix is the highest leverage).

---

## End-to-end verification

Phase 5 is done when all of these are true:

- [ ] Push to `staging` deploys to staging tier within ~90s, returns 200 health, broadcast pipeline still works
- [ ] Push to `main` deploys to prod tier within ~90s, returns 200 health, broadcast pipeline still works (TestFlight bake confirms)
- [ ] `[skip deploy]` in a commit message correctly short-circuits the deploy job
- [ ] CLAUDE.md, DOD, server/DEPLOY.md reflect the verified procedure

## Out of scope

Per the design doc: per-environment Sentry tagging, Slack/Discord notifications, database migrations, canary / staged prod rollouts.

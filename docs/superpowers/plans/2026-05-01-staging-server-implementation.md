# Staging Server Implementation Plan

> **For agentic workers:** Most tasks here are USER-side (DNS, R2, VPS shell, Caddy). Claude tasks are constrained to docs at the end. Don't try to automate the VPS work — Hostinger console + DNS panel + ssh-in are interactive.

**Goal:** Stand up a second tier of `cleo-broadcast` on the same VPS, addressable at `staging.api.worthymedia.tech`, suitable for both pre-prod validation and always-on mobile dev backend.

**Spec:** [`docs/superpowers/specs/2026-05-01-staging-server-design.md`](../specs/2026-05-01-staging-server-design.md).

---

## Ordering rationale

DNS propagation can take a few hours (occasionally up to 24); kick that off first so it's ready by the time everything else lands. R2 bucket creation is independent and can happen at any time. VPS work (clone → env → PM2) blocks Caddy (Caddy needs the upstream listening). Caddy blocks smoke test (smoke needs HTTPS). Docs go last so they describe verified reality.

```
T3 (R2 bucket)  ──┐
T4 (DNS)        ──┤
                  ├── T5 (VPS clone + .env)  →  T6 (PM2 start)  →  T7 (Caddy block)  →  T8 (smoke test)  →  T9 (docs)
                  ┘
```

---

## Task 3: Create R2 bucket `cleo-broadcast-segments-staging` (USER, ~5 min)

**Where:** Cloudflare dashboard → R2 → "Create bucket"

### Steps

- [ ] Bucket name: `cleo-broadcast-segments-staging`
- [ ] Location hint: same as prod bucket (probably WNAM / Eastern North America)
- [ ] No additional access keys needed — staging uses the same `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` as prod (just different `R2_BUCKET` value at runtime).
- [ ] Note the bucket name for use in T5's `server/.env`.

### Done when

- Bucket appears in Cloudflare R2 listing.
- (No need to test access yet — happens implicitly during T8 smoke test.)

---

## Task 4: Add DNS A record for `staging.api.worthymedia.tech` (USER, ~5 min + propagation)

**Where:** Hostinger DNS panel for `worthymedia.tech` (whichever registrar manages it — Hostinger if domain was bought there).

### Steps

- [ ] Find the existing A record for `api` (it points at the VPS IP).
- [ ] Add a new A record: name=`staging.api`, value=same VPS IP, TTL default.
- [ ] Save.

### Done when

- `dig staging.api.worthymedia.tech` resolves to the VPS IP. Could take minutes to hours for propagation; check with `dig +short staging.api.worthymedia.tech` periodically.

---

## Task 5: VPS clone + `server/.env` for staging tier (USER, ~20 min, blocked by T3)

**Where:** SSH into the VPS as `cleo@<VPS_HOST>`.

### Steps

- [ ] `cd /home/cleo`
- [ ] `git clone https://github.com/bworthy89/cleo cleo-broadcast-staging`
- [ ] `cd cleo-broadcast-staging`
- [ ] `git checkout -b staging` (or `git checkout staging` if it exists). The `staging` branch starts from current `main` HEAD.
- [ ] `git push -u origin staging` (so the branch exists remotely for future deploys).
- [ ] `cd server && npm ci && npm run build`
- [ ] Copy prod's `server/.env` as a starting point: `cp /home/cleo/cleo-broadcast/server/.env /home/cleo/cleo-broadcast-staging/server/.env`
- [ ] Edit `/home/cleo/cleo-broadcast-staging/server/.env` and change ONLY these lines:
  - `R2_BUCKET=cleo-broadcast-segments-staging` (the bucket from T3)
  - `CURATOR_PUBLISH_CAP=20` (was `3`)
  - `BROADCAST_ASSET_BASE_URL=https://staging.api.worthymedia.tech` (was the prod hostname)
  - Everything else (`GEMINI_API_KEY`, `CARTESIA_*`, `LASTFM_*`, `GENIUS_*`, `OPENWEATHER_API_KEY`, `VOXCPM_*`, `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`) stays identical to prod's.

### Done when

- `cd server && node -e 'require("dotenv").config(); console.log(process.env.R2_BUCKET)'` prints `cleo-broadcast-segments-staging`.
- `dist/index.js` exists (build succeeded).

---

## Task 6: PM2 start `cleo-broadcast-staging` on port 3103 (USER, ~5 min, blocked by T5)

**Where:** Still on the VPS, in `/home/cleo/cleo-broadcast-staging`.

### Steps

- [ ] `PORT=3103 pm2 start dist/index.js --name cleo-broadcast-staging --cwd /home/cleo/cleo-broadcast-staging`
- [ ] `pm2 save` (so it survives reboots).
- [ ] Verify: `curl -i http://localhost:3103/health` should return `200 OK` (or whatever the existing health endpoint returns).
- [ ] `pm2 logs cleo-broadcast-staging --lines 30` to confirm clean startup, no missing-env-var errors.

### Done when

- `pm2 list` shows `cleo-broadcast-staging` `online`.
- `curl localhost:3103/health` succeeds.

---

## Task 7: Add Caddy block for `staging.api.worthymedia.tech` (USER, ~10 min, blocked by T4 + T6)

**Where:** Edit `/etc/caddy/Caddyfile` on the VPS as root (or via sudo).

### Steps

- [ ] Find the existing block for `api.worthymedia.tech`.
- [ ] Add a parallel block for staging:
  ```caddy
  staging.api.worthymedia.tech {
      reverse_proxy localhost:3103
  }
  ```
  Mirror any other directives from the prod block (logging, headers) if they apply.
- [ ] `sudo systemctl reload caddy`
- [ ] Watch logs for TLS provisioning: `sudo journalctl -u caddy -f` until "certificate obtained successfully" appears (Caddy auto-requests Let's Encrypt cert on first request).

### Done when

- `curl -i https://staging.api.worthymedia.tech/health` returns `200 OK` (over HTTPS, valid cert).
- `curl https://staging.api.worthymedia.tech/health -v 2>&1 | grep "issuer:"` shows Let's Encrypt.

---

## Task 8: Smoke test staging end-to-end (USER, ~15 min, blocked by T7)

**Where:** Local Mac.

### Steps

- [ ] Build a local-device install pointed at staging:
  ```bash
  EXPO_PUBLIC_API_URL=https://staging.api.worthymedia.tech \
    SENTRY_DISABLE_AUTO_UPLOAD=true \
    npx expo run:ios --device
  ```
- [ ] App installs on phone; open it.
- [ ] Run a small broadcast bake (5-track quick).
- [ ] Verify the cold-open audio plays. The segment URL in DevTools Network (or check the manifest response) should be from the staging R2 bucket — look for `cleo-broadcast-segments-staging` in the URL.
- [ ] Check VPS: `ssh cleo@<VPS_HOST> 'pm2 logs cleo-broadcast-staging --lines 50'` should show the bake's log lines (`[bake id=... user=...] start vibe=... length=quick`).

### Done when

- A bake initiated from the local-device install completes successfully and audio plays.
- VPS staging logs reflect the bake.
- Cloudflare R2 dashboard shows objects in `cleo-broadcast-segments-staging`.

---

## Task 9: Update CLAUDE.md + DOD.md + server/DEPLOY.md with staging procedures (CLAUDE, ~30 min, blocked by T8)

Only after T8 verifies the tier actually works — docs should describe verified reality, not aspiration.

### Files

- `CLAUDE.md`:
  - "Backend" section under Tech Stack: add a third bullet for staging (port 3103, hostname, branch).
  - "Build Environment": add a "Mobile testing against staging" bullet with the `EXPO_PUBLIC_API_URL` build-time override.
- `DOD.md`:
  - Server logic change checklist: replace "Deployed to prod manually per server/DEPLOY.md" with "Deployed to staging first (push to `staging` branch, ssh + git pull + npm ci + npm run build + pm2 reload cleo-broadcast-staging), smoke-tested via local-device install or curl, then merged to `main` and deployed to prod the same way."
- `server/DEPLOY.md`:
  - Add a "Staging deploy" section mirroring the prod steps but pointing at `cleo-broadcast-staging` PM2 app and `cleo-broadcast-staging/` directory.

---

## End-to-end verification

Phase 3 is done when all of these are true:

- [ ] `https://staging.api.worthymedia.tech/health` returns 200 from anywhere on the internet.
- [ ] A bake initiated from a local-device install pointed at staging completes and plays audio sourced from the staging R2 bucket.
- [ ] Pushing a server change to the `staging` branch + manual deploy on the VPS makes the change live on staging without affecting prod.
- [ ] CLAUDE.md, DOD.md, and server/DEPLOY.md reflect the verified procedure.

## Out of scope

- **Auto-deploy on push** — Phase 5 future work.
- **Separate Firebase project for staging** — see design doc revisit-trigger (external testers).
- **Separate Gemini API key** — see design doc revisit-trigger (quota contention).
- **Separate Sentry environment tag** — sample is too low to justify; revisit if signal/noise gets messy.

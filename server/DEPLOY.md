# Production Deploy Runbook — cleo-broadcast

Target VPS: `cleo@187.124.69.95` (Hostinger, ID 1434111)
Path (post-2026-05-01 migration): `/home/cleo/cleo-broadcast/` is now a full
git clone with the server in `/server/` subdir. Old rsync-flat layout moved to
`cleo-broadcast-old-2026-05-01` for ~1 week rollback window.
Port: `3102` (behind Caddy at `api.worthymedia.tech`)

> **🤖 Auto-deploy is the primary path now** (Phase 5, 2026-05-01). `git push origin main` triggers `.github/workflows/deploy.yml` which SSHes in, pulls, builds, reloads PM2, and health-checks — done in ~30s. The rsync runbook below is the **manual escape hatch** for: bootstrapping on a new VPS, recovering from a broken auto-deploy, or one-off ops where you can't / don't want to push to GitHub.
>
> **Standard workflow:** `git push origin staging` → auto-deploy to staging tier → smoke-test → merge `staging → main` → `git push origin main` → auto-deploy to prod. See [`docs/superpowers/specs/2026-05-01-auto-deploy-design.md`](../docs/superpowers/specs/2026-05-01-auto-deploy-design.md).
>
> **Manual auto-deploy trigger:** `gh workflow run deploy.yml --ref main` (or `--ref staging`). Useful for re-deploying without a code change.
>
> **Skip lever:** include `[skip deploy]` in the commit message to bypass the workflow. For docs-only commits.

---

## Manual deploy (legacy / escape hatch)

The rsync-based ritual below was the primary procedure pre-2026-05-01. It still works (and the prod dir's `.git` directory means `git pull` is also available for ad-hoc pulls without the workflow). Use this when auto-deploy is broken or unavailable.

## Pre-flight (local, already done)

- [x] `npm run build` succeeds
- [x] `npm test` passes (132/132)
- [x] `ecosystem.config.cjs` present
- [x] Graceful shutdown on SIGTERM/SIGINT
- [x] R2 smoke test passes locally

## Step 1 — Create VPS directory + logs dir

```bash
ssh cleo@187.124.69.95 'mkdir -p ~/cleo-broadcast/logs ~/cleo-broadcast/.broadcast-cache ~/cleo-broadcast/.enrichment-cache ~/cleo-broadcast/featured-broadcasts'
```

## Step 2 — Rsync server code up

From the project root (`/Users/kari/Documents/cleo-app`):

```bash
rsync -avz \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.broadcast-cache' \
  --exclude='.enrichment-cache' \
  --exclude='.tts-cache' \
  --exclude='__tests__' \
  --exclude='coverage' \
  --exclude='featured-broadcasts/registry.json' \
  --exclude='logs' \
  ./server/ cleo@187.124.69.95:~/cleo-broadcast/
```

## Step 3 — Install + build on VPS

```bash
ssh cleo@187.124.69.95 'cd ~/cleo-broadcast && npm ci && npm run build'
```

## Step 4 — Create `.env` on VPS

**This step has secrets — do it yourself, don't paste creds in chat.**

SSH in and create `/home/cleo/cleo-broadcast/.env` with:

```
# LLM
GEMINI_API_KEY=<from cleo-api/.env>
OLLAMA_BASE_URL=<from cleo-api/.env>
OLLAMA_MODEL=<from cleo-api/.env>

# TTS — Cartesia primary, ElevenLabs fallback, Orpheus tertiary
CARTESIA_API_KEY=
CARTESIA_VOICE_ID=
CARTESIA_MODEL_ID=sonic-3
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_PRONUNCIATION_DICT_ID=
ELEVENLABS_PRONUNCIATION_DICT_VERSION=
ORPHEUS_BASE_URL=<from cleo-api/.env>
ORPHEUS_VOICE=tara
ORPHEUS_MAX_TOKENS=2048

# Enrichment
GENIUS_ACCESS_TOKEN=<from cleo-api/.env>

# Health checks
HEALTH_CHECK_INTERVAL_MS=30000
HEALTH_CHECK_TIMEOUT_MS=2000

# Storage — R2
STORAGE_BACKEND=r2
R2_ACCOUNT_ID=6c382be67dc62e7180d75b55c776e5fb
R2_ACCESS_KEY_ID=<NEW rotated token>
R2_SECRET_ACCESS_KEY=<NEW rotated token>
R2_BUCKET=cleo-broadcast-segments
R2_PUBLIC_BASE_URL=

# Curator allowlist
CURATOR_EMAILS=bworthy89@gmail.com
CURATOR_PUBLISH_CAP=3
CURATOR_PUBLISH_WINDOW_MS=86400000

# Sentry observability (Phase 1 telemetry foundation)
SENTRY_DSN=<from sentry.io project settings>
SENTRY_TRACES_SAMPLE_RATE=0.2
SENTRY_RELEASE=<optional; set to ios buildNumber for release tracking>
```

**Recommendation:** create a SECOND R2 API token scoped only to this bucket and use those creds on the VPS. Keep the first token for local dev. If either leaks, the other still works.

Lock the file:

```bash
ssh cleo@187.124.69.95 'chmod 600 ~/cleo-broadcast/.env'
```

## Step 5 — Start via PM2

```bash
ssh cleo@187.124.69.95 'cd ~/cleo-broadcast && pm2 start ecosystem.config.cjs && pm2 save'
```

Then check logs for ~30 seconds:

```bash
ssh cleo@187.124.69.95 'pm2 logs cleo-broadcast --lines 50 --nostream'
```

Expected: `Cleo server running on 0.0.0.0:3102`. If it crashes, fix before proceeding.

## Step 6 — Local VPS smoke test

```bash
ssh cleo@187.124.69.95 'curl -s http://localhost:3102/health'
```

Expected: `{"status":"ok"}`

## Step 7 — Caddy routing cutover

Current Caddy routes `api.worthymedia.tech` → `localhost:3100` (Fastify). Change to `:3102`.

```bash
ssh cleo@187.124.69.95 'sudo cat /etc/caddy/Caddyfile'
```

Find the `api.worthymedia.tech` block, change `reverse_proxy localhost:3100` → `reverse_proxy localhost:3102`.

Apply:

```bash
ssh cleo@187.124.69.95 'sudo systemctl reload caddy'
```

## Step 8 — Public smoke test

From your local machine:

```bash
curl -s https://api.worthymedia.tech/health
# → {"status":"ok"}

curl -sS https://api.worthymedia.tech/broadcast/featured -o /dev/null -w "%{http_code}\n"
# → 401  (proves auth is working — we're unauthenticated)
```

## Step 9 — TestFlight smoke test

1. Confirm project-root `.env` has `EXPO_PUBLIC_API_URL=https://api.worthymedia.tech`
2. Build: `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`
3. Log in, pick a playlist, start a broadcast
4. Watch VPS logs in another terminal: `ssh cleo@187.124.69.95 'pm2 logs cleo-broadcast'`
5. Expected: `[REQ] POST /broadcast/create` → orchestrator logs → audio bytes uploaded to R2

## Rollback

If any step breaks production:

```bash
# Revert Caddy to old Fastify
ssh cleo@187.124.69.95 "sudo sed -i 's/localhost:3102/localhost:3100/' /etc/caddy/Caddyfile && sudo systemctl reload caddy"
```

Old Fastify keeps running on 3100 the entire time — no downtime risk.

## Cleanup (later, after 1-week soak)

Once the new server is proven:

```bash
ssh cleo@187.124.69.95 'pm2 stop cleo-api && pm2 delete cleo-api && pm2 save'
# Leave /home/cleo/cleo-api/ on disk for another month as a safety net
```

## Observability — Sentry Alerts

Telemetry events emitted by `BakeTelemetry` (see
`server/src/services/telemetry/BakeTelemetry.ts`):

- `tts.provider-fallback` (event, level=warning, tags `from`/`to`, extra `reason`) — emitted when TTS chain falls through, e.g., VoxCPM → Cartesia → ElevenLabs.
- `enrichment.api-timing` (event, level=info, tags `api`, extra `durationMs`) — per-API timing for Genius, MusicBrainz, Wikipedia, Last.fm calls inside `BackgroundEnricher.drainNow`.
- `sequencer.result` (event, level=info, tags `vibe`, extra `meanDistance` + `featureSourceCounts` + `n` + `poolSize`) — emitted once per bake from `DeterministicTrackSequencer.logResult`.
- Bake span (`broadcast.bake` op, attributes `bake.broadcast_id`, `bake.vibe`, `bake.length`, `bake.time_to_slot_zero_ms`, `bake.time_to_completion_ms`, `bake.status`) — emitted from `BroadcastOrchestrator.create` for every bake; closed on success, failure, or early-exit.

Note: `enrichment.api-timing` does NOT cover ReccoBeats / Deezer — those run inside `FeatureFetchChain.fetchBatch` (a separate concern; future task).

### Required dashboard alerts

The three alerts below are codified as alerts-as-config in `server/scripts/sentry-setup-alerts.sh`. Run the script once per Sentry project to create or update them all.

```bash
export SENTRY_AUTH_TOKEN=<token from sentry.io/settings/account/api/auth-tokens/, scope: project:write + alerts:write>
export SENTRY_ORG=<org slug>
export SENTRY_PROJECT=onay-media-server
./server/scripts/sentry-setup-alerts.sh
```

The script is idempotent — re-running updates existing alerts by name rather than creating duplicates. User ID for email notifications is auto-resolved via `/users/me`.

**Alert 1 — Cartesia fallback rate elevated**
- Trigger: ≥5 `tts.provider-fallback` events with `tags.to=cartesia` in a rolling 1-hour window.
- Severity: warning.
- Action: email the user.
- Reasoning: Cartesia is the paid fallback. Frequent hits = LAN box (VoxCPM on 192.168.8.229) health degraded; investigate before subscriber experience degrades.
- Tuning: 5 events/hour is a heuristic; raise once steady-state bake volume is known and 5% of bakes can be expressed in absolute counts.

**Alert 2 — Phase 1 GATE: Sequencer meanDistance ≥ 0.5**
- Trigger: ≥10 `sequencer.result` events with `tags.poor_fit=true` in a rolling 24-hour window.
- Severity: error.
- Action: email the user.
- Reasoning: Phase 1 decision gate (issue #20 — `meanDistance < 0.5` across all 7 vibes after ReccoBeats integration). Trips → re-brainstorm sequencer redesign before starting Phase 2.
- Tag-not-extra: Sentry Issue Alerts can't filter on values in `extra.*`, so `BakeTelemetry.recordSequencerResult` writes a binary `poor_fit:true|false` tag at the 0.5 threshold. The exact `meanDistance` value remains in `extra` for dashboards.

**Alert 3 — Bake p95 duration > 20s** (Metric Alert)
- Trigger: p95 of `transaction.duration` on `transaction.op:broadcast.bake` exceeds 20000 ms over the last 1-hour window.
- Severity: warning.
- Action: email the user.
- Reasoning: Phase 1 success criterion is p95 time-to-slot-zero < 15s. 20s threshold gives headroom but flags trend.
- **Plan gating:** Sentry's free Developer plan does NOT include Metric Alerts; they require Team plan or higher. The setup script auto-skips this alert on 404 from the metric-alerts API and logs `[metric] skip — endpoint 404 (metric alerts not available on this plan/token)`. Re-run the script after a plan upgrade and it'll create the alert idempotently.
- **Caveat:** uses overall `transaction.duration` as a proxy — Sentry Metric Alerts can't currently target arbitrary span attributes like `bake.time_to_slot_zero_ms`. Long-bake vibes will skew the p95 upward. Track the proper fix (custom Sentry metric or span-based alert) in issue #23.

### Setup checklist after first deploy

- [ ] `SENTRY_DSN` set on the production VPS env (not committed to repo).
- [ ] `SENTRY_TRACES_SAMPLE_RATE` set (recommended: `0.2` initially; tighten down once event volume is calibrated).
- [ ] `./server/scripts/sentry-setup-alerts.sh` run successfully (creates the 3 alerts above).
- [ ] Verified: trigger a bake from a prod TestFlight build; confirm the bake transaction appears in Sentry's Performance tab and `tts.provider-fallback` events appear in Issues when fallback is forced.


---

## Staging deploy

Sister tier on the same VPS. Use this for "I built a server change locally, want to validate against real R2/Gemini/VoxCPM before merging to main."

**Topology:**
- Path: `/home/cleo/cleo-broadcast-staging/` (full git clone of `bworthy89/cleo`; server lives at `server/` subdir)
- Port: `3103`
- PM2 app: `cleo-broadcast-staging` (fork mode)
- Hostname: `staging.api.worthymedia.tech` (Caddy reverse-proxy)
- R2 bucket: `cleo-broadcast-segments-staging` (separate from prod)
- `.env`: `/home/cleo/cleo-broadcast-staging/server/.env` (copied from prod with three diffs — `R2_BUCKET`, `CURATOR_PUBLISH_CAP`, `BROADCAST_ASSET_BASE_URL`)

**Deploy a server change to staging:**

```bash
# from local: push to main (or whatever branch staging tracks)
git push origin main

# on VPS:
ssh cleo@187.124.69.95
cd /home/cleo/cleo-broadcast-staging
git pull
cd server && npm ci && npm run build
pm2 reload cleo-broadcast-staging
```

(Diverges from prod which uses rsync — see Steps 2–3 above. Phase 5 of the dev pipeline will harmonize both tiers via auto-deploy.)

**Smoke after staging deploy:**

```bash
# health
curl https://staging.api.worthymedia.tech/health

# logs
ssh cleo@187.124.69.95 "pm2 logs cleo-broadcast-staging --lines 50 --nostream"

# end-to-end: install local-device build pointed at staging
# (from project root)
echo "EXPO_PUBLIC_API_URL=https://staging.api.worthymedia.tech" > .env.local
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device
# bake from the app, watch logs
# delete .env.local when done to revert .env (prod URL)
```

**Gotchas (learned 2026-05-01 during initial staging stand-up):**
- R2 API tokens are bucket-scoped by default. If the prod token only has access to `cleo-broadcast-segments`, segment uploads to staging silently fail with 403 → bakes 500 + background slots never run. Fix: widen the token to all buckets in the Cloudflare R2 dashboard (Manage R2 API Tokens → Edit → bucket scope).
- Expo SDK 55 reads `EXPO_PUBLIC_*` ONLY from `.env`/`.env.local`, not from shell env vars. Use `.env.local` for the staging URL override; do NOT pass it inline on the command line.
- VPS git clone needs a deploy key — `~/.ssh/github_deploy` (ed25519) was generated on 2026-05-01; pubkey added to repo Settings → Deploy keys (read-only). `~/.ssh/config` configures `github.com → IdentityFile ~/.ssh/github_deploy`.


---

## SQLite migration runbook (2026-05-XX deploy)

The broadcast server now keeps all four state stores plus retention events
in one SQLite file at `.broadcast-cache/cleo.db`. WAL mode, single-process,
synchronous via `better-sqlite3`. See
`docs/superpowers/specs/2026-05-01-sqlite-migration-design.md` for the
full design.

### Pre-deploy toolchain checks

`better-sqlite3@^12` is a native addon. Before merging this branch, verify:

1. **Node version on the VPS is 20+** (better-sqlite3 v12 engines field requires it):

   ```bash
   ssh cleo@187.124.69.95 'node --version'
   ```

   If the VPS reports Node 18 or 19, install Node 20+ (e.g., `nvm install 20 && nvm alias default 20`) before deploying.

2. **Build toolchain present** for the native compile fallback. `prebuild-install` will try to download a prebuilt binary first; on miss, it falls back to `node-gyp rebuild` which needs `gcc`/`g++`/`make`/`python3`:

   ```bash
   ssh cleo@187.124.69.95 'gcc --version && python3 --version && make --version | head -1'
   ```

   If any are missing, install build-essential (`sudo apt install -y build-essential python3`).

   Symptom of a missing toolchain: `npm ci` in `deploy.yml` fails with `gyp ERR! ...` or `cannot find python3`. Task 1 itself doesn't surface this because nothing imports `better-sqlite3` until Task 3+ runtime.

3. **Backup cron uses `DB_PATH` and `BACKUP_DIR` env vars per environment;** defaults in the spec doc (`docs/superpowers/specs/2026-05-01-sqlite-migration-design.md`, Phase 4.5 section). Phase 4.5 will operationalize this.

### One-time backfill (run once on the VPS during the migration deploy)

```bash
ssh cleo@187.124.69.95
cd /home/cleo/cleo-broadcast/server
git pull origin main
npm ci && npm run build
pm2 stop cleo-broadcast
npm run backfill-sqlite
# Output should report "[backfill] enrichment: <N> rows inserted" and
# "[backfill] featured: <M> rows inserted". M should equal the number of
# records[] entries in featured-broadcasts/registry.json (small set,
# verify by hand). N should equal the number of keys in
# .enrichment-cache/tracks.json.tracks.
mv .enrichment-cache/tracks.json .enrichment-cache/tracks.json.bak
mv featured-broadcasts/registry.json featured-broadcasts/registry.json.bak
pm2 start cleo-broadcast
pm2 logs cleo-broadcast --lines 50  # look for "[boot] sqlite db opened at ..."
curl -s https://api.worthymedia.tech/health  # expect {"status":"ok"}
```

### `.bak` retention and verification

Keep the `.bak` files for at least 7 days, or one full release cycle —
whichever is longer. Before deletion, run all five checks listed in the
design doc's "**.bak retention and verification gating**" section:

1. Re-run `npm run backfill-sqlite`; expect zero new rows on the second run.
2. Spot-check 5 random `enrichment` rows against `tracks.json.bak`.
3. Spot-check every `featured_broadcasts` row against `registry.json.bak`.
4. Run a real bake end-to-end against the SQLite store; confirm completion.
5. Trigger a curator publish; confirm a row lands in `curator_publishes`.

After all five pass, delete in a single commit titled
"remove sqlite-migration .bak fallbacks."

### Revert path

If any step fails, restore by renaming `.bak` back, then revert the deploy
that swapped the stores. The SQLite tables can be left in place — the old
JSON-backed code ignores them.

### Known follow-ups

- **Phase 4.5 — automated backups to R2** (`cleo-broadcast-backups` bucket,
  separate token, hourly local + nightly off-box, lifecycle-rule retention).
  Required before deleting the `.bak` fallbacks. See "Phase 4.5" in
  `docs/superpowers/specs/2026-05-01-sqlite-migration-design.md`; a separate
  implementation plan will follow.
- **Phase 5 — admin endpoints** (`/admin/bakes`, `/admin/bakes/:id`,
  `/admin/users/:uid/activity`, `/admin/retention`,
  `/admin/curators/:uid/publishes`, `/admin/featured`,
  `/admin/tts/failures`). Purely additive — ship anytime after Phase 4.
  See "Admin surface" in the spec; a separate implementation plan will follow.

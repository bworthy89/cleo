# Production Deploy Runbook — cleo-broadcast

Target VPS: `cleo@<VPS_HOST>` (Hostinger, ID <HOSTINGER_ID>)
Sidecar directory: `/home/cleo/cleo-broadcast/` (keeps existing `/home/cleo/cleo-api/` untouched for rollback)
Port: `3102` (behind Caddy at `api.worthymedia.tech`)

## Pre-flight (local, already done)

- [x] `npm run build` succeeds
- [x] `npm test` passes (132/132)
- [x] `ecosystem.config.cjs` present
- [x] Graceful shutdown on SIGTERM/SIGINT
- [x] R2 smoke test passes locally

## Step 1 — Create VPS directory + logs dir

```bash
ssh cleo@<VPS_HOST> 'mkdir -p ~/cleo-broadcast/logs ~/cleo-broadcast/.broadcast-cache ~/cleo-broadcast/.enrichment-cache ~/cleo-broadcast/featured-broadcasts'
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
  ./server/ cleo@<VPS_HOST>:~/cleo-broadcast/
```

## Step 3 — Install + build on VPS

```bash
ssh cleo@<VPS_HOST> 'cd ~/cleo-broadcast && npm ci && npm run build'
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
R2_ACCOUNT_ID=REDACTED-R2-ACCOUNT-ID
R2_ACCESS_KEY_ID=<NEW rotated token>
R2_SECRET_ACCESS_KEY=<NEW rotated token>
R2_BUCKET=cleo-broadcast-segments
R2_PUBLIC_BASE_URL=

# Curator allowlist
CURATOR_EMAILS=bworthy89@gmail.com

# Sentry observability (Phase 1 telemetry foundation)
SENTRY_DSN=<from sentry.io project settings>
SENTRY_TRACES_SAMPLE_RATE=0.2
SENTRY_RELEASE=<optional; set to ios buildNumber for release tracking>
```

**Recommendation:** create a SECOND R2 API token scoped only to this bucket and use those creds on the VPS. Keep the first token for local dev. If either leaks, the other still works.

Lock the file:

```bash
ssh cleo@<VPS_HOST> 'chmod 600 ~/cleo-broadcast/.env'
```

## Step 5 — Start via PM2

```bash
ssh cleo@<VPS_HOST> 'cd ~/cleo-broadcast && pm2 start ecosystem.config.cjs && pm2 save'
```

Then check logs for ~30 seconds:

```bash
ssh cleo@<VPS_HOST> 'pm2 logs cleo-broadcast --lines 50 --nostream'
```

Expected: `Cleo server running on 0.0.0.0:3102`. If it crashes, fix before proceeding.

## Step 6 — Local VPS smoke test

```bash
ssh cleo@<VPS_HOST> 'curl -s http://localhost:3102/health'
```

Expected: `{"status":"ok"}`

## Step 7 — Caddy routing cutover

Current Caddy routes `api.worthymedia.tech` → `localhost:3100` (Fastify). Change to `:3102`.

```bash
ssh cleo@<VPS_HOST> 'sudo cat /etc/caddy/Caddyfile'
```

Find the `api.worthymedia.tech` block, change `reverse_proxy localhost:3100` → `reverse_proxy localhost:3102`.

Apply:

```bash
ssh cleo@<VPS_HOST> 'sudo systemctl reload caddy'
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
4. Watch VPS logs in another terminal: `ssh cleo@<VPS_HOST> 'pm2 logs cleo-broadcast'`
5. Expected: `[REQ] POST /broadcast/create` → orchestrator logs → audio bytes uploaded to R2

## Rollback

If any step breaks production:

```bash
# Revert Caddy to old Fastify
ssh cleo@<VPS_HOST> "sudo sed -i 's/localhost:3102/localhost:3100/' /etc/caddy/Caddyfile && sudo systemctl reload caddy"
```

Old Fastify keeps running on 3100 the entire time — no downtime risk.

## Cleanup (later, after 1-week soak)

Once the new server is proven:

```bash
ssh cleo@<VPS_HOST> 'pm2 stop cleo-api && pm2 delete cleo-api && pm2 save'
# Leave /home/cleo/cleo-api/ on disk for another month as a safety net
```

## Observability — Sentry Alerts

Telemetry events emitted by `BakeTelemetry` (see
`server/src/services/telemetry/BakeTelemetry.ts`):

- `tts.provider-fallback` (event, level=warning, tags `from`/`to`, extra `reason`) — emitted when TTS chain falls through, e.g., CosyVoice → F5 → Cartesia.
- `enrichment.api-timing` (event, level=info, tags `api`, extra `durationMs`) — per-API timing for Genius, MusicBrainz, Wikipedia, Last.fm calls inside `BackgroundEnricher.drainNow`.
- `sequencer.result` (event, level=info, tags `vibe`, extra `meanDistance` + `featureSourceCounts` + `n` + `poolSize`) — emitted once per bake from `DeterministicTrackSequencer.logResult`.
- Bake span (`broadcast.bake` op, attributes `bake.broadcast_id`, `bake.vibe`, `bake.length`, `bake.time_to_slot_zero_ms`, `bake.time_to_completion_ms`, `bake.status`) — emitted from `BroadcastOrchestrator.create` for every bake; closed on success, failure, or early-exit.

Note: `enrichment.api-timing` does NOT cover ReccoBeats / Deezer — those run inside `FeatureFetchChain.fetchBatch` (a separate concern; future task).

### Required dashboard alerts

Configure these in Sentry (Settings → Alerts → Create Alert):

1. **Cartesia fallback rate > 5% in 1 hour**
   - Trigger: Number of `tts.provider-fallback` events with `tags.to=cartesia` exceeds 5% of total bakes (count of `broadcast.bake` transactions) in a rolling 1-hour window.
   - Severity: warning.
   - Action: notify on-call (Slack #onay-alerts).
   - Reasoning: Cartesia is the paid fallback. Frequent hits = LAN box (CosyVoice on <TTS_HOST>) health degraded; investigate before subscriber experience degrades.

2. **Sequencer meanDistance ≥ 0.5 (Phase 1 gate)**
   - Trigger: `sequencer.result` event with `extra.meanDistance >= 0.5` more than 10% of bakes in 24 hours.
   - Severity: error.
   - Action: notify dev (email).
   - Reasoning: Phase 1 decision gate (issue #20 — meanDistance < 0.5 across all 7 vibes after ReccoBeats integration). Trips → re-brainstorm sequencer redesign before starting Phase 2.

3. **p95 time-to-slot-zero > 20s**
   - Trigger: 95th percentile of `bake.time_to_slot_zero_ms` over the last 1 hour exceeds 20000.
   - Severity: warning.
   - Action: notify on-call.
   - Reasoning: Phase 1 success criterion is p95 < 15s. 20s threshold gives headroom but flags trend.

### Setup checklist after first deploy

- [ ] `SENTRY_DSN` set on the production VPS env (not committed to repo).
- [ ] `SENTRY_TRACES_SAMPLE_RATE` set (recommended: `0.2` initially; tighten down once event volume is calibrated).
- [ ] Three alerts above configured + on-call Slack webhook attached.
- [ ] Verified: trigger a bake from a prod TestFlight build; confirm the bake transaction appears in Sentry's Performance tab and `tts.provider-fallback` events appear in Issues when fallback is forced.

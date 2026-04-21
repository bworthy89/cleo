# Production Deploy Runbook — cleo-broadcast

Target VPS: `cleo@187.124.69.95` (Hostinger, ID 1434111)
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
R2_ACCOUNT_ID=REDACTED-R2-ACCOUNT-ID
R2_ACCESS_KEY_ID=<NEW rotated token>
R2_SECRET_ACCESS_KEY=<NEW rotated token>
R2_BUCKET=cleo-broadcast-segments
R2_PUBLIC_BASE_URL=

# Curator allowlist
CURATOR_EMAILS=bworthy89@gmail.com
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

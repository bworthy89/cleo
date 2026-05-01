# Staging Server Design

**Status:** Resolved 2026-05-01. Implementation tracked in [`docs/superpowers/plans/2026-05-01-staging-server-implementation.md`](../plans/2026-05-01-staging-server-implementation.md).
**Parent spec:** [`2026-05-01-dev-pipeline-design.md`](2026-05-01-dev-pipeline-design.md), Tier 1 #4 — this doc resolves the choices the parent left open.

---

## Goal

A second tier of the broadcast server, on the same Hostinger VPS, that serves two purposes simultaneously:

1. **Pre-prod validation gate.** Push a server change to the `staging` branch, watch it deploy to staging, smoke-test against real R2 / real Gemini / real VoxCPM (not mocks, not local), then merge to `main` for prod deploy. Catches integration bugs before users see them.
2. **Always-on dev backend for mobile testing.** Local-device installs (`expo run:ios --device`) point at staging via `EXPO_PUBLIC_API_URL` build-time override, so the phone can test from anywhere — no LAN dependency, no need for the Mac to be awake.

Same tier serves both — solo dev, broken-staging-blocks-mobile-testing is acceptable since you're the one breaking it.

## Resolved choices

The parent spec listed five unspecified concerns. Each is resolved below with rationale and a "revisit when X" trigger.

### 1. R2 bucket — separate

**Decision:** Stand up `cleo-broadcast-segments-staging` as a sibling to prod's `cleo-broadcast-segments`. Same R2 account, same access keys, different bucket name.

**Why:** Sharing risks staging bakes overwriting prod segments at colliding broadcast IDs (`randomUUID()` collisions are astronomically unlikely but the path collision *pattern* is real — segments live at `broadcast/<id>/segment/<slot>/v<v>.mp3`). R2 cost for a low-volume staging bucket is trivial. Local filesystem (the third option) would skip R2 entirely and miss prod-only bugs in the storage code path.

**Revisit when:** Never, probably — the cost is permanent but small.

### 2. Firebase project — shared

**Decision:** Both tiers point at `cleo-app-840c8`. Same `GoogleService-Info.plist`, same JWT verifier, same Firestore data.

**Why:** Splitting means a second `GoogleService-Info-Staging.plist`, a second EAS build profile (`staging` distribution alongside `production`), a second TestFlight cycle for staging-targeting builds. That's significant complexity. The cost of sharing — staging tester writes (Last.fm sessionKeys, broadcast history, integrations) land in prod Firestore — is bounded because you're the only user. Only data at risk is your own.

**Revisit when:** External testers come on board AND any of them might use staging. Then split into `cleo-app-staging` Firebase project; staging-targeting EAS build picks up the staging plist via env override.

### 3. Initial DB state — empty

**Decision:** Staging starts empty. Manually seed featured broadcasts via `tsx scripts/bake-featured.ts <config.json>` from the staging clone as needed.

**Why:** Pre-SQLite-migration the data layer is ephemeral anyway:
- `BroadcastStore` is in-memory with 24h lazy TTL
- `FeaturedBroadcastRegistry` is `server/featured-broadcasts/registry.json` (gitignored, atomic-write)
- `EnrichmentCache` is `server/.enrichment-cache/tracks.json` (gitignored, 30-day re-enrichment)

None of these benefit from a prod snapshot — they're all populated on first use. Featured registry is the only one that needs explicit seeding, and `bake-featured` does that in one command.

**Revisit when:** SQLite migration lands ([`docs/superpowers/specs/2026-04-...-sqlite-migration-design.md`](.)) and the data layer becomes persistent. Then decide between empty / one-time prod snapshot / nightly refresh.

### 4. Curator allowlist + rate limits — same allowlist, higher cap

**Decision:** `CURATOR_EMAILS=bworthy89@gmail.com` (same as prod). `CURATOR_PUBLISH_CAP=20` (vs prod's 3) and `CURATOR_PUBLISH_WINDOW_MS=86400000` (same 24h window).

**Why:** Single dev means single curator. Higher cap on staging gives testing freedom without affecting prod's stricter limit.

**Revisit when:** External curators added.

### 5. Gemini API key — shared

**Decision:** Same `GEMINI_API_KEY` in both `.env` files.

**Why:** Free tier is 20 RPM globally; splitting requires a second Google Cloud project for a second key (~30 min of GCP UI navigation + billing setup). Solo low-volume staging is unlikely to dominate the quota. Risk: an enthusiastic staging soak burst-429s real users on prod.

**Revisit when:** A staging session 429s a prod user. Then create a second GCP project + key, set in `server/.env` of the staging clone only.

VoxCPM is self-hosted (free either way). Cartesia fallback is per-call paid (cheap at low volume). LastFm / Genius / MusicBrainz / OpenWeather all have generous free tiers; share keys.

## Operational topology

```
DNS:        staging.api.worthymedia.tech  →  VPS IP (same A record target as `api.worthymedia.tech`)
Caddy:      staging.api.worthymedia.tech { reverse_proxy localhost:3103 }
            (TLS auto-provisioned via Let's Encrypt — no extra config needed)
PM2:        cleo-broadcast-staging  on port 3103  (prod is cleo-broadcast on 3102)
VPS path:   /home/cleo/cleo-broadcast-staging/  (separate clone, separate node_modules)
Branch:     `staging` branch on git origin → manual deploy (Phase 5 will auto-deploy)
Env file:   /home/cleo/cleo-broadcast-staging/server/.env  (created on VPS, never committed)
Asset URL:  BROADCAST_ASSET_BASE_URL=https://staging.api.worthymedia.tech
            (so local-storage paths resolve correctly when STORAGE_BACKEND is unset
             for tests; for STORAGE_BACKEND=r2 the segment URLs are R2 presigned)
```

## Mobile testing pattern

Local-device install with build-time env override pins the binary at staging:

```bash
EXPO_PUBLIC_API_URL=https://staging.api.worthymedia.tech \
  SENTRY_DISABLE_AUTO_UPLOAD=true \
  npx expo run:ios --device
```

`EXPO_PUBLIC_*` is baked into the bundle at build time — once installed, the phone uses staging from anywhere, no LAN dependency, no need for the Mac to be awake. TestFlight builds keep pointing at prod (no separate staging TestFlight cycle needed).

## What the staging tier does NOT do

- **Doesn't replace local dev** — `cd server && npm run dev` against `localhost:3001` is still the inner loop for server iteration. Staging is for "I'm done iterating locally, validate against real infra before prod."
- **Doesn't host featured broadcasts shown to prod users** — staging featured registry is independent.
- **Doesn't do auto-deploy yet** — Phase 5 future work. For now: SSH + git pull + npm ci + npm run build + pm2 reload. Documented in `server/DEPLOY.md` once it lands.
- **Doesn't isolate Sentry events** — staging events go to the same Sentry project as prod. Tag-by-environment is on the LATER list if signal-vs-noise becomes an issue.

## Cost summary

- R2 staging bucket: pennies/month at low volume.
- VPS: zero added cost (same machine).
- Cloudflare DNS: free.
- Caddy + Let's Encrypt: free.
- Gemini / VoxCPM / Cartesia: shared with prod (no new cost unless quota becomes contended).

Total ongoing: **~$0 increment**.

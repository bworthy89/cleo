# Index

NOW / NEXT / LATER for ONAY. Don't pick from NEXT until NOW is empty. Open
checkboxes from plans + daily notes + this file aggregate into the Tasks query
at the bottom (renders once the Tasks plugin is installed).

Project conventions and topology: [[Conventions]].

## NOW

- [ ] Roadmap Phase 2 — Parity Sprint (issues #33–#38) — see [[2026-04-24-onay-roadmap-design]]
- [ ] **Prod SQLite-migration backfill** — `ssh cleo@<VPS_HOST>` → `cd /home/cleo/cleo-broadcast/server` → `npm run backfill-sqlite` → rename `.bak` files → `pm2 restart cleo-broadcast` → 5min log soak. Then same on staging if not yet done. See `server/DEPLOY.md` and [[2026-05-02]].

## NEXT

- [ ] **Phase 4.5 — automated `cleo.db` backups to R2** (`cleo-broadcast-backups` bucket, separate token, hourly local + nightly off-box, lifecycle-rule retention). **Hard prereq** for deleting the `.bak` JSON fallbacks. See "Phase 4.5" in [[2026-05-01-sqlite-migration-design]].

## LATER
- [ ] **`.bak` retention verification** — keep `tracks.json.bak` + `registry.json.bak` for ≥7 days (≥2026-05-09), then run the 5-step verification in `server/DEPLOY.md` before deleting in a single commit titled `remove sqlite-migration .bak fallbacks`.
- [ ] **Phase 5 — SQLite admin endpoints** (`/admin/bakes`, `/admin/bakes/:id`, `/admin/users/:uid/activity`, `/admin/retention`, `/admin/curators/:uid/publishes`, `/admin/featured`, `/admin/tts/failures`). Purely additive; ships when convenient. See "Admin surface" in [[2026-05-01-sqlite-migration-design]].
- [ ] **D1→D7 retention evaluation** (Phase 2 gate, #38). Now unblocked since `app_open` + `broadcast_started`/`completed`/`failed` events record to `app_events` from 2026-05-02 prod-deploy onward. Need ≥14 days of post-ship data → earliest evaluation 2026-05-16.
- [ ] **Track down the leaked jest handle** that forced `--forceExit` in `server/package.json`. Likely in `BackgroundEnricher.test.ts`'s `tempCache()` helper (`new Db(':memory:')` never closed) or `TrackSequencer.test.ts`'s `emptyEnrichmentCache()`. Once fixed, drop the `--forceExit`.
- [ ] **Update `server/DEPLOY.md`** to add `sqlite3` CLI to the Pre-deploy toolchain checks (`sudo apt install -y sqlite3` — needed for Phase 4.5 backup cron's `sqlite3 ".backup ..."` invocation).
- [ ] **Dev pipeline → done.** All 5 phases shipped 2026-05-01. Auto-deploy verified on both tiers. Next dev-pipeline-adjacent items: SHA-pin `appleboy/ssh-action@v1` to a verified commit hash; switch prod PM2 to cluster mode (`exec_mode: 'cluster'`, `instances: 'max'`) for zero-downtime reload (currently fork mode with ~1s reload window); migrate prod to use `ecosystem.config.cjs` instead of inline pm2 start args (so logs land in `server/logs/`).
- [ ] Bake abort endpoint (`DELETE /broadcast/:id`)
- [ ] Native Swift cleanup (eject code, `beginTTSBackgroundTask` / `silencePlayer` leftovers)
- [ ] R2 presign TTL tightening (7d → 24h to match BroadcastStore)
- [ ] Rollback Fastify decommission (`pm2 delete cleo-api` once new server is stable)
- [ ] Cleanup `cleo-broadcast-old-2026-05-01` directory on VPS once auto-deploy has soaked for ~1 week (≥2026-05-08)
- [ ] Investigate framing-segment word-count drift — `cold_open` running ~19 words (spec 35-50) and `sign_off` ~23 words (spec 35-55) under Groq primary; `deep_dive` and `tight_bridge` are in spec. Compare against a Gemini run; if Groq-specific, tune the framing-tier prompts. Surfaced by smoke-bake 2026-05-01.

---

## All open tasks

```tasks
not done
group by filename
sort by priority
```

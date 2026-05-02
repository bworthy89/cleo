# Index

NOW / NEXT / LATER for ONAY. Don't pick from NEXT until NOW is empty. Open
checkboxes from plans + daily notes + this file aggregate into the Tasks query
at the bottom (renders once the Tasks plugin is installed).

Project conventions and topology: [[Conventions]].

## NOW

- [ ] Roadmap Phase 2 — Parity Sprint (issues #33–#38) — see [[2026-04-24-onay-roadmap-design]]

## NEXT

- [ ] Root lint cleanup so it can join CI — `npm install --save-dev eslint-plugin-react-hooks`, then either accept or fix the 25 no-explicit-any / unused-var warnings

## LATER
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

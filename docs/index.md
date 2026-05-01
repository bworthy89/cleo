# Index

NOW / NEXT / LATER for ONAY. Don't pick from NEXT until NOW is empty. Open
checkboxes from plans + daily notes + this file aggregate into the Tasks query
at the bottom (renders once the Tasks plugin is installed).

Project conventions and topology: [[Conventions]].

## NOW

- [ ] Roadmap Phase 2 — Parity Sprint (issues #33–#38) — see [[2026-04-24-onay-roadmap-design]]

## NEXT

- [ ] Sentry source-map fix — beta blocker, was punted as LATER but should jump the queue once external testers are imminent (every OTA crash is currently unmapped)
- [ ] Root typecheck cleanup so it can join CI — fix tsconfig to exclude `server/**` (server has its own tsconfig + the build-step typecheck) and `v2-migration/**` (migration scratchpad), fix the testID prop error in `src/screens/home/HomeBroadcastScreen.tsx:673` (CatalogRow doesn't accept testID per current Props type)
- [ ] Root lint cleanup so it can join CI — `npm install --save-dev eslint-plugin-react-hooks`, then either accept or fix the 25 no-explicit-any / unused-var warnings
- [ ] Dev pipeline Phase 5 — auto-deploy on push to staging / main (last dev pipeline phase; depends on Phase 3 staging which is now done)

## LATER
- [ ] Bake abort endpoint (`DELETE /broadcast/:id`)
- [ ] Native Swift cleanup (eject code, `beginTTSBackgroundTask` / `silencePlayer` leftovers)
- [ ] R2 presign TTL tightening (7d → 24h to match BroadcastStore)
- [ ] Rollback Fastify decommission (`pm2 delete cleo-api` once new server is stable)
- [ ] Investigate framing-segment word-count drift — `cold_open` running ~19 words (spec 35-50) and `sign_off` ~23 words (spec 35-55) under Groq primary; `deep_dive` and `tight_bridge` are in spec. Compare against a Gemini run; if Groq-specific, tune the framing-tier prompts. Surfaced by smoke-bake 2026-05-01.

---

## All open tasks

```tasks
not done
group by filename
sort by priority
```

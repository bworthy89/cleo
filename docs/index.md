# Index

NOW / NEXT / LATER for ONAY. Don't pick from NEXT until NOW is empty. Open
checkboxes from plans + daily notes + this file aggregate into the Tasks query
at the bottom (renders once the Tasks plugin is installed).

Project conventions and topology: [[Conventions]].

## NOW

- [ ] Dev pipeline Phase 2 — workflow hygiene (DOD checklists, one-branch rule)
- [ ] Roadmap Phase 2 — Parity Sprint (issues #33–#38) — see [[2026-04-24-onay-roadmap-design]]

## NEXT

- [ ] Dev pipeline Phase 3 — staging environment (needs its own design pass first — R2 / Firebase / DB-state choices unspecified)
- [ ] Dev pipeline Phase 4 — automation safety net (CI on push, pre-push hook, build-number bump script)

## LATER

- [ ] Dev pipeline Phase 5 — auto-deploy on push to staging / main
- [ ] Bake abort endpoint (`DELETE /broadcast/:id`)
- [ ] Native Swift cleanup (eject code, `beginTTSBackgroundTask` / `silencePlayer` leftovers)
- [ ] R2 presign TTL tightening (7d → 24h to match BroadcastStore)
- [ ] Sentry source-map upload — verified missing 2026-05-01 after OTA went live: Sentry releases page shows "set up releases" CTA, meaning build 64 source maps never landed. Also: `eas update` doesn't auto-upload OTA bundle source maps; needs `sentry-expo-upload-sourcemaps` as a post-update step. Two-part fix: (a) diagnose why the build-time upload silently failed (check EAS build log for sentry-cli output), (b) wire post-update source-map upload script. Beta blocker — every OTA crash is currently unmapped.
- [ ] Rollback Fastify decommission (`pm2 delete cleo-api` once new server is stable)
- [ ] Investigate framing-segment word-count drift — `cold_open` running ~19 words (spec 35-50) and `sign_off` ~23 words (spec 35-55) under Groq primary; `deep_dive` and `tight_bridge` are in spec. Compare against a Gemini run; if Groq-specific, tune the framing-tier prompts. Surfaced by smoke-bake 2026-05-01.

---

## All open tasks

```tasks
not done
group by filename
sort by priority
```

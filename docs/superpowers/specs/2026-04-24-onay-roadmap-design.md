# ONAY Dev Roadmap — Research-Driven Phased Plan

**Date:** 2026-04-24
**Status:** Brainstorm-approved through Section 5; pending user spec review
**Source research:** [`docs/research.md`](../../research.md)
**Driver:** Competitive research → parity-then-differentiate
**Total calendar:** ~10–11 months solo-dev
**Scope:** Decomposition document. Each phase is brainstormed separately as a feature-level spec when work on that phase starts.

---

## Thesis

The research's central claim is that **stability is ONAY's structural moat**. Yoodio's "vibe coded slop" review and Radiant's literal "Emergency Fix" releases come from architectural choices ONAY doesn't share — Yoodio runs live per-listener generation; Radiant runs brittle live news/scraping. ONAY's bake-once-then-lock model means episodes *can't* break mid-playback. But no one knows that until it's measurable. Phase 1 makes the moat measurable; everything after lands on a foundation that won't embarrass it.

**Single-host ONAY is the editorial identity.** Personality investment goes into deeper ONAY (more reference audio, per-vibe tone, time-of-day variants, premium voice tier) — never breadth across hosts. Voice-cloning Pro tier (originally LT-8 in the research) is reframed as **"Personal Voice mode"**: the user's own voice on their personal stations only; ONAY herself is never replaced in featured/curator broadcasts.

**Sequencing logic: parity-then-differentiate.** Match what Yoodio/Radiant ship that genuinely matters (Last.fm scrobble, weather, first-listen onboarding, Up Next view, thumbs save-to-list), then differentiate at chrome → platform → architecture layers (Liquid Glass progressive enhancement → CarPlay → collaborative featured episodes).

Six phases. Phase 1 is non-negotiable foundation; Phases 2–6 each have explicit decision gates that can re-route the roadmap if Phase 1 telemetry doesn't support proceeding.

---

## Off the roadmap (deliberately)

Real features the research surfaced that are explicitly *not* on this roadmap. Tracked here so they don't quietly creep back in.

- **Multi-host (LT-4)** — single-host is the differentiation
- **Frequency slider** — cuts against tier-cadence design philosophy
- **Real news integration** — competitor's biggest stability surface; both Yoodio and Radiant break here
- **Local-business shoutouts** — spam vector; gets bad reviews
- **Concert discovery + ticket affiliate** — explicitly excluded
- **Spotify support** — commercial-approval trap; Apple Music exclusive stays
- **Android** — post-1-year only with revenue or co-founder
- **Wear OS / Apple Watch / Vision Pro standalone** — Vision Pro inherits via universal binary; standalone watch is post-roadmap

If any of these come back into scope they need a fresh brainstorm, not silent re-introduction.

---

## Phase 1 — Stability foundation + curation depth

**Calendar:** weeks 1–4
**Goal:** *"ONAY doesn't break, and the playlist makes sense."*
**Dependencies:** none — pure foundation; no phase blocks Phase 1 from starting now.

### Items

1. **MVP-1 — Bake abort endpoint (`DELETE /broadcast/:id`).** Cooperative cancellation via the `BroadcastOrchestrator.inFlight` map: flag flipped to `aborted`; in-flight TTS request finishes (CosyVoice/F5 are blocking on the lock); abort flag checked between segment generations. Remaining slots marked `aborted` in the manifest; client drops the broadcast from history.
2. **MVP-2 — Stability telemetry.** Per-bake events to Sentry / Firebase Performance: time-to-slot-0, time-to-completion, TTS provider fallback depth (CosyVoice → F5 → Cartesia), `drainNow` API timing breakdown. Threshold alerts on Cartesia fallback rate (LAN box health proxy). In-app public health indicator banner consuming a new `/health/public` endpoint.
3. **MVP-5 — Per-curator publish budget.** Cap featured publishes per curator email per day (initial: 3/day). Counter keyed on `req.uid` in curator middleware; Redis or in-memory with TTL. 429 with clear error.
4. **MVP-6 — CosyVoice systemd unit.** `systemctl link /home/kari/cosyvoice-server/cosyvoice.service` on 192.168.8.229. Restart-on-failure, journal logging, auto-start on boot. Health check is **in-process on the Hostinger VPS**, not cron + status file on the LAN box: `server/src/providers/tts/index.ts` runs a 30s loop (`HEALTH_CHECK_INTERVAL_MS`) pinging CosyVoice + F5 over the Pangolin tunnel; `/health/public` reads the in-process state via `getTtsStatus()` (`server/src/routes/health.ts`). The in-process design is a strict superset of the cron+status-file design — it catches both LAN-box-wedged and tunnel-down failures with a single signal — so the cron component originally proposed in `docs/research.md` was dropped during MVP-2 implementation (PR #21). The roadmap is amended to record the shipped architecture.
5. **LT-6 — ReccoBeats integration.** Slot at top of `FeatureFetchChain` ladder ahead of Deezer. Validates the planned playlist-algorithm-redesign branch against the identical-order-across-vibes bug.
6. **CLAUDE.md "What's Left" cleanup:**
   - Native Swift cleanup: remove `playEjectTransition` / `cancelEjectTransition` / `onEjectTrackChanged` (compiled but unreferenced); remove `beginTTSBackgroundTask` / `silencePlayer` leftovers.
   - Fastify decommission: `pm2 delete cleo-api` once new server is stable.
   - R2 presign TTL tightening: 7 days → 24h to match `BroadcastStore` 24h.

### Success criteria

- ≥ 95% of bakes complete without falling through to Cartesia (paid fallback)
- p95 time-to-slot-0 < 15s on standard length
- Sequencer telemetry: `meanDistance < 0.5` across all 7 vibes (currently flagged at 0.7)
- Zero per-curator runaway publishes
- "Identical order across vibes" demo bug fixed; protected by regression test

### Decision gate

If sequencer `meanDistance ≥ 0.5` after ReccoBeats integration, the sequencer needs deeper redesign before Phase 2 — re-brainstorm.

---

## Phase 2 — Parity sprint

**Calendar:** weeks 4–9 (overlaps Phase 1 wind-down)
**Goal:** *"ONAY does everything Yoodio/Radiant do that genuinely matters."*
**Dependencies:** Phase 1 telemetry to measure retention deltas these features should produce.

### Items

1. **LT-5 — Weather context.** Free OpenWeatherMap; client passes lat/long (or city) into `POST /broadcast/create` `userContext`. `SegmentScriptBuilder` cold_open prompt gets optional `weatherHint` slot ("It's 47 and drizzling in your zip code"). One mention per episode, opt-in by city, off by default. **No news, no traffic.** Filesystem TTS cache dedupes identical phrasing across users in the same condition.
2. **LT-7 — User-facing Last.fm scrobble.** Distinct from existing server-side `LastFmFetcher` enrichment use. OAuth flow on `ProfileScreen`; per-user tokens in Firestore (not MMKV). Server-side scrobble worker consumes per-user "now playing" + "scrobble" events emitted when `MusicKitPlayer.play([trackId])` resolves.
3. **MVP-7 — First-listen onboarding bake.** After music-auth succeeds, kick off a 3-track `length: 'quick'` bake using user's most-played playlist (or featured fallback). Cold open addresses user by name. By the time `cleo-setup` finishes, slot 0 is ready and the user lands on playing audio.
4. **Up Next view + Quick-add.**
   - Display: show `manifest.tracks` ahead of current in player.
   - Quick-add: tap-to-queue a single track that plays after current via direct `MusicKitPlayer.play()`. **Does NOT mutate the locked manifest.** No commentary slot generated for inserted tracks. Preserves bake-once-then-lock invariant.
5. **Thumbs-up save-to-list.** Single-direction feedback: tap a track → save to a personal "Liked" list (Firestore-backed, capped at 200 entries with FIFO eviction). **No thumbs-down path** that mutates the deterministic sequencer mid-bake. Saved list visible on Profile screen.

### Success criteria

- Last.fm OAuth end-to-end; scrobbles visible in Last.fm account within 30s of track start
- Weather mention appears in cold_open with city/condition; opt-in toggle on Profile
- First-listen median time from "tap into setup last screen" → "audio playing" < 5s
- Up Next view shows post-current tracks; quick-add plays inserted track after current with no commentary
- Saved list persists across sessions

### Decision gate

If day-1 → day-7 retention isn't measurably improved by Phase 2 features, run TestFlight user research before Phase 3 starts — visual work in Phase 3 would be downstream of a deeper UX problem.

---

## Phase 3 — Visual/UX coherence

**Calendar:** weeks 9–14
**Goal:** *"ONAY looks current on iOS 26 without losing Crate Digger."*
**Dependencies:** Phase 1 telemetry to back the App Store stability claim.

### Items

1. **MVP-3 — Phased Liquid Glass.** `#available(iOS 26, *)` runtime guards on chrome surfaces only: `CustomTabBar`, `AppHeader`, `NowPlayingBar`, `OfflineBanner`, modal sheets (`SetupSheet`, `SettingsDrawer`, `PublishFeaturedSheet`). Content layer stays Crate Digger: `FeaturedBroadcastCard`, `CatalogRow`, `LinerNotes`, `SleeveArt`, `SpinningRecord`, `StampButton`, `SectionMarker`. iOS 25 and below fall back to current `BlurView` + `AM.bgDeep` patterns. Side-by-side test on iOS 16.2 / 18 / 26.
2. **Crate Digger soft refresh** (+1 week scope addition). Keep tokens (oxblood, amber, Anton, Fraunces). Modify density:
   - Tighten spacing — more whitespace
   - More motion (overlaps with Liquid Glass on chrome surfaces)
   - Halftone overlays applied more selectively (currently default-laid under most oxblood plates; reduce to editorial moments)
   - Simplify `Tick` corner-marks where they read "trying too hard" on busier `StampButton` variants
3. **MVP-4 — Universal Link share-to-preview.** `onay.app/b/<broadcastId>` → marketing landing page streaming the cold_open MP3 directly from R2 (already presigned). First 3–5 tracks with cover art. "Open in ONAY" CTA. Public read endpoint `GET /broadcast/:id/manifest?public=true` bypasses ownership gate **only when** `manifest.userId === 'curator'`. Per-user share is Phase 6.
4. **MVP-8 — App Store positioning.** Lean into "the AI radio that doesn't break." Screenshots: episode timeline with locked tier-style cadence; host voice quote; Liquid Glass chrome on iOS 26 device. ASO keywords: "AI radio," "Apple Music DJ," "music host." Stability claim is backed by Phase 1 telemetry — don't ship App Store copy until 30 days of < 5% Cartesia-fallback data.
5. **Polish pass.** Earlier Tonight rail tightening, Tuning In overlay refinements, segment-progress visualization (consider showing tier marker positions as ticks on the track-based monotonic progress bar).
6. **Calendar optimization.** Submit `com.apple.developer.carplay-audio` entitlement application **at week 13** so the ~2-week Apple review overlaps Phase 3's tail and Phase 4 start.

### Success criteria

- Crate Digger intact on iOS 16.2 / 18 / 26 (side-by-side test)
- Universal Link click-through rate measurable (track via App Store referrer)
- App Store listing live with "doesn't break" framing backed by 30+ days of telemetry
- CarPlay entitlement application submitted by week 13

### Decision gate

If < 30 days of clean stability telemetry by Phase 3 end, hold the App Store positioning push until the data justifies it.

---

## Phase 4 — Platform expansion: CarPlay

**Calendar:** weeks 14–22
**Goal:** *"ONAY goes where you go."*
**Dependencies:** Phase 1 (CarPlay-specific failure tracking via telemetry); Phase 3 entitlement application timing.

### Items

1. **LT-1 — CarPlay implementation.**
   - CarPlay-Audio entitlement granted (application submitted in Phase 3).
   - CarPlay scene in `ios/ONAY/`: `CPListTemplate` driving "Featured" + "Earlier Tonight" categories from existing endpoints.
   - `CPNowPlayingTemplate` driven by `BroadcastPlayer` state — currentTrackIndex, `computeProgress()`, per-tier indicator above scrubber ("ONAY commentary in 2 tracks").
   - **Audio-session edge cases — biggest unknown of the entire roadmap.** Verify `releaseAudioSession` handoff between segment and next track works under CarPlay's stricter session ownership; verify `activateDuckingSession` ↔ `releaseAudioSession` cycle doesn't drop CarPlay route. Test scenarios: tunnel re-entry, Bluetooth/CarPlay switchover, incoming call mid-segment, MusicKit `play()` race with CarPlay session activation.
2. **LT-10 partial — iPad polish.** Mostly inherited from iPhone universal binary; treat as a real surface (Yoodio doesn't). Verify rotation handling on `HomeBroadcastScreen`, `AskOnayScreen`, `PlayerScreen`. Use `.regular` size class to widen content where appropriate.

### Success criteria

- Episode playback works end-to-end on CarPlay simulator + real CarPlay-enabled vehicle
- No regression on phone playback when CarPlay session activates/deactivates
- Tunnel/Bluetooth handoff doesn't drop the bake
- iPad layout intact in landscape

### Decision gate

If CarPlay audio-session regressions in real-world drive testing, TestFlight-only for an additional 4–6 weeks before App Store push with CarPlay enabled.

---

## Phase 5 — Monetization + ONAY personality depth

**Calendar:** weeks 22–32
**Goal:** *"ONAY makes money on real upsell value, not a tip jar."*
**Dependencies:** Phase 1 telemetry for conversion measurement; Phase 4 CarPlay (Pro users will demand it).

### Items

1. **LT-3 — StoreKit 2 + ONAY+** at **$3.99/mo or $29.99/yr** with 7-day free trial. Single SKU at launch (Pro tier ships later in same phase).
   - **Gating:** `length: 'long'` cap, priority bake queue, replay-last-segment, exclusive featured broadcasts.
   - **Entitlement signal:** Firebase custom claim `onay_plus: true`; `BroadcastOrchestrator` reads claim from `req.user`.
   - **Receipt validation:** on-device in v1; server-side validation deferred.
2. **LT-8 reframed — Personal Voice mode (Pro tier, $9.99/mo).**
   - User uploads 30s of their voice via biometric-challenge consent flow ("read this challenge phrase").
   - Reference audio in R2 keyed on userId.
   - `BroadcastOrchestrator.create` accepts optional `customVoiceId`; routes that bake's TTS to the custom reference.
   - **Hard guard:** rejected when `userId === 'curator'` — ONAY (canonical) is never replaced in featured/curator broadcasts.
   - **Watermarking:** F5/CosyVoice are not legally watermarked the way Chatterbox claims (Perth watermark). Add explicit ToS clauses; consider Perth-equivalent watermarking before shipping. **Hold until ONAY+ basic tier is shipping smoothly — legal surface is real.**
3. **ONAY personality depth (replaces the multi-host investment).** This is where the single-host commitment earns its keep:
   - Bank additional reference audio for ONAY across vibes/moods (currently one canonical clip; want 4–6 contextual variants).
   - Per-vibe tone tweaks: system-prompt fragments in `SegmentScriptBuilder` for each of the 7 vibes (e.g., late-night ONAY ≠ morning ONAY in cadence and word choice — *same identity, different register*).
   - Time-of-day / day-of-week awareness in cold_open ("Late Sunday — slowing things down").
   - **Premium voice for ONAY+ subscribers:** route bake-time TTS to a paid Cartesia voice instance (already in fallback chain; matches the existing `onay-cartesia.wav` reference). ONAY+ subscribers literally hear a *better-sounding* ONAY than free users — a concrete upsell hook neither competitor can match without rebuilding their TTS stack.

### Success criteria

- Free → ONAY+ trial conversion measurable; baseline target 3–5% trial-to-paid
- Personal Voice mode opt-in flow with consent + watermarking guard live
- ONAY+ users see `length: 'long'` shipping reliably (no extra fallbacks vs free tier)
- Blind A/B preference test shows ≥60% of users prefer the upgraded ONAY voice

### Decision gate

If ONAY+ trial-to-paid conversion < 2% of MAU, Phase 6 architecture moats may not have ROI; re-brainstorm what to do with the runway.

---

## Phase 6 — Architecture moats

**Calendar:** weeks 32–44+
**Goal:** *"ONAY does what nobody else can."*
**Dependencies:** Phase 5 (curator base grows during monetization phase); Phase 4 (CarPlay users likely curator audience). Sub-gate: iOS 26 adoption % gates LT-2.

### Items

1. **LT-9 — Discovery feed.** Dedicated tab; pageable query against `FeaturedBroadcastRegistry`; heart, save, follow-curator. New `featuredAt: timestamp` field for sort.
2. **LT-9 — Collaborative featured episodes.** `coAuthors: string[]` on the manifest; `requireCurator` extends to verify all listed authors in `CURATOR_EMAILS`. Sign-off shouts out contributors by curator handle. Track-list contributions distributed across authors. **The thing only ONAY can ship** — Yoodio's per-listener generation can't represent multi-author shared assets.
3. **LT-9 — Friends activity (opt-in).** Spotify-like presence: "Bakari is listening to 'Late Night Drive Vol. 3'." Default off; opt-in flow with privacy controls. Lower priority than discovery + collaborative; ship if user growth justifies.
4. **LT-2 — iOS 26 deployment-target bump.** When App Store Connect analytics shows ~70% of paying users on iOS 26 (likely 12–18 months post-iOS-26 release). Remove `#available(iOS 26, *)` guards from MVP-3 / Phase 3; apply Liquid Glass universally. Verify `MusicLibraryRequest` + ActivityKit still work post-bump.
5. **LT-10 long tail.**
   - Per-user share-to-preview: extend MVP-4's curator-only share to user broadcasts via privacy-respecting opt-in.
   - macOS Catalyst (~6–8 weeks): leverage MusicKit on macOS.
   - Web preview / shareable landing-page upgrade with full web playback for non-installed users.

### Success criteria

- Discovery feed live with ≥50 curator broadcasts at launch
- ≥1 multi-curator collaboration shipped as a featured demo
- Per-user share opt-in flow live
- iOS 26 deployment-target bump completed when adoption justifies (sub-gate)

### Decision sub-gate

iOS 26 adoption < 70% of paying users → hold the deployment-target bump (LT-2); keep `#available` guards.

---

## Cross-phase concerns

### Decision gates summary

Each phase has an explicit "do we proceed?" gate. Phase 1 telemetry is the data source for all of them.

| Gate | Triggering condition | If triggered |
|---|---|---|
| After Phase 1 | Sequencer `meanDistance ≥ 0.5` after ReccoBeats integration | Sequencer needs deeper redesign before Phase 2 — re-brainstorm |
| After Phase 2 | Day-1 → day-7 retention not measurably improved | Run TestFlight user research before Phase 3 starts |
| After Phase 3 | < 30 days of clean stability telemetry | Hold App Store "doesn't break" positioning until data backs it |
| After Phase 4 | CarPlay audio-session regressions in real-world drive testing | TestFlight-only for 4–6 more weeks before App Store push with CarPlay enabled |
| After Phase 5 | ONAY+ trial-to-paid conversion < 2% of MAU | Phase 6 moats may not have ROI; re-brainstorm runway use |
| Phase 6 sub-gate | iOS 26 adoption < 70% of paying users | Hold deployment-target bump (LT-2); keep `#available` guards |

### Risk register

Where to budget extra time:

- **Highest unknown: CarPlay audio-session edge cases (Phase 4).** CLAUDE.md flags `releaseAudioSession` between segment and next track as essential under normal phone playback; CarPlay's stricter ownership model could expose race conditions invisible today. **Budget 2× engineering estimate**; plan TestFlight-only for real-world drive validation.
- **Personal Voice mode legal surface (Phase 5).** F5/CosyVoice are not legally watermarked the way Chatterbox claims. ToS clauses + Perth-equivalent watermarking are blockers, not nice-to-haves. **Don't ship until legal is signed off.**
- **Curator base size (Phase 6).** Collaborative featured needs ≥10 active curators to be interesting. If publish budget is rate-limiting too aggressively or curator allowlist is too narrow, expand `CURATOR_EMAILS` ahead of Phase 6.
- **Ongoing: LAN box (192.168.8.229) is a single point of failure.** Hosts both CosyVoice and F5. Phase 1 systemd + telemetry mitigates short-term. At >1k DAU, evaluate moving CosyVoice to a redundant host. Track as ongoing concern, not a phase item.

### Cross-phase compounding

**Phase 1's telemetry is load-bearing for every later phase's success criteria.** Without it, "did Phase N succeed?" is unverifiable. Don't be tempted to skip Phase 1 to ship Phase 2 features faster — the entire downstream measurement chain depends on it.

### Total calendar

| Phase | Weeks | Theme |
|---|---|---|
| 1 | 1–4 | Stability foundation + curation depth |
| 2 | 4–9 | Parity sprint |
| 3 | 9–14 | Visual/UX coherence (incl. Crate Digger soft refresh) |
| 4 | 14–22 | Platform expansion (CarPlay) |
| 5 | 22–32 | Monetization + ONAY personality depth |
| 6 | 32–44+ | Architecture moats |

**Total: ~10–11 months solo-dev.** Phase 6's tail is the most variable — user-growth-dependent; three of its items (per-user share, macOS Catalyst, web preview) are independently scopable.

---

## What's NOT in scope (would need separate brainstorm)

- App icon redesign / brand refresh
- Major sequencer rework beyond ReccoBeats
- Onboarding redesign beyond first-listen bake
- ONAY voice retraining (different reference clip, different primary TTS provider)
- Server migration off Hostinger VPS
- Apple Watch standalone, Wear OS, etc.

If any of these become urgent, they're their own brainstorm + spec.

---

## Next step

This roadmap is the decomposition document. Each phase is brainstormed separately as a feature-level spec when work on that phase starts. Phase 1 should be the first of these brainstorms — pure foundation, no upstream dependencies.

Ready to enter Phase 1 brainstorm when you are.

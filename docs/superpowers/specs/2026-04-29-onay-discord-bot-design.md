# The Producer — ONAY Booth Discord Bot Design

**Date:** 2026-04-29
**Status:** Design approved, awaiting implementation plan
**Companion doc:** `docs/discord-beta-kit.md` (server structure, copy library, launch sequence)

---

## 1. Goal

Replace the mix of third-party Discord bots in `docs/discord-beta-kit.md` (Carl-bot, Sesh, MEE6, generic GitHub bot) with a single ONAY-branded automation surface — **The Producer** — that owns the closed-beta booth's onboarding, application review, voting digest, bug forwarding, and weekly vibe-pitch ranking. Phase 2 adds mod log, featured-broadcast announcer, and EAS build watcher.

The bot is the ops layer of the booth. It is deliberately distinct from any future "talk to ONAY in Discord" persona experience (which would be its own Discord application).

---

## 2. v1 scope (launch-critical)

| # | Feature | Trigger | Output |
|---|---|---|---|
| 1 | Onboarding | 📻 reaction on the pinned `#start-here` post | Grants `@Charter Listener` + DMs the approval copy with the TestFlight URL |
| 2 | Application review | Author 📻-reacts to their own `#apply` post | Bot attaches `Approve` / `Waitlist` buttons (Producer/On-Air only); button click grants role + DMs and footers the post |
| 3 | Vote tally | Cron 00:00 America/New_York | Digest in `#tonight-on-onay`: per-candidate 🔥 count + ship/no-ship at the 10-reactor threshold |
| 4 | Bug forwarder | New thread in `#bug-reports` forum channel | Opens GitHub issue in `bworthy89/cleo` with mapped tag → label + `tester-report`, replies in-thread with the issue link |
| 5 | Vibe-pitch digest | Cron Sun 21:00 America/New_York | Top 3 + honorable mentions in `#vibe-requests` |

**Phase 2 (deferred):** mod log, featured-broadcast announcer, EAS build watcher.

**Explicitly out of scope:** auto-publishing featured broadcasts from votes (kept human-in-the-loop), bug-issue two-way sync, tester leaderboards, a "what would ONAY say" conversational reply bot (separate Discord application).

---

## 3. Architecture

### Process model

Single long-lived Node process running on the same Hostinger VPS as the broadcast server, registered with PM2 as **`cleo-discord-bot`** alongside `cleo-broadcast`. Uses the same TypeScript stack and conventions as `server/`.

The bot holds a Discord gateway WebSocket (required for reaction events and role-grant detection — slash-command-only HTTP-interactions wouldn't cover v1's needs). It exposes nothing on the network: pure consumer of Discord events, outbound caller to GitHub.

**Gateway intents** (set on the `Client` constructor in `index.ts`):
- `Guilds` — channel/role lookups, `threadCreate` events.
- `GuildMessages` + `MessageContent` — reading `#bug-reports` thread starters and `#tonight-on-onay` candidate posts. **Privileged intent**, must be enabled in the Developer Portal.
- `GuildMessageReactions` — `messageReactionAdd` for onboarding + application review + vote/vibe tallies.
- `GuildMembers` — granting `@Charter Listener`. **Privileged intent**, must be enabled in the Developer Portal.

### Dependencies

- `discord.js` v14 — gateway client + slash command registration.
- `@octokit/rest` — GitHub issue creation. `@octokit/plugin-throttling` for defensive rate-limit handling.
- `node-cron` — vote tally + vibe digest scheduling.
- `pino` — already a `server/` dependency, reused for structured JSON logging.
- `zod` — already a `server/` dependency, used for env-var parsing.

### Repo layout

```
server/
├── src/
│   └── discord-bot/                  ← NEW
│       ├── index.ts                  ← gateway client, intent setup, top-level event router
│       ├── config.ts                 ← Zod env parsing, channel/role ID resolution on boot
│       ├── state.ts                  ← BotStateStore (JSON files, atomic write, 50ms debounce)
│       ├── github.ts                 ← Octokit wrapper: idempotent issue create, retry-on-failure
│       ├── copy.ts                   ← all user-facing strings (DMs, digest formats)
│       └── handlers/
│           ├── onboarding.ts
│           ├── applicationReview.ts
│           ├── voteTally.ts
│           ├── bugForwarder.ts
│           └── vibeDigest.ts
├── .bot-state/                       ← NEW, gitignored
│   ├── bug-thread-issue-map.json
│   └── last-digests.json
├── start-bot.ts                      ← NEW, PM2 entry point
└── ecosystem.config.js               ← extend to register cleo-discord-bot

server/__tests__/discord-bot/         ← NEW
└── handlers/                         ← one spec per handler + an integration test
```

### Why this shape

- Each handler is a single file, readable in one sitting, unit-testable against a mocked `discord.js` client.
- The top-level router in `index.ts` only dispatches gateway events; handlers don't reach into each other.
- `copy.ts` collects every line of user-facing prose (mirrors `docs/discord-beta-kit.md`'s "copy library" pattern) so editorial tweaks don't require touching logic.
- Bot state is small, infrequently mutated, and fits the existing filesystem-cache idiom in `server/` (`EnrichmentCache`, `FeaturedBroadcastRegistry`). JSON + atomic tmp+rename is simpler and more debuggable than introducing SQLite.

---

## 4. Feature design

### 4.1 Onboarding — `handlers/onboarding.ts`

**Trigger:** `messageReactionAdd` event on `DISCORD_START_HERE_MESSAGE_ID` with the configured emoji (default 📻 — chosen over ✅ to dodge accidental reactions).

**Logic:**
1. Fetch the reactor's `GuildMember`.
2. Idempotently grant `@Charter Listener` (no-op if already held).
3. Send the approval DM (copy from `copy.ts`, with `${TESTFLIGHT_URL}` substituted from env).

**State:** None. Discord owns the role, DMs aren't replayed on reconnect.

**Edge cases:**
- DM disabled by user → log warning, post a one-time ephemeral nudge in `#welcome` mentioning the user with the link.
- Reactor already has `@Charter Listener` → silently no-op.
- Bot's role sits below `@Charter Listener` in the hierarchy → role grant fails with a Discord 403; log error, surface in `pm2 logs`. Mitigated by the manual-setup checklist requirement to drag the bot's role above `@Charter Listener`.

### 4.2 Application review — `handlers/applicationReview.ts`

**Trigger A — buttons attach:** `messageReactionAdd` in `#apply` where the reactor *is the message author* and the emoji is 📻 (the kit's "I'm done, review me" signal). Bot replies to the post with two buttons:
- **Approve** (success/green)
- **Waitlist** (secondary/grey)

Each `customId` carries the application message ID + author ID.

**Trigger B — button press:** `interactionCreate` with one of those `customId`s.
1. Authorize: clicker must have `@Producer` or `@On-Air`. Otherwise reply ephemerally with "not authorized" and stop.
2. **Approve:** grant `@Charter Listener` to the application author, send approval DM, edit the buttons message to a footer reading `"✅ Approved by @reviewer"`, remove the buttons.
3. **Waitlist:** send waitlist DM, edit to `"⏳ Waitlisted by @reviewer"`, remove the buttons.

**State:** None. The application post itself is the record.

**Edge cases:**
- Author 📻-reacts twice → check for an existing buttons reply; no-op if found.
- Application post deleted before button click → interaction fetch fails; reply ephemerally to the reviewer and stop.
- DM-disabled author → same fallback as Onboarding (one-time ephemeral nudge in `#welcome`).

### 4.3 Vote tally — `handlers/voteTally.ts`

**Trigger:** `node-cron` at `0 0 * * *` in `America/New_York`.

**Logic:**
1. Fetch up to 24h of messages from `#tonight-on-onay`, paging through history until the cutoff is crossed.
2. Filter to messages **authored by `@Producer`** containing the 🎙 glyph (the kit's template marker).
3. For each candidate, count *unique* 🔥 reactors.
4. Compose a digest:
   ```
   🎙 LAST NIGHT'S VOTES

   • {first line of post truncated 80 chars} — {N} 🔥 — SHIP IT
   • {first line of post truncated 80 chars} — {N} 🔥 — no ship
   ```
   `SHIP IT` if N ≥ 10; `no ship` otherwise.
5. Post in `#tonight-on-onay`. If no candidates landed in the window, stay silent — no empty-digest noise.

**State:** `lastDigests.json#voteDigestAt` updated only on successful post, so a crash mid-cron doesn't burn the window.

**Edge cases:**
- Producer-authored post without 🎙 → ignored (treated as chatter).
- Same user reacts with multiple emoji on the same post → counted once for 🔥.
- Cron fires twice (e.g. PM2 restart at 00:00:30) → second run sees `voteDigestAt` is within the same calendar day in the configured timezone and skips.

### 4.4 Bug forwarder — `handlers/bugForwarder.ts`

**Trigger:** `threadCreate` event in the `#bug-reports` forum channel.

**Logic:**
1. Fetch the thread's starter message. If unavailable on first fetch, retry up to 5s (gateway sometimes delivers `threadCreate` before the message is queryable).
2. Read **all** of the thread's applied forum tags and map each to a GitHub label name: `crash` → `crash`, `audio` → `audio`, `ui` → `ui`, `bake-failure` → `bake-failure`, `onay-script` → `onay-script`, `auth` → `auth`, `other` → `other`. Multiple tags → multiple labels. Unrecognized tags are dropped. Always also apply the constant `tester-report` label, even if no tags were set.
3. Open a GitHub issue via Octokit:
   - **Repo:** `bworthy89/cleo`.
   - **Title:** thread title, truncated to 200 chars.
   - **Body:** starter message text + `\n\n---\n_Filed from Discord by @{discord-username} — [thread link]_`.
   - **Labels:** mapped tags + `tester-report`.
4. Reply once in the thread: `"Filed → bworthy89/cleo#{N}"`.
5. Persist `{ [threadId]: { issueNumber, repo } }` to `bug-thread-issue-map.json`.

**State:** `bug-thread-issue-map.json` — key on Discord thread ID so a bot restart that re-fires `threadCreate` does not double-create.

**Edge cases:**
- Thread already mapped in state with `status: "filed"` → skip silently.
- Thread already mapped with `status: "pendingManual"` → skip the auto-attempt (don't loop on a known-failing creation); a future `/retry-bug-file <threadId>` Producer-only command (deferred) can pick it up.
- GitHub API failure (after 3-attempt exponential backoff: 1s / 4s / 16s) → reply in-thread `"Couldn't file this one — Producer will pick it up manually"` and persist a `pendingManual` entry.
- Thread has no tags applied → `tester-report` is still applied (label set is never empty).
- Forum tag without a label mapping → that tag is dropped; the rest of the labels still apply.
- Issue body exceeds GitHub's 65k char limit → truncate body to 60k, append `"\n\n…(truncated)"`.

### 4.5 Vibe-pitch digest — `handlers/vibeDigest.ts`

**Trigger:** `node-cron` at `0 21 * * 0` in `America/New_York` (Sunday 21:00).

**Logic:**
1. Fetch messages in `#vibe-requests` since `lastDigests.json#vibeDigestAt` (default: 7 days ago on first run).
2. Tally unique 🔥 reactors per message.
3. Compose the digest:
   ```
   🔥 THIS WEEK'S VIBE PITCHES

   1. {N} 🔥 — @{author}: "{first line, 100 char excerpt}" → {jump link}
   2. ...
   3. ...

   Honorable mentions:
   • @{author}: "{first line excerpt}"
   • ...
   ```
   - **Top 3** by 🔥 count, with vote count, excerpt, and Discord jump link.
   - **Honorable mentions:** flat list of every other message that received ≥1 🔥 in the window, just `@author` + first-line excerpt.
4. Post in `#vibe-requests`. Empty window → skip the post entirely.

**State:** `lastDigests.json#vibeDigestAt` updated only on successful post.

**Edge cases:**
- Tied 🔥 counts in the top 3 → break ties by older message first (rewards early pitchers).
- Message author left the server between pitching and digest → render as `@former-listener` with no jump link.

---

## 5. Configuration & secrets

All bot configuration lives in `server/.env` (already gitignored, already loaded by the broadcast server). Bot-specific keys:

```env
# Discord
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
DISCORD_TESTFLIGHT_URL
DISCORD_CHANNEL_START_HERE
DISCORD_CHANNEL_APPLY
DISCORD_CHANNEL_BUG_REPORTS         # forum channel
DISCORD_CHANNEL_TONIGHT_ON_ONAY
DISCORD_CHANNEL_VIBE_REQUESTS
DISCORD_CHANNEL_WELCOME             # for the DM-disabled fallback nudge
DISCORD_ROLE_PRODUCER
DISCORD_ROLE_ON_AIR
DISCORD_ROLE_CHARTER_LISTENER
DISCORD_START_HERE_MESSAGE_ID
DISCORD_START_HERE_EMOJI=📻
DISCORD_TIMEZONE=America/New_York

# GitHub
GITHUB_TOKEN                        # fine-grained PAT, repo access on bworthy89/cleo
GITHUB_BUG_REPO=bworthy89/cleo
GITHUB_BUG_LABEL=tester-report
```

`config.ts` parses these once on boot via Zod, throws fast on missing/invalid values so PM2 fails-loud rather than running half-configured. After parsing, the boot sequence resolves channel/role IDs against the configured guild; any unresolved ID exits the process with a structured error naming the missing piece.

**State files** (`server/.bot-state/`, gitignored, atomic tmp+rename + 50ms debounce):
- `bug-thread-issue-map.json` — `{ "<threadId>": BugEntry }` where:
  - **Success entry:** `{ "status": "filed", "issueNumber": 142, "repo": "bworthy89/cleo", "filedAt": "2026-04-29T...Z" }`
  - **Manual-fallback entry** (3 GitHub retries failed): `{ "status": "pendingManual", "repo": "bworthy89/cleo", "lastErrorAt": "2026-04-29T...Z" }` (no `issueNumber` until a manual retry succeeds, at which point the entry flips to `status: "filed"`)
- `last-digests.json` — `{ "voteDigestAt": "2026-04-29T04:00:00Z", "vibeDigestAt": "2026-04-26T01:00:00Z" }`

`BotStateStore`'s API:
- `read<T>(filename, defaultValue): T`
- `write<T>(filename, value): Promise<void>` — atomic, debounced.

No new secrets in committed files. Deploy adds one PM2 step to `server/DEPLOY.md`.

---

## 6. Error handling & observability

**Logging.** `pino` JSON output. PM2 writes to `~/.pm2/logs/cleo-discord-bot-{out,error}.log`. Every log line carries `{ handler, event, actorId?, targetId? }` so triage doesn't need grep gymnastics.

**Discord-side failures.** `discord.js` v14 auto-reconnects gateway drops. The bot subscribes to `Client.error` and `Client.shardError` and logs at `warn`; nothing is fatal at the gateway level except invalid token, which is allowed to crash so PM2's `--max-restarts` cap surfaces it instead of looping silently. Per-handler errors are caught at the dispatch boundary in `index.ts` (one `try/catch` per gateway event) — a thrown handler logs at `error` and the bot keeps running.

**GitHub-side failures.** `bugForwarder` wraps `octokit.rest.issues.create` in a 3-attempt exponential backoff (1s / 4s / 16s). All-three-fail path replies in-thread with the manual-fallback copy and persists `pendingManual: true`. Octokit's `throttling` plugin is wired in defensively to handle GitHub's secondary rate limits.

**Cron failures.** `voteTally` and `vibeDigest` wrap their work in try/catch. `lastDigestAt` updates only on success, so a crash mid-cron doesn't burn the window.

**Restart safety.** No event replay (Discord doesn't offer it). Idempotency comes from:
- Bug forwarder: `bug-thread-issue-map.json` dedupe.
- Onboarding: role grant is naturally idempotent; reactions don't replay on reconnect.
- Application review: bot checks for an existing buttons reply before re-attaching.
- Crons: `lastDigestAt` guard prevents same-window re-post.

**Health surface.** No HTTP endpoint. Bot logs a structured `bot.heartbeat` line every 60s with `{ guildMembers, gatewayLatencyMs, lastEventAt }`. PM2 + journal is the dashboard for v1.

---

## 7. Testing strategy

**Unit tests** in `server/__tests__/discord-bot/handlers/`, one spec per handler, mocking `discord.js` via `jest.mock('discord.js')`. Coverage targets:

- **`onboarding`** — 📻 reaction grants role + DMs; already-Charter no-ops; DM-disabled fallback nudges in `#welcome`.
- **`applicationReview`** — author 📻 attaches buttons exactly once; non-Producer button-click rejected ephemerally; Approve grants role + DMs + edits; Waitlist DMs + edits; deleted-post path replies ephemerally.
- **`voteTally`** — filters to Producer-authored 🎙 posts; deduplicates the same user reacting with multiple emoji; ship/no-ship at 10; empty window stays silent; same-day re-fire skips.
- **`bugForwarder`** — thread-create opens issue with mapped tags + `tester-report`; replies in-thread; second `threadCreate` with state map populated does not re-create; GitHub failure triggers manual-fallback copy + `pendingManual: true`; oversized body truncated.
- **`vibeDigest`** — top-3 ranking; tie-break by older message first; honorable mentions filter to ≥1 🔥; empty window skips post.

**Integration test** — one happy-path test against a tmp-dir `BotStateStore` and a `nock`-mocked GitHub API: file a bug thread, verify the state file, re-fire `threadCreate` for the same thread, verify no second API call.

**No live Discord in CI.** Gateway connection is fully mocked. A separate manual smoke test on a private "Booth Dev" guild runs before each PM2 deploy: react 📻 on `#start-here`, verify role + DM; post a `#bug-reports` thread, verify the issue lands; click an Approve button as a non-Producer account, verify rejection. Documented as a checklist in `server/DEPLOY.md`.

**Not tested.** Discord's actual rate-limit responses, gateway reconnect timing, GitHub's secondary rate-limit responses. Mocking those well costs more than the bugs they'd catch — covered by the dev-guild smoke test.

---

## 8. Manual setup checklist

To be added to `server/DEPLOY.md` so bot setup is co-located with broadcast-server deploy steps.

### 8.1 Create the Discord application
- discord.com/developers → New Application → name **"The Producer"**.
- Bot tab → Reset Token → copy → `server/.env` as `DISCORD_BOT_TOKEN`.
- Bot tab → enable **Server Members Intent** + **Message Content Intent** (privileged intents required for role grants and reading thread starter messages).
- General Information tab → upload bot avatar. Recommend a desaturated/silhouette variant of the gold orb so the bot reads as ops, distinct from the booth's main server icon.

### 8.2 Invite the bot to The ONAY Booth
- OAuth2 → URL Generator. Scopes: `bot` + `applications.commands`. Permissions: `Manage Roles`, `Send Messages`, `Send Messages in Threads`, `Add Reactions`, `Read Message History`, `Use Application Commands`.
- Open the generated URL → select "The ONAY Booth" → authorize.
- In the booth: drag the bot's auto-created `@The Producer` role *above* `@Charter Listener` in the role hierarchy. Discord requires a role to be higher than the role it grants.

### 8.3 Capture IDs
- Discord Settings → Advanced → enable Developer Mode.
- Right-click each channel listed in §5 → Copy ID → paste into `server/.env`.
- Right-click each role → Copy ID → paste.
- Right-click the pinned `#start-here` post → Copy ID → into `DISCORD_START_HERE_MESSAGE_ID`.

### 8.4 Mint the GitHub PAT
- github.com/settings/tokens → Fine-grained PAT.
- Repository access: **`bworthy89/cleo` only**.
- Repository permissions: `Issues: read+write`, `Metadata: read`.
- Copy → `server/.env` as `GITHUB_TOKEN`.
- Pre-create the `tester-report` label on `bworthy89/cleo` so you can pick its color (the bot will create it on first use otherwise).

### 8.5 Deploy
- Merge bot code to main → `ssh cleo@187.124.69.95` → `cd /home/cleo/cleo-broadcast && git pull && npm install`.
- Register with PM2: `pm2 start ecosystem.config.js --only cleo-discord-bot` (first time) or `pm2 reload cleo-discord-bot` (subsequent).
- Tail: `pm2 logs cleo-discord-bot`. Watch for the `bot.ready` log line confirming gateway connect + ID resolution.

### 8.6 Smoke-test on a dev guild before flipping live
- Create a private "Booth Dev" guild that mirrors the channel/role layout.
- The bot can be invited to both; `DISCORD_GUILD_ID` in `.env` decides which it operates against.
- Run the manual smoke checklist (react 📻, file a fake bug, click an Approve button) on Booth Dev before pointing at production.

---

## 9. Phase 2 outlook

The handler-per-feature shape lets phase 2 land as additions, not refactors:

- **Mod log** (`handlers/modLog.ts`) — `messageDelete`, `messageUpdate`, `guildMemberAdd`, `guildMemberRemove`, `guildMemberRoleAdd` → structured embeds in `#mod-log`. Pure read-side, no state. ~1 day.
- **Featured-broadcast announcer** (`handlers/featuredAnnouncer.ts`) — first feature that calls the broadcast server. Polls `GET /broadcast/featured` every N minutes (or accepts a webhook from the broadcast server when wired), diffs against `state.lastFeaturedIds`, posts the kit's `#tonight-on-onay` template per new entry. New env vars: `BROADCAST_API_URL`, optional `BROADCAST_API_TOKEN`. ~2 days.
- **EAS build watcher** (`handlers/buildWatcher.ts`) — subscribes to EAS build webhooks, receives `build.completed` for the production iOS profile, posts the kit's build-announcement template in `#testflight-builds`. Needs an HTTP listener — first time the bot exposes a port (single-route Express, signed-payload verification per EAS spec, internal-only). ~2 days.

---

## 10. Open follow-ups (non-blocking)

1. **Avatar asset.** The desaturated/silhouette orb needs a concrete PNG (≥512×512). If `OnayCharacter.tsx` exports SVG paths, render the server icon and bot avatar from one pipeline. ~30-min chore the day before launch.
2. **TestFlight URL rotation.** Hardcoded in env for v1; rotation = `.env` edit + `pm2 restart`. Phase 2 candidate: pull from broadcast server at DM time so rotation is a runtime config change.
3. **GitHub PAT renewal.** Fine-grained PATs expire (max 1 year). Calendar a renewal reminder for ~11 months out and write the procedure into `server/DEPLOY.md`.

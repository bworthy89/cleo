# SQLite Migration Design

**Status:** Approved — ready for implementation plan.
**Author:** Captured from analysis on `claude/analyze-beta-testing-plan-QEqqM`.
**Date:** 2026-05-01.
**Decisions:** Raw `better-sqlite3` (no ORM). R2 backups under `cleo-broadcast-backups`. Typed payloads in TS, freeform `payload_json` in DB.

---

## Problem

The broadcast server has four distinct state stores, each implemented in a different way, none of them durable:

1. **`BroadcastStore`** (`server/src/services/broadcast/BroadcastStore.ts`) — `new Map<string, Manifest>()` with 24h lazy eviction. Every active bake, every in-flight manifest, every just-completed broadcast lives only in process memory.
2. **`EnrichmentCache`** (`server/src/services/enrichment/EnrichmentCache.ts`) — JSON file at `.enrichment-cache/tracks.json`, full-file rewrite on every `set()`, atomic tmp+rename, malformed-JSON tolerant.
3. **`FeaturedBroadcastRegistry`** (`server/src/services/broadcast/FeaturedBroadcastRegistry.ts`) — JSON file at `featured-broadcasts/registry.json`, same shape as above.
4. **`CuratorPublishBudget`** (`server/src/services/curator/CuratorPublishBudget.ts`) — `Map<uid, timestamp[]>` with lazy pruning on read; resets on process restart.

The orchestrator also keeps two pieces of process-local coordination state that aren't "stores" but interact with the same lifecycle:

- `inFlight: Map<string, Promise<void>>` — tracks background-bake completion (`BroadcastOrchestrator.ts:56`).
- `aborted: Set<string>` — cancellation flags (`BroadcastOrchestrator.ts:63`).

Consequences of the current model:

- `pm2 restart` mid-bake loses every active broadcast silently. The client polls a now-404 manifest until `BroadcastResumer.check()` clears the persisted record.
- The Phase 2 retention gate ("D1 → D7 retention measurably improved") cannot be evaluated. There is no persistent log of which user did what when. `BroadcastStore` expires in 24h; nothing else records user activity at all.
- `bake_status='completed'` is reported by telemetry even when every slot in the background bake failed (`BroadcastOrchestrator.ts:259-262`). The orchestrator's `.then()` resolves successfully because `generateSlotsBackground` swallows per-slot errors. With no queryable history, this bug is invisible.
- Backups of the JSON-file stores require coordinating with the atomic-rename writer; a `tar` of the directory mid-write can capture a half-state.

The fix is one SQLite file holding all four stores, plus a new `app_events` table for retention measurement.

---

## What this replaces

| Today | After |
|---|---|
| `BroadcastStore.entries` (Map) | `broadcasts` + `broadcast_slots` tables |
| `EnrichmentCache.data` (JSON file) | `enrichment` table |
| `FeaturedBroadcastRegistry.records` (JSON file) | `featured_broadcasts` table |
| `CuratorPublishBudget.entries` (Map) | `curator_publishes` table |

## What this does not replace

- **`inFlight: Map<string, Promise<void>>`** — Promises cannot be persisted. SQLite *can* persist a `bake_status='baking'` flag that survives restarts; the boot sweep flips any `'baking'` rows to `'failed'` because their owning process is gone.
- **`aborted: Set<string>`** — kept as a fast in-memory mirror of the new `abort_requested` column. The DB is the source of truth (so abort signals survive restarts and could be issued out-of-band by an admin tool); the Set avoids a per-iteration DB read in the worker loop.
- **R2 segment storage.** Already cloud-native, already correct.
- **Firestore Last.fm session keys.** Auth secrets benefit from Firestore's `allow write: if false` security rules. Stay where they are.
- **TTS filesystem cache** at `~/.cache/cleo-tts`. Large MP3 blobs; filesystem is the right place.
- **`SequenceCache`** (LLM-only, in-memory LRU). The LLM sequencer path is on its way out per the deterministic-sequencer soak; not worth migrating.

## What this newly enables

1. **D1 → D7 retention measurement.** The Phase 2 gate. A new `app_events` table indexed on `(user_id, occurred_at)` makes cohort queries one SELECT.
2. **Honest bake completion status.** Slot states become queryable rows. `bake_status` aggregates from per-slot status: `healthy` if all `ready`, `degraded` if any `failed`, `failed` if `cold_open` failed. The current "all slots failed but bake reports completed" bug becomes a one-line fix.
3. **Real backups.** `sqlite3 cleo.db ".backup ..."` is a one-line cron job. One file, one snapshot, no race with atomic-rename writers.
4. **Admin queries.** Existing `/admin/*` routes currently tail PM2 logs (`server/src/routes/admin.ts`). With rows, the admin surface can show recent bakes, failure rates per vibe, curator activity, top-failing TTS providers. See the **Admin surface** section below for concrete endpoint sketches and the deliberate decision to stay JSON-only at first.
5. **Crashed-bake recovery.** Boot-time sweep marks abandoned `'baking'` rows as `'failed'` and `pending` slots as `'aborted'`. Today these vanish; tomorrow the client gets a meaningful manifest state.

---

## Schema

One file: `server/.broadcast-cache/cleo.db`. WAL journal mode. `better-sqlite3` driver (synchronous, single-process — fits the orchestrator's existing model). No ORM — raw `db.prepare(...)` everywhere. Schema lives in `server/src/services/db/schema.sql`, applied idempotently via `IF NOT EXISTS` at boot. Drizzle / umzug get adopted when the second schema change lands; not before.

```sql
-- Replaces BroadcastStore.entries
CREATE TABLE broadcasts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  vibe            TEXT NOT NULL,
  length          TEXT NOT NULL,          -- 'quick' | 'standard' | 'long'
  playlist_id     TEXT,                   -- nullable (curator broadcasts)
  created_at      INTEGER NOT NULL,       -- ms epoch
  bake_status     TEXT NOT NULL,          -- 'baking' | 'completed' | 'degraded' | 'failed' | 'aborted'
  abort_requested INTEGER NOT NULL DEFAULT 0,  -- boolean: 0 = false, 1 = true
  manifest_json   TEXT NOT NULL           -- full Manifest blob, source of truth for shape
);
CREATE INDEX idx_broadcasts_user_created ON broadcasts(user_id, created_at DESC);
CREATE INDEX idx_broadcasts_bakestatus  ON broadcasts(bake_status, created_at);

CREATE TABLE broadcast_slots (
  broadcast_id    TEXT NOT NULL,
  slot_index      INTEGER NOT NULL,
  status          TEXT NOT NULL,          -- 'pending' | 'ready' | 'failed' | 'aborted'
  audio_urls_json TEXT,                   -- nullable until ready
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (broadcast_id, slot_index),
  FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
);

-- Replaces .enrichment-cache/tracks.json
CREATE TABLE enrichment (
  track_key       TEXT PRIMARY KEY,       -- normalizeKey(title, artist)
  data_json       TEXT NOT NULL,          -- EnrichmentRecord blob
  fetched_at      INTEGER NOT NULL,       -- enables 30-day re-enrichment query
  source          TEXT NOT NULL           -- denormalized for admin queries
);
CREATE INDEX idx_enrichment_fetched ON enrichment(fetched_at);

-- Replaces featured-broadcasts/registry.json
CREATE TABLE featured_broadcasts (
  id              TEXT PRIMARY KEY,
  slot            TEXT,                   -- 'morning' | 'evening' | NULL (legacy)
  theme_day       TEXT,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  vibe            TEXT NOT NULL,
  length          TEXT NOT NULL,
  artwork_url     TEXT,
  baked           INTEGER NOT NULL,       -- 0 | 1
  created_at      INTEGER NOT NULL,
  manifest_json   TEXT NOT NULL
);
CREATE INDEX idx_featured_slot_baked ON featured_broadcasts(slot, baked);

-- Replaces CuratorPublishBudget.entries
CREATE TABLE curator_publishes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  curator_uid     TEXT NOT NULL,
  published_at    INTEGER NOT NULL,
  broadcast_id    TEXT                    -- nullable; for forensics
);
CREATE INDEX idx_curator_uid_time ON curator_publishes(curator_uid, published_at);

-- New: retention measurement (Phase 2 gate unlock)
CREATE TABLE app_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  event_type      TEXT NOT NULL,          -- 'app_open' | 'broadcast_started' | 'broadcast_completed' | 'broadcast_failed' | 'track_completed'
  occurred_at     INTEGER NOT NULL,
  broadcast_id    TEXT,                   -- nullable
  payload_json    TEXT
);
CREATE INDEX idx_events_user_time ON app_events(user_id, occurred_at);
CREATE INDEX idx_events_type_time ON app_events(event_type, occurred_at);
```

### Schema decisions worth flagging

- **Hybrid `manifest_json` + `broadcast_slots`.** Manifests are mostly read whole; slots are independently mutated. Storing the manifest as a JSON blob keeps the existing `Manifest` type (`server/src/services/broadcast/types.ts:66`) as the in-memory contract. `broadcast_slots` makes per-slot updates cheap and queryable. `BroadcastStore.get()` reads the manifest blob and overlays current slot states from the slot table.
- **`bake_status` and `abort_requested` are columns, not tables.** Collapses `inFlight: Map` and `aborted: Set` into one place that survives restarts. Both stay as in-memory mirrors for hot-path checks; the DB is the source of truth.
- **`attempt_count` on slots.** Not used immediately. Present so the retry-with-backoff fix the orchestrator badly needs becomes a one-line UPDATE rather than a schema change.
- **No migration framework day one.** Schema lives in `server/src/services/db/schema.sql`, applied idempotently via `IF NOT EXISTS`. When the second migration is needed, bring in Drizzle Kit or umzug. Don't over-tool now.

---

## The `Db` service

One thin wrapper, one connection per process:

```ts
// server/src/services/db/Db.ts (sketch)
export class Db {
  private readonly db: Database;  // better-sqlite3 instance
  constructor(filePath: string) {
    try {
      this.db = new Database(filePath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.exec(readSchemaSql());
      this.markCrashedBakes();  // bake_status='baking' → 'failed'
    } catch (err) {
      // Close the handle if it opened before a later step threw; otherwise
      // we leak file descriptors and the DB stays locked across restarts.
      try { this.db?.close(); } catch { /* ignore */ }
      throw new DbBootError(filePath, err);
    }
  }
  prepare<T>(sql: string): Statement<T> { ... }
  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }
  close(): void { this.db.close(); }
}
```

**Boot-time error policy.** Each step inside the constructor has a distinct failure mode and each one must abort startup with an actionable message — never partial-init a half-broken DB:

- `new Database(filePath)` — file I/O / permissions / disk full. Wrap in try/catch, log `db.boot.open`, rethrow.
- `pragma('journal_mode = WAL')` — fails if the file lives on a filesystem without WAL support (rare; some network mounts). Log `db.boot.wal`, rethrow.
- `db.exec(schema)` — schema syntax errors are programmer mistakes, not transient; fail loud and refuse to start.
- `markCrashedBakes()` — its own UPDATE; errors propagate. Treat its successful completion as a precondition for serving traffic. The HTTP listener should be bound *after* `new Db(...)` returns, not in parallel.

Transient I/O is not retried in the constructor. The right scope for retry is the wrapping process supervisor (PM2 already restarts on failure with backoff). Logic-level errors deserve a fast, loud failure with a `DbBootError` that names the failing step in its message.

Constructed once in `server/src/index.ts`. Injected into the four stores and the new `EventRecorder`. Tests build `new Db(':memory:')` — SQLite's in-memory mode means tests don't touch disk and every test gets a clean DB.

## Per-store rewrites — interfaces stay, internals change

The contract for each store stays the same, which is the whole point. The orchestrator and routes don't change.

### `BroadcastStore`

Same five methods: `put`, `get`, `updateSlot`, `markPendingSlotsAborted`, `size`.

- `put(manifest)` — single transaction: INSERT into `broadcasts` + INSERT N rows into `broadcast_slots`.
- `get(id)` — JOIN that returns the manifest with current slot states overlaid. The `structuredClone` calls (`BroadcastStore.ts:13, 23`) disappear; SQLite returns fresh objects naturally.
- `updateSlot(id, idx, patch)` — single UPDATE on `broadcast_slots`.
- `markPendingSlotsAborted(id)` — single UPDATE: `WHERE broadcast_id=? AND status='pending'`. Atomic; today's loop (`BroadcastStore.ts:42-48`) is not.
- `size()` — `SELECT COUNT(*) FROM broadcasts`.

### `EnrichmentCache`

Same `load()` / `get()` / `set()` API.

- `load()` becomes a no-op. The table is the cache.
- `get(title, artist)` — `SELECT data_json WHERE track_key = ?`.
- `set(title, artist, record)` — `INSERT OR REPLACE`.
- The flushQueue serialization (`EnrichmentCache.ts:45, 72-74`) goes away. SQLite handles concurrent writes via WAL.

### `FeaturedBroadcastRegistry`

Same `load()` / `put()` / `remove()` / `list()` / `getBySlot()` API.

- `list()` — `SELECT … WHERE baked = 1 ORDER BY CASE slot WHEN 'morning' THEN 0 WHEN 'evening' THEN 1 ELSE 2 END, created_at DESC`. Replaces the hand-rolled rank ordering at `FeaturedBroadcastRegistry.ts:60-65`.
- All others map to obvious row operations.

### `CuratorPublishBudget`

Same `tryReserve(uid)` → `ReserveResult`.

```ts
const cutoff = now - this.windowMs;
const { n } = this.db.prepare(
  'SELECT COUNT(*) AS n FROM curator_publishes WHERE curator_uid=? AND published_at > ?'
).get(uid, cutoff);
if (n >= this.cap) {
  // figure out oldest in-window for retryAfter, return { ok: false, ... }
}
this.db.prepare(
  'INSERT INTO curator_publishes (curator_uid, published_at) VALUES (?, ?)'
).run(uid, now);
return { ok: true };
```

The lazy on-read pruning (`CuratorPublishBudget.ts:38`) is replaced by a once-a-day cleanup query. Not strictly necessary; rows are tiny.

---

## `EventRecorder` — the new piece

```ts
// server/src/services/events/EventRecorder.ts (sketch)
type AppEventPayloads = {
  app_open:             { appVersion: string; platform: 'ios' | 'android'; buildNumber: number };
  broadcast_started:    { vibe: Vibe; length: BroadcastLength; source: 'user' | 'featured' };
  broadcast_completed:  { durationMs: number; segmentsPlayed: number };
  broadcast_failed:     { slotIndex: number; provider: string; errorCategory: string };
  track_completed:      { trackIndex: number; wasSkipped: boolean; listenedMs: number };
};
export type EventType = keyof AppEventPayloads;

export class EventRecorder {
  constructor(private db: Db) {}
  record<T extends EventType>(
    userId: string,
    type: T,
    payload: AppEventPayloads[T],
    opts?: { broadcastId?: string }
  ): void {
    this.db.prepare(`
      INSERT INTO app_events (user_id, event_type, occurred_at, broadcast_id, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, type, Date.now(), opts?.broadcastId ?? null, JSON.stringify(payload));
  }
}
```

Payload shape is enforced by the type system at every call site; the DB column stays freeform `TEXT` so adding a field is a one-line type-map edit and never requires a migration. Admin queries that aggregate on payload fields (`/admin/tts/failures`) read via `json_extract(payload_json, '$.provider')`. If a particular field becomes hot enough to warrant indexing, promote it to a real column then.

Wired into:

- `BroadcastOrchestrator.create` — `broadcast_started` at the top of `try`, `broadcast_completed` / `broadcast_failed` in the success and catch paths.
- `app_open` — piggyback on `GET /broadcast/featured`. The home screen hits it on every cold launch, so adding the recorder call inside the route handler costs zero new routes and zero new client work. (No standalone `POST /events/app-open` — keep the surface tight; revisit only if a flow ever lands a user past auth without touching `/broadcast/featured`.)
- Optional later: client-side `track_completed` reports.

D1 → D7 retention becomes:

```sql
WITH cohort AS (
  SELECT user_id, MIN(occurred_at) AS d0
  FROM app_events
  GROUP BY user_id
)
SELECT
  COUNT(DISTINCT c.user_id) AS d0_users,
  COUNT(DISTINCT CASE WHEN e.occurred_at BETWEEN c.d0 + 86400000 AND c.d0 + 172800000 THEN c.user_id END) AS d1_returners,
  COUNT(DISTINCT CASE WHEN e.occurred_at BETWEEN c.d0 + 604800000 AND c.d0 + 691200000 THEN c.user_id END) AS d7_returners
FROM cohort c LEFT JOIN app_events e ON e.user_id = c.user_id;
```

---

## Admin surface

### Today

The admin surface is two endpoints, both in `server/src/routes/admin.ts`:

- `GET /admin/logs?stream=out|err|all&user=<sub>&id=<short>&lines=<n>` — text/plain tail of PM2's `out.log` / `error.log` with substring filtering. Operator-friendly (paste into a browser URL bar).
- `GET /admin/status` — JSON snapshot: uptime, memory (RSS / heap / external), `BroadcastStore.size()`, `orchestrator.inFlightCount`, provider health (`llm.getStatus()` / `tts.getStatus()`), log file sizes.

Auth is two-path via `adminGate()` (`admin.ts:135-157`): `X-Admin-Token` header against `ADMIN_BEARER_TOKEN` env (≥16 chars), or Firebase JWT + curator allowlist. There is no HTML, no static assets, no client UI.

The endpoints today can answer "what is the server doing right now" but not "what has happened." Anything historical requires `grep` on PM2 output.

### After the migration

The same `adminGate` chain protects a new family of SQL-backed endpoints. Each is 5-15 lines of route handler over a prepared statement. JSON-only — no HTML — so the curl/browser-bar workflow already in use stays primary.

```text
GET /admin/bakes?status=failed&since=<ms>&limit=<n>
  -> [{ id, user_id, vibe, length, created_at, bake_status, slot_summary }]
  SQL: SELECT b.*, json_group_array(json_object('idx', s.slot_index, 'status', s.status))
       FROM broadcasts b LEFT JOIN broadcast_slots s ON s.broadcast_id = b.id
       WHERE b.created_at > ? AND b.bake_status = ?
       GROUP BY b.id ORDER BY b.created_at DESC LIMIT ?

GET /admin/bakes/:id
  -> { broadcast, slots, events }
  Joins broadcasts, broadcast_slots, and app_events for one bake.
  The "what happened to this user's bake" deep-dive that today requires
  grep over PM2 logs by short id.

GET /admin/users/:uid/activity?since=<ms>
  -> { app_opens, broadcasts_created, broadcasts_completed, broadcasts_failed, last_seen_at }
  One user's recent activity. Useful when a tester reports a bug —
  paste their uid and see what they actually did.

GET /admin/retention?cohort_days=<n>
  -> { d0_users, d1_returners, d7_returners, d1_pct, d7_pct }
  The Phase 2 gate query, cached at 5min TTL. Same SQL as the
  EventRecorder section; rendered as a single-row JSON.

GET /admin/curators/:uid/publishes?since=<ms>
  -> [{ broadcast_id, published_at, title, vibe }]
  Per-curator publish history. Replaces "trust the in-memory counter,"
  enables the curator-facing "what have I published" view if it ever
  ships in-app.

GET /admin/featured
  -> [{ id, slot, theme_day, baked, created_at, manifest_summary }]
  Admin view of the featured registry, including drafts (baked=0).
  Today this data is only readable via /broadcast/featured, which
  filters to baked=1 and returns full manifests.

GET /admin/tts/failures?since=<ms>
  -> [{ provider, count, sample_errors[3] }]
  Aggregated from app_events where event_type='broadcast_failed' and
  payload_json carries the failing provider tag. Surfaces "ElevenLabs
  has been 503-ing for the last hour" without reading logs.
```

`/admin/status` gains two fields it can't have today: `broadcast.bakes_today`, `broadcast.failed_today`. Both are one-row counts.

### Why JSON-only first

A web dashboard is a feature, not a foundation. Before building one:

- The audience is one operator and a handful of curators. Curl is enough for the operator; curators don't need a separate portal (see below).
- The data shapes will shift as the team learns what questions matter. Locking them into a UI early calcifies the wrong layout.
- A Postman collection or shell-script wrapper around these endpoints gives 80% of dashboard value at 5% of the cost.

Build the HTML dashboard later — and only — when the operator finds themselves writing the same curl invocation three times. At that point the endpoints already exist; the HTML is purely a presentation layer.

### What's deliberately not in this scope

- **HTML dashboard / SPA admin.** Deferred. Two-to-three-day effort once the JSON endpoints exist; not blocking.
- **In-app curator surface.** The "your published broadcasts" view — letting curators see their own publish history and featured-broadcast performance from inside the React Native app — is a product feature, not an admin tool. It uses the same SQLite tables but talks to a different (curator-scoped, non-`/admin/`) route. Belongs in a separate spec.
- **Off-the-shelf SQL browsers** (`datasette`, `sqlite-web`). Tempting because they're free, but they sit outside the existing auth model, expose schema-level mutation, and would need a separate port or SSH tunnel. Not worth the integration friction at this scale.
- **Cost / token-spend telemetry.** Provider cost per bake is not in `app_events` today; capturing it requires plumbing through `SegmentGenerator` and the TTS providers. Worth doing, but separate work.

---

## Generation-transparency guarantee

The migration must not change how broadcasts are generated. Verifying this is structural, not a hope:

The generation pipeline touches storage at exactly these call sites:

- `store.put(manifest)` — once, after sequencing + manifest building (`BroadcastOrchestrator.ts:202`).
- `store.updateSlot(id, idx, { status, audioUrls })` — once per slot, on success or failure (`BroadcastOrchestrator.ts:383, 393`).
- `store.get(id)` — to read back the manifest after slot-0 completes (`BroadcastOrchestrator.ts:278`); also from `/broadcast/:id/manifest` polling.
- `store.markPendingSlotsAborted(id)` — only on `DELETE /broadcast/:id` (`BroadcastOrchestrator.ts:324`).
- `enrichmentCache.get(title, artist)` — read-only, inside `SegmentScriptBuilder.buildSegmentPrompts`.

That is the entire surface. None of the actual generation logic — sequencing, manifest construction, prompt building, LLM calls, TTS calls, worker concurrency, slot cadence, weather injection — touches storage. The orchestrator treats `BroadcastStore` and `EnrichmentCache` as opaque persistence; what's behind the interface is irrelevant to what gets generated.

Specific guarantees:

1. **The `Manifest` wire format is unchanged.** `bake_status` and `abort_requested` are server-internal columns; they are not added to the `Manifest` interface (`types.ts:66`). The JSON returned by `/broadcast/:id/manifest` is byte-identical.
2. **Sequencing determinism is preserved.** `DeterministicTrackSequencer`'s PRNG is seeded on `broadcastId`, generated before any storage call. Same input → same output.
3. **`updateSlot` semantics are preserved.** Today: `Object.assign(slot, patch)` on the in-memory object. Tomorrow: a single `UPDATE` row. The next `get()` returns the latest state either way. No worker can race itself — each slot index is owned by exactly one worker (`BroadcastOrchestrator.ts:347-348`).
4. **`structuredClone` already gave callers fresh objects.** The orchestrator never relies on reference identity across reads. SQLite returns fresh objects naturally; same contract.

The **one** new behavior introduced by the migration is the boot-time crashed-bake sweep — `UPDATE broadcasts SET bake_status='failed' WHERE bake_status='baking'` on startup. This only runs on server boot, only affects bakes whose owning process died mid-flight (which today silently vanish anyway), and the visible client effect is "manifest exists at `/broadcast/:id/manifest` with non-pending slots" instead of "404." The existing `BroadcastResumer.check()` handles that state correctly.

### Tests that lock this in

- **Generation invariant test:** run the existing bake test suite against both the old in-memory store and the new SQLite store, assert manifests are deep-equal under both backends.
- **Wire-format snapshot:** snapshot the JSON returned by `GET /broadcast/:id/manifest` before and after migration, assert no diff.

---

## Boot-time backfill

One-shot script: `server/src/scripts/backfill-sqlite.ts`. Reads `enrichment-cache/tracks.json` and `featured-broadcasts/registry.json`, writes rows. Idempotent (`INSERT OR IGNORE`). Run once on the VPS during the deploy window.

`BroadcastStore` and `CuratorPublishBudget` have nothing to backfill — both were process-memory.

### `.bak` retention and verification gating

After backfill completes, rename the source JSON files to `.bak`:

- `server/.enrichment-cache/tracks.json` → `tracks.json.bak`
- `server/featured-broadcasts/registry.json` → `registry.json.bak`

**Retention policy:** keep `.bak` files for **at least 7 days, or one full release cycle** (whichever is longer). They are the only on-disk fallback if a SQLite-side bug surfaces post-deploy and the new tables need to be rebuilt. Don't delete on the same deploy that creates them.

**Verification steps required before deletion:**

1. Re-run `backfill-sqlite.ts` against the live DB and confirm row count matches the JSON-file key count for both `enrichment` and `featured_broadcasts`. Idempotent inserts must produce zero new rows on the second run.
2. Spot-check 5 random `enrichment` rows: query SQLite by `track_key`, parse `data_json`, deep-equal compare to the corresponding entry in `tracks.json.bak`. Any mismatch blocks deletion.
3. Spot-check every `featured_broadcasts` row (the set is small): SELECT, parse `manifest_json`, deep-equal compare to `registry.json.bak`'s `records[]` entry by `id`.
4. Run a real bake end-to-end against the SQLite-backed `BroadcastStore` (smoke-bake script) and confirm `bake_status` reaches `completed` and all slots are `ready`. Confirms `BroadcastStore` works without falling back to anything.
5. Trigger a `CuratorPublishBudget.tryReserve` from a curator account and confirm a row lands in `curator_publishes`. Confirms the budget store works against SQLite.
6. After all five pass and 7+ days have elapsed since rename, delete the `.bak` files in a single commit titled "remove sqlite-migration .bak fallbacks."

**Ownership:** the operator who ran the backfill is responsible for deletion. If a different person is running the post-deploy verification, they own steps 1-5 and must hand off step 6 explicitly.

**Revert path:** if any verification step fails, restore by renaming `tracks.json.bak` → `tracks.json` and `registry.json.bak` → `registry.json`, then revert the deploy that swapped `EnrichmentCache` / `FeaturedBroadcastRegistry` to their SQLite-backed implementations. The SQLite tables can be left in place; the old JSON-backed stores ignore them.

---

## Test impact

Smaller than it looks. Most server tests use `BroadcastOrchestrator.makeWithDefaults()` (`BroadcastOrchestrator.ts:102`), which constructs a `new BroadcastStore()` internally. Change one line there to `new BroadcastStore(new Db(':memory:'))` and most tests pass unchanged.

Files that need rewriting:

- `BroadcastStore.test.ts` — direct unit tests of the in-memory Map. Rewrite for SQLite. Probably gain coverage (persistence across instances, the boot-time crashed-bake recovery).
- `EnrichmentCache.test.ts` and `EnrichmentCache.extended.test.ts` — same pattern.
- `FeaturedBroadcastRegistry` has no direct test file; it's exercised via `featured.test.ts` and `bakeFeatured.test.ts`, which should pass unchanged once the registry is wired through.

Net: roughly four test files rewritten, 30-60 lines each.

---

## Sequencing

**Phase 0 — scaffold (half day).** Add `better-sqlite3`, create the `Db` class, write `schema.sql`, write a boot test that proves the schema applies cleanly. No store changes.

**Phase 1 — `BroadcastStore` migration (one day).** Smallest API surface, biggest payoff. Migrate the store, update `makeWithDefaults`, run the test suite, fix breakage. Orchestrator code does not change. End of phase: bakes survive restarts.

**Phase 2 — the other three stores (one day).** `EnrichmentCache`, `FeaturedBroadcastRegistry`, `CuratorPublishBudget`. All three follow the template established in Phase 1.

**Phase 3 — `EventRecorder` and three call sites (half day).** The retention-gate unlock. Smallest change, biggest product impact.

**Phase 4 — backfill + deploy (half day).** Run the backfill on the VPS, verify row counts match the JSON-file keys, smoke-test a bake, rename source JSON files to `.bak` (do not delete; see retention policy in **Boot-time backfill**).

**Phase 4.5 — automated backups (~2 hours).** This must land before the `.bak` files are deleted, and ideally before Phase 4 ships. After the SQLite migration, the database file is a single point of failure with much higher blast radius than the JSON-file stores it replaces. Concretely:

- **Primary backup job:** cron entry on the VPS, hourly during waking hours plus a nightly run, calling `sqlite3 /home/cleo/cleo-broadcast/server/.broadcast-cache/cleo.db ".backup /var/backups/cleo/cleo-$(date +%F-%H).db"`. WAL-aware; doesn't block writers.
- **Off-box copy:** nightly push to R2 bucket `cleo-broadcast-backups` under a date-keyed prefix (`hourly/YYYY-MM-DD-HH.db`, `daily/YYYY-MM-DD.db`, `weekly/YYYY-WW.db`). Mint a **separate R2 token** for backups — do not reuse `R2_ACCESS_KEY_ID` from `server/.env` (different blast radius if exposed). New env vars `R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_ACCESS_KEY` / `R2_BACKUP_BUCKET=cleo-broadcast-backups`. Document in `server/DEPLOY.md`.
- **Retention:** 24 hourly + 14 daily + 12 weekly. Local cron expires old files via `find ... -mtime +N -delete`. R2 expiration enforced by an R2 lifecycle rule on the bucket — three rules keyed on the prefix above with corresponding TTLs. No client-side delete loop required.
- **Restore drill (mandatory):** before Phase 4 ships, copy the most recent backup to a scratch path, open it with `sqlite3`, run `PRAGMA integrity_check`, run a representative SELECT against `broadcasts` and `enrichment`, confirm the data matches expectations. If the restore drill fails, the deploy doesn't ship until it passes.
- **Monitoring:** the backup cron should write a sentinel file (`/var/backups/cleo/last-success`) on success. A `/admin/status` field surfaces "minutes since last backup" so a stale backup is visible without SSH.

**Phase 5 — admin endpoints (half day).** Add the JSON-backed `/admin/*` routes from the **Admin surface** section: `/admin/bakes`, `/admin/bakes/:id`, `/admin/users/:uid/activity`, `/admin/retention`, `/admin/curators/:uid/publishes`, `/admin/featured`, `/admin/tts/failures`. Each is a small handler over a prepared statement; reuses the existing `adminGate` chain. No client/UI work.

Total: ~3.75 days of focused work. Each phase is independently revertable until Phase 4 renames the JSON files (and even then `.bak` retention preserves a manual revert path for 7+ days). Phase 4.5 is non-negotiable before deletion of the `.bak` fallbacks. Phase 5 is purely additive — safe to ship separately or alongside Phase 4.

---

## Risks

- **`structuredClone` semantics.** Existing tests may assert reference identity contracts that SQLite's natural fresh-object semantics happen to satisfy, but spot-check. If any test asserts two consecutive reads return non-`===` objects, the migration is fine; if any test asserts they *are* `===`, that's a bug in the test that the migration will surface.
- **`UPDATE broadcast_slots` race vs. concurrent workers.** Today's worker pool (`BroadcastOrchestrator.ts:344`) doesn't synchronize because each slot index is owned by exactly one worker. SQLite is fine with concurrent UPDATEs to different rows in WAL mode. If two workers ever race on the same slot, that's a pre-existing bug surfaced by the migration, not caused by it. Worth confirming by reading the worker loop carefully.
- **Hot-path cost of `abort_requested` polling.** The `aborted` Set check (`BroadcastOrchestrator.ts:346`) is O(1). A SQLite read on every loop iteration would add ~10-50µs. Negligible, but the design keeps an in-memory mirror of the column to avoid the question entirely.
- **Backup as a day-one priority.** `sqlite3 cleo.db ".backup ..."` in cron plus the nightly R2 push to `cleo-broadcast-backups` (see Phase 4.5). Without this, the migration *increases* blast radius — one file destroys everything — until a backup story exists.

---

## Out of scope

- Multi-process / horizontal scaling. The current single-process model stays. SQLite WAL handles a future read-replica process if ever needed.
- Job-queue refactor (BullMQ, Redis-backed). Different architectural decision; not blocked by this migration but not unlocked by it either.
- Migration framework (Drizzle Kit, umzug, etc.). Defer until the second schema change.
- Replacing R2, Firestore, or the TTS filesystem cache. Each is correct for its purpose.

---

## Resolved decisions

(Were "Open questions" in earlier draft; settled 2026-05-01 before plan-writing.)

- **ORM:** raw `better-sqlite3`, no Drizzle. Schema is six tables; the half-day saved matters more in Phase 2 than the type-checked query builder. Adopt Drizzle later as a pure refactor when the second schema change lands.
- **Backup destination:** R2 bucket `cleo-broadcast-backups`, separate token from the segment-upload one, lifecycle-rule retention. R2 is already proven in the pipeline; single-provider risk is acceptable at our scale and a Hetzner mirror is a clean later addition if it ever bites.
- **Event payload schema:** typed in TS via discriminated union (`AppEventPayloads` map), freeform `TEXT` in DB. Compile-time safety on call sites, zero migration cost when fields evolve, JSON1 for ad-hoc admin aggregates. Promote a field to a real column if/when its query becomes hot.

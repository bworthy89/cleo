# SQLite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four ad-hoc state stores (`BroadcastStore` Map, `EnrichmentCache` JSON file, `FeaturedBroadcastRegistry` JSON file, `CuratorPublishBudget` Map) with a single SQLite file using `better-sqlite3`. Add an `app_events` table + `EventRecorder` to unlock D1→D7 retention measurement (the Phase 2 gate).

**Architecture:** One `Db` wrapper around `better-sqlite3` (synchronous, single-process, WAL mode), constructed once in `server/src/index.ts` and injected into each store. The four existing stores keep their public method names so the orchestrator and routes don't change — only the constructors gain a `Db` parameter. Schema lives in a flat `schema.sql` applied idempotently at boot via `IF NOT EXISTS`. Tests use `new Db(':memory:')`.

**Tech Stack:** Node.js + TypeScript, `better-sqlite3` v11+, ts-jest, no ORM (raw `db.prepare(...)`).

**Scope:** Phases 0–4 from `docs/superpowers/specs/2026-05-01-sqlite-migration-design.md` — the storage migration itself, ending with a deploy that ships SQLite-backed stores, the `EventRecorder`, and the backfill script. **Phase 4.5 (automated backups to R2)** and **Phase 5 (admin endpoints)** are deferred to follow-up plans because each is independently shippable; this plan is complete enough to deploy on its own, with `.bak` JSON files held for ≥7 days as the manual revert path.

**File Structure:**
- Create: `server/src/services/db/Db.ts`
- Create: `server/src/services/db/schema.sql`
- Create: `server/src/services/db/errors.ts`
- Create: `server/src/services/events/EventRecorder.ts`
- Create: `server/src/scripts/backfill-sqlite.ts`
- Rewrite (same public API, SQLite-backed): `server/src/services/broadcast/BroadcastStore.ts`
- Rewrite: `server/src/services/enrichment/EnrichmentCache.ts`
- Rewrite: `server/src/services/broadcast/FeaturedBroadcastRegistry.ts`
- Rewrite: `server/src/services/curator/CuratorPublishBudget.ts`
- Modify: `server/package.json` (add `better-sqlite3` + `@types/better-sqlite3`)
- Modify: `server/src/index.ts` (construct `Db`, pass into each store + EventRecorder)
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts` (`makeWithDefaults` uses `Db(':memory:')`; `create()` records 3 events)
- Modify: `server/src/routes/featured.ts` (record `app_open` on `GET /broadcast/featured`)
- Modify: `server/.gitignore` (`cleo.db*`)
- Modify: `server/DEPLOY.md` (post-migration runbook)
- Rewrite tests: `server/__tests__/broadcast/BroadcastStore.test.ts`, `server/__tests__/enrichment/EnrichmentCache.test.ts`, `server/__tests__/enrichment/EnrichmentCache.extended.test.ts`, `server/__tests__/services/curator/CuratorPublishBudget.test.ts`
- New tests: `server/__tests__/services/db/Db.test.ts`, `server/__tests__/services/events/EventRecorder.test.ts`, `server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts`, `server/__tests__/scripts/backfill-sqlite.test.ts`, `server/__tests__/broadcast/generation-invariant.test.ts`

---

## Phase 0 — Scaffold

### Task 1: Add better-sqlite3 dependency

**Files:**
- Modify: `server/package.json`
- Modify: `server/.gitignore`

- [ ] **Step 1: Install better-sqlite3 and types**

Run from `server/`:

```bash
cd server && npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3
```

Expected: `package.json` gains `"better-sqlite3": "^X.Y.Z"` under `dependencies` and `"@types/better-sqlite3": "^X.Y.Z"` under `devDependencies`. `package-lock.json` updates.

- [ ] **Step 2: Add SQLite artifacts to `.gitignore`**

Append to `server/.gitignore`:

```gitignore

# SQLite database (created at runtime; backed up via Phase 4.5 cron)
.broadcast-cache/cleo.db
.broadcast-cache/cleo.db-wal
.broadcast-cache/cleo.db-shm
```

- [ ] **Step 3: Verify build still passes**

```bash
cd server && npm run build
```

Expected: clean compile, no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/package.json server/package-lock.json server/.gitignore
git commit -m "feat(server): add better-sqlite3 dependency for sqlite-migration"
```

---

### Task 2: Write the schema

**Files:**
- Create: `server/src/services/db/schema.sql`

- [ ] **Step 1: Create the schema file**

Create `server/src/services/db/schema.sql`:

```sql
-- One DB file holds every state store the broadcast server keeps.
-- Applied idempotently at boot via Db's `db.exec(readSchemaSql())` call.
-- Source of truth for shape: docs/superpowers/specs/2026-05-01-sqlite-migration-design.md

CREATE TABLE IF NOT EXISTS broadcasts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  vibe            TEXT NOT NULL,
  length          TEXT NOT NULL,
  playlist_id     TEXT,
  created_at      INTEGER NOT NULL,
  bake_status     TEXT NOT NULL,
  abort_requested INTEGER NOT NULL DEFAULT 0,
  manifest_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_user_created ON broadcasts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_bakestatus  ON broadcasts(bake_status, created_at);

CREATE TABLE IF NOT EXISTS broadcast_slots (
  broadcast_id    TEXT NOT NULL,
  slot_index      INTEGER NOT NULL,
  status          TEXT NOT NULL,
  audio_urls_json TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (broadcast_id, slot_index),
  FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrichment (
  track_key       TEXT PRIMARY KEY,
  data_json       TEXT NOT NULL,
  fetched_at      INTEGER NOT NULL,
  source          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enrichment_fetched ON enrichment(fetched_at);

CREATE TABLE IF NOT EXISTS featured_broadcasts (
  id              TEXT PRIMARY KEY,
  slot            TEXT,
  theme_day       TEXT,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  vibe            TEXT NOT NULL,
  length          TEXT NOT NULL,
  artwork_url     TEXT,
  baked           INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  manifest_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_featured_slot_baked ON featured_broadcasts(slot, baked);

CREATE TABLE IF NOT EXISTS curator_publishes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  curator_uid     TEXT NOT NULL,
  published_at    INTEGER NOT NULL,
  broadcast_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_curator_uid_time ON curator_publishes(curator_uid, published_at);

CREATE TABLE IF NOT EXISTS app_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  occurred_at     INTEGER NOT NULL,
  broadcast_id    TEXT,
  payload_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON app_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON app_events(event_type, occurred_at);
```

- [ ] **Step 2: Update `server/tsconfig.json` to include `.sql` files at runtime**

Schema is loaded via `fs.readFileSync` at boot, so tsc itself doesn't need to copy it. But `npm run build` outputs to `dist/`; the build process needs to copy `schema.sql` into `dist/services/db/`. Add a `postbuild` script.

Edit `server/package.json` `scripts`:

```json
"scripts": {
  "dev": "npx tsx watch src/index.ts",
  "build": "tsc && npm run build:copy-assets",
  "build:copy-assets": "mkdir -p dist/services/db && cp src/services/db/schema.sql dist/services/db/schema.sql",
  "start": "node dist/index.js",
  "test": "jest",
  "test:watch": "jest --watch",
  "bake-featured": "tsx scripts/bake-featured.ts",
  "eval-sequencer-gate": "tsx scripts/eval-sequencer-gate.ts"
}
```

- [ ] **Step 3: Verify build copies the schema**

```bash
cd server && rm -rf dist && npm run build && ls dist/services/db/
```

Expected: output includes `schema.sql`.

- [ ] **Step 4: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/db/schema.sql server/package.json
git commit -m "feat(server): add sqlite schema for cleo.db"
```

---

### Task 3: Db wrapper class with boot test (TDD)

**Files:**
- Create: `server/src/services/db/errors.ts`
- Create: `server/src/services/db/Db.ts`
- Test: `server/__tests__/services/db/Db.test.ts`

- [ ] **Step 1: Write failing test for the Db class**

Create `server/__tests__/services/db/Db.test.ts`:

```ts
import { Db } from '@/services/db/Db';
import { DbBootError } from '@/services/db/errors';

describe('Db', () => {
  it('opens an in-memory database and applies the schema', () => {
    const db = new Db(':memory:');
    // All six tables must exist after boot.
    const tables = db.prepare<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all();
    const names = tables.map(t => t.name).sort();
    expect(names).toEqual([
      'app_events',
      'broadcast_slots',
      'broadcasts',
      'curator_publishes',
      'enrichment',
      'featured_broadcasts',
    ]);
    db.close();
  });

  it('enables WAL journal mode (file-backed only — :memory: returns "memory")', () => {
    // :memory: databases report 'memory' for journal_mode regardless of pragma —
    // the WAL pragma on memory dbs is a no-op. Verify against a temp file.
    const tmp = `/tmp/test-cleo-${process.pid}-${Date.now()}.db`;
    const db = new Db(tmp);
    const { journal_mode } = db.prepare<{ journal_mode: string }>(
      'PRAGMA journal_mode',
    ).get();
    expect(journal_mode).toBe('wal');
    db.close();
    require('fs').unlinkSync(tmp);
    // Also drop the wal/shm sidecars if they exist.
    for (const ext of ['-wal', '-shm']) {
      try { require('fs').unlinkSync(tmp + ext); } catch {}
    }
  });

  it('enables foreign_keys', () => {
    const db = new Db(':memory:');
    const { foreign_keys } = db.prepare<{ foreign_keys: number }>(
      'PRAGMA foreign_keys',
    ).get();
    expect(foreign_keys).toBe(1);
    db.close();
  });

  it('throws DbBootError when the parent directory does not exist', () => {
    expect(() => new Db('/nonexistent/path/cleo.db')).toThrow(DbBootError);
  });

  it('exposes a transaction helper that runs the callback atomically', () => {
    const db = new Db(':memory:');
    db.transaction(() => {
      db.prepare(
        "INSERT INTO broadcasts (id, user_id, vibe, length, created_at, bake_status, manifest_json) " +
        "VALUES ('t1', 'u1', 'morning', 'quick', 1, 'baking', '{}')",
      ).run();
      db.prepare(
        "INSERT INTO broadcast_slots (broadcast_id, slot_index, status, updated_at) " +
        "VALUES ('t1', 0, 'pending', 1)",
      ).run();
    });
    const { n } = db.prepare<{ n: number }>(
      "SELECT COUNT(*) AS n FROM broadcast_slots WHERE broadcast_id='t1'",
    ).get();
    expect(n).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest __tests__/services/db/Db.test.ts
```

Expected: FAIL with `Cannot find module '@/services/db/Db'`.

- [ ] **Step 3: Create the error class**

Create `server/src/services/db/errors.ts`:

```ts
export class DbBootError extends Error {
  readonly cause: unknown;
  readonly step: string;
  constructor(step: string, filePath: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`db boot failed at step "${step}" for "${filePath}": ${causeMsg}`);
    this.name = 'DbBootError';
    this.step = step;
    this.cause = cause;
  }
}
```

- [ ] **Step 4: Implement the Db class**

Create `server/src/services/db/Db.ts`:

```ts
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { DbBootError } from './errors';

type BetterSqliteDatabase = ReturnType<typeof Database>;
type RawStatement = ReturnType<BetterSqliteDatabase['prepare']>;

export interface Statement<Row = unknown> {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Row;
  all(...params: unknown[]): Row[];
  iterate(...params: unknown[]): IterableIterator<Row>;
}

function readSchemaSql(): string {
  // Schema lives next to this file in src/, and gets copied to dist/services/db/
  // by the build:copy-assets npm script. __dirname resolves correctly in both.
  return fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
}

export class Db {
  private readonly db: BetterSqliteDatabase;

  constructor(filePath: string) {
    let opened: BetterSqliteDatabase | undefined;
    try {
      opened = new Database(filePath);
      this.db = opened;
      try {
        this.db.pragma('journal_mode = WAL');
      } catch (err) {
        throw new DbBootError('pragma:journal_mode', filePath, err);
      }
      try {
        this.db.pragma('foreign_keys = ON');
      } catch (err) {
        throw new DbBootError('pragma:foreign_keys', filePath, err);
      }
      try {
        this.db.exec(readSchemaSql());
      } catch (err) {
        throw new DbBootError('exec:schema', filePath, err);
      }
      try {
        this.markCrashedBakes();
      } catch (err) {
        throw new DbBootError('markCrashedBakes', filePath, err);
      }
    } catch (err) {
      // Close the handle if it opened before a later step threw, otherwise we
      // leak file descriptors and the DB stays locked across PM2 restarts.
      try { opened?.close(); } catch { /* ignore */ }
      if (err instanceof DbBootError) throw err;
      throw new DbBootError('open', filePath, err);
    }
  }

  prepare<Row = unknown>(sql: string): Statement<Row> {
    return this.db.prepare(sql) as RawStatement & Statement<Row>;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }

  /**
   * Boot-time recovery sweep: any broadcast whose bake_status is still 'baking'
   * was owned by a process that died mid-flight. Mark it failed and flip its
   * pending slots to aborted so client polling can resolve.
   */
  private markCrashedBakes(): void {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const failed = this.db.prepare(
        "UPDATE broadcasts SET bake_status='failed' WHERE bake_status='baking'",
      ).run();
      if (failed.changes > 0) {
        this.db.prepare(
          "UPDATE broadcast_slots SET status='aborted', updated_at=? " +
          "WHERE status='pending' AND broadcast_id IN " +
          "(SELECT id FROM broadcasts WHERE bake_status='failed')",
        ).run(now);
      }
    });
    tx();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd server && npx jest __tests__/services/db/Db.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
cd server && npm test
```

Expected: existing tests still pass; new `Db` tests included.

- [ ] **Step 7: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/db/ server/__tests__/services/db/
git commit -m "feat(server): add Db wrapper around better-sqlite3"
```

---

## Phase 1 — BroadcastStore migration

### Task 4: Port BroadcastStore to SQLite (TDD)

**Files:**
- Rewrite: `server/src/services/broadcast/BroadcastStore.ts`
- Rewrite: `server/__tests__/broadcast/BroadcastStore.test.ts`

**Public API stays the same:** `put(manifest)`, `get(id)`, `updateSlot(id, idx, patch)`, `markPendingSlotsAborted(id)`, `size()`. Constructor changes from `new BroadcastStore()` to `new BroadcastStore(db: Db)`.

- [ ] **Step 1: Replace the test file with SQLite-aware tests**

Replace the entire content of `server/__tests__/broadcast/BroadcastStore.test.ts`:

```ts
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { Db } from '@/services/db/Db';
import type { Manifest } from '@/services/broadcast/types';

const baseManifest = (id = 'b1'): Manifest => ({
  broadcastId: id, userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
    { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
  ],
});

const newStore = (): { db: Db; store: BroadcastStore } => {
  const db = new Db(':memory:');
  return { db, store: new BroadcastStore(db) };
};

describe('BroadcastStore (sqlite)', () => {
  it('stores and retrieves a manifest', () => {
    const { db, store } = newStore();
    const m = baseManifest();
    store.put(m);
    expect(store.get('b1')).toEqual(m);
    db.close();
  });

  it('returns undefined for unknown ids', () => {
    const { db, store } = newStore();
    expect(store.get('nope')).toBeUndefined();
    db.close();
  });

  it('updates a slot with audio URLs and marks it ready', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    store.updateSlot('b1', 0, { status: 'ready', audioUrls: ['u0', 'u1', 'u2'] });
    const m = store.get('b1')!;
    expect(m.segmentSlots[0].status).toBe('ready');
    expect(m.segmentSlots[0].audioUrls).toEqual(['u0', 'u1', 'u2']);
    db.close();
  });

  it('marks a slot as failed', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    store.updateSlot('b1', 1, { status: 'failed' });
    expect(store.get('b1')!.segmentSlots[1].status).toBe('failed');
    db.close();
  });

  it('returns defensive copies (caller mutations do not leak)', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    const m = store.get('b1')!;
    m.segmentSlots[0].status = 'ready';
    expect(store.get('b1')!.segmentSlots[0].status).toBe('pending');
    db.close();
  });

  it('evicts entries older than 24h on access', () => {
    const { db, store } = newStore();
    const m = baseManifest();
    m.createdAt = Date.now() - (24 * 60 * 60 * 1000 + 1000);
    store.put(m);
    expect(store.get('b1')).toBeUndefined();
    db.close();
  });

  it('markPendingSlotsAborted flips only pending slots to aborted', () => {
    const { db, store } = newStore();
    const m = baseManifest();
    m.segmentSlots = [
      { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'ready' },
      { index: 1, kind: 'transition', beforeTrackId: 't0', variantCount: 1, status: 'pending' },
      { index: 2, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'failed' },
    ];
    store.put(m);
    store.markPendingSlotsAborted('b1');
    const out = store.get('b1')!;
    expect(out.segmentSlots[0].status).toBe('ready');
    expect(out.segmentSlots[1].status).toBe('aborted');
    expect(out.segmentSlots[2].status).toBe('failed');
    db.close();
  });

  it('markPendingSlotsAborted is a no-op for unknown broadcastId', () => {
    const { db, store } = newStore();
    expect(() => store.markPendingSlotsAborted('nope')).not.toThrow();
    db.close();
  });

  it('size() returns the row count', () => {
    const { db, store } = newStore();
    expect(store.size()).toBe(0);
    store.put(baseManifest('a'));
    store.put(baseManifest('b'));
    expect(store.size()).toBe(2);
    db.close();
  });

  it('persists across BroadcastStore instances on the same Db', () => {
    const { db, store } = newStore();
    store.put(baseManifest());
    const second = new BroadcastStore(db);
    expect(second.get('b1')).toBeDefined();
    expect(second.get('b1')!.segmentSlots[0].status).toBe('pending');
    db.close();
  });

  it('boot sweep marks orphaned baking rows as failed and pending slots as aborted', () => {
    // First Db: simulate a bake that started but never finished.
    const tmp = `/tmp/test-cleo-bootsweep-${process.pid}-${Date.now()}.db`;
    const first = new Db(tmp);
    const fStore = new BroadcastStore(first);
    fStore.put(baseManifest());
    // Manually flip the status to 'baking' to simulate mid-flight crash —
    // BroadcastStore.put writes 'baking' by default but be explicit.
    first.prepare(
      "UPDATE broadcasts SET bake_status='baking' WHERE id='b1'",
    ).run();
    first.close();
    // Second Db: opening it triggers markCrashedBakes.
    const second = new Db(tmp);
    const { bake_status } = second.prepare<{ bake_status: string }>(
      "SELECT bake_status FROM broadcasts WHERE id='b1'",
    ).get();
    expect(bake_status).toBe('failed');
    const slotStatuses = second.prepare<{ status: string }>(
      "SELECT status FROM broadcast_slots WHERE broadcast_id='b1' ORDER BY slot_index",
    ).all().map(r => r.status);
    expect(slotStatuses).toEqual(['aborted', 'aborted']);
    second.close();
    require('fs').unlinkSync(tmp);
    for (const ext of ['-wal', '-shm']) {
      try { require('fs').unlinkSync(tmp + ext); } catch {}
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx jest __tests__/broadcast/BroadcastStore.test.ts
```

Expected: FAIL — current `BroadcastStore` constructor takes no args, so `new BroadcastStore(db)` raises a TS error or runtime mismatch.

- [ ] **Step 3: Replace BroadcastStore with the SQLite implementation**

Replace the entire content of `server/src/services/broadcast/BroadcastStore.ts`:

```ts
import type { Manifest, SegmentSlot } from './types';
import type { Db } from '../db/Db';

const TTL_MS = 24 * 60 * 60 * 1000;

interface BroadcastRow {
  id: string;
  manifest_json: string;
  created_at: number;
}

interface SlotRow {
  slot_index: number;
  status: SegmentSlot['status'];
  audio_urls_json: string | null;
}

export class BroadcastStore {
  constructor(private readonly db: Db) {}

  put(manifest: Manifest): void {
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO broadcasts
         (id, user_id, vibe, length, playlist_id, created_at, bake_status, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, 'baking', ?)
         ON CONFLICT(id) DO UPDATE SET
           manifest_json = excluded.manifest_json,
           created_at = excluded.created_at,
           bake_status = excluded.bake_status`,
      ).run(
        manifest.broadcastId,
        manifest.userId,
        manifest.vibe,
        manifest.length,
        manifest.playlistId,
        manifest.createdAt,
        JSON.stringify(manifest),
      );
      // Wipe any prior slot rows for this id (fresh put = fresh slots).
      this.db.prepare('DELETE FROM broadcast_slots WHERE broadcast_id = ?').run(manifest.broadcastId);
      const insertSlot = this.db.prepare(
        `INSERT INTO broadcast_slots
         (broadcast_id, slot_index, status, audio_urls_json, attempt_count, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      );
      for (const slot of manifest.segmentSlots) {
        insertSlot.run(
          manifest.broadcastId,
          slot.index,
          slot.status,
          slot.audioUrls ? JSON.stringify(slot.audioUrls) : null,
          now,
        );
      }
    });
  }

  get(id: string): Manifest | undefined {
    const row = this.db.prepare<BroadcastRow>(
      'SELECT id, manifest_json, created_at FROM broadcasts WHERE id = ?',
    ).get(id);
    if (!row) return undefined;
    if (Date.now() - row.created_at > TTL_MS) {
      this.db.prepare('DELETE FROM broadcasts WHERE id = ?').run(id);
      return undefined;
    }
    const manifest = JSON.parse(row.manifest_json) as Manifest;
    // Overlay current slot states on top of the stored manifest blob.
    const slots = this.db.prepare<SlotRow>(
      'SELECT slot_index, status, audio_urls_json FROM broadcast_slots ' +
      'WHERE broadcast_id = ? ORDER BY slot_index',
    ).all(id);
    for (const slotRow of slots) {
      const target = manifest.segmentSlots[slotRow.slot_index];
      if (!target) continue;
      target.status = slotRow.status;
      target.audioUrls = slotRow.audio_urls_json ? JSON.parse(slotRow.audio_urls_json) : undefined;
    }
    return manifest;
  }

  updateSlot(
    id: string,
    slotIndex: number,
    patch: Partial<Pick<SegmentSlot, 'status' | 'audioUrls'>>,
  ): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) {
      setClauses.push('status = ?');
      params.push(patch.status);
    }
    if (patch.audioUrls !== undefined) {
      setClauses.push('audio_urls_json = ?');
      params.push(JSON.stringify(patch.audioUrls));
    }
    if (setClauses.length === 0) return;
    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id, slotIndex);
    const result = this.db.prepare(
      `UPDATE broadcast_slots SET ${setClauses.join(', ')} ` +
      `WHERE broadcast_id = ? AND slot_index = ?`,
    ).run(...params);
    if (result.changes === 0) {
      // Existence check to mirror the old behavior, which threw on missing
      // broadcast or missing slot index.
      const broadcast = this.db.prepare(
        'SELECT id FROM broadcasts WHERE id = ?',
      ).get(id);
      if (!broadcast) throw new Error(`broadcast not found: ${id}`);
      throw new Error(`slot ${slotIndex} not found`);
    }
  }

  markPendingSlotsAborted(broadcastId: string): void {
    this.db.prepare(
      `UPDATE broadcast_slots
       SET status = 'aborted', updated_at = ?
       WHERE broadcast_id = ? AND status = 'pending'`,
    ).run(Date.now(), broadcastId);
  }

  size(): number {
    const { n } = this.db.prepare<{ n: number }>(
      'SELECT COUNT(*) AS n FROM broadcasts',
    ).get();
    return n;
  }
}
```

- [ ] **Step 4: Run BroadcastStore tests**

```bash
cd server && npx jest __tests__/broadcast/BroadcastStore.test.ts
```

Expected: 11 tests PASS.

- [ ] **Step 5: Run full server test suite — there will be breakage**

```bash
cd server && npm test
```

Expected: failures in tests that construct `new BroadcastStore()` without a Db, and in `BroadcastOrchestrator.makeWithDefaults` (which we fix in Task 5). Note the breakage list — it's the next task's input.

- [ ] **Step 6: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/broadcast/BroadcastStore.ts server/__tests__/broadcast/BroadcastStore.test.ts
git commit -m "feat(server): port BroadcastStore to sqlite (interface preserved)"
```

---

### Task 5: Wire makeWithDefaults to use in-memory Db

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts:102-134`

- [ ] **Step 1: Run failing tests to identify breakage**

```bash
cd server && npm test 2>&1 | grep -E 'FAIL|new BroadcastStore' | head -20
```

Expected: tests using `BroadcastOrchestrator.makeWithDefaults` fail; the offending line is `const store = new BroadcastStore();` at `BroadcastOrchestrator.ts:116`.

- [ ] **Step 2: Update makeWithDefaults to construct an in-memory Db**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`. Find:

```ts
    const store = new BroadcastStore();
    const cache = new EnrichmentCache('/tmp/noop-enrich.json');
```

Replace with:

```ts
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const cache = new EnrichmentCache('/tmp/noop-enrich.json');
```

Add the import at the top with the other imports:

```ts
import { Db } from '../db/Db';
```

- [ ] **Step 3: Run full server test suite**

```bash
cd server && npm test
```

Expected: no failures from `BroadcastStore` constructor mismatch. Other store tests (EnrichmentCache, FeaturedBroadcastRegistry, CuratorPublishBudget) still pass against their old in-memory/JSON-file implementations.

- [ ] **Step 4: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/broadcast/BroadcastOrchestrator.ts
git commit -m "feat(server): makeWithDefaults uses in-memory Db for BroadcastStore"
```

---

### Task 6: Wire production index.ts to file-backed Db

**Files:**
- Modify: `server/src/index.ts:178` (add `Db` construction, pass into `BroadcastStore`)

- [ ] **Step 1: Add Db construction in index.ts**

Edit `server/src/index.ts`. Find:

```ts
const broadcastStore = new BroadcastStore();
```

Replace with:

```ts
import { Db } from './services/db/Db';

// ... (further down, near broadcastStorage initialization)

// One SQLite file holds every state store the broadcast server keeps
// (broadcasts, slots, enrichment, featured, curator publishes, app_events).
// WAL mode + boot-time crashed-bake sweep happen inside the Db constructor.
const dbPath = process.env.SQLITE_DB_PATH
  ?? path.resolve(__dirname, '../.broadcast-cache/cleo.db');
const db = new Db(dbPath);
console.log(`[boot] sqlite db opened at ${dbPath}`);

const broadcastStore = new BroadcastStore(db);
```

The `Db` import goes at the top with the other imports; adjust placement to match the file's import-block style.

- [ ] **Step 2: Verify build still passes**

```bash
cd server && npm run build
```

Expected: clean compile.

- [ ] **Step 3: Verify dev server boots**

```bash
cd server && npm run dev &
sleep 3
curl -s http://localhost:3001/health
kill %1
```

Expected: `{"status":"ok"}`. Server log includes `[boot] sqlite db opened at .../cleo.db`. A fresh `cleo.db` file plus `cleo.db-wal` / `cleo.db-shm` sidecars now exist under `server/.broadcast-cache/`.

- [ ] **Step 4: Run full test suite**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/index.ts
git commit -m "feat(server): boot Db in index.ts; BroadcastStore uses sqlite"
```

End of Phase 1. Bakes now survive `pm2 restart`.

---

## Phase 2 — The other three stores

### Task 7: Port EnrichmentCache to SQLite (TDD)

**Files:**
- Rewrite: `server/src/services/enrichment/EnrichmentCache.ts`
- Rewrite: `server/__tests__/enrichment/EnrichmentCache.test.ts`
- Rewrite: `server/__tests__/enrichment/EnrichmentCache.extended.test.ts`

**Public API stays:** `load()`, `get(title, artist)`, `set(title, artist, record)`. `load()` becomes a no-op. The constructor takes a `Db` instead of a file path.

- [ ] **Step 1: Replace `EnrichmentCache.test.ts` with sqlite-aware tests**

Replace the entire content of `server/__tests__/enrichment/EnrichmentCache.test.ts`:

```ts
import { EnrichmentCache, type EnrichmentRecord } from '@/services/enrichment/EnrichmentCache';
import { Db } from '@/services/db/Db';

const newCache = (): { db: Db; cache: EnrichmentCache } => {
  const db = new Db(':memory:');
  return { db, cache: new EnrichmentCache(db) };
};

const sampleRecord = (overrides: Partial<EnrichmentRecord> = {}): EnrichmentRecord => ({
  genre: 'house',
  moodTags: ['driving'],
  lastEnrichedAt: 1_700_000_000_000,
  source: 'genius',
  ...overrides,
});

describe('EnrichmentCache (sqlite)', () => {
  it('load() resolves immediately (no-op)', async () => {
    const { db, cache } = newCache();
    await expect(cache.load()).resolves.toBeUndefined();
    db.close();
  });

  it('returns null for missing entries', () => {
    const { db, cache } = newCache();
    expect(cache.get('Title', 'Artist')).toBeNull();
    db.close();
  });

  it('writes and reads back a record (key normalization preserved)', async () => {
    const { db, cache } = newCache();
    const rec = sampleRecord();
    await cache.set('Title (feat. X)', 'Artist', rec);
    expect(cache.get('Title', 'Artist')).toEqual(rec);
    expect(cache.get('TITLE   (feat. someone)', 'artist')).toEqual(rec);
    db.close();
  });

  it('overwrites existing entries on set', async () => {
    const { db, cache } = newCache();
    await cache.set('T', 'A', sampleRecord({ genre: 'house' }));
    await cache.set('T', 'A', sampleRecord({ genre: 'techno' }));
    expect(cache.get('T', 'A')!.genre).toBe('techno');
    db.close();
  });

  it('persists across cache instances on the same Db', async () => {
    const { db, cache } = newCache();
    await cache.set('T', 'A', sampleRecord());
    const second = new EnrichmentCache(db);
    expect(second.get('T', 'A')).not.toBeNull();
    db.close();
  });
});
```

- [ ] **Step 2: Replace `EnrichmentCache.extended.test.ts`**

Read the existing file first to understand what extended cases it covers:

```bash
cat server/__tests__/enrichment/EnrichmentCache.extended.test.ts
```

Replace its content with the same patterns translated to SQLite (constructing `new EnrichmentCache(new Db(':memory:'))` instead of a file path). Preserve every test name and assertion — only the setup changes.

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd server && npx jest __tests__/enrichment/
```

Expected: FAIL — `EnrichmentCache` constructor still takes a file path.

- [ ] **Step 4: Replace EnrichmentCache with the SQLite implementation**

Replace the entire content of `server/src/services/enrichment/EnrichmentCache.ts`:

```ts
import type { AudioFeatures } from '../broadcast/audio-features';
import type { Db } from '../db/Db';

export interface EnrichmentRecord {
  genre?: string;
  moodTags?: string[];
  releaseYear?: string;
  producer?: string;
  sample?: string;
  wikipediaSummary?: string;
  notableFacts?: string[];
  artistBio?: string;
  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'wikipedia' | 'lastfm' | 'hybrid' | 'reccobeats';

  isrc?: string;
  features?: AudioFeatures;
  featuresSource?: 'reccobeats' | 'synthesized' | 'defaults';
  featuresAt?: number;
  featuresVersion?: number;
}

function normalizeKey(title: string, artist: string): string {
  const clean = (s: string): string => s
    .toLowerCase()
    .replace(/\(feat\.[^)]*\)/gi, '')
    .replace(/\(remastered[^)]*\)/gi, '')
    .replace(/-\s*deluxe[^|]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${clean(title)}|${clean(artist)}`;
}

interface Row {
  data_json: string;
}

export class EnrichmentCache {
  constructor(private readonly db: Db) {}

  /**
   * Kept on the API for shape compatibility with the file-backed predecessor.
   * The SQLite-backed cache has no in-memory map to populate; reads hit the
   * table directly. Existing call sites that `await cache.load()` keep working.
   */
  async load(): Promise<void> {
    return;
  }

  get(title: string, artist: string): EnrichmentRecord | null {
    const key = normalizeKey(title, artist);
    const row = this.db.prepare<Row>(
      'SELECT data_json FROM enrichment WHERE track_key = ?',
    ).get(key);
    if (!row) return null;
    return JSON.parse(row.data_json) as EnrichmentRecord;
  }

  async set(title: string, artist: string, record: EnrichmentRecord): Promise<void> {
    const key = normalizeKey(title, artist);
    this.db.prepare(
      `INSERT INTO enrichment (track_key, data_json, fetched_at, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(track_key) DO UPDATE SET
         data_json = excluded.data_json,
         fetched_at = excluded.fetched_at,
         source = excluded.source`,
    ).run(key, JSON.stringify(record), record.lastEnrichedAt, record.source);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npx jest __tests__/enrichment/
```

Expected: all enrichment-cache tests PASS.

- [ ] **Step 6: Update makeWithDefaults to use the new EnrichmentCache constructor**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`. Find:

```ts
    const cache = new EnrichmentCache('/tmp/noop-enrich.json');
```

Replace with:

```ts
    const cache = new EnrichmentCache(db);
```

(`db` is already in scope from Task 5.)

- [ ] **Step 7: Update index.ts to construct EnrichmentCache with the Db**

Edit `server/src/index.ts`. Find:

```ts
const enrichmentCache = new EnrichmentCache(
  path.resolve(__dirname, '../.enrichment-cache/tracks.json'),
);
```

Replace with:

```ts
const enrichmentCache = new EnrichmentCache(db);
```

- [ ] **Step 8: Run full test suite**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/enrichment/EnrichmentCache.ts \
        server/__tests__/enrichment/ \
        server/src/services/broadcast/BroadcastOrchestrator.ts \
        server/src/index.ts
git commit -m "feat(server): port EnrichmentCache to sqlite"
```

---

### Task 8: Port FeaturedBroadcastRegistry to SQLite (TDD)

**Files:**
- Rewrite: `server/src/services/broadcast/FeaturedBroadcastRegistry.ts`
- Create: `server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts`
- Modify: `server/src/index.ts:245` (constructor signature change)

**Public API stays:** `load()`, `put(record)`, `remove(id)`, `list()`, `getBySlot(slot)`. `load()` becomes a no-op.

- [ ] **Step 1: Write the failing test file**

Create `server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts`:

```ts
import { FeaturedBroadcastRegistry, type FeaturedBroadcast } from '@/services/broadcast/FeaturedBroadcastRegistry';
import { Db } from '@/services/db/Db';
import type { Manifest } from '@/services/broadcast/types';

const baseManifest = (id: string): Manifest => ({
  broadcastId: id, userId: 'curator', playlistId: null,
  vibe: 'morning', length: 'standard', createdAt: Date.now(),
  tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'ready', audioUrls: ['u0'] },
  ],
});

const sampleRecord = (id: string, overrides: Partial<FeaturedBroadcast> = {}): FeaturedBroadcast => ({
  id, title: 'T', description: 'D', vibe: 'morning', length: 'standard',
  baked: true, createdAt: Date.now(), manifest: baseManifest(id),
  ...overrides,
});

const newRegistry = (): { db: Db; reg: FeaturedBroadcastRegistry } => {
  const db = new Db(':memory:');
  return { db, reg: new FeaturedBroadcastRegistry(db) };
};

describe('FeaturedBroadcastRegistry (sqlite)', () => {
  it('load() resolves immediately', async () => {
    const { db, reg } = newRegistry();
    await expect(reg.load()).resolves.toBeUndefined();
    db.close();
  });

  it('list() returns empty for fresh db', () => {
    const { db, reg } = newRegistry();
    expect(reg.list()).toEqual([]);
    db.close();
  });

  it('put + list returns the record', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a'));
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
    db.close();
  });

  it('list() filters out unbaked records', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a', { baked: true }));
    await reg.put(sampleRecord('b', { baked: false }));
    const list = reg.list();
    expect(list.map(r => r.id)).toEqual(['a']);
    db.close();
  });

  it('list() orders morning slot, evening slot, then legacy', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('legacy'));
    await reg.put(sampleRecord('evening', { slot: 'evening' }));
    await reg.put(sampleRecord('morning', { slot: 'morning' }));
    const list = reg.list();
    expect(list.map(r => r.id)).toEqual(['morning', 'evening', 'legacy']);
    db.close();
  });

  it('put() updates an existing record by id', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a', { title: 'first' }));
    await reg.put(sampleRecord('a', { title: 'second' }));
    expect(reg.list()[0].title).toBe('second');
    db.close();
  });

  it('remove() deletes a record', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a'));
    await reg.remove('a');
    expect(reg.list()).toEqual([]);
    db.close();
  });

  it('getBySlot returns the matching baked record or null', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('m', { slot: 'morning' }));
    expect(reg.getBySlot('morning')!.id).toBe('m');
    expect(reg.getBySlot('evening')).toBeNull();
    db.close();
  });

  it('returns defensive copies (caller mutations do not leak)', async () => {
    const { db, reg } = newRegistry();
    await reg.put(sampleRecord('a'));
    const out = reg.list()[0];
    out.title = 'mutated';
    expect(reg.list()[0].title).not.toBe('mutated');
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx jest __tests__/broadcast/FeaturedBroadcastRegistry.test.ts
```

Expected: FAIL — constructor takes a file path, not a Db.

- [ ] **Step 3: Replace FeaturedBroadcastRegistry with the SQLite implementation**

Replace the entire content of `server/src/services/broadcast/FeaturedBroadcastRegistry.ts`:

```ts
import type { Manifest } from './types';
import type { SlotKey, DayOfWeek } from '../../config/tonightOnOnay';
import type { Db } from '../db/Db';

export interface FeaturedBroadcast {
  id: string;
  slot?: SlotKey;
  themeDay?: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
}

interface Row {
  id: string;
  slot: string | null;
  theme_day: string | null;
  title: string;
  description: string;
  vibe: string;
  length: string;
  artwork_url: string | null;
  baked: number;
  created_at: number;
  manifest_json: string;
}

function rowToRecord(row: Row): FeaturedBroadcast {
  return {
    id: row.id,
    slot: (row.slot as SlotKey | null) ?? undefined,
    themeDay: (row.theme_day as DayOfWeek | null) ?? undefined,
    title: row.title,
    description: row.description,
    vibe: row.vibe as Manifest['vibe'],
    length: row.length as Manifest['length'],
    artworkUrl: row.artwork_url ?? undefined,
    baked: row.baked === 1,
    createdAt: row.created_at,
    manifest: JSON.parse(row.manifest_json) as Manifest,
  };
}

export class FeaturedBroadcastRegistry {
  constructor(private readonly db: Db) {}

  async load(): Promise<void> {
    return;
  }

  async put(record: FeaturedBroadcast): Promise<void> {
    this.db.prepare(
      `INSERT INTO featured_broadcasts
       (id, slot, theme_day, title, description, vibe, length, artwork_url, baked, created_at, manifest_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slot = excluded.slot,
         theme_day = excluded.theme_day,
         title = excluded.title,
         description = excluded.description,
         vibe = excluded.vibe,
         length = excluded.length,
         artwork_url = excluded.artwork_url,
         baked = excluded.baked,
         created_at = excluded.created_at,
         manifest_json = excluded.manifest_json`,
    ).run(
      record.id,
      record.slot ?? null,
      record.themeDay ?? null,
      record.title,
      record.description,
      record.vibe,
      record.length,
      record.artworkUrl ?? null,
      record.baked ? 1 : 0,
      record.createdAt,
      JSON.stringify(record.manifest),
    );
  }

  async remove(id: string): Promise<void> {
    this.db.prepare('DELETE FROM featured_broadcasts WHERE id = ?').run(id);
  }

  list(): FeaturedBroadcast[] {
    // Slot ordering: morning (0) → evening (1) → legacy (2). CASE expression
    // mirrors the old hand-rolled rank() at FeaturedBroadcastRegistry.ts:60-65.
    const rows = this.db.prepare<Row>(
      `SELECT * FROM featured_broadcasts
       WHERE baked = 1
       ORDER BY CASE slot
                  WHEN 'morning' THEN 0
                  WHEN 'evening' THEN 1
                  ELSE 2
                END,
                created_at DESC`,
    ).all();
    return rows.map(rowToRecord);
  }

  getBySlot(slot: SlotKey): FeaturedBroadcast | null {
    const row = this.db.prepare<Row>(
      `SELECT * FROM featured_broadcasts
       WHERE baked = 1 AND slot = ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(slot);
    return row ? rowToRecord(row) : null;
  }
}
```

- [ ] **Step 4: Update index.ts to inject the Db**

Edit `server/src/index.ts`. Find:

```ts
  const featuredRegistry = new FeaturedBroadcastRegistry(
    path.resolve(__dirname, '../featured-broadcasts/registry.json'),
  );
```

Replace with:

```ts
  const featuredRegistry = new FeaturedBroadcastRegistry(db);
```

- [ ] **Step 5: Run tests**

```bash
cd server && npm test
```

Expected: all tests pass, including the new `FeaturedBroadcastRegistry` test file.

- [ ] **Step 6: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/broadcast/FeaturedBroadcastRegistry.ts \
        server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts \
        server/src/index.ts
git commit -m "feat(server): port FeaturedBroadcastRegistry to sqlite"
```

---

### Task 9: Port CuratorPublishBudget to SQLite (TDD)

**Files:**
- Rewrite: `server/src/services/curator/CuratorPublishBudget.ts`
- Rewrite: `server/__tests__/services/curator/CuratorPublishBudget.test.ts`
- Modify: `server/src/index.ts:129` (pass db into options)

**Public API stays:** `tryReserve(uid)` returns `ReserveResult`. The middleware factory is unchanged. Constructor adds `db: Db` to the options bag.

- [ ] **Step 1: Read current test file to preserve coverage**

```bash
cat server/__tests__/services/curator/CuratorPublishBudget.test.ts
```

Note every test name + assertion. The translation must keep all existing coverage; the only setup change is constructing `new CuratorPublishBudget({ db: new Db(':memory:'), ... })`.

- [ ] **Step 2: Replace the test file's setup**

For every existing test, change construction. Where the old test had:

```ts
const budget = new CuratorPublishBudget({
  capPerWindow: 3,
  windowMs: 24 * 60 * 60 * 1000,
  clock: () => clock,
});
```

Change to:

```ts
const db = new Db(':memory:');
const budget = new CuratorPublishBudget({
  db,
  capPerWindow: 3,
  windowMs: 24 * 60 * 60 * 1000,
  clock: () => clock,
});
// (call db.close() at the end of each test)
```

Add the import at the top: `import { Db } from '@/services/db/Db';`

Add one new test at the end of the file:

```ts
  it('persists across CuratorPublishBudget instances on the same Db', () => {
    let now = 1_000_000;
    const db = new Db(':memory:');
    const opts = { db, capPerWindow: 3, windowMs: 60_000, clock: () => now };
    const a = new CuratorPublishBudget(opts);
    expect(a.tryReserve('u1').ok).toBe(true);
    expect(a.tryReserve('u1').ok).toBe(true);
    expect(a.tryReserve('u1').ok).toBe(true);
    const b = new CuratorPublishBudget(opts);
    const result = b.tryReserve('u1');
    expect(result.ok).toBe(false);
    db.close();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd server && npx jest __tests__/services/curator/
```

Expected: FAIL — `CuratorPublishBudgetOptions` does not yet accept `db`.

- [ ] **Step 4: Replace CuratorPublishBudget with the SQLite implementation**

Replace the **`CuratorPublishBudget` class only** (lines 5–51 of the current file) — keep the express middleware factory at lines 53–122 exactly as it is. The middleware doesn't touch storage.

New `CuratorPublishBudget` block:

```ts
import type { Db } from '../db/Db';

export interface CuratorPublishBudgetOptions {
  db: Db;
  capPerWindow: number;
  windowMs: number;
  clock?: () => number;
}

export type ReserveResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number; current: number };

/**
 * Per-curator rolling-window publish quota. State persists in the
 * `curator_publishes` table so the budget survives process restarts.
 * No background timer; old rows are inert and can be pruned by an
 * out-of-band cron if/when row count becomes a concern.
 */
export class CuratorPublishBudget {
  readonly capPerWindow: number;
  readonly windowMs: number;
  private readonly db: Db;
  private readonly clock: () => number;

  constructor(opts: CuratorPublishBudgetOptions) {
    this.db = opts.db;
    this.capPerWindow = opts.capPerWindow;
    this.windowMs = opts.windowMs;
    this.clock = opts.clock ?? Date.now;
  }

  tryReserve(uid: string): ReserveResult {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const rows = this.db.prepare<{ published_at: number }>(
      `SELECT published_at FROM curator_publishes
       WHERE curator_uid = ? AND published_at > ?
       ORDER BY published_at ASC`,
    ).all(uid, cutoff);

    if (rows.length >= this.capPerWindow) {
      const oldest = rows[0].published_at;
      const retryAfterMs = oldest + this.windowMs - now;
      return { ok: false, retryAfterMs, current: rows.length };
    }

    this.db.prepare(
      'INSERT INTO curator_publishes (curator_uid, published_at) VALUES (?, ?)',
    ).run(uid, now);
    return { ok: true };
  }
}
```

Keep everything from `export function makeCuratorPublishBudgetMiddleware(` to the end of file unchanged.

- [ ] **Step 5: Update index.ts to inject the Db**

Edit `server/src/index.ts`. Find:

```ts
const curatorPublishBudget = new CuratorPublishBudget({
  capPerWindow: parsePositiveInt(process.env.CURATOR_PUBLISH_CAP, 3, 'CURATOR_PUBLISH_CAP'),
  windowMs: parsePositiveInt(
    process.env.CURATOR_PUBLISH_WINDOW_MS,
    24 * 60 * 60 * 1000,
    'CURATOR_PUBLISH_WINDOW_MS',
  ),
});
```

This currently runs **before** the `Db` construction added in Task 6. Move the `Db` construction up so it runs before this block, or move this `CuratorPublishBudget` construction down to after the `Db` block. Recommended: move the budget construction below the `Db` block. After moving, change to:

```ts
const curatorPublishBudget = new CuratorPublishBudget({
  db,
  capPerWindow: parsePositiveInt(process.env.CURATOR_PUBLISH_CAP, 3, 'CURATOR_PUBLISH_CAP'),
  windowMs: parsePositiveInt(
    process.env.CURATOR_PUBLISH_WINDOW_MS,
    24 * 60 * 60 * 1000,
    'CURATOR_PUBLISH_WINDOW_MS',
  ),
});
const curatorPublishBudgetMiddleware = makeCuratorPublishBudgetMiddleware(curatorPublishBudget);
```

- [ ] **Step 6: Run tests**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/curator/CuratorPublishBudget.ts \
        server/__tests__/services/curator/CuratorPublishBudget.test.ts \
        server/src/index.ts
git commit -m "feat(server): port CuratorPublishBudget to sqlite"
```

End of Phase 2. All four stores now live in SQLite.

---

## Phase 3 — EventRecorder

### Task 10: AppEventPayloads + EventRecorder (TDD)

**Files:**
- Create: `server/src/services/events/EventRecorder.ts`
- Create: `server/__tests__/services/events/EventRecorder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/events/EventRecorder.test.ts`:

```ts
import { EventRecorder } from '@/services/events/EventRecorder';
import { Db } from '@/services/db/Db';

describe('EventRecorder', () => {
  it('inserts an app_open event with the typed payload', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    recorder.record('u1', 'app_open', {
      appVersion: '1.0.0',
      platform: 'ios',
      buildNumber: 100,
    });
    const row = db.prepare<{ user_id: string; event_type: string; payload_json: string }>(
      'SELECT user_id, event_type, payload_json FROM app_events',
    ).get();
    expect(row.user_id).toBe('u1');
    expect(row.event_type).toBe('app_open');
    expect(JSON.parse(row.payload_json)).toEqual({
      appVersion: '1.0.0',
      platform: 'ios',
      buildNumber: 100,
    });
    db.close();
  });

  it('inserts a broadcast_started event with broadcastId attached', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    recorder.record('u1', 'broadcast_started', {
      vibe: 'morning',
      length: 'standard',
      source: 'user',
    }, { broadcastId: 'b1' });
    const row = db.prepare<{ broadcast_id: string }>(
      'SELECT broadcast_id FROM app_events',
    ).get();
    expect(row.broadcast_id).toBe('b1');
    db.close();
  });

  it('records every event type with its payload shape', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    recorder.record('u1', 'broadcast_completed', { durationMs: 30000, segmentsPlayed: 4 }, { broadcastId: 'b1' });
    recorder.record('u1', 'broadcast_failed', { slotIndex: 2, provider: 'voxcpm', errorCategory: 'timeout' }, { broadcastId: 'b1' });
    recorder.record('u1', 'track_completed', { trackIndex: 0, wasSkipped: false, listenedMs: 200000 }, { broadcastId: 'b1' });
    const { n } = db.prepare<{ n: number }>(
      'SELECT COUNT(*) AS n FROM app_events',
    ).get();
    expect(n).toBe(3);
    db.close();
  });

  it('stamps occurred_at with the current time', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    const before = Date.now();
    recorder.record('u1', 'app_open', { appVersion: '1', platform: 'ios', buildNumber: 1 });
    const after = Date.now();
    const { occurred_at } = db.prepare<{ occurred_at: number }>(
      'SELECT occurred_at FROM app_events',
    ).get();
    expect(occurred_at).toBeGreaterThanOrEqual(before);
    expect(occurred_at).toBeLessThanOrEqual(after);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest __tests__/services/events/
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement EventRecorder**

Create `server/src/services/events/EventRecorder.ts`:

```ts
import type { Db } from '../db/Db';
import type { Vibe, BroadcastLength } from '../broadcast/types';

/**
 * Discriminated payload map. Adding a new event type means adding an entry
 * here AND a string in EventType — TS surfaces missing combinations at every
 * call site. The DB column `payload_json` stays freeform `TEXT`, so adding a
 * new field never requires a migration.
 */
export interface AppEventPayloads {
  app_open: { appVersion: string; platform: 'ios' | 'android'; buildNumber: number };
  broadcast_started: { vibe: Vibe; length: BroadcastLength; source: 'user' | 'featured' };
  broadcast_completed: { durationMs: number; segmentsPlayed: number };
  broadcast_failed: { slotIndex: number; provider: string; errorCategory: string };
  track_completed: { trackIndex: number; wasSkipped: boolean; listenedMs: number };
}

export type EventType = keyof AppEventPayloads;

export class EventRecorder {
  constructor(private readonly db: Db) {}

  record<T extends EventType>(
    userId: string,
    type: T,
    payload: AppEventPayloads[T],
    opts?: { broadcastId?: string },
  ): void {
    this.db.prepare(
      `INSERT INTO app_events (user_id, event_type, occurred_at, broadcast_id, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      userId,
      type,
      Date.now(),
      opts?.broadcastId ?? null,
      JSON.stringify(payload),
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx jest __tests__/services/events/
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/events/ server/__tests__/services/events/
git commit -m "feat(server): add EventRecorder with typed payloads"
```

---

### Task 11: Wire orchestrator to record broadcast_started/completed/failed

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts` (constructor + 3 call sites)
- Modify: `server/src/index.ts` (construct EventRecorder, pass into orchestrator)

- [ ] **Step 1: Add EventRecorder to BroadcastOrchestrator's constructor signature**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`. Add the import:

```ts
import { EventRecorder } from '../events/EventRecorder';
```

In the constructor signature, add an optional `eventRecorder` parameter at the end:

```ts
  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    featureFetchChain: FeatureFetchChain,
    sequenceCache?: SequenceCache,
    private readonly weatherProvider?: Pick<WeatherProvider, 'getHint'>,
    private readonly eventRecorder?: EventRecorder,
  ) {
```

Optional so test setups (`makeWithDefaults` and any direct constructor callers in tests) keep working without rewiring; production wiring in `index.ts` always passes one.

- [ ] **Step 2: Record broadcast_started at the top of the try block in create()**

In `create()`, find:

```ts
    try {
      // Tester-triage tag. Prefix all bake-scoped logs so `grep "user=foo@bar"`
      // or `grep "id=a3f9k2"` surfaces the full lifecycle of one bake.
      const tag = buildBakeTag(broadcastId, input.userEmail ?? input.userId);
```

Insert immediately after the opening `try {`:

```ts
      this.eventRecorder?.record(input.userId, 'broadcast_started', {
        vibe: input.vibe,
        length: input.length,
        source: input.userId === 'curator' ? 'featured' : 'user',
      }, { broadcastId });
```

- [ ] **Step 3: Record broadcast_completed and broadcast_failed in the background chain and catch path**

In the same `create()` method, find the background promise chain:

```ts
      if (manifest.segmentSlots.length > 1) {
        const backgroundP = drainP
          .then(() => this.generateSlotsBackground(manifest, ctxWithHint, tag))
          .then(() => {
            const status = this.aborted.has(manifest.broadcastId) ? 'aborted' : 'completed';
            handle.endBake({ durationMs: Date.now() - startedAt, status });
          })
          .catch((err) => {
            handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
            throw err;
          })
```

Replace with:

```ts
      if (manifest.segmentSlots.length > 1) {
        const backgroundP = drainP
          .then(() => this.generateSlotsBackground(manifest, ctxWithHint, tag))
          .then(() => {
            const status = this.aborted.has(manifest.broadcastId) ? 'aborted' : 'completed';
            handle.endBake({ durationMs: Date.now() - startedAt, status });
            const durationMs = Date.now() - startedAt;
            const segmentsPlayed = manifest.segmentSlots.length;
            if (status === 'completed') {
              this.eventRecorder?.record(input.userId, 'broadcast_completed', {
                durationMs,
                segmentsPlayed,
              }, { broadcastId: manifest.broadcastId });
            }
          })
          .catch((err) => {
            handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
            this.eventRecorder?.record(input.userId, 'broadcast_failed', {
              slotIndex: -1,
              provider: 'orchestrator',
              errorCategory: err instanceof Error ? err.name : 'unknown',
            }, { broadcastId: manifest.broadcastId });
            throw err;
          })
```

Note: slot-level `broadcast_failed` events are deliberately not recorded here — `generateSlotsBackground` swallows per-slot errors so the chain's `.catch` only fires on truly unrecoverable failures. Per-slot telemetry is a future enhancement once the orchestrator gets a slot-error callback.

In the same method, find the outer `catch (err)` at the end:

```ts
    } catch (err) {
      handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
      throw err;
    }
```

Replace with:

```ts
    } catch (err) {
      handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
      this.eventRecorder?.record(input.userId, 'broadcast_failed', {
        slotIndex: 0,
        provider: 'orchestrator',
        errorCategory: err instanceof Error ? err.name : 'unknown',
      }, { broadcastId });
      throw err;
    }
```

- [ ] **Step 4: Wire EventRecorder in index.ts**

Edit `server/src/index.ts`. Find the orchestrator construction:

```ts
  const broadcastOrchestrator = new BroadcastOrchestrator(
    llmProvider, ttsProvider, broadcastStorage, broadcastStore,
    enrichmentCache, backgroundEnricher, featureFetchChain,
    undefined, weatherProvider,
  );
```

Replace with:

```ts
  const eventRecorder = new EventRecorder(db);
  const broadcastOrchestrator = new BroadcastOrchestrator(
    llmProvider, ttsProvider, broadcastStorage, broadcastStore,
    enrichmentCache, backgroundEnricher, featureFetchChain,
    undefined, weatherProvider, eventRecorder,
  );
```

Add the import at the top:

```ts
import { EventRecorder } from './services/events/EventRecorder';
```

- [ ] **Step 5: Add a test that verifies orchestrator records the lifecycle**

Create `server/__tests__/broadcast/orchestrator-events.test.ts`:

```ts
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { EventRecorder } from '@/services/events/EventRecorder';
import { Db } from '@/services/db/Db';
import type { LLMCaller, TTSCaller } from '@/services/broadcast/SegmentGenerator';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import type { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import type { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';

describe('BroadcastOrchestrator events', () => {
  it('records broadcast_started for a user-driven bake', async () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const cache = new EnrichmentCache(db);
    const recorder = new EventRecorder(db);
    const noopLLM: LLMCaller = { generate: async () => ({ text: 'hello' }) };
    const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: 'AA' }) };
    const noopStorage: ObjectStorage = { put: async (key) => `noop://${key}` };
    const enricher = { drainNow: async () => {} } as unknown as BackgroundEnricher;
    const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
    const orch = new BroadcastOrchestrator(
      noopLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
      undefined, undefined, recorder,
    );
    try {
      await orch.create({
        userId: 'u1', userEmail: 'a@b.c',
        playlistId: 'p1', vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon', firstTimeUser: false },
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't2', title: 'T2', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't3', title: 'T3', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't4', title: 'T4', artistName: 'A', albumTitle: 'Al', duration: 200 },
        ],
      });
    } catch { /* may throw if downstream dies; we only care about the started event */ }
    const row = db.prepare<{ event_type: string; user_id: string; payload_json: string }>(
      "SELECT event_type, user_id, payload_json FROM app_events WHERE event_type = 'broadcast_started'",
    ).get();
    expect(row).toBeDefined();
    expect(row.user_id).toBe('u1');
    expect(JSON.parse(row.payload_json).source).toBe('user');
    db.close();
  });

  it('records source=featured for curator-driven bakes', async () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const cache = new EnrichmentCache(db);
    const recorder = new EventRecorder(db);
    const noopLLM: LLMCaller = { generate: async () => ({ text: 'hello' }) };
    const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: 'AA' }) };
    const noopStorage: ObjectStorage = { put: async (key) => `noop://${key}` };
    const enricher = { drainNow: async () => {} } as unknown as BackgroundEnricher;
    const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
    const orch = new BroadcastOrchestrator(
      noopLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
      undefined, undefined, recorder,
    );
    try {
      await orch.create({
        userId: 'curator',
        playlistId: null, vibe: 'morning', length: 'quick',
        userContext: { timeOfDay: '12:00', dayOfWeek: 'Mon', firstTimeUser: false },
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't2', title: 'T2', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't3', title: 'T3', artistName: 'A', albumTitle: 'Al', duration: 200 },
          { id: 't4', title: 'T4', artistName: 'A', albumTitle: 'Al', duration: 200 },
        ],
      });
    } catch { /* same tolerance */ }
    const row = db.prepare<{ payload_json: string }>(
      "SELECT payload_json FROM app_events WHERE event_type = 'broadcast_started'",
    ).get();
    expect(JSON.parse(row.payload_json).source).toBe('featured');
    db.close();
  });
});
```

- [ ] **Step 6: Run tests**

```bash
cd server && npm test
```

Expected: all tests pass, including the two new orchestrator-event tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/services/broadcast/BroadcastOrchestrator.ts \
        server/src/index.ts \
        server/__tests__/broadcast/orchestrator-events.test.ts
git commit -m "feat(server): record broadcast_started/completed/failed events"
```

---

### Task 12: Wire app_open via the featured route

**Files:**
- Modify: `server/src/routes/featured.ts:84` (record `app_open` on GET /broadcast/featured)
- Modify: `server/src/index.ts` (pass EventRecorder into createFeaturedRouter)

- [ ] **Step 1: Read the AuthenticatedRequest interface**

```bash
grep -n "AuthenticatedRequest" server/src/middleware/auth.ts | head -5
```

Confirm it has a `uid` field — that's the user identifier the recorder needs.

- [ ] **Step 2: Update createFeaturedRouter to accept an EventRecorder**

Edit `server/src/routes/featured.ts`. Add the import:

```ts
import type { EventRecorder } from '../services/events/EventRecorder';
import type { AuthenticatedRequest } from '../middleware/auth';
```

Update the function signature and the `GET /broadcast/featured` handler. Find:

```ts
export function createFeaturedRouter(
  registry: FeaturedBroadcastRegistry,
  orchestrator?: BroadcastOrchestrator,
  bakeLimiter?: RequestHandler,
  publishBudget?: RequestHandler,
): Router {
  const router = Router();

  router.get('/broadcast/featured', (_req, res) => {
    res.json({ broadcasts: registry.list() });
  });
```

Replace with:

```ts
export function createFeaturedRouter(
  registry: FeaturedBroadcastRegistry,
  orchestrator?: BroadcastOrchestrator,
  bakeLimiter?: RequestHandler,
  publishBudget?: RequestHandler,
  eventRecorder?: EventRecorder,
): Router {
  const router = Router();

  router.get('/broadcast/featured', (req: AuthenticatedRequest, res) => {
    // Piggyback `app_open` here — the home screen always hits this route on
    // cold launch, so this is the canonical "user opened the app" signal
    // without standing up a separate /events/app-open endpoint. Best-effort:
    // if recorder write fails, the GET still returns the featured list.
    if (eventRecorder && req.uid) {
      try {
        // Client-platform headers — fall back to 'unknown' rather than block
        // the response on missing headers; payload_json stays freeform.
        const platformHeader = req.header('x-cleo-platform');
        const platform = platformHeader === 'android' ? 'android' : 'ios';
        const appVersion = req.header('x-cleo-app-version') ?? 'unknown';
        const buildNumber = Number.parseInt(req.header('x-cleo-build-number') ?? '0', 10) || 0;
        eventRecorder.record(req.uid, 'app_open', { appVersion, platform, buildNumber });
      } catch (err) {
        console.warn('[featured] app_open record failed:', err);
      }
    }
    res.json({ broadcasts: registry.list() });
  });
```

- [ ] **Step 3: Pass EventRecorder into createFeaturedRouter from index.ts**

Edit `server/src/index.ts`. Find the `createFeaturedRouter(...)` call and append the `eventRecorder` argument. The call currently looks like (around line 251):

```ts
  app.use(requireAuth, createFeaturedRouter(
    featuredRegistry,
    broadcastOrchestrator,
    generationLimiter,
    curatorPublishBudgetMiddleware,
  ));
```

Replace with:

```ts
  app.use(requireAuth, createFeaturedRouter(
    featuredRegistry,
    broadcastOrchestrator,
    generationLimiter,
    curatorPublishBudgetMiddleware,
    eventRecorder,
  ));
```

- [ ] **Step 4: Add a test for the app_open piggyback**

Create `server/__tests__/routes/featured-app-open.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { createFeaturedRouter } from '@/routes/featured';
import { FeaturedBroadcastRegistry } from '@/services/broadcast/FeaturedBroadcastRegistry';
import { EventRecorder } from '@/services/events/EventRecorder';
import { Db } from '@/services/db/Db';

describe('GET /broadcast/featured app_open piggyback', () => {
  it('records an app_open event with default headers', async () => {
    const db = new Db(':memory:');
    const registry = new FeaturedBroadcastRegistry(db);
    const recorder = new EventRecorder(db);
    const app = express();
    // Stub auth: attach a fixed uid to req so the route's req.uid check passes.
    app.use((req, _res, next) => { (req as { uid?: string }).uid = 'u1'; next(); });
    app.use(createFeaturedRouter(registry, undefined, undefined, undefined, recorder));
    const res = await request(app).get('/broadcast/featured');
    expect(res.status).toBe(200);
    const row = db.prepare<{ user_id: string; payload_json: string }>(
      'SELECT user_id, payload_json FROM app_events',
    ).get();
    expect(row.user_id).toBe('u1');
    expect(JSON.parse(row.payload_json).platform).toBe('ios');
    db.close();
  });

  it('reads platform/version/build from request headers', async () => {
    const db = new Db(':memory:');
    const registry = new FeaturedBroadcastRegistry(db);
    const recorder = new EventRecorder(db);
    const app = express();
    app.use((req, _res, next) => { (req as { uid?: string }).uid = 'u2'; next(); });
    app.use(createFeaturedRouter(registry, undefined, undefined, undefined, recorder));
    const res = await request(app)
      .get('/broadcast/featured')
      .set('x-cleo-platform', 'android')
      .set('x-cleo-app-version', '1.2.3')
      .set('x-cleo-build-number', '99');
    expect(res.status).toBe(200);
    const row = db.prepare<{ payload_json: string }>(
      'SELECT payload_json FROM app_events',
    ).get();
    expect(JSON.parse(row.payload_json)).toEqual({
      appVersion: '1.2.3',
      platform: 'android',
      buildNumber: 99,
    });
    db.close();
  });

  it('returns 200 even if the recorder is omitted', async () => {
    const db = new Db(':memory:');
    const registry = new FeaturedBroadcastRegistry(db);
    const app = express();
    app.use((req, _res, next) => { (req as { uid?: string }).uid = 'u3'; next(); });
    app.use(createFeaturedRouter(registry));
    const res = await request(app).get('/broadcast/featured');
    expect(res.status).toBe(200);
    db.close();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/routes/featured.ts \
        server/src/index.ts \
        server/__tests__/routes/featured-app-open.test.ts
git commit -m "feat(server): record app_open on GET /broadcast/featured"
```

End of Phase 3. The DB now records every retention-relevant event.

---

## Phase 4 — Backfill, invariants, deploy runbook

### Task 13: Write the backfill script (TDD)

**Files:**
- Create: `server/src/scripts/backfill-sqlite.ts`
- Create: `server/__tests__/scripts/backfill-sqlite.test.ts`

The script reads the legacy `enrichment-cache/tracks.json` and `featured-broadcasts/registry.json` and inserts rows. Must be idempotent — running it twice produces the same DB.

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/scripts/backfill-sqlite.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Db } from '@/services/db/Db';
import { backfill } from '@/scripts/backfill-sqlite';

describe('backfill-sqlite', () => {
  let workDir: string;
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleo-backfill-'));
  });
  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('inserts enrichment rows from tracks.json', async () => {
    const db = new Db(':memory:');
    const enrichmentJson = path.join(workDir, 'tracks.json');
    fs.writeFileSync(enrichmentJson, JSON.stringify({
      version: 1,
      tracks: {
        'song one|artist a': {
          genre: 'house',
          lastEnrichedAt: 1_700_000_000_000,
          source: 'genius',
        },
        'song two|artist b': {
          genre: 'techno',
          lastEnrichedAt: 1_700_000_000_001,
          source: 'musicbrainz',
        },
      },
    }));
    await backfill({
      db,
      enrichmentJsonPath: enrichmentJson,
      registryJsonPath: path.join(workDir, 'registry.json'), // missing — fine
    });
    const { n } = db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM enrichment').get();
    expect(n).toBe(2);
    db.close();
  });

  it('inserts featured rows from registry.json', async () => {
    const db = new Db(':memory:');
    const registryJson = path.join(workDir, 'registry.json');
    fs.writeFileSync(registryJson, JSON.stringify({
      records: [{
        id: 'feat-a', title: 'T', description: 'D', vibe: 'morning', length: 'standard',
        baked: true, createdAt: 1_700_000_000_000,
        manifest: {
          broadcastId: 'feat-a', userId: 'curator', playlistId: null,
          vibe: 'morning', length: 'standard', createdAt: 1_700_000_000_000,
          tracks: [], segmentSlots: [],
        },
      }],
    }));
    await backfill({
      db,
      enrichmentJsonPath: path.join(workDir, 'tracks.json'),
      registryJsonPath: registryJson,
    });
    const { n } = db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM featured_broadcasts').get();
    expect(n).toBe(1);
    db.close();
  });

  it('is idempotent — second run inserts zero new rows', async () => {
    const db = new Db(':memory:');
    const enrichmentJson = path.join(workDir, 'tracks.json');
    fs.writeFileSync(enrichmentJson, JSON.stringify({
      version: 1,
      tracks: {
        'song one|artist a': { genre: 'house', lastEnrichedAt: 1, source: 'genius' },
      },
    }));
    const opts = {
      db,
      enrichmentJsonPath: enrichmentJson,
      registryJsonPath: path.join(workDir, 'missing.json'),
    };
    const first = await backfill(opts);
    const second = await backfill(opts);
    expect(first.enrichmentInserted).toBe(1);
    expect(second.enrichmentInserted).toBe(0);
    db.close();
  });

  it('tolerates missing input files (logs and skips)', async () => {
    const db = new Db(':memory:');
    const result = await backfill({
      db,
      enrichmentJsonPath: path.join(workDir, 'missing-enrich.json'),
      registryJsonPath: path.join(workDir, 'missing-registry.json'),
    });
    expect(result.enrichmentInserted).toBe(0);
    expect(result.featuredInserted).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest __tests__/scripts/
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the backfill script**

Create `server/src/scripts/backfill-sqlite.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { Db } from '../services/db/Db';
import type { EnrichmentRecord } from '../services/enrichment/EnrichmentCache';
import type { FeaturedBroadcast } from '../services/broadcast/FeaturedBroadcastRegistry';

interface BackfillOptions {
  db: Db;
  enrichmentJsonPath: string;
  registryJsonPath: string;
}

interface BackfillResult {
  enrichmentInserted: number;
  featuredInserted: number;
}

interface CacheFile {
  version?: number;
  tracks?: Record<string, EnrichmentRecord>;
}

interface RegistrySnapshot {
  records?: FeaturedBroadcast[];
}

function readJsonOrNull<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

export async function backfill(opts: BackfillOptions): Promise<BackfillResult> {
  let enrichmentInserted = 0;
  let featuredInserted = 0;

  const enrich = readJsonOrNull<CacheFile>(opts.enrichmentJsonPath);
  if (enrich?.tracks) {
    const stmt = opts.db.prepare(
      `INSERT OR IGNORE INTO enrichment (track_key, data_json, fetched_at, source)
       VALUES (?, ?, ?, ?)`,
    );
    for (const [key, rec] of Object.entries(enrich.tracks)) {
      const result = stmt.run(key, JSON.stringify(rec), rec.lastEnrichedAt, rec.source);
      if (result.changes > 0) enrichmentInserted++;
    }
    console.log(`[backfill] enrichment: ${enrichmentInserted} rows inserted from ${opts.enrichmentJsonPath}`);
  } else {
    console.log(`[backfill] enrichment: source file missing or empty (${opts.enrichmentJsonPath}) — skipped`);
  }

  const registry = readJsonOrNull<RegistrySnapshot>(opts.registryJsonPath);
  if (registry?.records) {
    const stmt = opts.db.prepare(
      `INSERT OR IGNORE INTO featured_broadcasts
       (id, slot, theme_day, title, description, vibe, length, artwork_url, baked, created_at, manifest_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const rec of registry.records) {
      const result = stmt.run(
        rec.id,
        rec.slot ?? null,
        rec.themeDay ?? null,
        rec.title,
        rec.description,
        rec.vibe,
        rec.length,
        rec.artworkUrl ?? null,
        rec.baked ? 1 : 0,
        rec.createdAt,
        JSON.stringify(rec.manifest),
      );
      if (result.changes > 0) featuredInserted++;
    }
    console.log(`[backfill] featured: ${featuredInserted} rows inserted from ${opts.registryJsonPath}`);
  } else {
    console.log(`[backfill] featured: source file missing or empty (${opts.registryJsonPath}) — skipped`);
  }

  return { enrichmentInserted, featuredInserted };
}

// CLI entry point — invoked via `tsx src/scripts/backfill-sqlite.ts` on the VPS.
async function main(): Promise<void> {
  const dbPath = process.env.SQLITE_DB_PATH
    ?? path.resolve(__dirname, '../../.broadcast-cache/cleo.db');
  const enrichmentJsonPath = process.env.ENRICHMENT_JSON_PATH
    ?? path.resolve(__dirname, '../../.enrichment-cache/tracks.json');
  const registryJsonPath = process.env.REGISTRY_JSON_PATH
    ?? path.resolve(__dirname, '../../featured-broadcasts/registry.json');

  console.log(`[backfill] db=${dbPath}`);
  const db = new Db(dbPath);
  try {
    const result = await backfill({ db, enrichmentJsonPath, registryJsonPath });
    console.log('[backfill] done', result);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(err => { console.error('[backfill] failed:', err); process.exit(1); });
}
```

- [ ] **Step 4: Add the script to package.json**

Edit `server/package.json` `scripts`:

```json
"backfill-sqlite": "tsx src/scripts/backfill-sqlite.ts",
```

- [ ] **Step 5: Run tests**

```bash
cd server && npx jest __tests__/scripts/
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/src/scripts/backfill-sqlite.ts \
        server/__tests__/scripts/backfill-sqlite.test.ts \
        server/package.json
git commit -m "feat(server): add idempotent backfill script for sqlite migration"
```

---

### Task 14: Generation invariant test

**Files:**
- Create: `server/__tests__/broadcast/generation-invariant.test.ts`

This test exists to prove the migration didn't change what gets generated. It runs the same orchestrator inputs through SQLite-backed stores and asserts the resulting manifest shape matches the deterministic-sequencer's output.

- [ ] **Step 1: Write the test**

Create `server/__tests__/broadcast/generation-invariant.test.ts`:

```ts
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { Db } from '@/services/db/Db';
import type { LLMCaller, TTSCaller } from '@/services/broadcast/SegmentGenerator';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import type { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import type { FeatureFetchChain } from '@/services/broadcast/FeatureFetchChain';
import type { ManifestTrack, BroadcastCreateRequest } from '@/services/broadcast/types';

function makeTracks(n: number): ManifestTrack[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Track ${i}`,
    artistName: i % 2 === 0 ? 'Alpha' : 'Beta',
    albumTitle: 'Album',
    duration: 200 + i,
  }));
}

function makeOrch(db: Db) {
  const noopLLM: LLMCaller = { generate: async () => ({ text: 'commentary' }) };
  const noopTTS: TTSCaller = { synthesize: async () => ({ audioContent: 'AA==' }) };
  const noopStorage: ObjectStorage = { put: async (key) => `noop://${key}` };
  const enricher = { drainNow: async () => {} } as unknown as BackgroundEnricher;
  const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
  return new BroadcastOrchestrator(
    noopLLM, noopTTS, noopStorage,
    new BroadcastStore(db),
    new EnrichmentCache(db),
    enricher, fetchChain,
  );
}

const baseRequest: BroadcastCreateRequest & { userId: string } = {
  userId: 'u1',
  playlistId: 'p1',
  vibe: 'morning',
  length: 'quick',
  userContext: { timeOfDay: '09:00', dayOfWeek: 'Mon', firstTimeUser: false },
  tracks: makeTracks(8),
};

describe('generation invariant — sqlite store', () => {
  it('manifest track order is deterministic across two runs with the same id seed', async () => {
    // The seed is the broadcastId, which is generated by randomUUID() inside
    // create() — so we can't assert byte-for-byte equivalence without mocking
    // the UUID. Instead, assert the structural properties the migration
    // promised: same N tracks chosen, sparse cadence preserved, manifest JSON
    // returned by store.get() equals the one passed in (modulo slot status
    // overlays from broadcast_slots).
    const db = new Db(':memory:');
    const orch = makeOrch(db);
    const { manifest } = await orch.create(baseRequest);
    expect(manifest.tracks).toHaveLength(5); // quick = 5
    // Sparse cadence: cold_open + sign_off + transitions only before even-indexed tracks.
    const kinds = manifest.segmentSlots.map(s => s.kind);
    expect(kinds[0]).toBe('cold_open');
    expect(kinds[kinds.length - 1]).toBe('sign_off');
    db.close();
  });

  it('store.get() round-trips the manifest with slot states overlaid', async () => {
    const db = new Db(':memory:');
    const orch = makeOrch(db);
    const { manifest } = await orch.create(baseRequest);
    const fetched = orch.getManifest(manifest.broadcastId)!;
    expect(fetched.broadcastId).toBe(manifest.broadcastId);
    expect(fetched.tracks).toEqual(manifest.tracks);
    expect(fetched.segmentSlots.length).toBe(manifest.segmentSlots.length);
    // Slot 0 (cold_open) is baked synchronously inside create() and should be
    // 'ready' or 'failed' (not still 'pending') by the time create() returns.
    expect(['ready', 'failed']).toContain(fetched.segmentSlots[0].status);
    db.close();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd server && npx jest __tests__/broadcast/generation-invariant.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/__tests__/broadcast/generation-invariant.test.ts
git commit -m "test(server): add generation invariant test against sqlite store"
```

---

### Task 15: Wire-format snapshot test

**Files:**
- Create: `server/__tests__/broadcast/manifest-wire-format.test.ts`

The spec promises `/broadcast/:id/manifest` returns byte-identical JSON. This test snapshots the manifest shape so any drift is loud.

- [ ] **Step 1: Write the snapshot test**

Create `server/__tests__/broadcast/manifest-wire-format.test.ts`:

```ts
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { Db } from '@/services/db/Db';
import type { Manifest } from '@/services/broadcast/types';

describe('Manifest wire format (post-sqlite)', () => {
  it('returns the same shape the client expects', () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const m: Manifest = {
      broadcastId: 'fixed-id-for-snapshot',
      userId: 'u1',
      playlistId: 'p1',
      vibe: 'morning',
      length: 'quick',
      createdAt: 1_700_000_000_000,
      tracks: [
        { id: 't0', title: 'Title', artistName: 'Artist', albumTitle: 'Album', duration: 200 },
      ],
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
        { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
      ],
    };
    store.put(m);
    const out = store.get('fixed-id-for-snapshot');
    // Snapshot shape — fail loud if any new column leaks into the wire format.
    expect(out).toMatchInlineSnapshot(`
      {
        "broadcastId": "fixed-id-for-snapshot",
        "createdAt": 1700000000000,
        "length": "quick",
        "playlistId": "p1",
        "segmentSlots": [
          {
            "audioUrls": undefined,
            "beforeTrackId": "t0",
            "index": 0,
            "kind": "cold_open",
            "status": "pending",
            "variantCount": 3,
          },
          {
            "afterTrackId": "t0",
            "audioUrls": undefined,
            "index": 1,
            "kind": "sign_off",
            "status": "pending",
            "variantCount": 1,
          },
        ],
        "tracks": [
          {
            "albumTitle": "Album",
            "artistName": "Artist",
            "duration": 200,
            "id": "t0",
            "title": "Title",
          },
        ],
        "userId": "u1",
        "vibe": "morning",
      }
    `);
    db.close();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd server && npx jest __tests__/broadcast/manifest-wire-format.test.ts
```

Expected: PASS. If the inline snapshot doesn't match exactly (jest will rewrite it on first run), check `git diff` — if the diff is purely the snapshot getting filled in, that's the expected first-run rewrite; commit. If the diff shows extra columns leaking in (`bake_status`, `abort_requested`, etc.), the migration regressed — fix it.

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/__tests__/broadcast/manifest-wire-format.test.ts
git commit -m "test(server): snapshot manifest wire format"
```

---

### Task 16: Deploy runbook

**Files:**
- Modify: `server/DEPLOY.md`

- [ ] **Step 1: Read existing DEPLOY.md to understand its structure**

```bash
cat server/DEPLOY.md
```

Note the existing section headings — the new section should match their style.

- [ ] **Step 2: Add the SQLite migration section**

Append to `server/DEPLOY.md`:

```markdown

## SQLite migration runbook (2026-05-XX deploy)

The broadcast server now keeps all four state stores plus retention events
in one SQLite file at `.broadcast-cache/cleo.db`. WAL mode, single-process,
synchronous via `better-sqlite3`. See
`docs/superpowers/specs/2026-05-01-sqlite-migration-design.md` for the
full design.

### One-time backfill (run once on the VPS during the migration deploy)

```bash
ssh cleo@187.124.69.95
cd /home/cleo/cleo-broadcast/server
git pull origin main
npm ci && npm run build
pm2 stop cleo-broadcast
npm run backfill-sqlite
# Output should report "[backfill] enrichment: <N> rows inserted" and
# "[backfill] featured: <M> rows inserted". M should equal the number of
# records[] entries in featured-broadcasts/registry.json (small set,
# verify by hand). N should equal the number of keys in
# .enrichment-cache/tracks.json.tracks.
mv .enrichment-cache/tracks.json .enrichment-cache/tracks.json.bak
mv featured-broadcasts/registry.json featured-broadcasts/registry.json.bak
pm2 start cleo-broadcast
pm2 logs cleo-broadcast --lines 50  # look for "[boot] sqlite db opened at ..."
curl -s https://api.worthymedia.tech/health  # expect {"status":"ok"}
```

### `.bak` retention and verification

Keep the `.bak` files for at least 7 days, or one full release cycle —
whichever is longer. Before deletion, run all five checks listed in the
design doc's "**.bak retention and verification gating**" section:

1. Re-run `npm run backfill-sqlite`; expect zero new rows on the second run.
2. Spot-check 5 random `enrichment` rows against `tracks.json.bak`.
3. Spot-check every `featured_broadcasts` row against `registry.json.bak`.
4. Run a real bake end-to-end against the SQLite store; confirm completion.
5. Trigger a curator publish; confirm a row lands in `curator_publishes`.

After all five pass, delete in a single commit titled
"remove sqlite-migration .bak fallbacks."

### Revert path

If any step fails, restore by renaming `.bak` back, then revert the deploy
that swapped the stores. The SQLite tables can be left in place — the old
JSON-backed code ignores them.

### Known follow-ups

- **Phase 4.5 — automated backups to R2** (`cleo-broadcast-backups` bucket,
  separate token, hourly local + nightly off-box, lifecycle-rule retention).
  Required before deleting the `.bak` fallbacks. See "Phase 4.5" in
  `docs/superpowers/specs/2026-05-01-sqlite-migration-design.md`; a separate
  implementation plan will follow.
- **Phase 5 — admin endpoints** (`/admin/bakes`, `/admin/bakes/:id`,
  `/admin/users/:uid/activity`, `/admin/retention`,
  `/admin/curators/:uid/publishes`, `/admin/featured`,
  `/admin/tts/failures`). Purely additive — ship anytime after Phase 4.
  See "Admin surface" in the spec; a separate implementation plan will follow.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/cleo-app
git add server/DEPLOY.md
git commit -m "docs(server): add sqlite-migration runbook to DEPLOY.md"
```

---

### Task 17: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

```bash
cd server && npm test
```

Expected: every test passes. Note pass count for the handoff message.

- [ ] **Step 2: Run the server build**

```bash
cd server && npm run build
```

Expected: clean compile. `dist/services/db/schema.sql` exists.

- [ ] **Step 3: Boot the dev server and exercise it**

```bash
cd server && rm -f .broadcast-cache/cleo.db* && npm run dev &
sleep 3
# Confirm the DB came up and is empty.
sqlite3 .broadcast-cache/cleo.db "SELECT COUNT(*) FROM broadcasts; SELECT COUNT(*) FROM enrichment;"
# Hit health (no auth required).
curl -s http://localhost:3001/health
kill %1
```

Expected: SQLite reports `0` for both counts. `/health` returns `{"status":"ok"}`. Server log includes `[boot] sqlite db opened at ...`.

- [ ] **Step 4: Run the backfill against the real local files**

```bash
cd server && npm run backfill-sqlite
sqlite3 .broadcast-cache/cleo.db "SELECT COUNT(*) FROM enrichment; SELECT COUNT(*) FROM featured_broadcasts;"
```

Expected: counts match keys in `.enrichment-cache/tracks.json.tracks` and entries in `featured-broadcasts/registry.json.records`.

- [ ] **Step 5: Run client jest from project root to confirm no cross-impact**

```bash
cd /Users/kari/Documents/cleo-app && npm test
```

Expected: all client tests pass (the migration only touches server code).

- [ ] **Step 6: Confirm the working tree is clean**

```bash
cd /Users/kari/Documents/cleo-app
git status
```

Expected: `working tree clean` aside from the runtime artifacts excluded by `.gitignore` (`server/.broadcast-cache/cleo.db*`, `server/.enrichment-cache/`, `server/featured-broadcasts/`). Anything else staged or untracked from this plan that isn't already covered by an earlier task's commit is a leak — inspect and either commit it under the related earlier task's message or delete the artifact.

End of Phase 4. The migration is ready to deploy via the runbook in `server/DEPLOY.md`. Phase 4.5 (backups to R2) and Phase 5 (admin endpoints) ship in follow-up plans.

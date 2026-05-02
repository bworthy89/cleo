-- One DB file holds every state store the broadcast server keeps.
-- Applied idempotently at boot via Db's `db.exec(readSchemaSql())` call.
-- Source of truth for shape: docs/superpowers/specs/2026-05-01-sqlite-migration-design.md

-- Replaces BroadcastStore.entries
CREATE TABLE IF NOT EXISTS broadcasts (
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
CREATE INDEX IF NOT EXISTS idx_broadcasts_user_created ON broadcasts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_bakestatus  ON broadcasts(bake_status, created_at);

CREATE TABLE IF NOT EXISTS broadcast_slots (
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
CREATE TABLE IF NOT EXISTS enrichment (
  track_key       TEXT PRIMARY KEY,       -- normalizeKey(title, artist)
  data_json       TEXT NOT NULL,          -- EnrichmentRecord blob
  fetched_at      INTEGER NOT NULL,       -- enables 30-day re-enrichment query
  source          TEXT NOT NULL           -- denormalized for admin queries
);
CREATE INDEX IF NOT EXISTS idx_enrichment_fetched ON enrichment(fetched_at);

-- Replaces featured-broadcasts/registry.json
CREATE TABLE IF NOT EXISTS featured_broadcasts (
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
CREATE INDEX IF NOT EXISTS idx_featured_slot_baked ON featured_broadcasts(slot, baked);

-- Replaces CuratorPublishBudget.entries
CREATE TABLE IF NOT EXISTS curator_publishes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  curator_uid     TEXT NOT NULL,
  published_at    INTEGER NOT NULL,
  broadcast_id    TEXT                    -- nullable; for forensics
);
CREATE INDEX IF NOT EXISTS idx_curator_uid_time ON curator_publishes(curator_uid, published_at);

-- New: retention measurement (Phase 2 gate unlock)
CREATE TABLE IF NOT EXISTS app_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  event_type      TEXT NOT NULL,          -- 'app_open' | 'broadcast_started' | 'broadcast_completed' | 'broadcast_failed' | 'track_completed'
  occurred_at     INTEGER NOT NULL,
  broadcast_id    TEXT,                   -- nullable
  payload_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON app_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON app_events(event_type, occurred_at);

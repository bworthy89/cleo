import { Db } from '@/services/db/Db';
import { DbBootError } from '@/services/db/errors';

describe('Db', () => {
  it('opens an in-memory database and applies the schema', () => {
    const db = new Db(':memory:');
    // All six tables must exist after boot. Filter out sqlite_% — SQLite
    // auto-creates sqlite_sequence when AUTOINCREMENT is used (we use it on
    // curator_publishes.id and app_events.id), and it would otherwise show
    // up alongside our user tables.
    const tables = db.prepare<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
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
    ).get()!;
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
    ).get()!;
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
    ).get()!;
    expect(n).toBe(1);
    db.close();
  });
});

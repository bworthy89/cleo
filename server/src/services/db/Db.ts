import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { DbBootError } from './errors';

type BetterSqliteDatabase = ReturnType<typeof Database>;
type RawStatement = ReturnType<BetterSqliteDatabase['prepare']>;

export interface Statement<Row = unknown> {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  /** Returns the first matching row, or `undefined` if none — matches
   *  better-sqlite3's runtime behavior. Callers must narrow before use. */
  get(...params: unknown[]): Row | undefined;
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
    this.db.transaction(() => {
      // Capture the set of broadcast ids that were 'baking' at boot — i.e.,
      // the bakes whose owning process died mid-flight. Use this explicit set
      // for both the broadcasts UPDATE and the slot UPDATE so the sweep
      // affects only the just-transitioned bakes, not older 'failed' rows
      // from previous crashes.
      const baking = this.db.prepare(
        "SELECT id FROM broadcasts WHERE bake_status='baking'",
      ).all() as Array<{ id: string }>;
      if (baking.length === 0) return;
      const ids = baking.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      this.db.prepare(
        `UPDATE broadcasts SET bake_status='failed' WHERE id IN (${placeholders})`,
      ).run(...ids);
      this.db.prepare(
        `UPDATE broadcast_slots SET status='aborted', updated_at=? ` +
        `WHERE status='pending' AND broadcast_id IN (${placeholders})`,
      ).run(now, ...ids);
    })();
  }
}

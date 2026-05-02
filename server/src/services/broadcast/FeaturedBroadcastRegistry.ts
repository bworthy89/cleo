import type { Manifest } from './types';
import type { SlotKey, DayOfWeek } from '../../config/tonightOnOnay';
import type { Db } from '../db/Db';

export interface FeaturedBroadcast {
  id: string;
  /** Present iff this is a Tonight-on-ONAY slot record. Fixed ids
   *  `slot_morning` / `slot_evening` make re-bakes replace by natural key. */
  slot?: SlotKey;
  /** Day whose theme was used for this bake — denormalized onto the
   *  record so the client doesn't need to re-derive it. */
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
  let manifest: Manifest;
  try {
    manifest = JSON.parse(row.manifest_json) as Manifest;
  } catch (err) {
    throw new Error(`featured_broadcasts.manifest_json corrupt for id="${row.id}": ${(err as Error).message}`);
  }
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
    manifest,
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

  /** Baked records only, ordered: morning slot → evening slot → legacy. */
  list(): FeaturedBroadcast[] {
    // Slot ordering: morning (0) → evening (1) → legacy (2). CASE expression
    // replaces the old hand-rolled rank() function from the JSON-file version.
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

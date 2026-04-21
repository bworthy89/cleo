import * as fs from 'fs/promises';
import * as path from 'path';
import type { Manifest } from './types';
import type { SlotKey, DayOfWeek } from '../../config/tonightOnOnay';

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

interface Snapshot { records: FeaturedBroadcast[] }

export class FeaturedBroadcastRegistry {
  private records: FeaturedBroadcast[] = [];

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Snapshot;
      this.records = parsed.records ?? [];
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT') { this.records = []; return; }
      // Malformed JSON should not crash startup. Log, reset, and continue —
      // a corrupted registry is recoverable by re-running bakeFeatured jobs.
      console.warn(`[FeaturedBroadcastRegistry] load failed, resetting:`, err);
      this.records = [];
    }
  }

  async put(record: FeaturedBroadcast): Promise<void> {
    const idx = this.records.findIndex(r => r.id === record.id);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
    await this.save();
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter(r => r.id !== id);
    await this.save();
  }

  /** Baked records only, ordered: morning slot → evening slot → legacy. */
  list(): FeaturedBroadcast[] {
    const baked = this.records.filter(r => r.baked);
    const rank = (r: FeaturedBroadcast) =>
      r.slot === 'morning' ? 0 : r.slot === 'evening' ? 1 : 2;
    return [...baked]
      .sort((a, b) => rank(a) - rank(b))
      .map(r => ({ ...r }));
  }

  getBySlot(slot: SlotKey): FeaturedBroadcast | null {
    const hit = this.records.find(r => r.baked && r.slot === slot);
    return hit ? { ...hit } : null;
  }

  /** Atomic write: tmp file + rename. Prevents registry corruption if the
   *  process crashes mid-write. */
  private async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ records: this.records }, null, 2));
    await fs.rename(tmp, this.filePath);
  }
}

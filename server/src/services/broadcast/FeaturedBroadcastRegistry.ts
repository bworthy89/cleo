import * as fs from 'fs/promises';
import * as path from 'path';
import type { Manifest } from './types';

export interface FeaturedBroadcast {
  id: string;
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

  list(): FeaturedBroadcast[] {
    return this.records.filter(r => r.baked).map(r => ({ ...r }));
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

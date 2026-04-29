import { promises as fs } from 'fs';
import * as path from 'path';

const DEBOUNCE_MS = 50;

export class BotStateStore {
  private cache = new Map<string, unknown>();
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly dir: string) {}

  async read<T>(filename: string, defaultValue: T): Promise<T> {
    if (this.cache.has(filename)) return this.cache.get(filename) as T;
    const filePath = path.join(this.dir, filename);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as T;
      this.cache.set(filename, parsed);
      return parsed;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return defaultValue;
      console.error(`[bot:state] malformed json ${filename}, returning default`, err);
      return defaultValue;
    }
  }

  async write<T>(filename: string, value: T): Promise<void> {
    this.cache.set(filename, value);
    const existing = this.pending.get(filename);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.flushOne(filename).catch((err) => {
        console.error(`[bot:state] flush failed for ${filename}`, err);
      });
    }, DEBOUNCE_MS);
    this.pending.set(filename, timer);
  }

  async flush(): Promise<void> {
    const filenames = Array.from(this.pending.keys());
    for (const filename of filenames) {
      const t = this.pending.get(filename);
      if (t) clearTimeout(t);
      this.pending.delete(filename);
      await this.flushOne(filename);
    }
  }

  private async flushOne(filename: string): Promise<void> {
    if (!this.cache.has(filename)) return;
    await fs.mkdir(this.dir, { recursive: true });
    const filePath = path.join(this.dir, filename);
    const tmpPath = `${filePath}.tmp`;
    const value = this.cache.get(filename);
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
    this.pending.delete(filename);
  }
}

export interface BugEntry {
  status: 'filed' | 'pendingManual';
  repo: string;
  issueNumber?: number;
  filedAt?: string;
  lastErrorAt?: string;
}

export type BugThreadIssueMap = Record<string, BugEntry>;

export interface LastDigests {
  voteDigestAt?: string;
  vibeDigestAt?: string;
}

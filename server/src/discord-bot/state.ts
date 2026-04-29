import { promises as fs } from 'fs';
import * as path from 'path';

const DEBOUNCE_MS = 50;

export class BotStateStore {
  private cache = new Map<string, unknown>();
  private pending = new Map<string, NodeJS.Timeout>();
  private inFlight = new Map<string, Promise<void>>();

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
      // Remove our own pending entry FIRST so any write that lands during
      // flushOne can schedule a fresh timer that we don't accidentally wipe.
      if (this.pending.get(filename) === timer) {
        this.pending.delete(filename);
      }
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
      if (t) {
        clearTimeout(t);
        this.pending.delete(filename);
      }
    }
    // Kick flushOne for every key that was pending, then await all
    // in-flight promises (including any already running for other keys)
    // in parallel.
    const all: Array<Promise<void>> = [];
    for (const filename of filenames) {
      all.push(this.flushOne(filename));
    }
    // Also await any flushOne already running for keys not in `filenames`.
    for (const [, p] of this.inFlight) {
      all.push(p);
    }
    await Promise.all(all);
  }

  private flushOne(filename: string): Promise<void> {
    // Dedupe concurrent calls for the same filename — both callers share
    // the single in-flight promise rather than racing on rename.
    const existing = this.inFlight.get(filename);
    if (existing) return existing;

    const promise = (async () => {
      if (!this.cache.has(filename)) return;
      await fs.mkdir(this.dir, { recursive: true });
      const filePath = path.join(this.dir, filename);
      const tmpPath = `${filePath}.tmp`;
      const value = this.cache.get(filename);
      await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
      await fs.rename(tmpPath, filePath);
    })().finally(() => {
      // Only clear the in-flight map entry if it's still ours (paranoid
      // guard against any future re-entrancy).
      if (this.inFlight.get(filename) === promise) {
        this.inFlight.delete(filename);
      }
    });

    this.inFlight.set(filename, promise);
    return promise;
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

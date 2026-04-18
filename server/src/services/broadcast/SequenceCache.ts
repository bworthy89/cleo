import { createHash } from 'crypto';
import type { Vibe, BroadcastLength } from './types';

export interface SequenceCacheValue {
  ordered: string[];
  featureSlots: number[];
}

interface CacheEntry {
  value: SequenceCacheValue;
  expiresAt: number;
}

interface Options {
  ttlMs?: number;
  maxEntries?: number;
}

export class SequenceCache {
  private entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts: Options = {}) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 500;
  }

  private makeKey(trackIds: string[], vibe: Vibe, length: BroadcastLength): string {
    const sorted = [...trackIds].sort().join('|');
    const hash = createHash('sha256').update(sorted).digest('hex');
    return `${hash}|${vibe}|${length}`;
  }

  get(
    trackIds: string[], vibe: Vibe, length: BroadcastLength,
  ): SequenceCacheValue | null {
    const key = this.makeKey(trackIds, vibe, length);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    // LRU: re-insert to mark recently used
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(
    trackIds: string[],
    vibe: Vibe,
    length: BroadcastLength,
    value: SequenceCacheValue,
  ): void {
    const key = this.makeKey(trackIds, vibe, length);
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface CuratorPublishBudgetOptions {
  capPerWindow: number;
  windowMs: number;
  clock?: () => number;
}

export type ReserveResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number; current: number };

/**
 * Per-curator rolling-window publish quota. State is in-memory
 * Map<uid, timestamp[]>; entries are pruned lazily on every read,
 * so there is no background timer.
 */
export class CuratorPublishBudget {
  private readonly capPerWindow: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  private readonly entries = new Map<string, number[]>();

  constructor(opts: CuratorPublishBudgetOptions) {
    this.capPerWindow = opts.capPerWindow;
    this.windowMs = opts.windowMs;
    this.clock = opts.clock ?? Date.now;
  }

  tryReserve(uid: string): ReserveResult {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const existing = this.entries.get(uid) ?? [];
    // Drop entries on or before the cutoff (rolling window: an entry
    // exactly windowMs old is no longer "in the window").
    const list = existing.filter(t => t > cutoff);

    if (list.length >= this.capPerWindow) {
      const oldest = list[0];
      const retryAfterMs = oldest + this.windowMs - now;
      this.entries.set(uid, list); // persist the pruned list
      return { ok: false, retryAfterMs, current: list.length };
    }

    list.push(now);
    this.entries.set(uid, list);
    return { ok: true };
  }
}

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { bakeTelemetry } from '../telemetry/BakeTelemetry';

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
  readonly capPerWindow: number;
  readonly windowMs: number;
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

/**
 * Express middleware that gates the wrapped handler on the curator's
 * remaining quota. Must run after auth so req.uid is populated.
 *
 * - 200 path: tryReserve → ok → next()
 * - 429 path: tryReserve → !ok → Retry-After header + JSON body, telemetry fires
 * - 500 path: req.uid missing → defensive bail (auth chain is misconfigured)
 */
export function makeCuratorPublishBudgetMiddleware(
  budget: CuratorPublishBudget,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const uid = (req as AuthenticatedRequest).uid;
    if (!uid) {
      // Auth chain misconfigured — requireAuth must run before this
      // middleware. Log the diagnostic and return a generic 500 so the
      // implementation vocabulary doesn't leak to the client.
      console.error('[CuratorPublishBudget] req.uid not set — requireAuth must run first');
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    const result = budget.tryReserve(uid);
    if (result.ok) {
      next();
      return;
    }

    // result is narrowed to { ok: false; retryAfterMs: number; current: number }
    // by the discriminated union — no defensive ?? fallbacks needed.
    const { retryAfterMs, current } = result;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    const cap = budget.capPerWindow;

    // Format the window as the most-precise integer-friendly unit:
    // exact-hour windows render as "Xh", sub-minute windows render
    // as "<1m" to avoid the misleading "0m" / "1m" rounding, otherwise
    // as "Xm". Avoids misleading rounding when the window is
    // configured below 1h.
    const windowMs = budget.windowMs;
    const windowLabel = windowMs % (60 * 60 * 1000) === 0
      ? `${windowMs / (60 * 60 * 1000)}h`
      : windowMs < 60 * 1000
        ? '<1m'
        : `${Math.round(windowMs / (60 * 1000))}m`;

    // Same sub-minute treatment for the retry-after phrase: floor
    // to minutes, but render "<1m" when both hours and minutes round
    // to zero so the user doesn't see "0m".
    const hours = Math.floor(retryAfterMs / (60 * 60 * 1000));
    const minutes = Math.floor((retryAfterMs % (60 * 60 * 1000)) / (60 * 1000));
    const human = hours > 0
      ? `${hours}h ${minutes}m`
      : minutes === 0
        ? '<1m'
        : `${minutes}m`;

    bakeTelemetry.recordPublishCapHit({
      uid,
      current,
      retryAfterMs,
    });

    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: `Publish cap reached (${cap} per ${windowLabel}). Try again in ~${human}.`,
      retryAfterMs,
    });
  };
}

import { Db } from '@/services/db/Db';
import { CuratorPublishBudget } from '@/services/curator/CuratorPublishBudget';

describe('CuratorPublishBudget', () => {
  describe('tryReserve — under cap', () => {
    it('returns { ok: true } for first reserve', () => {
      const now = 1_000_000;
      const db = new Db(':memory:');
      const budget = new CuratorPublishBudget({
        db,
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      expect(budget.tryReserve('uid-a')).toEqual({ ok: true });
      db.close();
    });

    it('returns { ok: true } for second reserve under cap', () => {
      const now = 1_000_000;
      const db = new Db(':memory:');
      const budget = new CuratorPublishBudget({
        db,
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      expect(budget.tryReserve('uid-a')).toEqual({ ok: true });
      db.close();
    });
  });

  describe('tryReserve — at cap', () => {
    it('rejects fourth reserve when cap is 3', () => {
      const now = 1_000_000;
      const db = new Db(':memory:');
      const budget = new CuratorPublishBudget({
        db,
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      const result = budget.tryReserve('uid-a');
      if (result.ok) throw new Error('expected rejection');
      expect(result.current).toBe(3);
      // First reserve was at `now`; the window expires at now + windowMs.
      // retryAfterMs = (oldestEntry + windowMs) - now = windowMs (since clock didn't move).
      expect(result.retryAfterMs).toBe(24 * 60 * 60 * 1000);
      db.close();
    });

    it('does not push a new timestamp when rejecting', () => {
      const now = 1_000_000;
      const db = new Db(':memory:');
      const budget = new CuratorPublishBudget({
        db,
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a'); // rejected
      // Verify that only 3 rows were inserted (the rejected call must not have written).
      const rows = db.prepare<{ count: number }>(
        'SELECT COUNT(*) AS count FROM curator_publishes WHERE curator_uid = ?',
      ).all('uid-a');
      expect(rows[0].count).toBe(3);
      db.close();
    });
  });

  describe('tryReserve — rolling-window pruning', () => {
    it('admits a new reserve after windowMs elapses', () => {
      let now = 1_000_000;
      const windowMs = 24 * 60 * 60 * 1000;
      const db = new Db(':memory:');
      const budget = new CuratorPublishBudget({
        db,
        capPerWindow: 3,
        windowMs,
        clock: () => now,
      });
      budget.tryReserve('uid-a'); // t=1_000_000
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      expect(budget.tryReserve('uid-a').ok).toBe(false);

      // Advance past the first entry's window expiry. With the prune
      // rule "drop entries where t <= now - windowMs", at exactly
      // now = 1_000_000 + windowMs the oldest is on the boundary and
      // pruned; the next reserve must succeed.
      now = 1_000_000 + windowMs;
      const result = budget.tryReserve('uid-a');
      expect(result.ok).toBe(true);
      db.close();
    });

    it('does not accumulate entries outside the window', () => {
      let now = 0;
      const windowMs = 100;
      const db = new Db(':memory:');
      const budget = new CuratorPublishBudget({
        db,
        capPerWindow: 3,
        windowMs,
        clock: () => now,
      });
      // Four reserves: at t=0, t=50, t=100, t=100.
      // At t=100 the first reserve (t=0) is on the boundary and should
      // be pruned (published_at > cutoff, cutoff = 100 - 100 = 0, so
      // t=0 is NOT > 0 → excluded), leaving {50, 100} before the second
      // t=100 push, then {50, 100, 100} after.
      budget.tryReserve('uid-a');
      now = 50;
      budget.tryReserve('uid-a');
      now = 100;
      budget.tryReserve('uid-a');
      const result = budget.tryReserve('uid-a');
      expect(result.ok).toBe(true);
      // Verify: after the fourth successful reserve, exactly 3 in-window
      // rows exist for uid-a (the t=0 row is outside the window at now=100).
      const rows = db.prepare<{ count: number }>(
        'SELECT COUNT(*) AS count FROM curator_publishes WHERE curator_uid = ? AND published_at > ?',
      ).all('uid-a', now - windowMs);
      expect(rows[0].count).toBe(3);
      db.close();
    });
  });

  describe('tryReserve — per-uid isolation', () => {
    it('uid A at cap does not block uid B', () => {
      const now = 1_000_000;
      const db = new Db(':memory:');
      const budget = new CuratorPublishBudget({
        db,
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      expect(budget.tryReserve('uid-a').ok).toBe(false);

      expect(budget.tryReserve('uid-b').ok).toBe(true);
      expect(budget.tryReserve('uid-b').ok).toBe(true);
      expect(budget.tryReserve('uid-b').ok).toBe(true);
      expect(budget.tryReserve('uid-b').ok).toBe(false);
      db.close();
    });
  });

  it('persists across CuratorPublishBudget instances on the same Db', () => {
    let now = 1_000_000;
    const db = new Db(':memory:');
    const opts = { db, capPerWindow: 3, windowMs: 60_000, clock: () => now };
    const a = new CuratorPublishBudget(opts);
    expect(a.tryReserve('u1').ok).toBe(true);
    expect(a.tryReserve('u1').ok).toBe(true);
    expect(a.tryReserve('u1').ok).toBe(true);
    const b = new CuratorPublishBudget(opts);
    const result = b.tryReserve('u1');
    expect(result.ok).toBe(false);
    db.close();
  });
});

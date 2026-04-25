import { CuratorPublishBudget } from '@/services/curator/CuratorPublishBudget';

describe('CuratorPublishBudget', () => {
  describe('tryReserve — under cap', () => {
    it('returns { ok: true } for first reserve', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      expect(budget.tryReserve('uid-a')).toEqual({ ok: true });
    });

    it('returns { ok: true } for second reserve under cap', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      expect(budget.tryReserve('uid-a')).toEqual({ ok: true });
    });
  });

  describe('tryReserve — at cap', () => {
    it('rejects fourth reserve when cap is 3', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
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
    });

    it('does not push a new timestamp when rejecting', () => {
      const now = 1_000_000;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs: 24 * 60 * 60 * 1000,
        clock: () => now,
      });
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a');
      budget.tryReserve('uid-a'); // rejected
      // Reach into private state via a cast for whitebox verification.
      const list = (budget as unknown as { entries: Map<string, number[]> })
        .entries.get('uid-a')!;
      expect(list.length).toBe(3);
    });
  });

  describe('tryReserve — rolling-window pruning', () => {
    it('admits a new reserve after windowMs elapses', () => {
      let now = 1_000_000;
      const windowMs = 24 * 60 * 60 * 1000;
      const budget = new CuratorPublishBudget({
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
    });

    it('does not accumulate entries outside the window', () => {
      let now = 0;
      const windowMs = 100;
      const budget = new CuratorPublishBudget({
        capPerWindow: 3,
        windowMs,
        clock: () => now,
      });
      // Four reserves: at t=0, t=50, t=100, t=100.
      // At t=100 the first reserve (t=0) is on the boundary and should
      // be pruned, leaving {50, 100} before the second t=100 push,
      // then {50, 100, 100} after.
      budget.tryReserve('uid-a');
      now = 50;
      budget.tryReserve('uid-a');
      now = 100;
      budget.tryReserve('uid-a');
      const result = budget.tryReserve('uid-a');
      expect(result.ok).toBe(true);
      const list = (budget as unknown as { entries: Map<string, number[]> })
        .entries.get('uid-a')!;
      expect(list).toEqual([50, 100, 100]);
    });
  });
});

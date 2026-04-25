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
});

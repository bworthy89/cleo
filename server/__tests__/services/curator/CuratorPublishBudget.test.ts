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
});

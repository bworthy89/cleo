import {
  SLOT_THEMES,
  getThemeFor,
  type SlotKey,
  type DayOfWeek,
} from '@/config/tonightOnOnay';

describe('tonightOnOnay theme library', () => {
  it('has exactly 14 entries — one per (day × slot)', () => {
    expect(SLOT_THEMES).toHaveLength(14);
  });

  it('has one entry for every (slot, day) pair with no duplicates', () => {
    const slots: SlotKey[] = ['morning', 'evening'];
    const days: DayOfWeek[] = ['mon','tue','wed','thu','fri','sat','sun'];
    const seen = new Set<string>();
    for (const s of slots) for (const d of days) {
      const key = `${s}:${d}`;
      const match = SLOT_THEMES.filter(t => t.slot === s && t.day === d);
      expect(match).toHaveLength(1);
      seen.add(key);
    }
    expect(seen.size).toBe(14);
  });

  it('getThemeFor returns the right entry', () => {
    const t = getThemeFor('morning', 'tue');
    expect(t.slot).toBe('morning');
    expect(t.day).toBe('tue');
    expect(typeof t.title).toBe('string');
    expect(t.title.length).toBeGreaterThan(0);
  });

  it('every entry has a valid vibe and length', () => {
    const vibes = new Set(['morning','focus','workout','feelGood','lateNight','melancholy','party']);
    const lengths = new Set(['quick','standard','long']);
    for (const t of SLOT_THEMES) {
      expect(vibes.has(t.vibe)).toBe(true);
      expect(lengths.has(t.length)).toBe(true);
      expect(t.title.length).toBeLessThanOrEqual(120);
      expect(t.description.length).toBeLessThanOrEqual(400);
    }
  });
});

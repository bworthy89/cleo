import {
  DAYS_ORDERED,
  buildSlotPrefill,
  shouldWarnVibeMismatch,
} from '../../src/components/broadcast/publishFeaturedSheet.helpers';
import { getThemeFor } from '../../src/config/tonightOnOnay';

describe('publishFeaturedSheet.helpers', () => {
  it('DAYS_ORDERED starts Monday, ends Sunday', () => {
    expect(DAYS_ORDERED).toEqual(['mon','tue','wed','thu','fri','sat','sun']);
  });

  it('buildSlotPrefill pulls the right theme', () => {
    const p = buildSlotPrefill('morning', 'tue');
    const t = getThemeFor('morning', 'tue');
    expect(p.id).toBe('slot_morning');
    expect(p.slot).toBe('morning');
    expect(p.themeDay).toBe('tue');
    expect(p.title).toBe(t.title);
    expect(p.description).toBe(t.description);
    expect(p.vibe).toBe(t.vibe);
    expect(p.length).toBe(t.length);
  });

  it('shouldWarnVibeMismatch: true when session vibe differs from slot vibe', () => {
    expect(shouldWarnVibeMismatch('party', 'morning')).toBe(true);
    expect(shouldWarnVibeMismatch('morning', 'morning')).toBe(false);
    expect(shouldWarnVibeMismatch(undefined, 'morning')).toBe(false);
  });
});

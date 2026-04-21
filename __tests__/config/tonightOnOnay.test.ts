import {
  SLOT_THEMES as CLIENT,
  getThemeFor as getClient,
  type SlotKey,
  type DayOfWeek,
} from '../../src/config/tonightOnOnay';
import { SLOT_THEMES as SERVER } from '../../server/src/config/tonightOnOnay';

describe('tonightOnOnay client mirror', () => {
  it('has 14 entries', () => {
    expect(CLIENT).toHaveLength(14);
  });

  it('matches server 1:1 on (slot, day, vibe, length)', () => {
    // Title + description may drift slightly for display reasons; the
    // structural fields that drive validation must not drift.
    const keyOf = (t: { slot: string; day: string; vibe: string; length: string }) =>
      `${t.slot}:${t.day}:${t.vibe}:${t.length}`;
    expect(new Set(CLIENT.map(keyOf))).toEqual(new Set(SERVER.map(keyOf)));
  });

  it('getThemeFor returns a usable entry', () => {
    const t = getClient('evening' as SlotKey, 'fri' as DayOfWeek);
    expect(t.title.length).toBeGreaterThan(0);
  });
});

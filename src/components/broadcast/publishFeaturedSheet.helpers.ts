import { getThemeFor, type SlotKey, type DayOfWeek, type SlotTheme } from '../../config/tonightOnOnay';
import type { Manifest } from '../../engines/BroadcastPlayer.types';

export const DAYS_ORDERED: DayOfWeek[] = ['mon','tue','wed','thu','fri','sat','sun'];

export interface SlotPrefill {
  id: string;
  slot: SlotKey;
  themeDay: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
}

export function buildSlotPrefill(slot: SlotKey, day: DayOfWeek): SlotPrefill {
  const t: SlotTheme = getThemeFor(slot, day);
  return {
    id: `slot_${slot}`,
    slot,
    themeDay: day,
    title: t.title,
    description: t.description,
    vibe: t.vibe,
    length: t.length,
  };
}

/** True when the caller's current session vibe disagrees with the slot's
 *  theme vibe. Shows the soft warning band in the publish sheet. */
export function shouldWarnVibeMismatch(
  sessionVibe: Manifest['vibe'] | undefined,
  slotVibe: Manifest['vibe'],
): boolean {
  return !!sessionVibe && sessionVibe !== slotVibe;
}

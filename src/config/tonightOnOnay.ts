import type { Manifest } from '../engines/BroadcastPlayer.types';

export type SlotKey = 'morning' | 'evening';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SlotTheme {
  slot: SlotKey;
  day: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
}

// v1 placeholder schedule — curator will tune copy before shipping.
// Keeps the grid functionally complete (14 entries, valid vibes/lengths).
export const SLOT_THEMES: SlotTheme[] = [
  // ── Morning slots ──────────────────────────────────────────────
  { slot: 'morning', day: 'mon', title: 'Monday Reset',       description: 'Slow start. Coffee first, noise later.',        vibe: 'morning',   length: 'standard' },
  { slot: 'morning', day: 'tue', title: 'Throwback Tuesday',  description: 'Old favorites to dust off the week.',            vibe: 'feelGood',  length: 'standard' },
  { slot: 'morning', day: 'wed', title: 'Midweek Lift',       description: 'Enough momentum to get over the hump.',          vibe: 'feelGood',  length: 'quick'    },
  { slot: 'morning', day: 'thu', title: 'Thursday Flow',      description: 'Focus music for the part of the week that ships.', vibe: 'focus',  length: 'standard' },
  { slot: 'morning', day: 'fri', title: 'Friday Warmup',      description: 'A shoulder-roll before the weekend starts.',     vibe: 'feelGood',  length: 'quick'    },
  { slot: 'morning', day: 'sat', title: 'Slow Pour',          description: 'Saturday as it was meant to be taken.',          vibe: 'morning',   length: 'standard' },
  { slot: 'morning', day: 'sun', title: 'Gentle Start',       description: 'Sundays are for returning to yourself.',         vibe: 'morning',   length: 'long'     },
  // ── Evening slots ──────────────────────────────────────────────
  { slot: 'evening', day: 'mon', title: 'Monday Unwind',      description: 'Off the clock, into the dim.',                   vibe: 'lateNight', length: 'standard' },
  { slot: 'evening', day: 'tue', title: 'Melancholy Hour',    description: 'Blue-hour records. Sit with them.',              vibe: 'melancholy', length: 'standard' },
  { slot: 'evening', day: 'wed', title: 'Focus Cuts',         description: 'Late-night studio sessions with nothing to prove.', vibe: 'focus', length: 'standard' },
  { slot: 'evening', day: 'thu', title: 'Thursday Build',     description: 'A slow climb toward the weekend.',               vibe: 'feelGood',  length: 'standard' },
  { slot: 'evening', day: 'fri', title: 'Friday Feels',       description: 'Whatever you need the night to be.',             vibe: 'party',     length: 'long'     },
  { slot: 'evening', day: 'sat', title: 'Saturday Pour',      description: 'The loud part of the evening.',                  vibe: 'party',     length: 'long'     },
  { slot: 'evening', day: 'sun', title: 'Late Night Soul',    description: 'Warm records for the last hour of the week.',    vibe: 'lateNight', length: 'standard' },
];

export function getThemeFor(slot: SlotKey, day: DayOfWeek): SlotTheme {
  const match = SLOT_THEMES.find(t => t.slot === slot && t.day === day);
  if (!match) throw new Error(`no theme for ${slot}/${day}`);
  return match;
}

/** Helper for computing today's DayOfWeek from a Date (curator's local time). */
export function dayOfWeekFor(date: Date): DayOfWeek {
  const days: DayOfWeek[] = ['sun','mon','tue','wed','thu','fri','sat'];
  return days[date.getDay()];
}

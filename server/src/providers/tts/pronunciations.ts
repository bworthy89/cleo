import dict from './pronunciations.json';

/**
 * Artist-name pronunciation overrides, ported from the Cartesia pronunciation
 * dictionary (pdict_xuZ82HwXjZMHzQLEvB26Bb) so the self-hosted primary
 * (VoxCPM today, F5-TTS historically) — which has no server-side dict API —
 * gets the same phonetic corrections as the paid providers.
 *
 * The map is applied locally before handing text to any TTS provider, which
 * means Cartesia/ElevenLabs now receive pre-substituted text and their own
 * server-side dicts become no-ops for these entries. Output is identical.
 *
 * Entries are sorted longest-first at compile time so multi-word entries
 * ("Boosie Badazz") match before their prefixes ("Boosie").
 */

type PronDict = Record<string, string>;
const entries = Object.entries(dict as PronDict).sort((a, b) => b[0].length - a[0].length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Unicode-safe word boundary: require non-alphanumeric (or start/end) on both sides.
// Plain \b doesn't work for entries with accented chars (Aminé, Jhené) because é
// isn't a \w character.
const pattern = entries.length === 0
  ? null
  : new RegExp(`(?<![A-Za-z0-9])(?:${entries.map(([k]) => escape(k)).join('|')})(?![A-Za-z0-9])`, 'g');

const lookup: PronDict = Object.fromEntries(entries);

export function applyPronunciations(text: string): string {
  if (!pattern) return text;
  return text.replace(pattern, (match) => lookup[match] ?? match);
}

export const __pronunciationCount = entries.length;

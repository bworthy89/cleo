export type GenreFamily =
  | 'jazz' | 'hipHop' | 'rnb' | 'rock' | 'electronic'
  | 'folk' | 'pop' | 'global' | 'gospel' | 'generic';

/**
 * Map a raw genre string (from MusicBrainz, Apple Music, or Last.fm) to one
 * of our playbook families. Keyword matching with priority order — gospel
 * before rnb so "gospel soul" routes to gospel; jazz before rnb so "jazz
 * fusion" routes to jazz not funk; electronic before pop for electro-pop
 * crossovers; hipHop before rnb for hip-hop soul; global before rock so
 * "reggae rock" routes to global.
 */
export function normalizeGenreFamily(raw?: string | string[]): GenreFamily {
  if (!raw) return 'generic';
  const s = (Array.isArray(raw) ? raw.join(' ') : raw).toLowerCase();
  if (!s.trim()) return 'generic';
  if (/gospel|spirituals?|praise.+worship|quartet.+gospel/.test(s)) return 'gospel';
  if (/jazz|bebop|bossa|fusion|big band|post[- ]?bop/.test(s)) return 'jazz';
  if (/hip[- ]?hop|rap|trap|drill|boom[- ]?bap/.test(s)) return 'hipHop';
  if (/r&?b|soul|motown|quiet storm|neo[- ]?soul|funk|disco/.test(s)) return 'rnb';
  if (/electronic|edm|house|techno|trance|dnb|drum[^a-z]*(and|n)?[^a-z]*bass|dubstep|garage|ambient|idm|trip[- ]?hop|electro[- ]?pop|synth[- ]?pop|synthpop|electropop/.test(s)) return 'electronic';
  if (/afrobeat|reggae|reggaeton|cumbia|samba|latin|highlife|global|world|dancehall|ska/.test(s)) return 'global';
  if (/folk|country|bluegrass|americana|singer.?songwriter|blues/.test(s)) return 'folk';
  if (/rock|punk|grunge|indie|alternative|metal/.test(s)) return 'rock';
  if (/pop|k-?pop|j-?pop/.test(s)) return 'pop';
  return 'generic';
}

export const GENRE_PLAYBOOK: Record<GenreFamily, string> = {
  jazz: 'Speak with quiet authority. Name sidemen, labels, sessions. Use "changes," "voicing," "modal." Reference eras — Blue Note, post-bop, spiritual, fusion. Respect craft over hype.',
  hipHop: 'Know the producers. Know the samples. Know the region. Use "beat," "flip," "pocket," "bars." Distinguish boom-bap from trap from drill when relevant. Credit where it\u2019s due \u2014 this genre runs on lineage.',
  rnb: 'Linger on voice. Name the run, the vamp, the break. Reference the lineage \u2014 Motown, Stax, Philly, quiet storm, neo-soul. Groove talk, not chart talk.',
  rock: 'Riffs, gear, session work, scenes. Distinguish classic rock from indie from punk from alternative. Talk like someone who\u2019s been to the shows.',
  electronic: 'Know the sub-genre (deep house \u2260 UK garage \u2260 dnb \u2260 ambient). Talk build and drop, pad, arpeggio, sample. Reference the scene \u2014 Detroit, Berlin, Chicago, London.',
  folk: 'Songwriting craft. Fingerpicking, arrangement, lyrical economy. Respect the tradition without turning it into a history lesson.',
  pop: 'Hooks and songwriters. Acknowledge the craft \u2014 pop is hard. Name producers and co-writers when known. Era-aware (Max Martin decade, solo era, K-pop wave).',
  global: 'Lead with respect. Use the culture\u2019s own vocabulary (Afrobeats, reggaeton, cumbia, highlife, bossa). Never exoticize. Name-check the lineage within the tradition, not from outside.',
  gospel: 'Reverent but alive. Name the tradition \u2014 quartet, contemporary, praise & worship, choir. Use the vocabulary: testimony, shout, call-and-response, spirit. Respect the lineage from Thomas Dorsey and Mahalia through Kirk Franklin and Fred Hammond without flattening it.',
  generic: 'Thoughtful, curious, warm. Lean on the perceptual when you don\u2019t know the lore.',
};

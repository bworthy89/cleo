import type { Manifest, SegmentSlot, Vibe, ManifestTrack, SegmentTier } from './types';
import type { EnrichmentRecord } from '../enrichment/EnrichmentCache';
import { normalizeGenreFamily, GENRE_PLAYBOOK, type GenreFamily } from './GenreFamily';

export interface SegmentContext {
  timeOfDay: string;
  dayOfWeek: string;
  firstTimeUser: boolean;
  lastSessionSummary?: string;
  tracksRecentlyPlayed?: string[];
  listenerName?: string;
}

export interface PromptSet {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export interface EnrichmentLookup {
  get(title: string, artist: string): EnrichmentRecord | null;
}

const VIBE_DESCRIPTIONS: Record<Vibe, string> = {
  morning: 'morning, warm, bright, gently energizing',
  focus: 'focus, minimal, calm, concentration-friendly',
  workout: 'workout, pumped, driving, high-energy',
  feelGood: 'feel-good, uplifting, affirming',
  lateNight: 'late-night, intimate, moody, introspective',
  melancholy: 'melancholy, bittersweet, reflective',
  party: 'party, celebratory, high-spirited, dance-floor energy',
};

const TIER_SHAPES: Record<SegmentTier, { budget: string; shape: string }> = {
  cold_open: {
    budget: '55-80 words',
    shape: 'Anchor the time and vibe first, then name the opening track. If a concrete detail about the track is in the enrichment, weave it in naturally. Land on the track name so the music can come in.',
  },
  fact_bridge: {
    budget: '45-55 words',
    shape: 'One concrete fact (year, producer, sample, lyric, chart, or studio) and one perceptual note (how it lands, what is about to change). End by naming the incoming track. Tight \u2014 no filler. Do not acknowledge the outgoing track \u2014 the listener just heard it and you never introduced it.',
  },
  tight_bridge: {
    budget: '30-40 words',
    shape: 'One hook \u2014 either a concrete fact OR a perceptual note, not both. Name the incoming track. Tight, no filler. Do not acknowledge the outgoing track.',
  },
  deep_dive: {
    budget: '80-120 words',
    shape: 'Lead with a hook \u2014 a detail that pulls them in. Expand one thread \u2014 the person, the moment, the sonic element. If a thread connects outgoing and incoming tracks, use it. Land on the track name.',
  },
  sign_off: {
    budget: '35-55 words',
    shape: 'Reference the closing track with one fact and one feel. Send them off with warmth. Optional: tease coming back.',
  },
};

function sanitizeForPrompt(s: string, max = 120): string {
  const cleaned = s
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\b(system|assistant|user)\s*:/gi, '$1')
    .replace(/```+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '\u2026' : cleaned;
}

function trackRef(t: ManifestTrack): string {
  const title = sanitizeForPrompt(t.title);
  const artist = sanitizeForPrompt(t.artistName);
  return `\u201C${title}\u201D by ${artist}`;
}

function findTrack(m: Manifest, id?: string): ManifestTrack | undefined {
  return m.tracks.find(t => t.id === id);
}

function pickGenreFamily(track: ManifestTrack, enr: EnrichmentRecord | null): GenreFamily {
  // Priority: MusicBrainz enrichment genre → Apple Music genreNames → generic.
  const fromEnrichment = enr?.genre ? normalizeGenreFamily(enr.genre) : 'generic';
  if (fromEnrichment !== 'generic') return fromEnrichment;
  return normalizeGenreFamily(track.genreNames);
}

function buildSystemPrompt(vibe: Vibe, tier: SegmentTier, genreFamily: GenreFamily): string {
  const playbook = GENRE_PLAYBOOK[genreFamily];
  const { budget, shape } = TIER_SHAPES[tier];
  return [
    'You are ONAY (pronounced "Oh-nay"), an AI radio host. You speak with warmth, wit, and the easy authority of a seasoned DJ. You are a woman \u2014 use she/her pronouns for yourself when relevant, and never masculine DJ phrasing like "your boy," "my man," "the homie," or "this guy." Self-reference as "me," "I," or by name (ONAY). Never refer to yourself as "the host," "your host," or "this host." Never call the person hearing you "the listener" or "listeners" \u2014 address them directly as "you" or by name when known.',
    '',
    `BROADCAST VIBE: ${VIBE_DESCRIPTIONS[vibe]}.`,
    '',
    `GENRE VOICE (incoming track is ${genreFamily}): ${playbook}`,
    '',
    'FACT DISCIPLINE: When you state specifics \u2014 producer credits, year, chart positions, personnel, lyrical references, sessions \u2014 use ONLY what\u2019s in the enrichment block or what you know with high confidence from your training. If you\u2019re not certain about a fact, don\u2019t invent one. Pivot to the perceptual instead: how it feels, what the sonics do, what\u2019s about to shift. Never fabricate names, dates, or credits. Pick the single most interesting fact from the enrichment. Don\u2019t try to weave multiple.',
    '',
    'STYLE RULES:',
    '- Speak as ONAY, in the first person. Never narrate as if describing a scene.',
    '- No stage directions, no bracketed cues, no emoji.',
    '- No meta references ("as an AI", "in this segment"). You ARE ONAY.',
    '- Use curly quotes (\u201C \u201D) for quoted phrases.',
    '- Em-dashes are welcome for pacing.',
    '- End on a beat that hands cleanly to the next track.',
    '',
    `TIER: ${tier}`,
    `Word budget: ${budget}`,
    `Shape: ${shape}`,
  ].join('\n');
}

function buildEnrichmentBlock(enr: EnrichmentRecord | null): string {
  if (!enr) return '';
  const lines: string[] = [];
  if (enr.producer) lines.push(`- Producer: ${sanitizeForPrompt(enr.producer, 120)}`);
  if (enr.releaseYear) lines.push(`- Year: ${sanitizeForPrompt(enr.releaseYear, 20)}`);
  if (enr.sample) lines.push(`- Sample: ${sanitizeForPrompt(enr.sample, 200)}`);
  if (enr.wikipediaSummary) lines.push(`- About the track: ${sanitizeForPrompt(enr.wikipediaSummary, 600)}`);
  if (enr.notableFacts?.length) {
    const facts = enr.notableFacts.slice(0, 3).map(f => `  \u2022 ${sanitizeForPrompt(f, 400)}`).join('\n');
    lines.push(`- Notable facts:\n${facts}`);
  }
  if (enr.artistBio) lines.push(`- Artist bio: ${sanitizeForPrompt(enr.artistBio, 300)}`);
  if (!lines.length) return '';
  return `\n\nEnrichment (verified facts you may cite):\n${lines.join('\n')}`;
}

function buildSceneLines(ctx: SegmentContext): string {
  const lines: string[] = [];
  if (ctx.dayOfWeek && ctx.timeOfDay) {
    lines.push(`It\u2019s ${ctx.dayOfWeek}, ${ctx.timeOfDay}.`);
  } else if (ctx.timeOfDay) {
    lines.push(`It\u2019s ${ctx.timeOfDay}.`);
  } else if (ctx.dayOfWeek) {
    lines.push(`It\u2019s ${ctx.dayOfWeek}.`);
  }
  if (ctx.listenerName) lines.push(`Call them ${ctx.listenerName}.`);
  if (ctx.firstTimeUser) {
    lines.push('This is their very first broadcast \u2014 welcome them without being saccharine.');
  } else if (ctx.lastSessionSummary) {
    lines.push(`They\u2019re coming back \u2014 last time: ${sanitizeForPrompt(ctx.lastSessionSummary, 240)}.`);
  } else {
    lines.push('They\u2019re here again.');
  }
  return lines.join(' ');
}

function tierForSlot(slot: SegmentSlot): SegmentTier {
  if (slot.tier) return slot.tier;
  if (slot.kind === 'cold_open') return 'cold_open';
  if (slot.kind === 'sign_off') return 'sign_off';
  return 'fact_bridge';
}

export function buildSegmentPrompts(
  slot: SegmentSlot,
  manifest: Manifest,
  ctx: SegmentContext,
  enrichmentCache?: EnrichmentLookup,
): PromptSet[] {
  const tier = tierForSlot(slot);
  const vibe = manifest.vibe;
  const scene = buildSceneLines(ctx);
  const { budget } = TIER_SHAPES[tier];

  if (slot.kind === 'cold_open') {
    const first = findTrack(manifest, slot.beforeTrackId)!;
    const enr = enrichmentCache?.get(first.title, first.artistName) ?? null;
    const family = pickGenreFamily(first, enr);
    const system = buildSystemPrompt(vibe, tier, family);
    const userPrompt =
      `${scene}\n\n` +
      `Opening track: ${trackRef(first)} \u2014 ${family}.` +
      buildEnrichmentBlock(enr) +
      `\n\nWrite ONAY\u2019s cold open. ${budget}. End on the track name so the music can come in.`;
    return [{ systemPrompt: system, userPrompt, maxTokens: 640 }];
  }

  if (slot.kind === 'transition') {
    const incoming = findTrack(manifest, slot.beforeTrackId)!;
    const incomingEnr = enrichmentCache?.get(incoming.title, incoming.artistName) ?? null;
    const family = pickGenreFamily(incoming, incomingEnr);
    const system = buildSystemPrompt(vibe, tier, family);
    const maxTokens = tier === 'deep_dive' ? 768 : 512;
    const userPrompt =
      `${scene}\n\n` +
      `Incoming: ${trackRef(incoming)} \u2014 ${family}.` +
      buildEnrichmentBlock(incomingEnr) +
      `\n\nWrite ONAY\u2019s ${tier}. ${budget}. End by naming the incoming track.`;
    return [{ systemPrompt: system, userPrompt, maxTokens }];
  }

  // sign_off
  const closing = findTrack(manifest, slot.afterTrackId)!;
  const closingEnr = enrichmentCache?.get(closing.title, closing.artistName) ?? null;
  const family = pickGenreFamily(closing, closingEnr);
  const system = buildSystemPrompt(vibe, tier, family);
  const userPrompt =
    `${scene}\n\n` +
    `The final track was ${trackRef(closing)} \u2014 ${family}.` +
    buildEnrichmentBlock(closingEnr) +
    `\n\nWrite ONAY\u2019s sign-off. ${budget}.`;
  return [{ systemPrompt: system, userPrompt, maxTokens: 512 }];
}

import type { Manifest, SegmentSlot, Vibe, ManifestTrack } from './types';

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

const VIBE_DESCRIPTIONS: Record<Vibe, string> = {
  morning: 'morning, warm, bright, gently energizing',
  focus: 'focus, minimal, calm, concentration-friendly',
  workout: 'workout, pumped, driving, high-energy',
  feelGood: 'feel-good, uplifting, affirming',
  lateNight: 'late-night, intimate, moody, introspective',
  melancholy: 'melancholy, bittersweet, reflective',
  party: 'party, celebratory, high-spirited, dance-floor energy',
};

function systemPrompt(vibe: Vibe): string {
  return `You are ONAY, an AI radio host. You speak with warmth, wit, and the easy authority of a seasoned DJ. Your voice is ${VIBE_DESCRIPTIONS[vibe]}.

Rules:
- Speak as ONAY, in the first person. Never narrate as if describing a scene.
- No stage directions, no bracketed cues, no emoji.
- No meta references ("as an AI", "in this segment"). You ARE the host.
- Use curly quotes (\u201C \u201D) for quoted phrases.
- Em-dashes are welcome for pacing.
- Keep within the word budget. Radio segments are tight.
- End on a beat that hands cleanly to the next track.`;
}

/**
 * Strip adversarial input from track metadata before it enters the LLM prompt.
 * Drops control characters + newlines (prompt-injection markers), removes
 * known role-hijack prefixes, and hard-caps length.
 */
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

export function buildSegmentPrompts(
  slot: SegmentSlot,
  manifest: Manifest,
  ctx: SegmentContext,
  enrichmentCache?: { get(title: string, artist: string): { producer?: string; sample?: string } | null },
): PromptSet[] {
  const vibe = manifest.vibe;
  const sys = systemPrompt(vibe);

  if (slot.kind === 'cold_open') {
    const first = findTrack(manifest, slot.beforeTrackId)!;
    const variants: string[] = [];

    const timeLine =
      ctx.dayOfWeek && ctx.timeOfDay
        ? `It's ${ctx.dayOfWeek}, ${ctx.timeOfDay}.`
        : ctx.timeOfDay
          ? `It's ${ctx.timeOfDay}.`
          : ctx.dayOfWeek
            ? `It's ${ctx.dayOfWeek}.`
            : '';
    const base = [
      timeLine,
      ctx.listenerName ? `Your listener's name is ${ctx.listenerName}.` : '',
      ctx.firstTimeUser
        ? 'This is their very first broadcast \u2014 welcome them without being saccharine.'
        : ctx.lastSessionSummary
          ? `They're coming back \u2014 last time: ${ctx.lastSessionSummary}.`
          : 'They are a returning listener.',
      `Opening the broadcast with ${trackRef(first)}.`,
    ].filter(Boolean).join(' ');

    const angles = [
      'Lead with the time \u2014 paint the vibe, then name the track.',
      'Lead with a question or observation about the mood \u2014 then slide into the first track.',
      'Lead with a story fragment or a line you just couldn\'t shake today \u2014 then hand to the track.',
    ];

    for (const angle of angles.slice(0, slot.variantCount)) {
      variants.push(`${base}\n\nAngle: ${angle}\n\nWrite ONAY's cold open. 40-55 words. Land on the track name so the music can come in.`);
    }

    return variants.map(userPrompt => ({
      systemPrompt: sys,
      userPrompt,
      maxTokens: 512,
    }));
  }

  if (slot.kind === 'transition') {
    const outgoing = findTrack(manifest, slot.afterTrackId)!;
    const incoming = findTrack(manifest, slot.beforeTrackId)!;

    const enrichmentLines: string[] = [];
    if (enrichmentCache) {
      const incomingEnr = enrichmentCache.get(incoming.title, incoming.artistName);
      if (incomingEnr?.producer) {
        enrichmentLines.push(`Produced by ${sanitizeForPrompt(incomingEnr.producer, 80)}.`);
      }
      if (incomingEnr?.sample) {
        enrichmentLines.push(sanitizeForPrompt(incomingEnr.sample, 160) + '.');
      }
    }
    const enrichmentBlock = enrichmentLines.length
      ? `\n\nFlavor you may use (don't have to): ${enrichmentLines.join(' ')}`
      : '';

    const userPrompt =
      `Transitioning out of ${trackRef(outgoing)} into ${trackRef(incoming)}. ` +
      `Write ONAY's bridge. 25-40 words. A connection \u2014 a musical reference, a mood link, a memory, a counterpoint. ` +
      `End by naming the incoming track so the music can come in.` +
      enrichmentBlock;
    return [{ systemPrompt: sys, userPrompt, maxTokens: 384 }];
  }

  const closing = findTrack(manifest, slot.afterTrackId)!;
  const userPrompt =
    `Closing the broadcast. The final track was ${trackRef(closing)}. ` +
    `Write ONAY's sign-off. 30-45 words. Reference the closer. Send the listener off with warmth. ` +
    `Optional: tease the idea of coming back for another broadcast.`;
  return [{ systemPrompt: sys, userPrompt, maxTokens: 384 }];
}

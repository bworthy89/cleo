import { playAudioFromBase64 } from '../../modules/expo-music-kit';
import { authenticatedFetch } from './api';
import type { Vibe } from '../cleo/fallbacks';

interface VoiceProfile {
  stability: number;
  style: number;
  speed: number;
}

const VIBE_VOICE_PROFILES: Record<Vibe, VoiceProfile> = {
  morning:    { stability: 0.40, style: 0.50, speed: 1.0 },
  chill:      { stability: 0.30, style: 0.45, speed: 0.95 },
  workout:    { stability: 0.45, style: 0.65, speed: 1.08 },
  lateNight:  { stability: 0.25, style: 0.40, speed: 0.92 },
  party:      { stability: 0.50, style: 0.70, speed: 1.05 },
  focus:      { stability: 0.50, style: 0.35, speed: 0.98 },
  feelGood:   { stability: 0.35, style: 0.60, speed: 1.02 },
  throwback:  { stability: 0.35, style: 0.55, speed: 0.98 },
  elevated:   { stability: 0.30, style: 0.50, speed: 0.95 },
  melancholy: { stability: 0.25, style: 0.40, speed: 0.93 },
  sunday:     { stability: 0.30, style: 0.45, speed: 0.93 },
  general:    { stability: 0.35, style: 0.55, speed: 1.0 },
};

type DeliveryCue = 'warm' | 'hype' | 'quiet' | 'playful' | 'reflective' | 'matter-of-fact';

const DELIVERY_CUE_NUDGES: Record<DeliveryCue, Partial<VoiceProfile>> = {
  'warm':           { stability: -0.05 },
  'hype':           { style: 0.10 },
  'quiet':          { speed: -0.03 },
  'playful':        { style: 0.05, stability: -0.05 },
  'reflective':     { speed: -0.02, stability: -0.05 },
  'matter-of-fact': { stability: 0.05 },
};

function parseDeliveryCue(text: string): { cue: DeliveryCue | null; cleanText: string } {
  // Match cue tag anywhere in text (Gemini may add preamble before the tag)
  const match = text.match(/\[(warm|hype|quiet|playful|reflective|matter-of-fact)\]\s*/);
  if (!match) return { cue: null, cleanText: text };
  return { cue: match[1] as DeliveryCue, cleanText: text.replace(match[0], '').trim() };
}

function resolveVoiceParams(vibe: Vibe, cue: DeliveryCue | null): VoiceProfile {
  const base = { ...VIBE_VOICE_PROFILES[vibe] };
  if (!cue) return base;
  const nudge = DELIVERY_CUE_NUDGES[cue];
  if (nudge.stability !== undefined) base.stability = Math.max(0, Math.min(1, base.stability + nudge.stability));
  if (nudge.style !== undefined) base.style = Math.max(0, Math.min(1, base.style + nudge.style));
  if (nudge.speed !== undefined) base.speed = Math.max(0.5, Math.min(2, base.speed + nudge.speed));
  return base;
}

/**
 * Post-process Gemini output for natural ElevenLabs delivery.
 *
 * 1. Strips quotes and stage directions
 * 2. Splits long sentences at natural clause boundaries
 * 3. Adds breath marks (em-dashes, ellipses) between complete thoughts
 *
 * Artist name pronunciation is handled server-side via ElevenLabs
 * Pronunciation Dictionary (ID: Tz7qFxqqoRQ7cvPkOlof).
 */

// No `g` flag — these are used with .test() and must not maintain lastIndex state
const ABBREVIATIONS = /\b(?:feat|vs|Dr|Mr|Mrs|Ms|Jr|Sr|St)\./i;
const SINGLE_INITIAL = /\b[A-Z]\./;

function isAbbreviationOrInitial(text: string, periodIndex: number): boolean {
  const before = text.substring(Math.max(0, periodIndex - 8), periodIndex + 1);
  return ABBREVIATIONS.test(before) || SINGLE_INITIAL.test(before);
}

function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  if (words.length <= 15) return [sentence];

  // Strategy 1: Split at "comma + conjunction" — e.g. "carries the whole track, and if you..."
  const commaConjunction = sentence.match(/^(.+?,)\s+(and|but|so|or)\s+(.+)$/i);
  if (commaConjunction) {
    const before = commaConjunction[1].replace(/,$/, '');
    const conjunction = commaConjunction[2];
    const after = commaConjunction[3];
    if (before.split(/\s+/).length >= 4) {
      return [before + '.', conjunction.charAt(0).toUpperCase() + conjunction.slice(1) + ' ' + after];
    }
  }

  // Strategy 2: Split at a bare conjunction (no comma) if sentence is long enough
  const conjunctionOnly = sentence.match(/^((?:\S+\s+){4,}?\S+)\s+(and|but|so|or)\s+(.+)$/i);
  if (conjunctionOnly && conjunctionOnly[1].split(/\s+/).length >= 5) {
    return [conjunctionOnly[1] + ' —', conjunctionOnly[3]];
  }

  // Strategy 3: Split at a comma with 4+ words before it
  const commaMatch = sentence.match(/^((?:\S+\s+){3,}\S+,)\s+(.+)$/);
  if (commaMatch) {
    return [commaMatch[1].replace(/,$/, '') + ' —', commaMatch[2]];
  }

  return [sentence];
}

function addBreathMarks(sentences: string[]): string {
  if (sentences.length <= 1) return sentences.join(' ');

  return sentences.map((s, i) => {
    if (i === sentences.length - 1) return s;
    // Short fragments (1-3 words) — natural emphasis points, leave as-is
    if (s.split(/\s+/).length <= 3) return s;
    // Sentences ending with em-dash already have a pause cue
    if (s.endsWith('—')) return s;
    // Sentences ending with period — add an ellipsis beat on ~every other one
    if (s.endsWith('.') && i % 2 === 0) {
      return s.slice(0, -1) + '...';
    }
    return s;
  }).join(' ');
}

function formatForSpeech(text: string): string {
  let processed = text
    // Remove any stray quotation marks
    .replace(/["""]/g, '')
    // Remove stage directions like (pause) or [beat]
    .replace(/[\(\[][^\)\]]{0,40}[\)\]]/g, '')
    // Clean up any double spaces
    .replace(/  +/g, ' ')
    .trim();

  // Split into sentences, preserving abbreviations, initials, and ellipses
  const sentences: string[] = [];
  let current = '';
  for (let i = 0; i < processed.length; i++) {
    current += processed[i];
    if (processed[i] === '.' || processed[i] === '!' || processed[i] === '?') {
      // Skip periods that are part of an ellipsis (...)
      if (processed[i] === '.' && (processed[i + 1] === '.' || (i > 0 && processed[i - 1] === '.'))) {
        continue;
      }
      if (processed[i] === '.' && isAbbreviationOrInitial(processed, i)) {
        continue;
      }
      if (i === processed.length - 1 || processed[i + 1] === ' ') {
        sentences.push(current.trim());
        current = '';
      }
    }
  }
  if (current.trim()) sentences.push(current.trim());

  // Split long sentences at clause boundaries
  const split = sentences.flatMap(s => splitLongSentence(s));

  // Apply comma-conjunction em-dash transform after splitting (so Strategy 1 isn't bypassed)
  const withEmDashes = split.map(s => s.replace(/, (and|but|so) /g, ' — $1 '));

  return addBreathMarks(withEmDashes);
}

/**
 * Synthesize text to audio without playing it. Returns base64 audio data.
 * Used for pre-generation — synthesize while current track is still playing,
 * then play the cached audio instantly when the track changes.
 */
const TTS_TIMEOUT_MS = 15000;

export async function synthesize(text: string, vibe: Vibe = 'general'): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  try {
    const { cue, cleanText } = parseDeliveryCue(text);
    const formatted = formatForSpeech(cleanText);
    const voiceParams = resolveVoiceParams(vibe, cue);

    const wordCount = formatted.split(/\s+/).length;
    console.log(`[CleoVoice] Synthesizing ${wordCount} words, vibe: ${vibe}, cue: ${cue ?? 'none'}`);

    const response = await authenticatedFetch('/synthesize-voice', {
      method: 'POST',
      body: JSON.stringify({
        text: formatted,
        stability: voiceParams.stability,
        style: voiceParams.style,
        speed: voiceParams.speed,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`TTS error: ${response.status}`);
    }

    const data = await response.json();
    const base64Audio = data.audioContent;

    if (!base64Audio) {
      throw new Error('No audio content returned');
    }

    const audioSizeKB = Math.round((base64Audio.length * 3 / 4) / 1024);
    console.log(`[CleoVoice] Audio synthesized: ${audioSizeKB}KB`);
    return base64Audio;
  } catch (error) {
    console.error('Voice synthesis failed:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Play pre-synthesized base64 audio.
 */
export async function playCachedAudio(base64Audio: string): Promise<void> {
  await playAudioFromBase64(base64Audio);
  console.log(`[CleoVoice] Cached audio playback finished`);
}

/**
 * Synthesize and immediately play. Convenience wrapper for non-pregenerated segments.
 */
export async function synthesizeAndPlay(text: string, vibe: Vibe = 'general'): Promise<void> {
  try {
    const base64Audio = await synthesize(text, vibe);
    if (!base64Audio) return;
    await playAudioFromBase64(base64Audio);
    console.log(`[CleoVoice] Playback finished`);
  } catch (error) {
    console.error('Voice playback failed:', error);
  }
}

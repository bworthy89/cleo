import { playAudioFromBase64 } from '../../modules/expo-music-kit';
import { API_BASE_URL } from './api';

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
  const before = text.substring(Math.max(0, periodIndex - 5), periodIndex + 1);
  return ABBREVIATIONS.test(before) || SINGLE_INITIAL.test(before);
}

function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  if (words.length <= 15) return [sentence];

  // Strategy 1: Split at "comma + conjunction" — e.g. "carries the whole track, and if you..."
  const commaConjunction = sentence.match(/^(.{20,}?,)\s+(and|but|so|or)\s+(.+)$/i);
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
    // Comma before "and/but/so" at clause boundary → em-dash for stronger pause
    .replace(/, (and|but|so) /g, ' — $1 ')
    // Clean up any double spaces
    .replace(/  +/g, ' ')
    .trim();

  // Split into sentences, preserving abbreviations and initials
  const sentences: string[] = [];
  let current = '';
  for (let i = 0; i < processed.length; i++) {
    current += processed[i];
    if (processed[i] === '.' || processed[i] === '!' || processed[i] === '?') {
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

  // Split long sentences and add breath marks
  const split = sentences.flatMap(s => splitLongSentence(s));
  return addBreathMarks(split);
}

export async function synthesizeAndPlay(text: string): Promise<void> {
  try {
    const formatted = formatForSpeech(text);
    const wordCount = formatted.split(/\s+/).length;
    console.log(`[CleoVoice] Sending ${wordCount} words (${formatted.length} chars) to TTS: "${formatted.substring(0, 80)}..."`);

    const response = await fetch(`${API_BASE_URL}/synthesize-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatted }),
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
    console.log(`[CleoVoice] Audio received: ${audioSizeKB}KB`);

    await playAudioFromBase64(base64Audio);
    console.log(`[CleoVoice] Playback finished`);
  } catch (error) {
    console.error('Voice playback failed:', error);
  }
}

import { playAudioFromBase64 } from '../../modules/expo-music-kit';
import { API_BASE_URL } from './api';

/**
 * Post-process Gemini output for natural ElevenLabs delivery.
 * Em-dashes signal a beat/pause. Ellipses trail off naturally.
 * Strips quotation marks and stage directions.
 */
function formatForSpeech(text: string): string {
  return text
    // Remove any stray quotation marks
    .replace(/["""]/g, '')
    // Remove stage directions like (pause) or [beat]
    .replace(/[\(\[][^\)\]]{1,20}[\)\]]/g, '')
    // Comma before "and/but/so" at clause boundary → em-dash for stronger pause
    .replace(/, (and|but|so) /g, ' — $1 ')
    // Clean up any double spaces
    .replace(/  +/g, ' ')
    .trim();
}

export async function synthesizeAndPlay(text: string): Promise<void> {
  try {
    const formatted = formatForSpeech(text);

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

    await playAudioFromBase64(base64Audio);
  } catch (error) {
    console.error('Voice playback failed:', error);
  }
}

import { playAudioFromBase64 } from '../../modules/expo-music-kit';
import { API_BASE_URL } from './api';

export async function synthesizeAndPlay(text: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/synthesize-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
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

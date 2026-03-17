import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import { API_BASE_URL } from './api';

export async function synthesizeAndPlay(text: string): Promise<void> {
  let speechFile: File | null = null;

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
    const base64Audio: string | undefined = data.audioContent;

    if (!base64Audio) {
      throw new Error('No audio content returned');
    }

    speechFile = new File(Paths.cache, `cleo-speech-${Date.now()}.mp3`);
    speechFile.write(base64Audio, { encoding: 'base64' });

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });

    const { sound } = await Audio.Sound.createAsync({ uri: speechFile.uri });
    const fileToClean = speechFile;

    await sound.playAsync();

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        try {
          fileToClean.delete();
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  } catch (error) {
    console.error('Voice playback failed:', error);
    if (speechFile) {
      try {
        speechFile.delete();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

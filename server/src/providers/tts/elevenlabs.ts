import { TTSProvider, TTSRequest, TTSResponse } from './types';

export class ElevenLabsProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  private apiKey: string;
  private voiceId: string;
  private pronunciationConfig?: object[];

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    if (!apiKey || !voiceId) throw new Error('ElevenLabs not configured (missing API key or voice ID)');
    this.apiKey = apiKey;
    this.voiceId = voiceId;

    if (process.env.ELEVENLABS_PRONUNCIATION_DICT_ID) {
      this.pronunciationConfig = [{
        pronunciation_dictionary_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_ID,
        version_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_VERSION,
      }];
    }
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
          body: JSON.stringify({
            text: request.text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: request.stability,
              similarity_boost: 0.80,
              style: request.style,
              use_speaker_boost: true,
              speed: request.speed,
            },
            pronunciation_dictionary_locators: this.pronunciationConfig,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error(`[TTS:elevenlabs] Error (${response.status}): ${error.substring(0, 300)}`);
        throw new Error(`ElevenLabs ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
      console.log(`[TTS:elevenlabs] Audio: ${audioSizeKB}KB`);

      return { audioContent: Buffer.from(arrayBuffer).toString('base64') };
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Check subscription endpoint — lightweight, confirms API key works
      const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': this.apiKey },
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

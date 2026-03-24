import { TTSProvider, TTSRequest, TTSResponse } from './types';

export class CartesiaProvider implements TTSProvider {
  readonly name = 'cartesia';
  private apiKey: string;
  private voiceId: string;
  private modelId: string;

  constructor() {
    const apiKey = process.env.CARTESIA_API_KEY;
    const voiceId = process.env.CARTESIA_VOICE_ID;
    if (!apiKey || !voiceId) throw new Error('Cartesia not configured (missing API key or voice ID)');
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.modelId = process.env.CARTESIA_MODEL_ID || 'sonic-3';
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const speed = Math.max(0.6, Math.min(1.5, request.speed));

      const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          'Cartesia-Version': '2025-04-16',
        },
        body: JSON.stringify({
          model_id: this.modelId,
          transcript: request.text,
          voice: {
            mode: 'id',
            id: this.voiceId,
          },
          output_format: {
            container: 'wav',
            encoding: 'pcm_s16le',
            sample_rate: 44100,
          },
          language: 'en',
          generation_config: {
            speed,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[TTS:cartesia] Error (${response.status}): ${error.substring(0, 300)}`);
        throw new Error(`Cartesia ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
      console.log(`[TTS:cartesia] Audio: ${audioSizeKB}KB`);

      return { audioContent: Buffer.from(arrayBuffer).toString('base64') };
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch('https://api.cartesia.ai/voices', {
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': '2025-04-16',
        },
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

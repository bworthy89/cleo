import { TTSProvider, TTSRequest, TTSResponse } from './types';

export class OrpheusProvider implements TTSProvider {
  readonly name = 'orpheus';
  private baseUrl: string;
  private voice: string;
  private maxTokens: number;

  constructor() {
    this.baseUrl = process.env.ORPHEUS_BASE_URL || 'http://localhost:5005';
    this.voice = process.env.ORPHEUS_VOICE || 'tara';
    this.maxTokens = Number(process.env.ORPHEUS_MAX_TOKENS) || 2048;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      // Map ElevenLabs-style speed to Orpheus speed (both use similar 0.5-2.0 range)
      const speed = request.speed;

      const response = await fetch(`${this.baseUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'orpheus',
          input: request.text,
          voice: this.voice,
          speed,
          max_tokens: this.maxTokens,
          response_format: 'wav',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[TTS:orpheus] Error (${response.status}): ${error.substring(0, 300)}`);
        throw new Error(`Orpheus ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
      console.log(`[TTS:orpheus] Audio: ${audioSizeKB}KB, voice: ${this.voice}`);

      return { audioContent: Buffer.from(arrayBuffer).toString('base64') };
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/`, {
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

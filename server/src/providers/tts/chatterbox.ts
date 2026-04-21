import { TTSProvider, TTSRequest, TTSResponse } from './types';

/**
 * Chatterbox TTS via self-hosted devnen/Chatterbox-TTS-Server.
 *
 * Expected server: HTTP POST /tts returning raw audio bytes.
 *
 * Environment:
 * - CHATTERBOX_BASE_URL         — required, e.g. https://chatterbox.worthymedia.online
 * - CHATTERBOX_VOICE_REF        — reference filename registered on the server
 *                                 (default: onay-voice.wav)
 * - CHATTERBOX_EXAGGERATION     — 0..1, default 1.0 (higher = more expressive)
 * - CHATTERBOX_CFG_WEIGHT       — 0..1, default 0.15
 * - CHATTERBOX_TEMPERATURE      — default 0.95
 * - CHATTERBOX_CHUNK_SIZE       — default 500 (the server's max). Chatterbox splits
 *                                 text at this char boundary. Larger = fewer chunks
 *                                 = lower total latency. Most ONAY segments are
 *                                 ≤400 chars so 500 avoids splitting.
 * - CHATTERBOX_TIMEOUT_MS       — default 90000. Bake parallelism queues multiple
 *                                 TTS calls on one GPU, so individual calls can wait
 *                                 5-7x the solo latency.
 */

export class ChatterboxProvider implements TTSProvider {
  readonly name = 'chatterbox';
  private readonly baseUrl: string;
  private readonly voiceRef: string;
  private readonly exaggeration: number;
  private readonly cfgWeight: number;
  private readonly temperature: number;
  private readonly chunkSize: number;
  private readonly timeoutMs: number;

  constructor() {
    const baseUrl = process.env.CHATTERBOX_BASE_URL;
    if (!baseUrl) throw new Error('Chatterbox not configured (missing CHATTERBOX_BASE_URL)');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.voiceRef = process.env.CHATTERBOX_VOICE_REF || 'onay-voice.wav';
    this.exaggeration = Number(process.env.CHATTERBOX_EXAGGERATION ?? 1.0);
    this.cfgWeight = Number(process.env.CHATTERBOX_CFG_WEIGHT ?? 0.15);
    this.temperature = Number(process.env.CHATTERBOX_TEMPERATURE ?? 0.95);
    this.chunkSize = Number(process.env.CHATTERBOX_CHUNK_SIZE ?? 500);
    this.timeoutMs = Number(process.env.CHATTERBOX_TIMEOUT_MS ?? 90_000);
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    console.log(`[DEBUG-TTS] transcript: ${JSON.stringify(request.text)}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: request.text,
          voice_mode: 'clone',
          reference_audio_filename: this.voiceRef,
          output_format: 'wav',
          exaggeration: this.exaggeration,
          cfg_weight: this.cfgWeight,
          temperature: this.temperature,
          chunk_size: this.chunkSize,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[TTS:chatterbox] Error (${res.status}): ${body.substring(0, 300)}`);
        throw new Error(`Chatterbox ${res.status}`);
      }

      const audioBuffer = await res.arrayBuffer();
      const sizeKB = Math.round(audioBuffer.byteLength / 1024);
      console.log(`[TTS:chatterbox] Audio: ${sizeKB}KB`);
      return { audioContent: Buffer.from(audioBuffer).toString('base64') };
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/get_predefined_voices`, {
        method: 'GET',
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

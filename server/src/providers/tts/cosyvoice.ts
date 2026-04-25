import { TTSProvider, TTSRequest, TTSResponse } from './types';

/**
 * CosyVoice via the self-hosted FastAPI wrapper on the Linux box.
 *
 * POST /tts body:
 *   { text, ref_id, speed?, seed?, nfe_step?, cfg_strength? }
 * returns JSON:
 *   { audio_b64, sample_rate, format, char_count }
 *
 * Schema mirrors F5TTSProvider exactly so the factory can route between
 * them without rewriting call sites. CosyVoice ignores nfe_step / cfg_strength
 * (kept for interface compatibility), and bakes its winning system prompt
 * ("You are ONAY, a warm radio DJ.") server-side — we don't re-send it.
 *
 * Environment:
 * - COSYVOICE_BASE_URL   — required, e.g. https://cosy.worthymedia.online
 *                          (or http://<TTS_HOST>:8001 on the LAN)
 * - COSYVOICE_VOICE_REF  — voice ID on the server (default: onay-cartesia)
 * - COSYVOICE_SPEED      — playback speed, 0.6-1.5. Default 1.0.
 * - COSYVOICE_TIMEOUT_MS — default 180000 (first call ~30s cold, ~15s warm).
 *
 * Known behavior: the server can return 502 with "empty generation" on
 * certain inputs (intermittent). The factory treats that as a transient
 * failure and falls back to the next provider in the chain.
 */
export class CosyVoiceProvider implements TTSProvider {
  readonly name = 'cosyvoice';
  private readonly baseUrl: string;
  private readonly voiceRef: string;
  private readonly speed: number;
  private readonly timeoutMs: number;

  constructor() {
    const baseUrl = process.env.COSYVOICE_BASE_URL;
    if (!baseUrl) throw new Error('CosyVoice not configured (missing COSYVOICE_BASE_URL)');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.voiceRef = process.env.COSYVOICE_VOICE_REF || 'onay-cartesia';
    this.speed = Number(process.env.COSYVOICE_SPEED ?? 1.0);
    this.timeoutMs = Number(process.env.COSYVOICE_TIMEOUT_MS ?? 180_000);
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    console.log(`[DEBUG-TTS] transcript: ${JSON.stringify(request.text)}`);

    const speed = request.speed !== 1.0
      ? Math.max(0.6, Math.min(1.5, request.speed))
      : this.speed;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: request.text,
          ref_id: this.voiceRef,
          speed,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[TTS:cosyvoice] Error (${res.status}): ${body.substring(0, 300)}`);
        throw new Error(`CosyVoice ${res.status}`);
      }

      const payload = (await res.json()) as { audio_b64?: string };
      if (!payload.audio_b64) throw new Error('CosyVoice returned no audio_b64');

      const sizeKB = Math.round((payload.audio_b64.length * 3) / 4 / 1024);
      console.log(`[TTS:cosyvoice] Audio: ${sizeKB}KB`);
      return { audioContent: payload.audio_b64 };
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

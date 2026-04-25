import { TTSProvider, TTSRequest, TTSResponse } from './types';

/**
 * F5-TTS via the self-hosted FastAPI wrapper on the Linux box.
 *
 * POST /tts body:
 *   { text, ref_id, speed?, seed?, nfe_step?, cfg_strength? }
 * returns JSON:
 *   { audio_b64, sample_rate, format, char_count }
 *
 * Environment:
 * - F5TTS_BASE_URL        — required, e.g. https://f5tts.worthymedia.online
 * - F5TTS_VOICE_REF       — voice ID registered on the server (default: onay-cartesia)
 * - F5TTS_NFE_STEP        — diffusion steps, 8-32. Default 16 is the quality/speed sweet
 *                           spot on the 6700XT (~8s/call, near nfe=32 quality).
 * - F5TTS_CFG_STRENGTH    — classifier-free guidance, default 2.0. Doesn't affect speed
 *                           on this build but can shape voice fidelity.
 * - F5TTS_SPEED           — playback speed override, 0.6-1.5. Default 0.9.
 * - F5TTS_TIMEOUT_MS      — default 60000 (F5-TTS is slower than Chatterbox; parallel
 *                           bake burst can queue 8+ requests).
 */

export class F5TTSProvider implements TTSProvider {
  readonly name = 'f5tts';
  private readonly baseUrl: string;
  private readonly voiceRef: string;
  private readonly nfeStep: number;
  private readonly cfgStrength: number;
  private readonly speed: number;
  private readonly timeoutMs: number;

  constructor() {
    const baseUrl = process.env.F5TTS_BASE_URL;
    if (!baseUrl) throw new Error('F5-TTS not configured (missing F5TTS_BASE_URL)');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.voiceRef = process.env.F5TTS_VOICE_REF || 'onay-cartesia';
    this.nfeStep = Number(process.env.F5TTS_NFE_STEP ?? 16);
    this.cfgStrength = Number(process.env.F5TTS_CFG_STRENGTH ?? 2.0);
    this.speed = Number(process.env.F5TTS_SPEED ?? 0.9);
    this.timeoutMs = Number(process.env.F5TTS_TIMEOUT_MS ?? 60_000);
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    // Length-only debug trace — gated behind DEBUG_TTS=1 so production logs
    // don't carry user-derived transcript content.
    if (process.env.DEBUG_TTS === '1') {
      console.log(`[DEBUG-TTS] transcript chars=${request.text.length}`);
    }

    // Honor caller's speed when they explicitly override the default (1.0);
    // otherwise use the env-tuned default (F5 voice-clone reads ~0.9 more
    // naturally than 1.0). Clamped to the F5 server's supported range.
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
          nfe_step: this.nfeStep,
          cfg_strength: this.cfgStrength,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[TTS:f5tts] Error (${res.status}): ${body.substring(0, 300)}`);
        throw new Error(`F5-TTS ${res.status}`);
      }

      const payload = (await res.json()) as { audio_b64?: string };
      if (!payload.audio_b64) throw new Error('F5-TTS returned no audio_b64');

      const sizeKB = Math.round((payload.audio_b64.length * 3) / 4 / 1024);
      console.log(`[TTS:f5tts] Audio: ${sizeKB}KB`);
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

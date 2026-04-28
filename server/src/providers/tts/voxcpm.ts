import { TTSProvider, TTSRequest, TTSResponse } from './types';

/**
 * VoxCPM2 via the self-hosted FastAPI wrapper on the Linux box.
 *
 * POST /tts body:
 *   { text, ref_id, denoise?, inference_timesteps?, cfg_value?, use_prompt_mode? }
 * returns JSON:
 *   { audio_b64, sample_rate, format, char_count }
 *
 * Validated recipe (2026-04-27): pre-denoised reference + style prefix +
 * default inference_timesteps. The style prefix is injected here so Gemini
 * doesn't need to know about it and other providers don't see it. The
 * default reference is `onay-cartesia-clean` — ZipEnhancer-cleaned at
 * install time so per-call denoise is unnecessary (saves ~3s per call).
 *
 * Environment:
 * - VOXCPM_BASE_URL              — required, e.g. https://voxcpm.worthymedia.online
 * - VOXCPM_VOICE_REF             — ref_id on server. Default: onay-cartesia-clean.
 * - VOXCPM_STYLE_PREFIX          — prepended to every text in parens for VoxCPM's
 *                                  inline style steering. Default:
 *                                  "(slow, measured pace, late-night radio)".
 *                                  Set empty string to disable.
 * - VOXCPM_INFERENCE_TIMESTEPS   — flow-matching steps, 4-30. Default 10.
 * - VOXCPM_CFG_VALUE             — guidance scale, 1.0-3.0. Default 2.0.
 * - VOXCPM_DENOISE               — 0/1. Set 1 to denoise the reference per
 *                                  request (only useful when ref isn't pre-cleaned).
 *                                  Default 0.
 * - VOXCPM_USE_PROMPT_MODE       — 0/1. When 1 + ref has transcript, passes ref
 *                                  as both reference + prompt-continuation
 *                                  (VoxCPM2 "ultimate cloning"). Default 1.
 * - VOXCPM_TIMEOUT_MS            — default 180000 (deep_dive ~25s on 5060 Ti).
 *
 * Known: optimize=True (torch.compile) currently breaks inference on Blackwell
 * sm_120 + torch 2.11+cu128 (AssertionError on real calls though warmup
 * compiles successfully). Wrapper boots with VOXCPM_OPTIMIZE=0; revisit
 * when torch ships better Blackwell support.
 */

// Strict integer pattern — `parseInt('10abc')` would otherwise return 10 and
// silently accept trailing garbage. Trim trailing/leading whitespace first
// since shell-set env vars sometimes carry it.
const INT_PATTERN = /^\d+$/;
const FLOAT_PATTERN = /^\d+(\.\d+)?$/;

function readBoundedInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw === '') return fallback;
  const trimmed = raw.trim();
  if (!INT_PATTERN.test(trimmed)) {
    throw new Error(`Invalid ${name}: "${raw}" — expected integer in [${min}, ${max}]`);
  }
  const parsed = parseInt(trimmed, 10);
  if (parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: ${parsed} — expected integer in [${min}, ${max}]`);
  }
  return parsed;
}

function readBoundedFloat(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw === '') return fallback;
  const trimmed = raw.trim();
  if (!FLOAT_PATTERN.test(trimmed)) {
    throw new Error(`Invalid ${name}: "${raw}" — expected number in [${min}, ${max}]`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: ${parsed} — expected number in [${min}, ${max}]`);
  }
  return parsed;
}

export class VoxCpmProvider implements TTSProvider {
  readonly name = 'voxcpm';
  private readonly baseUrl: string;
  private readonly voiceRef: string;
  private readonly stylePrefix: string;
  private readonly inferenceTimesteps: number;
  private readonly cfgValue: number;
  private readonly denoise: boolean;
  private readonly usePromptMode: boolean;
  private readonly timeoutMs: number;

  constructor() {
    const baseUrl = process.env.VOXCPM_BASE_URL;
    if (!baseUrl) throw new Error('VoxCPM not configured (missing VOXCPM_BASE_URL)');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.voiceRef = process.env.VOXCPM_VOICE_REF || 'onay-cartesia-clean';
    this.stylePrefix = process.env.VOXCPM_STYLE_PREFIX
      ?? '(slow, measured pace, late-night radio)';
    // Numeric env vars are validated at startup so a typo'd VOXCPM_*= surfaces
    // as a clear error in the boot log rather than as a NaN that fails opaquely
    // mid-bake. The TTSProviderFactory wraps construction and logs failed
    // providers as unavailable, so a bad value here means voxcpm drops out of
    // the chain instead of taking the whole server down.
    // Bounds reflect VoxCPM's documented usable ranges. The wrapper itself
    // clamps `inference_timesteps` to [4, 30] server-side; mirroring 1-30
    // here lets dev experimentation continue (server clamps low values to 4)
    // while rejecting nonsense like "150" at startup. cfg_value docs say
    // 1.0-3.0 recommended; widening to [0.5, 5.0] gives operators headroom
    // for experiments without admitting clearly bad values like cfg=999.
    this.inferenceTimesteps = readBoundedInt(
      'VOXCPM_INFERENCE_TIMESTEPS',
      process.env.VOXCPM_INFERENCE_TIMESTEPS,
      10,
      1,
      30,
    );
    this.cfgValue = readBoundedFloat(
      'VOXCPM_CFG_VALUE',
      process.env.VOXCPM_CFG_VALUE,
      2.0,
      0.5,
      5.0,
    );
    this.timeoutMs = readBoundedInt(
      'VOXCPM_TIMEOUT_MS',
      process.env.VOXCPM_TIMEOUT_MS,
      180_000,
      1_000,
      600_000,
    );
    this.denoise = process.env.VOXCPM_DENOISE === '1';
    this.usePromptMode = (process.env.VOXCPM_USE_PROMPT_MODE ?? '1') === '1';
  }

  /**
   * Prepend the style prefix unless the text already starts with one. VoxCPM's
   * inline style format is `(description) actual text`; if a caller has already
   * authored a prefix, respect it instead of double-wrapping.
   */
  private applyStylePrefix(text: string): string {
    if (!this.stylePrefix) return text;
    if (/^\s*\(/.test(text)) return text;
    return `${this.stylePrefix} ${text}`;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (process.env.DEBUG_TTS === '1') {
      console.log(`[DEBUG-TTS] transcript chars=${request.text.length}`);
    }

    const text = this.applyStylePrefix(request.text);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          ref_id: this.voiceRef,
          inference_timesteps: this.inferenceTimesteps,
          cfg_value: this.cfgValue,
          denoise: this.denoise,
          use_prompt_mode: this.usePromptMode,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[TTS:voxcpm] Error (${res.status}): ${body.substring(0, 300)}`);
        throw new Error(`VoxCPM ${res.status}`);
      }

      const payload = (await res.json()) as { audio_b64?: unknown };
      const audio = payload.audio_b64;
      // Cap at 50 MB of base64 (~37 MB raw audio) — a 95-word deep_dive
      // segment is ~3 MB raw / ~4 MB base64; anything past 50 MB is
      // upstream wrapper malfunction, not a legitimate response.
      const MAX_BASE64_BYTES = 50 * 1024 * 1024;
      if (typeof audio !== 'string' || audio.length === 0) {
        throw new Error('voxcpm.synthesize: payload missing audio_b64 string');
      }
      if (audio.length > MAX_BASE64_BYTES) {
        throw new Error(
          `voxcpm.synthesize: audio_b64 length ${audio.length} exceeds ${MAX_BASE64_BYTES} cap`,
        );
      }

      const sizeKB = Math.round((audio.length * 3) / 4 / 1024);
      console.log(`[TTS:voxcpm] Audio: ${sizeKB}KB`);
      return { audioContent: audio };
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

import { TTSProvider, TTSRequest, TTSResponse } from './types';

/**
 * Chatterbox TTS via Replicate's hosted model (resemble-ai/chatterbox).
 *
 * Environment:
 * - REPLICATE_API_TOKEN                  — required
 * - CHATTERBOX_REFERENCE_AUDIO_URL       — optional; a public URL to a reference
 *                                          clip for voice cloning. Without it,
 *                                          Chatterbox uses its default voice.
 * - CHATTERBOX_EXAGGERATION              — optional, 0-1, defaults 0.5
 * - CHATTERBOX_CFG                       — optional, 0-1, defaults 0.5
 * - CHATTERBOX_TEMPERATURE               — optional, 0-1, defaults 0.8
 * - CHATTERBOX_WAIT_TIMEOUT_MS           — optional, default 60000 (Replicate's
 *                                          Prefer: wait=60s cap); overall
 *                                          request timeout is this value + a
 *                                          small buffer.
 *
 * Replicate's API is async: POST returns a prediction object; we use the
 * `Prefer: wait=60` header to make it synchronous-ish within 60s. If the
 * prediction isn't done within that window, we poll until it is (or time out).
 */

const MODEL_PATH = 'resemble-ai/chatterbox';
const BASE_URL = 'https://api.replicate.com/v1';
const DEFAULT_WAIT_SECONDS = 60;

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error: string | null;
  urls: { get: string; cancel: string };
}

export class ChatterboxProvider implements TTSProvider {
  readonly name = 'chatterbox';
  private readonly token: string;
  private readonly referenceUrl?: string;
  private readonly exaggeration: number;
  private readonly cfg: number;
  private readonly temperature: number;
  private readonly waitTimeoutMs: number;

  constructor() {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error('Chatterbox not configured (missing REPLICATE_API_TOKEN)');
    this.token = token;
    this.referenceUrl = process.env.CHATTERBOX_REFERENCE_AUDIO_URL || undefined;
    this.exaggeration = Number(process.env.CHATTERBOX_EXAGGERATION ?? 0.5);
    this.cfg = Number(process.env.CHATTERBOX_CFG ?? 0.5);
    this.temperature = Number(process.env.CHATTERBOX_TEMPERATURE ?? 0.8);
    this.waitTimeoutMs = Number(process.env.CHATTERBOX_WAIT_TIMEOUT_MS ?? 60_000);
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const input: Record<string, unknown> = {
      prompt: request.text,
      exaggeration: this.exaggeration,
      cfg_weight: this.cfg,
      temperature: this.temperature,
    };
    if (this.referenceUrl) {
      input.audio_prompt = this.referenceUrl;
    }

    const prediction = await this.createPrediction(input);
    const final = prediction.status === 'succeeded' || prediction.status === 'failed'
      ? prediction
      : await this.pollPrediction(prediction);

    if (final.status !== 'succeeded') {
      console.error(`[TTS:chatterbox] prediction ${final.status}: ${final.error ?? 'unknown'}`);
      throw new Error(`Chatterbox prediction ${final.status}: ${final.error ?? 'unknown'}`);
    }

    const outputUrl = Array.isArray(final.output) ? final.output[0] : final.output;
    if (!outputUrl) {
      throw new Error('Chatterbox returned no output URL');
    }

    const audioRes = await fetch(outputUrl, {
      signal: AbortSignal.timeout(this.waitTimeoutMs),
    });
    if (!audioRes.ok) {
      throw new Error(`Chatterbox output fetch failed: ${audioRes.status}`);
    }
    const audioBuffer = await audioRes.arrayBuffer();
    const sizeKB = Math.round(audioBuffer.byteLength / 1024);
    console.log(`[TTS:chatterbox] Audio: ${sizeKB}KB`);
    return { audioContent: Buffer.from(audioBuffer).toString('base64') };
  }

  private async createPrediction(input: Record<string, unknown>): Promise<ReplicatePrediction> {
    const waitSeconds = Math.min(60, Math.floor(this.waitTimeoutMs / 1000));
    const res = await fetch(`${BASE_URL}/models/${MODEL_PATH}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Prefer: `wait=${waitSeconds}`,
      },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(this.waitTimeoutMs + 5_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[TTS:chatterbox] Create error (${res.status}): ${body.substring(0, 300)}`);
      throw new Error(`Chatterbox create ${res.status}`);
    }
    return (await res.json()) as ReplicatePrediction;
  }

  private async pollPrediction(initial: ReplicatePrediction): Promise<ReplicatePrediction> {
    const deadline = Date.now() + this.waitTimeoutMs;
    let current = initial;
    while (Date.now() < deadline) {
      if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'canceled') {
        return current;
      }
      await new Promise(r => setTimeout(r, 1000));
      const res = await fetch(current.urls.get, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`Chatterbox poll ${res.status}`);
      }
      current = (await res.json()) as ReplicatePrediction;
    }
    throw new Error('Chatterbox prediction timed out');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/account`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

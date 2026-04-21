import { LLMProvider, LLMRequest, LLMResponse } from './types';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 15000;

interface GroqChoice {
  message?: { content?: string; role?: string };
  finish_reason?: string;
}

interface GroqResponse {
  choices?: GroqChoice[];
}

/**
 * Groq hosts OSS models (Llama 3.3 70B, etc.) on custom LPU hardware with
 * sub-second inference. OpenAI-compatible Chat Completions schema. Free tier
 * is ~30 RPM / 12k TPM on 70B-class models — comfortably fits our 4-worker
 * segment fan-out.
 */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private apiKey: string;
  private model: string;

  constructor() {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY not configured');
    this.apiKey = key;
    this.model = process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 0.95,
    };

    const response = await fetch(GROQ_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[LLM:groq] Error (${response.status}): ${errorBody.substring(0, 500)}`);
      throw new Error(`Groq ${response.status}`);
    }

    const data = (await response.json()) as GroqResponse;
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason ?? 'unknown';
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    console.log(`[LLM:groq] ${wordCount} words, finishReason: ${finishReason}`);

    return { text: text.trim() };
  }

  async healthCheck(): Promise<boolean> {
    // Probe `/openai/v1/models` — auth-gated, cheap, NOT counted against
    // generation rate limit. Returns 200 only if API key is valid AND the
    // service is reachable. Any other outcome (network, timeout, 4xx, 5xx)
    // is swallowed and reported as unhealthy so the factory can fail over.
    if (!this.apiKey) return false;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

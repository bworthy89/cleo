import { LLMProvider, LLMRequest, LLMResponse } from './types';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor() {
    const baseUrl = process.env.OLLAMA_BASE_URL;
    if (!baseUrl) throw new Error('Ollama not configured (missing OLLAMA_BASE_URL)');
    this.baseUrl = baseUrl;
    this.model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        stream: false,
        options: {
          temperature: request.temperature ?? 1.0,
          top_p: request.topP ?? 0.95,
          num_predict: request.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[LLM:ollama] Error (${response.status}): ${errorBody.substring(0, 500)}`);
      throw new Error(`Ollama ${response.status}`);
    }

    const data: any = await response.json();
    const text = data.message?.content ?? '';
    const wordCount = text.trim().split(/\s+/).length;
    console.log(`[LLM:ollama] ${wordCount} words, model: ${this.model}`);

    return { text: text.trim() };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

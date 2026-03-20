import { LLMProvider, LLMRequest, LLMResponse } from './types';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private apiKey: string;

  constructor() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not configured');
    this.apiKey = key;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents: [{ parts: [{ text: request.userPrompt }] }],
          generationConfig: {
            temperature: request.temperature ?? 1.0,
            maxOutputTokens: request.maxTokens,
            topP: request.topP ?? 0.95,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[LLM:gemini] Error (${response.status}): ${errorBody.substring(0, 500)}`);
      throw new Error(`Gemini ${response.status}`);
    }

    const data: any = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
    const wordCount = text.trim().split(/\s+/).length;
    console.log(`[LLM:gemini] ${wordCount} words, finishReason: ${finishReason}`);

    return { text: text.trim() };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Lightweight check — just verify the API key works with a tiny request
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 1 },
          }),
          signal: AbortSignal.timeout(Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000),
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  /**
   * Provider preference hint. Default path uses the primary (Ollama) for
   * cost + latency; quality-sensitive, low-volume routes (e.g. Ask ONAY
   * curation) can request the fallback (Gemini) for its broader music
   * knowledge. On outage the factory reverses automatically.
   */
  preferredProvider?: 'primary' | 'fallback';
}

export interface LLMResponse {
  text: string;
}

export interface LLMProvider {
  name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  healthCheck(): Promise<boolean>;
}

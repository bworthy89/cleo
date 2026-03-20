import { LLMProvider, LLMRequest, LLMResponse } from './types';
import { OllamaProvider } from './ollama';
import { GeminiProvider } from './gemini';

export type { LLMRequest, LLMResponse } from './types';

interface ProviderStatus {
  active: string;
  ollama: { healthy: boolean; lastCheck: string | null };
  gemini: { healthy: boolean; lastCheck: string | null };
}

class LLMProviderFactory {
  private primary: LLMProvider | null = null;
  private fallback: LLMProvider | null = null;
  private primaryHealthy = false;
  private fallbackHealthy = false;
  private lastPrimaryCheck: Date | null = null;
  private lastFallbackCheck: Date | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Initialize providers — fail gracefully if env vars are missing
    try {
      this.primary = new OllamaProvider();
    } catch (e) {
      console.warn('[LLM] Ollama provider unavailable:', (e as Error).message);
    }

    try {
      this.fallback = new GeminiProvider();
    } catch (e) {
      console.warn('[LLM] Gemini provider unavailable:', (e as Error).message);
    }

    // Run initial health check, then schedule periodic checks
    this.runHealthChecks();
    const interval = Number(process.env.HEALTH_CHECK_INTERVAL_MS) || 30000;
    this.healthInterval = setInterval(() => this.runHealthChecks(), interval);
  }

  private async runHealthChecks(): Promise<void> {
    if (this.primary) {
      try {
        const wasHealthy = this.primaryHealthy;
        this.primaryHealthy = await this.primary.healthCheck();
        this.lastPrimaryCheck = new Date();
        if (!wasHealthy && this.primaryHealthy) {
          console.log(`[LLM] Primary (${this.primary.name}) recovered — switching back`);
        } else if (wasHealthy && !this.primaryHealthy) {
          console.warn(`[LLM] Primary (${this.primary.name}) went down — will use fallback`);
        }
      } catch {
        this.primaryHealthy = false;
        this.lastPrimaryCheck = new Date();
      }
    }

    if (this.fallback) {
      try {
        this.fallbackHealthy = await this.fallback.healthCheck();
        this.lastFallbackCheck = new Date();
      } catch {
        this.fallbackHealthy = false;
        this.lastFallbackCheck = new Date();
      }
    }
  }

  private getActiveProvider(): LLMProvider {
    if (this.primary && this.primaryHealthy) return this.primary;
    if (this.fallback && this.fallbackHealthy) return this.fallback;
    // If neither is confirmed healthy, try primary first, then fallback
    if (this.primary) return this.primary;
    if (this.fallback) return this.fallback;
    throw new Error('No LLM providers available');
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const provider = this.getActiveProvider();
    console.log(`[LLM] Using ${provider.name}`);

    try {
      return await provider.generate(request);
    } catch (error) {
      // If primary failed, try fallback
      if (provider === this.primary && this.fallback) {
        console.warn(`[LLM] ${provider.name} failed, falling back to ${this.fallback.name}`);
        this.primaryHealthy = false;
        return await this.fallback.generate(request);
      }
      throw error;
    }
  }

  getStatus(): ProviderStatus {
    const active = this.primary && this.primaryHealthy
      ? this.primary.name
      : this.fallback?.name ?? 'none';

    return {
      active,
      ollama: {
        healthy: this.primaryHealthy,
        lastCheck: this.lastPrimaryCheck?.toISOString() ?? null,
      },
      gemini: {
        healthy: this.fallbackHealthy,
        lastCheck: this.lastFallbackCheck?.toISOString() ?? null,
      },
    };
  }

  destroy(): void {
    if (this.healthInterval) clearInterval(this.healthInterval);
  }
}

export const llmProvider = new LLMProviderFactory();

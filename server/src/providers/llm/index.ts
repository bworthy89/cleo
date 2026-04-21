import { LLMProvider, LLMRequest, LLMResponse } from './types';
import { GroqProvider } from './groq';
import { GeminiProvider } from './gemini';

export type { LLMRequest, LLMResponse } from './types';

interface ProviderStatus {
  active: string;
  groq: { healthy: boolean; lastCheck: string | null };
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
    // Groq (Llama 3.3 70B on LPU) = primary — sub-second inference, generous
    // free tier, no quota-exhaust failure mode that Gemini has. Gemini stays
    // as fallback for when Groq is unreachable.
    try {
      this.primary = new GroqProvider();
    } catch (e) {
      console.warn('[LLM] Groq provider unavailable:', (e as Error).message);
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
    const prefersFallback = request.preferredProvider === 'fallback';
    const first = prefersFallback && this.fallback && this.fallbackHealthy
      ? this.fallback
      : this.getActiveProvider();
    console.log(`[LLM] Using ${first.name}${prefersFallback ? ' (fallback preferred)' : ''}`);

    try {
      return await first.generate(request);
    } catch (error) {
      // Cross-try the other provider if one is available. Preserves existing
      // primary→fallback behavior and adds fallback→primary when the caller
      // preferred fallback but it errored.
      const alt = first === this.primary ? this.fallback : this.primary;
      if (alt) {
        console.warn(`[LLM] ${first.name} failed, trying ${alt.name}`);
        if (first === this.primary) this.primaryHealthy = false;
        else this.fallbackHealthy = false;
        return await alt.generate(request);
      }
      throw error;
    }
  }

  getStatus(): ProviderStatus {
    // Only report a provider as active when its most-recent health check
    // passed. Otherwise return 'none' so /health accurately reflects that
    // no provider is currently serving requests.
    const active =
      this.primary && this.primaryHealthy ? this.primary.name
      : this.fallback && this.fallbackHealthy ? this.fallback.name
      : 'none';

    return {
      active,
      groq: {
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

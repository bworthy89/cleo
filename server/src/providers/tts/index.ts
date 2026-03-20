import { TTSProvider, TTSRequest, TTSResponse } from './types';
import { OrpheusProvider } from './orpheus';
import { ElevenLabsProvider } from './elevenlabs';

export type { TTSRequest, TTSResponse } from './types';

interface ProviderStatus {
  active: string;
  orpheus: { healthy: boolean; lastCheck: string | null };
  elevenlabs: { healthy: boolean; lastCheck: string | null };
}

class TTSProviderFactory {
  private primary: TTSProvider | null = null;
  private fallback: TTSProvider | null = null;
  private primaryHealthy = false;
  private fallbackHealthy = false;
  private lastPrimaryCheck: Date | null = null;
  private lastFallbackCheck: Date | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    try {
      this.primary = new OrpheusProvider();
    } catch (e) {
      console.warn('[TTS] Orpheus provider unavailable:', (e as Error).message);
    }

    try {
      this.fallback = new ElevenLabsProvider();
    } catch (e) {
      console.warn('[TTS] ElevenLabs provider unavailable:', (e as Error).message);
    }

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
          console.log(`[TTS] Primary (${this.primary.name}) recovered — switching back`);
        } else if (wasHealthy && !this.primaryHealthy) {
          console.warn(`[TTS] Primary (${this.primary.name}) went down — will use fallback`);
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

  private getActiveProvider(): TTSProvider {
    if (this.primary && this.primaryHealthy) return this.primary;
    if (this.fallback && this.fallbackHealthy) return this.fallback;
    if (this.primary) return this.primary;
    if (this.fallback) return this.fallback;
    throw new Error('No TTS providers available');
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const provider = this.getActiveProvider();
    console.log(`[TTS] Using ${provider.name}`);

    try {
      return await provider.synthesize(request);
    } catch (error) {
      if (provider === this.primary && this.fallback) {
        console.warn(`[TTS] ${provider.name} failed, falling back to ${this.fallback.name}`);
        this.primaryHealthy = false;
        return await this.fallback.synthesize(request);
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
      orpheus: {
        healthy: this.primaryHealthy,
        lastCheck: this.lastPrimaryCheck?.toISOString() ?? null,
      },
      elevenlabs: {
        healthy: this.fallbackHealthy,
        lastCheck: this.lastFallbackCheck?.toISOString() ?? null,
      },
    };
  }

  destroy(): void {
    if (this.healthInterval) clearInterval(this.healthInterval);
  }
}

export const ttsProvider = new TTSProviderFactory();

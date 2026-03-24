import { TTSProvider, TTSRequest, TTSResponse } from './types';
import { CartesiaProvider } from './cartesia';
import { ElevenLabsProvider } from './elevenlabs';
import { OrpheusProvider } from './orpheus';

export type { TTSRequest, TTSResponse } from './types';

interface ProviderStatus {
  active: string;
  cartesia: { healthy: boolean; lastCheck: string | null };
  elevenlabs: { healthy: boolean; lastCheck: string | null };
  orpheus: { healthy: boolean; lastCheck: string | null };
}

class TTSProviderFactory {
  private primary: TTSProvider | null = null;
  private fallback: TTSProvider | null = null;
  private tertiary: TTSProvider | null = null;
  private primaryHealthy = false;
  private fallbackHealthy = false;
  private tertiaryHealthy = false;
  private lastPrimaryCheck: Date | null = null;
  private lastFallbackCheck: Date | null = null;
  private lastTertiaryCheck: Date | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    try {
      this.primary = new CartesiaProvider();
    } catch (e) {
      console.warn('[TTS] Cartesia provider unavailable:', (e as Error).message);
    }

    try {
      this.fallback = new ElevenLabsProvider();
    } catch (e) {
      console.warn('[TTS] ElevenLabs provider unavailable:', (e as Error).message);
    }

    try {
      this.tertiary = new OrpheusProvider();
    } catch (e) {
      console.warn('[TTS] Orpheus provider unavailable:', (e as Error).message);
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

    if (this.tertiary) {
      try {
        this.tertiaryHealthy = await this.tertiary.healthCheck();
        this.lastTertiaryCheck = new Date();
      } catch {
        this.tertiaryHealthy = false;
        this.lastTertiaryCheck = new Date();
      }
    }
  }

  private getActiveProvider(): TTSProvider {
    if (this.primary && this.primaryHealthy) return this.primary;
    if (this.fallback && this.fallbackHealthy) return this.fallback;
    if (this.tertiary && this.tertiaryHealthy) return this.tertiary;
    if (this.primary) return this.primary;
    if (this.fallback) return this.fallback;
    if (this.tertiary) return this.tertiary;
    throw new Error('No TTS providers available');
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const provider = this.getActiveProvider();
    console.log(`[TTS] Using ${provider.name}`);

    try {
      return await provider.synthesize(request);
    } catch (error) {
      // Try fallback chain
      if (provider === this.primary) {
        this.primaryHealthy = false;
        if (this.fallback) {
          console.warn(`[TTS] ${provider.name} failed, falling back to ${this.fallback.name}`);
          try {
            return await this.fallback.synthesize(request);
          } catch (fallbackError) {
            this.fallbackHealthy = false;
            if (this.tertiary) {
              console.warn(`[TTS] ${this.fallback.name} failed, falling back to ${this.tertiary.name}`);
              return await this.tertiary.synthesize(request);
            }
            throw fallbackError;
          }
        }
      } else if (provider === this.fallback && this.tertiary) {
        this.fallbackHealthy = false;
        console.warn(`[TTS] ${provider.name} failed, falling back to ${this.tertiary.name}`);
        return await this.tertiary.synthesize(request);
      }
      throw error;
    }
  }

  getStatus(): ProviderStatus {
    const active = this.primary && this.primaryHealthy
      ? this.primary.name
      : this.fallback && this.fallbackHealthy
        ? this.fallback.name
        : this.tertiary?.name ?? 'none';

    return {
      active,
      cartesia: {
        healthy: this.primaryHealthy,
        lastCheck: this.lastPrimaryCheck?.toISOString() ?? null,
      },
      elevenlabs: {
        healthy: this.fallbackHealthy,
        lastCheck: this.lastFallbackCheck?.toISOString() ?? null,
      },
      orpheus: {
        healthy: this.tertiaryHealthy,
        lastCheck: this.lastTertiaryCheck?.toISOString() ?? null,
      },
    };
  }

  destroy(): void {
    if (this.healthInterval) clearInterval(this.healthInterval);
  }
}

export const ttsProvider = new TTSProviderFactory();

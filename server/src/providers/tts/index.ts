import { TTSProvider, TTSRequest, TTSResponse } from './types';
import { CachingTTSProvider } from './cache';
import { CartesiaProvider } from './cartesia';
import { ChatterboxProvider } from './chatterbox';
import { CosyVoiceProvider } from './cosyvoice';
import { ElevenLabsProvider } from './elevenlabs';
import { F5TTSProvider } from './f5tts';
import { OrpheusProvider } from './orpheus';
import { bakeTelemetry } from '../../services/telemetry/BakeTelemetry';

export type { TTSRequest, TTSResponse } from './types';

interface ProviderStatus {
  active: string;
  primary: { name: string; healthy: boolean; lastCheck: string | null };
  fallback: { name: string; healthy: boolean; lastCheck: string | null };
  tertiary: { name: string; healthy: boolean; lastCheck: string | null };
}

const PROVIDER_CONSTRUCTORS: Record<string, () => TTSProvider> = {
  cartesia: () => new CartesiaProvider(),
  chatterbox: () => new ChatterboxProvider(),
  cosyvoice: () => new CosyVoiceProvider(),
  elevenlabs: () => new ElevenLabsProvider(),
  f5tts: () => new F5TTSProvider(),
  orpheus: () => new OrpheusProvider(),
};

/**
 * Ordered slot names — primary, fallback, tertiary.
 * Respects TTS_PRIMARY env var: that provider moves to primary slot. When
 * TTS_FALLBACK is also set, it takes slot 2 explicitly (needed so a
 * self-hosted primary like cosyvoice can fall back to another self-hosted
 * provider like f5tts before hitting a paid API). Otherwise falls back to
 * a sensible default order led by ElevenLabs for prose quality.
 */
function resolveOrder(): [string, string, string] {
  const primary = (process.env.TTS_PRIMARY ?? 'cartesia').toLowerCase();
  const fallback = (process.env.TTS_FALLBACK ?? '').toLowerCase();
  const defaults = ['cartesia', 'elevenlabs', 'orpheus'];
  const known = Object.keys(PROVIDER_CONSTRUCTORS);
  const chosen = known.includes(primary) ? primary : 'cartesia';

  // Explicit fallback override — lets self-hosted chains (cosyvoice→f5tts)
  // skip the default API-first fallback. Tertiary fills from defaults.
  if (fallback && known.includes(fallback) && fallback !== chosen) {
    const tertiary = defaults.find(n => n !== chosen && n !== fallback) ?? '';
    return [chosen, fallback, tertiary];
  }

  const rest = defaults.filter(n => n !== chosen);
  // If primary is non-default (e.g. cosyvoice, f5tts, chatterbox), keep all
  // three defaults as remaining slots, prioritizing elevenlabs/orpheus then
  // cartesia.
  if (!defaults.includes(chosen)) {
    rest.push('cartesia');
  }
  return [chosen, rest[0] ?? '', rest[1] ?? ''];
}

export class TTSProviderFactory {
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

  private readonly order: [string, string, string];

  constructor() {
    this.order = resolveOrder();
    const [primaryName, fallbackName, tertiaryName] = this.order;
    console.log(`[TTS] Provider order: ${primaryName} > ${fallbackName} > ${tertiaryName}`);

    const tryBuild = (name: string): TTSProvider | null => {
      if (!name) return null;
      const ctor = PROVIDER_CONSTRUCTORS[name];
      if (!ctor) {
        console.warn(`[TTS] Unknown provider name: ${name}`);
        return null;
      }
      try {
        return ctor();
      } catch (e) {
        console.warn(`[TTS] ${name} provider unavailable: ${(e as Error).message}`);
        return null;
      }
    };

    this.primary = tryBuild(primaryName);
    this.fallback = tryBuild(fallbackName);
    this.tertiary = tryBuild(tertiaryName);

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
          bakeTelemetry.recordProviderFallback({
            from: provider.name,
            to: this.fallback.name,
            reason: error instanceof Error ? error.message : String(error),
          });
          try {
            return await this.fallback.synthesize(request);
          } catch (fallbackError) {
            this.fallbackHealthy = false;
            if (this.tertiary) {
              console.warn(`[TTS] ${this.fallback.name} failed, falling back to ${this.tertiary.name}`);
              bakeTelemetry.recordProviderFallback({
                from: this.fallback.name,
                to: this.tertiary.name,
                reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              });
              return await this.tertiary.synthesize(request);
            }
            throw fallbackError;
          }
        }
      } else if (provider === this.fallback && this.tertiary) {
        this.fallbackHealthy = false;
        console.warn(`[TTS] ${provider.name} failed, falling back to ${this.tertiary.name}`);
        bakeTelemetry.recordProviderFallback({
          from: provider.name,
          to: this.tertiary.name,
          reason: error instanceof Error ? error.message : String(error),
        });
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
      primary: {
        name: this.primary?.name ?? this.order[0],
        healthy: this.primaryHealthy,
        lastCheck: this.lastPrimaryCheck?.toISOString() ?? null,
      },
      fallback: {
        name: this.fallback?.name ?? this.order[1],
        healthy: this.fallbackHealthy,
        lastCheck: this.lastFallbackCheck?.toISOString() ?? null,
      },
      tertiary: {
        name: this.tertiary?.name ?? this.order[2],
        healthy: this.tertiaryHealthy,
        lastCheck: this.lastTertiaryCheck?.toISOString() ?? null,
      },
    };
  }

  destroy(): void {
    if (this.healthInterval) clearInterval(this.healthInterval);
  }

  /**
   * Test seam — construct a factory with pre-built provider instances, bypassing
   * env-var resolution and the health-check interval. `primaryHealthy` and
   * `fallbackHealthy` are pre-set to true so the primary is the active provider
   * and a thrown error triggers a real fallback transition.
   */
  static makeWithProviders(
    primary: TTSProvider,
    fallback: TTSProvider,
    tertiary: TTSProvider,
  ): TTSProviderFactory {
    const factory = Object.create(TTSProviderFactory.prototype) as TTSProviderFactory;
    factory.primary = primary;
    factory.fallback = fallback;
    factory.tertiary = tertiary;
    factory.primaryHealthy = true;
    factory.fallbackHealthy = true;
    factory.tertiaryHealthy = true;
    factory.lastPrimaryCheck = null;
    factory.lastFallbackCheck = null;
    factory.lastTertiaryCheck = null;
    factory.healthInterval = null;
    (factory as unknown as { order: [string, string, string] }).order =
      [primary.name, fallback.name, tertiary.name];
    return factory;
  }
}

const _factory = new TTSProviderFactory();

// Wrap the factory with filesystem caching.
// The adapter gives TTSProviderFactory a TTSProvider interface so
// CachingTTSProvider can wrap it. Name is static ('factory') because
// getStatus().active is not yet populated at module load time.
const _cache = new CachingTTSProvider({
  name: 'factory',
  synthesize: (req: TTSRequest) => _factory.synthesize(req),
  healthCheck: async () => true,
});

export const ttsProvider = {
  synthesize: (req: TTSRequest) => _cache.synthesize(req),
  getStatus: () => _factory.getStatus(),
  destroy: () => _factory.destroy(),
};

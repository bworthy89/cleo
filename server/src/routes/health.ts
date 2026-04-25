import { Router } from 'express';

const BAKE_QUEUE_DEGRADED_THRESHOLD = 5;
const BAKE_QUEUE_MAJOR_THRESHOLD = 15;

interface TtsStatus {
  active: string;
  primary: { name: string; healthy: boolean; lastCheck: string | null };
  fallback: { name: string; healthy: boolean; lastCheck: string | null };
  tertiary: { name: string; healthy: boolean; lastCheck: string | null };
}

export interface PublicHealthDeps {
  getTtsStatus(): TtsStatus;
  getInFlightCount(): number;
}

type ComponentStatus = 'operational' | 'degraded' | 'major';

function deriveTtsStatus(s: TtsStatus): ComponentStatus {
  if (s.primary.healthy) return 'operational';
  if (s.fallback.healthy) return 'degraded';
  return 'major';
}

function deriveBakeStatus(queueDepth: number): ComponentStatus {
  if (queueDepth >= BAKE_QUEUE_MAJOR_THRESHOLD) return 'major';
  if (queueDepth >= BAKE_QUEUE_DEGRADED_THRESHOLD) return 'degraded';
  return 'operational';
}

function deriveOverall(ttsStatus: ComponentStatus, bakeStatus: ComponentStatus): ComponentStatus {
  if (ttsStatus === 'major' || bakeStatus === 'major') return 'major';
  if (ttsStatus === 'degraded' || bakeStatus === 'degraded') return 'degraded';
  return 'operational';
}

export function createPublicHealthRouter(deps: PublicHealthDeps): Router {
  const router = Router();

  router.get('/health/public', (_req, res) => {
    const tts = deps.getTtsStatus();
    const queueDepth = deps.getInFlightCount();

    const ttsStatus = deriveTtsStatus(tts);
    const bakeStatus = deriveBakeStatus(queueDepth);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: deriveOverall(ttsStatus, bakeStatus),
      checkedAt: new Date().toISOString(),
      components: {
        tts: {
          status: ttsStatus,
          active: tts.active,
          primary: { name: tts.primary.name, healthy: tts.primary.healthy },
          fallback: { name: tts.fallback.name, healthy: tts.fallback.healthy },
        },
        bake: {
          status: bakeStatus,
          queueDepth,
        },
      },
    });
  });

  return router;
}

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { FeaturedBroadcastRegistry } from '../services/broadcast/FeaturedBroadcastRegistry';
import type { BroadcastOrchestrator } from '../services/broadcast/BroadcastOrchestrator';
import { requireCurator, type AuthenticatedRequest } from '../middleware/auth';

const vibeSchema = z.enum([
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
]);

const lengthSchema = z.enum(['quick', 'standard', 'long']);

const trackSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  artistName: z.string().min(1).max(200),
  albumTitle: z.string().max(200),
  duration: z.number().positive().max(7200),
  artworkUrl: z.string().url().max(2048).optional(),
  genreNames: z.array(z.string().max(100)).max(10).optional(),
});

const publishSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  vibe: vibeSchema,
  length: lengthSchema,
  artworkUrl: z.string().url().optional(),
  tracks: z.array(trackSchema).min(5).max(100),
});

export function createFeaturedRouter(
  registry: FeaturedBroadcastRegistry,
  orchestrator?: BroadcastOrchestrator,
  bakeLimiter?: RequestHandler,
): Router {
  const router = Router();

  router.get('/broadcast/featured', (_req, res) => {
    res.json({ broadcasts: registry.list() });
  });

  if (orchestrator) {
    const publishMiddleware: RequestHandler[] = [
      requireCurator,
      ...(bakeLimiter ? [bakeLimiter] : []),
    ];

    router.post('/broadcast/featured/publish', ...publishMiddleware, async (req: AuthenticatedRequest, res) => {
      const parsed = publishSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      }
      const config = parsed.data;

      try {
        const { manifest: initial } = await orchestrator.create({
          userId: 'curator',
          playlistId: null,
          vibe: config.vibe,
          length: config.length,
          tracks: config.tracks,
          userContext: {
            timeOfDay: '12:00',
            dayOfWeek: '',
            firstTimeUser: false,
            listenerName: 'tonight\u2019s listener',
          },
        });

        await orchestrator.waitForCompletion(initial.broadcastId);
        const finalManifest = orchestrator.getManifest(initial.broadcastId) ?? initial;

        await registry.put({
          id: config.id,
          title: config.title,
          description: config.description,
          vibe: config.vibe,
          length: config.length,
          artworkUrl: config.artworkUrl,
          baked: true,
          createdAt: Date.now(),
          manifest: finalManifest,
        });

        return res.json({ id: config.id, broadcastId: finalManifest.broadcastId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'publish failed';
        return res.status(500).json({ error: msg });
      }
    });
  }

  return router;
}

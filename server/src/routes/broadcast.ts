import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { BroadcastOrchestrator } from '../services/broadcast/BroadcastOrchestrator';
import type { BroadcastStore } from '../services/broadcast/BroadcastStore';

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
});

const contextSchema = z.object({
  timeOfDay: z.string(),
  dayOfWeek: z.string(),
  firstTimeUser: z.boolean(),
  lastSessionSummary: z.string().max(500).optional(),
  tracksRecentlyPlayed: z.array(z.string()).max(50).optional(),
  listenerName: z.string().max(50).optional(),
});

const createSchema = z.object({
  playlistId: z.string().min(1),
  vibe: vibeSchema,
  length: lengthSchema,
  userContext: contextSchema,
  tracks: z.array(trackSchema).min(5).max(100),
});

interface AuthenticatedRequest extends Request {
  uid?: string;
}

export function createBroadcastRouter(
  orch: BroadcastOrchestrator,
  store: BroadcastStore,
  bakeLimiter?: RequestHandler,
): Router {
  const router = Router();

  const createMiddleware: RequestHandler[] = bakeLimiter ? [bakeLimiter] : [];

  router.post('/broadcast/create', ...createMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    if (!req.uid) return res.status(401).json({ error: 'unauthenticated' });

    try {
      const result = await orch.create({ ...parsed.data, userId: req.uid });
      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'bake failed';
      const status = /insufficient tracks/i.test(msg) ? 400 : 500;
      return res.status(status).json({ error: msg });
    }
  });

  router.get('/broadcast/:id/manifest', (req, res) => {
    const manifest = store.get(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'not found' });
    return res.json(manifest);
  });

  return router;
}

import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { BroadcastOrchestrator } from '../services/broadcast/BroadcastOrchestrator';
import type { BroadcastStore } from '../services/broadcast/BroadcastStore';
import type { AuthenticatedRequest } from '../middleware/auth';

const vibeSchema = z.enum([
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
]);

const lengthSchema = z.enum(['quick', 'standard', 'long']);

// Exported so the Zod ISRC-format tests can exercise the route schema directly.
export const trackSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  artistName: z.string().min(1).max(200),
  albumTitle: z.string().max(200),
  duration: z.number().positive().max(7200),
  artworkUrl: z.string().url().max(2048).optional(),
  genreNames: z.array(z.string().max(100)).max(10).optional(),
  // ISO 3901: 2-letter country + 3-alphanumeric registrant + 7 digits.
  isrc: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/).optional(),
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
  // Ask ONAY sets this true so the LLM-curated order is preserved verbatim
  // rather than re-sequenced by DeterministicTrackSequencer.
  preserveOrder: z.boolean().optional(),
});

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
      // Log the specific field-level issues so we can diagnose 400s that
      // users report. Zod's `fieldErrors` is a map of path → messages.
      const flat = parsed.error.flatten();
      const issues = parsed.error.issues.slice(0, 5).map(i => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      }));
      console.warn(
        `[broadcast/create] 400 invalid request — issues: ${JSON.stringify(issues)}`,
      );
      return res.status(400).json({ error: 'invalid request', details: flat });
    }
    if (!req.uid) return res.status(401).json({ error: 'unauthenticated' });

    try {
      const result = await orch.create({
        ...parsed.data,
        userId: req.uid,
        userEmail: req.email,
      });
      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'bake failed';
      const status = /insufficient tracks/i.test(msg) ? 400 : 500;
      return res.status(status).json({ error: msg });
    }
  });

  router.get('/broadcast/:id/manifest', (req: AuthenticatedRequest, res) => {
    const manifest = store.get(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'not found' });
    // Ownership gate: a broadcast belongs to the uid that baked it. Curator-baked
    // (featured) broadcasts are shared globally. Return 404 on mismatch so the
    // existence of another user's id isn't confirmed.
    if (manifest.userId !== 'curator' && manifest.userId !== req.uid) {
      return res.status(404).json({ error: 'not found' });
    }
    return res.json(manifest);
  });

  router.delete('/broadcast/:id', (req: AuthenticatedRequest, res) => {
    if (!req.uid) return res.status(401).json({ error: 'unauthenticated' });
    const manifest = store.get(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'not found' });
    // Strict ownership: curator-baked broadcasts (manifest.userId === 'curator')
    // are NOT abortable here. The GET endpoint's curator-readable carveout
    // does not apply — featured publishes use a separate code path.
    if (manifest.userId !== req.uid) return res.status(404).json({ error: 'not found' });
    orch.abortBake(req.params.id);
    return res.status(204).end();
  });

  return router;
}

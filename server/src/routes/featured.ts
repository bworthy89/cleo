import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { FeaturedBroadcastRegistry } from '../services/broadcast/FeaturedBroadcastRegistry';
import type { BroadcastOrchestrator } from '../services/broadcast/BroadcastOrchestrator';
import { requireCurator, type AuthenticatedRequest } from '../middleware/auth';
import type { EventRecorder } from '../services/events/EventRecorder';
import { getThemeFor } from '../config/tonightOnOnay';

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
  // ISO 3901: 2-letter country + 3-alphanumeric registrant + 7 digits.
  isrc: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/).optional(),
});

const slotSchema = z.enum(['morning', 'evening']);
const daySchema = z.enum(['mon','tue','wed','thu','fri','sat','sun']);

const publishSchema = z.object({
  id: z.string().min(1).max(80),
  slot: slotSchema.optional(),
  themeDay: daySchema.optional(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  vibe: vibeSchema,
  length: lengthSchema,
  artworkUrl: z.string().url().optional(),
  tracks: z.array(trackSchema).min(5).max(100),
}).superRefine((v, ctx) => {
  if (v.slot) {
    if (!v.themeDay) {
      ctx.addIssue({ code: 'custom', path: ['themeDay'], message: 'themeDay required when slot is set' });
      return;
    }
    const expectedId = `slot_${v.slot}`;
    if (v.id !== expectedId) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: `id must be "${expectedId}" for slot ${v.slot}` });
    }
    const theme = getThemeFor(v.slot, v.themeDay);
    if (theme.vibe !== v.vibe) {
      ctx.addIssue({ code: 'custom', path: ['vibe'], message: `vibe must match theme (${theme.vibe})` });
    }
    if (theme.length !== v.length) {
      ctx.addIssue({ code: 'custom', path: ['length'], message: `length must match theme (${theme.length})` });
    }
  } else {
    // Free-form publishes may not use the reserved slot id namespace.
    if (/^slot_/.test(v.id)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'id "slot_*" is reserved for Tonight on ONAY slots' });
    }
  }
});

/**
 * Builds the featured-broadcasts router. The publish route mounts only
 * when `orchestrator` is supplied; otherwise the router exposes the
 * read-only `GET /broadcast/featured` endpoint alone.
 *
 * @param registry - featured broadcast registry (required)
 * @param orchestrator - bake orchestrator; omit to skip the publish route
 * @param bakeLimiter - per-minute generation rate limiter (shared across users)
 * @param publishBudget - per-curator rolling daily cap; runs after requireCurator
 *   and before bakeLimiter so exhausted curators don't consume shared capacity
 */
export function createFeaturedRouter(
  registry: FeaturedBroadcastRegistry,
  orchestrator?: BroadcastOrchestrator,
  bakeLimiter?: RequestHandler,
  publishBudget?: RequestHandler,
  eventRecorder?: EventRecorder,
): Router {
  const router = Router();

  router.get('/broadcast/featured', (req: AuthenticatedRequest, res) => {
    // Piggyback `app_open` here — the home screen always hits this route on
    // cold launch, so this is the canonical "user opened the app" signal
    // without standing up a separate /events/app-open endpoint. Best-effort:
    // if recorder write fails, the GET still returns the featured list.
    if (eventRecorder && req.uid) {
      try {
        // Client-platform headers — fall back to 'unknown' rather than block
        // the response on missing headers; payload_json stays freeform.
        const platformHeader = req.header('x-cleo-platform');
        const platform = platformHeader === 'android' ? 'android' : 'ios';
        const appVersion = req.header('x-cleo-app-version') ?? 'unknown';
        const buildNumber = Number.parseInt(req.header('x-cleo-build-number') ?? '0', 10) || 0;
        eventRecorder.record(req.uid, 'app_open', { appVersion, platform, buildNumber });
      } catch (err) {
        console.warn('[featured] app_open record failed:', err);
      }
    }
    res.json({ broadcasts: registry.list() });
  });

  if (orchestrator) {
    const publishMiddleware: RequestHandler[] = [
      requireCurator,
      ...(publishBudget ? [publishBudget] : []),
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
          // Curator already hand-picked the track order (via Ask ONAY's
          // LLM curation or a direct config). Skip the deterministic
          // sequencer's re-shuffle.
          preserveOrder: true,
        });

        await orchestrator.waitForCompletion(initial.broadcastId);
        const finalManifest = orchestrator.getManifest(initial.broadcastId) ?? initial;

        await registry.put({
          id: config.id,
          slot: config.slot,
          themeDay: config.themeDay,
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

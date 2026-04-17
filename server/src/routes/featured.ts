import { Router } from 'express';
import type { FeaturedBroadcastRegistry } from '../services/broadcast/FeaturedBroadcastRegistry';

export function createFeaturedRouter(registry: FeaturedBroadcastRegistry): Router {
  const router = Router();
  router.get('/broadcast/featured', (_req, res) => {
    res.json({ broadcasts: registry.list() });
  });
  return router;
}

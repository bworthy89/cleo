import { Router } from 'express';
import { z } from 'zod';
import type { LastFmClient } from '../services/lastfm/LastFmClient';

export interface LastFmRouterDeps {
  client: LastFmClient;
  firestore: FirebaseFirestore.Firestore;
  apiKey: string;
  callbackUrl: string;
}

const integrationDoc = (firestore: FirebaseFirestore.Firestore, uid: string) =>
  firestore.collection('users').doc(uid).collection('integrations').doc('lastfm');

const connectSchema = z.object({
  token: z.string().trim().min(1).max(200),
});

export function createLastFmRouter(deps: LastFmRouterDeps): Router {
  const router = Router();

  router.post('/lastfm/auth-url', (_req, res) => {
    const url = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(deps.apiKey)}&cb=${encodeURIComponent(deps.callbackUrl)}`;
    return res.json({ url });
  });

  router.post('/lastfm/connect', async (req, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const uid = (req as unknown as { uid: string }).uid;
    try {
      const session = await deps.client.getSession(parsed.data.token);
      await integrationDoc(deps.firestore, uid).set({
        sessionKey: session.key,
        username: session.name,
        needsReconnect: false,
        connectedAt: new Date(),
      }, { merge: true });
      return res.status(204).end();
    } catch (err) {
      console.warn('[lastfm/connect] failed', err);
      return res.status(502).json({ error: 'last.fm exchange failed' });
    }
  });

  return router;
}

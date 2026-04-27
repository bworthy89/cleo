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

const trackBaseSchema = z.object({
  trackId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  artistName: z.string().trim().min(1).max(200),
  albumTitle: z.string().trim().max(200).optional(),
  duration: z.number().int().min(1).max(36000),
});

const nowPlayingSchema = trackBaseSchema;
const scrobbleSchema = trackBaseSchema.extend({
  startedAt: z.number().int().min(0).max(2_000_000_000),
});

const STICKY_AUTH_ERRORS = new Set([4, 9]);

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

    let session: { key: string; name: string };
    try {
      session = await deps.client.getSession(parsed.data.token);
    } catch (err) {
      console.warn('[lastfm/connect] getSession failed', err);
      return res.status(502).json({ error: 'last.fm exchange failed' });
    }

    try {
      await integrationDoc(deps.firestore, uid).set({
        sessionKey: session.key,
        username: session.name,
        needsReconnect: false,
        connectedAt: new Date(),
      }, { merge: true });
    } catch (err) {
      console.warn('[lastfm/connect] firestore write failed', err);
      return res.status(500).json({ error: 'persistence failed' });
    }

    return res.status(204).end();
  });

  router.post('/lastfm/disconnect', async (req, res) => {
    const uid = (req as unknown as { uid: string }).uid;
    try {
      await integrationDoc(deps.firestore, uid).delete();
      return res.status(204).end();
    } catch (err) {
      console.warn('[lastfm/disconnect] failed', err);
      return res.status(500).json({ error: 'disconnect failed' });
    }
  });

  router.post('/lastfm/now-playing', async (req, res) => {
    const parsed = nowPlayingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const uid = (req as unknown as { uid: string }).uid;
    const docRef = integrationDoc(deps.firestore, uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(412).json({ error: 'not connected' });
    }
    const sessionKey = (snap.data() as { sessionKey?: string } | undefined)?.sessionKey;
    if (!sessionKey) {
      return res.status(412).json({ error: 'not connected' });
    }
    try {
      const result = await deps.client.updateNowPlaying(sessionKey, parsed.data);
      if (result.ok) return res.status(204).end();
      if (STICKY_AUTH_ERRORS.has(result.errorCode)) {
        await docRef.update({ needsReconnect: true });
        return res.status(401).json({ error: 'last.fm session invalid', errorCode: result.errorCode });
      }
      return res.status(502).json({ error: 'last.fm error', errorCode: result.errorCode });
    } catch (err) {
      console.warn('[lastfm/now-playing] failed', err);
      return res.status(502).json({ error: 'last.fm error' });
    }
  });

  router.post('/lastfm/scrobble', async (req, res) => {
    const parsed = scrobbleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const uid = (req as unknown as { uid: string }).uid;
    const docRef = integrationDoc(deps.firestore, uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(412).json({ error: 'not connected' });
    }
    const sessionKey = (snap.data() as { sessionKey?: string } | undefined)?.sessionKey;
    if (!sessionKey) {
      return res.status(412).json({ error: 'not connected' });
    }
    try {
      const result = await deps.client.scrobble(sessionKey, parsed.data);
      if (result.ok) return res.status(204).end();
      if (STICKY_AUTH_ERRORS.has(result.errorCode)) {
        await docRef.update({ needsReconnect: true });
        return res.status(401).json({ error: 'last.fm session invalid', errorCode: result.errorCode });
      }
      return res.status(502).json({ error: 'last.fm error', errorCode: result.errorCode });
    } catch (err) {
      console.warn('[lastfm/scrobble] failed', err);
      return res.status(502).json({ error: 'last.fm error' });
    }
  });

  return router;
}

import { Router, Request, Response } from 'express';
import { validate, enrichMusicBrainzSchema } from '../middleware/validate';

export const musicbrainzRouter = Router();

const MIN_INTERVAL = 1100;

// Promise-chain queue ensures requests are serialized with minimum interval,
// even when multiple concurrent requests arrive simultaneously.
let mbQueue = Promise.resolve() as Promise<unknown>;

async function rateLimitedFetch(url: string): Promise<any> {
  const result = mbQueue.then(async () => {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL));
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CleoRadioApp/1.0 (bworthy89@gmail.com)',
        Accept: 'application/json',
      },
    });
    if (!response.ok) throw new Error(`MusicBrainz: ${response.status}`);
    return response.json();
  });
  // Chain regardless of success/failure so subsequent requests still wait
  mbQueue = result.catch(() => {});
  return result;
}

musicbrainzRouter.post('/enrich-musicbrainz', validate(enrichMusicBrainzSchema), async (req: Request, res: Response) => {
  try {
    const { title, artist } = req.body;

    const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const data = await rateLimitedFetch(
      `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=1&fmt=json`
    );

    const recording = data.recordings?.[0];
    if (!recording) {
      res.json({ found: false });
      return;
    }

    const tags = (recording.tags ?? [])
      .sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 5)
      .map((t: any) => t.name);

    res.json({
      found: true,
      mbid: recording.id,
      title: recording.title,
      artist: recording['artist-credit']?.[0]?.name,
      duration: recording.length ? Math.round(recording.length / 1000) : null,
      tags,
      firstReleaseYear: recording['first-release-date']?.substring(0, 4) ?? null,
    });
  } catch (error) {
    console.error('MusicBrainz error:', error);
    res.status(500).json({ error: 'MusicBrainz lookup failed' });
  }
});

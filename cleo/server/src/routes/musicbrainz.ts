import { Router, Request, Response } from 'express';

export const musicbrainzRouter = Router();

let lastRequestTime = 0;
const MIN_INTERVAL = 1100;

async function rateLimitedFetch(url: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'CleoRadioApp/1.0 (bworthy89@gmail.com)',
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`MusicBrainz: ${response.status}`);
  return response.json();
}

musicbrainzRouter.post('/enrich-musicbrainz', async (req: Request, res: Response) => {
  try {
    const { title, artist } = req.body;
    if (!title || !artist) {
      res.status(400).json({ error: 'title and artist are required' });
      return;
    }

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

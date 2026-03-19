import { Router, Request, Response } from 'express';

export const enrichmentRouter = Router();

enrichmentRouter.post('/enrich-track', async (req: Request, res: Response) => {
  try {
    const { title, artist } = req.body;

    if (!title || !artist) {
      res.status(400).json({ error: 'title and artist are required' });
      return;
    }

    const token = process.env.GENIUS_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ error: 'GENIUS_ACCESS_TOKEN not configured' });
      return;
    }

    const query = encodeURIComponent(`${title} ${artist}`);
    const response = await fetch(`https://api.genius.com/search?q=${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = await response.text();
      res.status(response.status).json({ error });
      return;
    }

    const data = await response.json();
    const hits = data.response?.hits ?? [];
    const results = hits.slice(0, 3).map((hit: any) => ({
      id: hit.result.id,
      title: hit.result.title,
      artist: hit.result.primary_artist?.name,
      url: hit.result.url,
      thumbnailUrl: hit.result.song_art_image_thumbnail_url,
    }));

    res.json({ results });
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Failed to enrich track' });
  }
});

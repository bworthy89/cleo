import { Router, Request, Response } from 'express';
import { validate, enrichTrackSchema } from '../middleware/validate';

export const enrichmentRouter = Router();

const GENIUS_MIN_INTERVAL = 1100;

// Promise-chain queue ensures requests are serialized with minimum interval,
// even when multiple concurrent requests arrive simultaneously.
let geniusQueue = Promise.resolve() as Promise<unknown>;

async function geniusRateLimitedFetch(url: string, token: string): Promise<any> {
  const result = geniusQueue.then(async () => {
    await new Promise((r) => setTimeout(r, GENIUS_MIN_INTERVAL));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Genius ${response.status}`);
    return response.json();
  });
  // Chain regardless of success/failure so subsequent requests still wait
  geniusQueue = result.catch(() => {});
  return result;
}

interface GeniusEnrichedFacts {
  producer?: string;
  songwriter?: string;
  sample?: string;
  context?: string;
  recordingLocation?: string;
  releaseYear?: string;
  geniusUrl?: string;
}

async function fetchSongDetails(songId: number, token: string): Promise<GeniusEnrichedFacts> {
  const data = await geniusRateLimitedFetch(
    `https://api.genius.com/songs/${songId}`,
    token
  );
  const song = data.response?.song;
  if (!song) return {};

  const facts: GeniusEnrichedFacts = {};

  // Producer credits
  const producers = song.producer_artists;
  if (producers && producers.length > 0) {
    facts.producer = producers.map((p: any) => p.name).join(', ');
  }

  // Songwriter credits
  const writers = song.writer_artists;
  if (writers && writers.length > 0) {
    facts.songwriter = writers.map((w: any) => w.name).join(', ');
  }

  // Description / context
  const desc = song.description?.plain;
  if (desc && desc.length > 10 && desc !== '?') {
    facts.context = desc.substring(0, 150).replace(/\s+\S*$/, '...');
  }

  // Recording location
  if (song.recording_location) {
    facts.recordingLocation = song.recording_location;
  }

  // Release year
  if (song.release_date_for_display) {
    facts.releaseYear = song.release_date_for_display;
  }

  // Sample relationships
  const relationships = song.song_relationships ?? [];
  const samples = relationships.find((r: any) => r.relationship_type === 'samples');
  if (samples?.songs?.length > 0) {
    const sampled = samples.songs[0];
    facts.sample = `Samples "${sampled.title}" by ${sampled.primary_artist?.name ?? 'unknown'}`;
  }

  facts.geniusUrl = song.url;

  return facts;
}

enrichmentRouter.post('/enrich-track', validate(enrichTrackSchema), async (req: Request, res: Response) => {
  console.log('[Enrichment] Request received');
  try {
    const { title, artist } = req.body;
    console.log(`[Enrichment] title: "${title}", artist: "${artist}"`);

    const token = process.env.GENIUS_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ error: 'GENIUS_ACCESS_TOKEN not configured' });
      return;
    }

    // Step 1: Search for the song
    const query = encodeURIComponent(`${title} ${artist}`);
    const searchData = await geniusRateLimitedFetch(
      `https://api.genius.com/search?q=${query}`,
      token
    );

    const hits = searchData.response?.hits ?? [];
    if (hits.length === 0) {
      res.json({ results: [], enrichedFacts: {} });
      return;
    }

    const topHit = hits[0].result;
    const results = hits.slice(0, 3).map((hit: any) => ({
      id: hit.result.id,
      title: hit.result.title,
      artist: hit.result.primary_artist?.name,
      url: hit.result.url,
      thumbnailUrl: hit.result.song_art_image_thumbnail_url,
    }));

    // Step 2: Fetch full song details for the top hit
    let enrichedFacts: GeniusEnrichedFacts = {};
    try {
      enrichedFacts = await fetchSongDetails(topHit.id, token);
    } catch (error) {
      console.warn('Genius song detail fetch failed:', error);
      enrichedFacts = { geniusUrl: topHit.url };
    }

    res.json({ results, enrichedFacts });
  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Failed to enrich track' });
  }
});

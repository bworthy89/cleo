import { Router, Request, Response } from 'express';

export const videoRouter = Router();

const HEYGEN_BASE = 'https://api.heygen.com';

videoRouter.post('/generate-cleo-video', async (req: Request, res: Response) => {
  try {
    const { text, audioUrl } = req.body;
    const apiKey = process.env.HEYGEN_API_KEY;
    const avatarId = process.env.CLEO_AVATAR_ID;

    if (!apiKey || !avatarId) {
      res.status(500).json({ error: 'HeyGen not configured' });
      return;
    }

    // Validate audioUrl to prevent SSRF
    if (audioUrl && (typeof audioUrl !== 'string' || !audioUrl.startsWith('https://'))) {
      res.status(400).json({ error: 'audioUrl must be a valid HTTPS URL' });
      return;
    }

    const response = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        video_inputs: [{
          character: {
            type: 'avatar',
            avatar_id: avatarId,
            avatar_style: 'normal',
          },
          voice: {
            type: 'audio',
            audio_url: audioUrl,
          },
        }],
        dimension: { width: 512, height: 512 },
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: 'Failed to generate video' });
  }
});

videoRouter.get('/cleo-video-status/:id', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.HEYGEN_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'HeyGen not configured' });
      return;
    }

    const videoId = req.params.id;
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(videoId)) {
      res.status(400).json({ error: 'Invalid video ID format' });
      return;
    }

    const response = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${videoId}`, {
      headers: { 'X-Api-Key': apiKey },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Video status error:', error);
    res.status(500).json({ error: 'Failed to get video status' });
  }
});

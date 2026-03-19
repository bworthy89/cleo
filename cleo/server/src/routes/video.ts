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

    const response = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${req.params.id}`, {
      headers: { 'X-Api-Key': apiKey },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Video status error:', error);
    res.status(500).json({ error: 'Failed to get video status' });
  }
});

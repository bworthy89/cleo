import { Router, Request, Response } from 'express';

export const voiceRouter = Router();

voiceRouter.post('/synthesize-voice', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    const wordCount = text?.split(/\s+/).length ?? 0;
    console.log(`[TTS] Received ${wordCount} words (${text?.length ?? 0} chars): "${text?.substring(0, 100)}..."`);

    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      res.status(500).json({ error: 'ElevenLabs not configured' });
      return;
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.15,
            similarity_boost: 0.80,
            style: 0.40,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      res.status(response.status).json({ error });
      return;
    }

    // ElevenLabs returns raw audio bytes, convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
    const estimatedDurationS = Math.round(arrayBuffer.byteLength / 16000); // ~128kbps mp3
    console.log(`[TTS] Audio returned: ${audioSizeKB}KB (~${estimatedDurationS}s), ${wordCount} words`);
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    res.json({ audioContent: base64Audio });
  } catch (error) {
    console.error('Voice synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice' });
  }
});

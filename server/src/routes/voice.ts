import { Router, Request, Response } from 'express';
import { ttsProvider } from '../providers/tts';

export const voiceRouter = Router();

voiceRouter.post('/synthesize-voice', async (req: Request, res: Response) => {
  try {
    const { text, stability, style, speed } = req.body;
    const wordCount = text?.split(/\s+/).length ?? 0;
    console.log(`[TTS] Received ${wordCount} words (${text?.length ?? 0} chars): "${text?.substring(0, 100)}..."`);

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    if (text.length > 5000) {
      res.status(400).json({ error: 'text exceeds maximum length of 5000 characters' });
      return;
    }

    const voiceSettings = {
      stability: Math.min(1.0, Math.max(0.0, typeof stability === 'number' ? stability : 0.35)),
      style: Math.min(1.0, Math.max(0.0, typeof style === 'number' ? style : 0.55)),
      speed: Math.min(2.0, Math.max(0.5, typeof speed === 'number' ? speed : 1.0)),
    };

    console.log(`[TTS] Voice settings: stability=${voiceSettings.stability}, style=${voiceSettings.style}, speed=${voiceSettings.speed}`);

    const result = await ttsProvider.synthesize({
      text,
      ...voiceSettings,
    });

    const audioSizeKB = Math.round((result.audioContent.length * 3 / 4) / 1024);
    console.log(`[TTS] Audio: ${audioSizeKB}KB, ${wordCount} words`);

    res.json({ audioContent: result.audioContent });
  } catch (error) {
    console.error('Voice synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice' });
  }
});

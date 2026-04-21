import { Router, Request, Response } from 'express';
import { ttsProvider } from '../providers/tts';
import { validate, voiceSchema } from '../middleware/validate';

export const voiceRouter = Router();

voiceRouter.post('/synthesize-voice', validate(voiceSchema), async (req: Request, res: Response) => {
  try {
    const { text, stability, style, speed } = req.body;
    const wordCount = text.split(/\s+/).length;
    console.log(`[TTS] Received ${wordCount} words (${text.length} chars): "${text.substring(0, 100)}..."`);
    console.log(`[TTS] Voice settings: stability=${stability}, style=${style}, speed=${speed}`);

    const result = await ttsProvider.synthesize({
      text,
      stability,
      style,
      speed,
    });

    const audioSizeKB = Math.round((result.audioContent.length * 3 / 4) / 1024);
    console.log(`[TTS] Audio: ${audioSizeKB}KB, ${wordCount} words`);

    res.json({ audioContent: result.audioContent });
  } catch (error) {
    console.error('Voice synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice' });
  }
});

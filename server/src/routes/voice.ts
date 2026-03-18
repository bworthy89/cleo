import { Router, Request, Response } from 'express';

export const voiceRouter = Router();

async function callElevenLabs(
  text: string,
  modelId: string,
  apiKey: string,
  voiceId: string,
  timeoutMs: number,
  pronunciationConfig?: object[]
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
          model_id: modelId,
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.80,
            style: 0.55,
            use_speaker_boost: true,
          },
          pronunciation_dictionary_locators: pronunciationConfig,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs ${response.status}: ${error}`);
    }

    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

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

    const pronunciationConfig = process.env.ELEVENLABS_PRONUNCIATION_DICT_ID ? [
      {
        pronunciation_dictionary_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_ID,
        version_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_VERSION,
      },
    ] : undefined;

    let arrayBuffer: ArrayBuffer;
    let modelUsed = 'eleven_multilingual_v2';

    try {
      arrayBuffer = await callElevenLabs(text, 'eleven_multilingual_v2', apiKey, voiceId, 10000, pronunciationConfig);
    } catch (primaryError: any) {
      if (primaryError.name === 'AbortError') {
        console.warn(`[TTS] Fallback: eleven_multilingual_v2 timed out (10s), retrying with turbo_v2_5`);
      } else {
        console.warn(`[TTS] Fallback: eleven_multilingual_v2 failed (${primaryError.message}), retrying with turbo_v2_5`);
      }
      modelUsed = 'eleven_turbo_v2_5 (fallback)';
      arrayBuffer = await callElevenLabs(text, 'eleven_turbo_v2_5', apiKey, voiceId, 8000, pronunciationConfig);
    }

    const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
    const estimatedDurationS = Math.round(arrayBuffer.byteLength / 16000);
    console.log(`[TTS] Model: ${modelUsed} | Audio: ${audioSizeKB}KB (~${estimatedDurationS}s), ${wordCount} words`);
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    res.json({ audioContent: base64Audio });
  } catch (error) {
    console.error('Voice synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice' });
  }
});

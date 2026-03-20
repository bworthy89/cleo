import { Router, Request, Response } from 'express';

export const segmentRouter = Router();

segmentRouter.post('/generate-segment', async (req: Request, res: Response) => {
  console.log('[Segment] Request received');
  try {
    const { systemPrompt, userPrompt, maxTokens: rawMaxTokens } = req.body;
    console.log(`[Segment] systemPrompt: ${systemPrompt?.length ?? 0} chars, userPrompt: ${userPrompt?.length ?? 0} chars, apiKey: ${process.env.GEMINI_API_KEY ? 'SET' : 'MISSING'}`);

    if (!systemPrompt || !userPrompt) {
      res.status(400).json({ error: 'systemPrompt and userPrompt are required' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
      return;
    }

    // Clamp maxTokens to prevent abuse (max 8192 per CLAUDE.md)
    const maxTokens = typeof rawMaxTokens === 'number'
      ? Math.min(Math.max(rawMaxTokens, 256), 8192)
      : 2048;

    console.log('[Segment] Calling Gemini API...');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 1.0,
            maxOutputTokens: maxTokens,
            topP: 0.95,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        }),
      }
    );

    console.log(`[Segment] Gemini responded: ${response.status}`);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Segment] Gemini error (${response.status}): ${errorBody.substring(0, 500)}`);
      res.status(502).json({ error: 'Upstream generation service error' });
      return;
    }

    const data: any = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
    const wordCount = text.trim().split(/\s+/).length;
    console.log(`[Gemini] ${wordCount} words, finishReason: ${finishReason}, text: "${text.trim().substring(0, 120)}..."`);

    res.json({ text: text.trim() });
  } catch (error) {
    console.error('Segment generation error:', error);
    res.status(500).json({ error: 'Failed to generate segment' });
  }
});

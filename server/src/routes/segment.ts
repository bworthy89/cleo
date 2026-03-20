import { Router, Request, Response } from 'express';
import { llmProvider } from '../providers/llm';

export const segmentRouter = Router();

segmentRouter.post('/generate-segment', async (req: Request, res: Response) => {
  console.log('[Segment] Request received');
  try {
    const { systemPrompt, userPrompt, maxTokens: rawMaxTokens } = req.body;
    console.log(`[Segment] systemPrompt: ${systemPrompt?.length ?? 0} chars, userPrompt: ${userPrompt?.length ?? 0} chars`);

    if (!systemPrompt || !userPrompt) {
      res.status(400).json({ error: 'systemPrompt and userPrompt are required' });
      return;
    }

    // Clamp maxTokens to prevent abuse (max 8192 per CLAUDE.md)
    const maxTokens = typeof rawMaxTokens === 'number'
      ? Math.min(Math.max(rawMaxTokens, 256), 8192)
      : 2048;

    console.log('[Segment] Generating via LLM provider...');
    const result = await llmProvider.generate({
      systemPrompt,
      userPrompt,
      maxTokens,
    });

    res.json({ text: result.text });
  } catch (error) {
    console.error('Segment generation error:', error);
    res.status(500).json({ error: 'Failed to generate segment' });
  }
});

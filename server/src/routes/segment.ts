import { Router, Request, Response } from 'express';
import { llmProvider } from '../providers/llm';
import { validate, segmentSchema } from '../middleware/validate';

export const segmentRouter = Router();

segmentRouter.post('/generate-segment', validate(segmentSchema), async (req: Request, res: Response) => {
  console.log('[Segment] Request received');
  try {
    const { systemPrompt, userPrompt, maxTokens } = req.body;
    console.log(`[Segment] systemPrompt: ${systemPrompt.length} chars, userPrompt: ${userPrompt.length} chars`);

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

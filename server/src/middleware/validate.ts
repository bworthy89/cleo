import { Request, Response, NextFunction } from 'express';
import { z } from 'zod/v4';

/**
 * Express middleware that validates req.body against a Zod schema.
 * Returns 400 with structured errors on failure.
 */
export function validate<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ── Route schemas ─────────────────────────────────────────────────────

export const segmentSchema = z.object({
  systemPrompt: z.string().min(1, 'systemPrompt is required'),
  userPrompt: z.string().min(1, 'userPrompt is required'),
  maxTokens: z.number().int().min(256).max(8192).optional().default(2048),
  thinkingBudget: z.number().int().min(0).max(8192).optional(),
});

export const voiceSchema = z.object({
  text: z.string().min(1, 'text is required').max(5000, 'text exceeds 5000 characters'),
  stability: z.number().min(0).max(1).optional().default(0.35),
  style: z.number().min(0).max(1).optional().default(0.55),
  speed: z.number().min(0.5).max(2).optional().default(1.0),
});

export const enrichTrackSchema = z.object({
  title: z.string().min(1, 'title is required'),
  artist: z.string().min(1, 'artist is required'),
});

export const enrichMusicBrainzSchema = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  duration: z.number().optional(),
});

export const curatePlaylistSchema = z.object({
  prompt: z.string().min(1).max(500),
  trackCount: z.number().int().min(10).max(50).optional().default(20),
  round: z.enum(['initial', 'gap-fill', 'refinement']),
  existingTracks: z.array(z.object({
    title: z.string(),
    artist: z.string(),
  })).optional(),
  unmatchedTracks: z.array(z.object({
    title: z.string(),
    artist: z.string(),
  })).optional(),
  userFeedback: z.string().max(500).optional(),
});

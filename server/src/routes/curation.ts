import { Router, Request, Response } from 'express';
import { llmProvider } from '../providers/llm/index.js';
import { validate, curatePlaylistSchema } from '../middleware/validate.js';

export const curationRouter = Router();

const VIBES = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
] as const;

function buildSystemPrompt(round: string): string {
  const base = `You are ONAY, an AI radio host with impeccable music taste. You curate playlists that feel like a DJ set — not a random shuffle.

IMPORTANT: Respond with ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.

Response format:
{
  "tracks": [{ "title": "Song Name", "artist": "Artist Name" }],
  "suggestedVibe": "one of: ${VIBES.join(', ')}",
  "playlistTitle": "A creative playlist title",
  "playlistDescription": "A 1-2 sentence pitch for this playlist",
  "conversationalResponse": "What you'd say to the listener about this playlist"
}`;

  if (round === 'initial') {
    return `${base}

Suggest real songs that actually exist. Prefer well-known tracks over deep cuts unless the listener asks for hidden gems. Diversify artists — no more than 2 tracks from the same artist. Match the mood, era, and energy of the request.`;
  }

  if (round === 'gap-fill') {
    return `${base}

The listener's playlist is being built but some of your earlier suggestions weren't found in the Apple Music catalog. Suggest replacements that complement the tracks already confirmed. Match the same mood, energy, and era.`;
  }

  // refinement
  return `${base}

The listener wants to modify their existing playlist. Make targeted swaps based on their feedback — don't regenerate the whole list. Keep tracks they didn't mention. Return the FULL updated track list.`;
}

function buildUserPrompt(body: {
  prompt: string;
  trackCount: number;
  round: string;
  existingTracks?: { title: string; artist: string }[];
  unmatchedTracks?: { title: string; artist: string }[];
  userFeedback?: string;
}): string {
  if (body.round === 'initial') {
    return `Create a ${body.trackCount}-track playlist for: "${body.prompt}"`;
  }

  if (body.round === 'gap-fill') {
    const confirmed = (body.existingTracks || [])
      .map(t => `  - "${t.title}" by ${t.artist}`)
      .join('\n');
    const missed = (body.unmatchedTracks || [])
      .map(t => `  - "${t.title}" by ${t.artist}`)
      .join('\n');
    return `These tracks were confirmed:\n${confirmed}\n\nThese were NOT found on Apple Music — suggest ${body.unmatchedTracks?.length || 0} replacements:\n${missed}`;
  }

  // refinement
  const current = (body.existingTracks || [])
    .map((t, i) => `  ${i + 1}. "${t.title}" by ${t.artist}`)
    .join('\n');
  return `Current playlist:\n${current}\n\nListener feedback: "${body.userFeedback}"`;
}

curationRouter.post('/curate-playlist', validate(curatePlaylistSchema), async (req: Request, res: Response) => {
  try {
    const { prompt, trackCount, round, existingTracks, unmatchedTracks, userFeedback } = req.body;

    // Sanitize inputs — strip control characters
    const sanitizedPrompt = prompt.replace(/[\x00-\x1F\x7F]/g, '');
    const sanitizedFeedback = userFeedback?.replace(/[\x00-\x1F\x7F]/g, '');

    const systemPrompt = buildSystemPrompt(round);
    const userPrompt = buildUserPrompt({
      prompt: sanitizedPrompt,
      trackCount,
      round,
      existingTracks,
      unmatchedTracks,
      userFeedback: sanitizedFeedback,
    });

    const result = await llmProvider.generate({
      systemPrompt,
      userPrompt,
      maxTokens: 4096,
      temperature: 0.9,
    });

    // Parse JSON from LLM response
    let parsed;
    try {
      // Try direct parse first
      parsed = JSON.parse(result.text);
    } catch {
      // Try extracting JSON from markdown code fences
      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try finding JSON object in the text
        const braceMatch = result.text.match(/\{[\s\S]*\}/);
        if (braceMatch) {
          parsed = JSON.parse(braceMatch[0]);
        } else {
          throw new Error('No valid JSON found in LLM response');
        }
      }
    }

    // Validate response shape
    if (!parsed.tracks || !Array.isArray(parsed.tracks)) {
      throw new Error('LLM response missing tracks array');
    }

    // Ensure suggestedVibe is valid
    if (!VIBES.includes(parsed.suggestedVibe)) {
      parsed.suggestedVibe = 'feelGood';
    }

    res.json({
      tracks: parsed.tracks.slice(0, trackCount),
      suggestedVibe: parsed.suggestedVibe,
      playlistTitle: parsed.playlistTitle || 'ONAY\'s Picks',
      playlistDescription: parsed.playlistDescription || 'Curated by ONAY',
      conversationalResponse: parsed.conversationalResponse || 'Here\'s what I put together for you.',
    });
  } catch (error: any) {
    console.error('[Curation] Error:', error.message);
    res.status(500).json({ error: 'Failed to generate playlist suggestions' });
  }
});

import { Router, Request, Response } from 'express';
import { llmProvider } from '../providers/llm/index.js';
import {
  validate, curatePlaylistSchema, curateIntentSchema,
} from '../middleware/validate.js';
import { VIBE_ARCS } from '../services/broadcast/vibe-arcs.js';

export const curationRouter = Router();

const VIBES = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
] as const;

const INTENT_TYPES = [
  'single-artist',
  'artist-circle',
  'scene',
  'mood',
  'era-genre',
  'specific-track',
  'seed-track-plus',
  'deep-cuts',
  'mixed',
] as const;

/**
 * Compact the vibe-arc reference into something short enough to fit
 * every curation prompt. Mirrors the soft-signal framing used by the
 * broadcast TrackSequencer.
 */
function buildVibeReference(): string {
  return VIBES.map(v => {
    const arc = VIBE_ARCS[v];
    return [
      `• ${v} — ${arc.descriptor}.`,
      `  arc: ${arc.arc}`,
      `  preferred: ${arc.preferred.join(', ')}`,
      `  avoid: ${arc.avoid.join(', ')}`,
    ].join('\n');
  }).join('\n');
}

const VIBE_REFERENCE = buildVibeReference();

function buildSystemPrompt(round: string): string {
  const base = `You are ONAY, an AI radio host with impeccable music taste. You curate playlists that feel like a DJ set — a sequenced broadcast, not a random shuffle.

IMPORTANT: Respond with ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.

Response format:
{
  "tracks": [{ "title": "Song Name", "artist": "Artist Name" }],
  "suggestedVibe": "one of: ${VIBES.join(', ')}",
  "playlistTitle": "A creative playlist title",
  "playlistDescription": "A 1-2 sentence pitch for this playlist",
  "conversationalResponse": "What you'd say to the listener about this playlist"
}

Vibe reference — pick the one that best fits the request, then use its arc + preferred/avoid as soft signals (not hard rules):
${VIBE_REFERENCE}

Curation rules:
- Suggest real songs that actually exist on Apple Music. When unsure, pick the artist's best-known tracks over deep cuts.
- If the listener names a specific artist (e.g. "Brent Faiyaz inspired", "like Frank Ocean"), include 3–5 tracks by that artist and fill the rest with stylistically adjacent artists who share the same scene/producers/era. Do NOT scatter into unrelated genres to hit a track count.
- Ordering matters: open in the arc's opener register, build through the body, land the peak, come down on the close. Think sequenced set, not random.
- Adjacency: avoid placing two tracks by the same artist back-to-back. Spread them across the set.
- Match mood + era + texture. "Feel-good" doesn't mean any upbeat song — it means the feel-good arc's tradition.`;

  if (round === 'initial') {
    return base;
  }

  if (round === 'gap-fill') {
    return `${base}

Gap-fill round: some earlier suggestions weren't found on Apple Music. Replace them with tracks that share the confirmed tracks' artists, scene, era, and vibe. Stay inside the same arc.`;
  }

  // refinement
  return `${base}

Refinement round: the listener wants targeted changes. Keep tracks they didn't mention. Swap only what their feedback asks for. Return the FULL updated track list in arc-appropriate order.`;
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

// ─────────────────────── Intent classifier ───────────────────────────
//
// Called first by the Ask ONAY flow. Returns a structured intent so the
// client can pick the right curation strategy. "best of X" is answered
// by catalog lookup on the artist, not by asking the LLM to name tracks.
// "mood" / "scene" / "era-genre" still use LLM generation but with
// tighter framing. See docs on the curation redesign for the taxonomy.

const INTENT_SYSTEM_PROMPT = `You are ONAY, an AI radio host classifying a listener's playlist request. Read the request, decide the intent, pull out structured parameters, and write an opinionated stance that will drive the curation pipeline.

Return ONLY valid JSON. No markdown, no code fences, no prose outside the JSON.

Response shape:
{
  "intent": "one of: ${INTENT_TYPES.join(', ')}",
  "artists": ["Artist Name", ...],
  "seedTracks": [{ "title": "Song", "artist": "Artist" }, ...],
  "vibe": "one of: ${VIBES.join(', ')} or null",
  "era": "e.g. 1990s, early 2000s, 2010s — or null",
  "genre": "e.g. hip hop, alt-R&B, indie folk — or null",
  "stance": "2-3 sentences in your voice, explaining your curation choice and the arc. Literary, warm, specific.",
  "playlistTitle": "A stylized playlist title",
  "conversationalResponse": "What you'd say opening the chat — warm, 1-2 sentences",
  "options": ["wider — ...", "tighter — ...", "different vibe — ..."]
}

Intent taxonomy:
- single-artist: "best of X", "all of X", "X songs", "give me X" — listener wants one artist's catalog. artists = [the one artist].
- artist-circle: "X and their collaborators", "the Sonder crew" — artist plus their close network. artists = named artist(s).
- scene: "X inspired", "like X", "X vibes", "if you liked X" — aesthetic continuation. artists = seed artist(s).
- mood: "Sunday morning", "late-night chill", "focus music" — mood-driven, no artist. vibe is set.
- era-genre: "90s hip hop", "2000s indie rock" — era or genre or both. era and/or genre set.
- specific-track: "play 'Rolling Stone' by X", "that one Lucky Daye song about..." — listener named or described a specific track. seedTracks populated.
- seed-track-plus: "songs like 'Rolling Stone' by X", "more like that Frank Ocean song" — seed track plus similars. seedTracks populated.
- deep-cuts: "hidden gems of X", "X's b-sides", "underrated Y" — curatorial deep picks. artists = named artist(s).
- mixed: combines above or doesn't fit cleanly.

Rules:
- "best of X" is single-artist, never scene. Scene is only for explicit "like X" / "inspired" language.
- vibe is only set for mood intent. Scene requests don't set vibe — the curation pipeline will infer the scene's vibe separately.
- stance is real taste: "Opens on 'Trust' — his breakout — so the listener remembers why they fell for him, then the 2018-2020 run is the body, closes on 'Rolling Stone' because that's the emotional peak." Not "here's a playlist."
- options: always 3, actionable, in ONAY's voice.
- playlist titles editorial, not generic. "Brent Faiyaz — the essentials, late-night cut", not "Brent Faiyaz Hits".`;

function sanitize(s: string): string {
  return s.replace(/[\x00-\x1F\x7F]/g, '');
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
}

curationRouter.post('/curate-intent', validate(curateIntentSchema), async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body as { prompt: string };

    const result = await llmProvider.generate({
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userPrompt: `Listener request: "${sanitize(prompt)}"`,
      maxTokens: 2048,
      temperature: 0.4,
      preferredProvider: 'fallback',
    });

    const parsed = tryParseJson(result.text);
    if (!parsed || typeof parsed.intent !== 'string') {
      throw new Error('intent classifier returned malformed JSON');
    }

    // Coerce fields to safe defaults; narrow intent to taxonomy.
    const intent = (INTENT_TYPES as readonly string[]).includes(parsed.intent as string)
      ? parsed.intent as string
      : 'mixed';
    const vibe = typeof parsed.vibe === 'string' && (VIBES as readonly string[]).includes(parsed.vibe)
      ? parsed.vibe
      : null;

    res.json({
      intent,
      artists: Array.isArray(parsed.artists) ? parsed.artists.filter((a: unknown) => typeof a === 'string').slice(0, 12) : [],
      seedTracks: Array.isArray(parsed.seedTracks) ? parsed.seedTracks.slice(0, 5) : [],
      vibe,
      era: typeof parsed.era === 'string' ? parsed.era : null,
      genre: typeof parsed.genre === 'string' ? parsed.genre : null,
      stance: typeof parsed.stance === 'string' ? parsed.stance : '',
      playlistTitle: typeof parsed.playlistTitle === 'string' ? parsed.playlistTitle : 'ONAY\u2019s Picks',
      conversationalResponse: typeof parsed.conversationalResponse === 'string'
        ? parsed.conversationalResponse
        : 'Here\u2019s what I put together.',
      options: Array.isArray(parsed.options)
        ? parsed.options.filter((o: unknown) => typeof o === 'string').slice(0, 3)
        : [],
    });
  } catch (err: any) {
    console.error('[Curation:intent] Error:', err?.message);
    res.status(500).json({ error: 'Failed to classify intent' });
  }
});

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
      // 0.6 matches the broadcast TrackSequencer — curation is a precision
      // task, not a creativity task. High temperatures drift the LLM into
      // unrelated artists to hit track-count quotas.
      temperature: 0.6,
      // Route through Gemini (fallback slot) — its training corpus has
      // deeper recall for contemporary / alt-R&B artists than the
      // self-hosted 8B primary. Factory reverses on error.
      preferredProvider: 'fallback',
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

import { CLEO_STATIC_CORE } from '../cleo/static-core';
import { getFallbackLine, type SegmentType, type Vibe } from '../cleo/fallbacks';
import { API_BASE_URL } from './api';
import type { EnrichedFacts } from './TrackEnrichmentService';

export interface SegmentContext {
  segmentType: SegmentType;
  vibe: Vibe;
  currentTrack: {
    title: string;
    artistName: string;
    albumTitle?: string;
    genre?: string;
  };
  nextTrack?: {
    title: string;
    artistName: string;
    genre?: string;
  };
  sessionDurationMinutes?: number;
  segmentHistory?: string[];
  listenerName?: string;
  enrichedFacts?: EnrichedFacts;
}

const TIMEOUT_MS = 10000;

function buildDynamicPrompt(context: SegmentContext): string {
  const timeOfDay = getTimeOfDay();
  const vibeLabel: Record<Vibe, string> = {
    morning: 'Morning Drive',
    chill: 'Chill',
    workout: 'Workout',
    lateNight: 'Late Night',
    party: 'Party',
  };

  let prompt = `CURRENT SESSION CONTEXT
- Session vibe: ${vibeLabel[context.vibe]}
- Time of day: ${timeOfDay}
- Session duration: ${context.sessionDurationMinutes ?? 0} minutes in`;

  if (context.listenerName) {
    prompt += `\n- Listener name: ${context.listenerName}`;
  }

  prompt += `\n\nCURRENT TRACK
- Title: ${context.currentTrack.title}
- Artist: ${context.currentTrack.artistName}`;

  if (context.currentTrack.albumTitle) {
    prompt += `\n- Album: ${context.currentTrack.albumTitle}`;
  }
  if (context.currentTrack.genre) {
    prompt += `  |  Genre: ${context.currentTrack.genre}`;
  }

  if (context.nextTrack) {
    prompt += `\n\nNEXT TRACK
- Title: ${context.nextTrack.title}  |  Artist: ${context.nextTrack.artistName}`;
    if (context.nextTrack.genre) {
      prompt += `  |  Genre: ${context.nextTrack.genre}`;
    }
  }

  if (context.enrichedFacts) {
    const facts = context.enrichedFacts;
    prompt += '\n\nVERIFIED TRACK FACTS (use only what is provided — never invent)';
    if (facts.sample) prompt += `\n- Sample: ${facts.sample}`;
    if (facts.context) prompt += `\n- Context: ${facts.context}`;
    if (facts.producer) prompt += `\n- Producer: ${facts.producer}`;
    if (facts.songwriter) prompt += `\n- Written by: ${facts.songwriter}`;
  }

  if (context.segmentHistory && context.segmentHistory.length > 0) {
    prompt += '\n\nSEGMENT HISTORY (last 3 — do not repeat these structures)';
    context.segmentHistory.slice(0, 3).forEach((seg, i) => {
      prompt += `\n${i + 1}. ${seg}`;
    });
  }

  prompt += `\n\nSEGMENT TYPE: ${context.segmentType}

OUTPUT RULES
- 40 to 75 words maximum.
- Plain text only. No quotes, no stage directions, no labels.
- Do not include the segment type name in your response.`;

  return prompt;
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Late Night';
}

export async function generateSegment(context: SegmentContext): Promise<string> {
  const userPrompt = buildDynamicPrompt(context);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    console.log('[CleoScript] Calling Gemini for segment:', context.segmentType);
    const response = await fetch(`${API_BASE_URL}/generate-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: CLEO_STATIC_CORE,
        userPrompt,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[CleoScript] Gemini response:', data.text?.substring(0, 80));
    if (data.text && data.text.length > 0) {
      return data.text;
    }

    throw new Error('Empty response');
  } catch (error: any) {
    console.warn('Segment generation failed, using fallback. Error:', error?.message ?? error);
    return getFallbackLine(context.segmentType, context.vibe);
  }
}

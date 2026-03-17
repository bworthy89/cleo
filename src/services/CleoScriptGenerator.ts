import { CLEO_STATIC_CORE } from '../cleo/static-core';
import { getFallbackLine, type SegmentType, type Vibe } from '../cleo/fallbacks';
import { API_BASE_URL } from './api';
import type { EnrichedFacts } from './TrackEnrichmentService';

export type DeliveryMode = 'pre_song' | 'post_song';
export type SessionPhase = 'opening' | 'mid' | 'late';

export interface SegmentContext {
  segmentType: SegmentType;
  vibe: Vibe;
  deliveryMode: DeliveryMode;
  sessionPhase: SessionPhase;
  currentTrack: {
    title: string;
    artistName: string;
    albumTitle?: string;
    genre?: string;
  };
  previousTrack?: {
    title: string;
    artistName: string;
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
  tracksReferenced?: string[];
}

const TIMEOUT_MS = 10000;

const SEGMENT_BRIEFS: Record<SegmentType, string> = {
  song_intro: 'Tease or bridge. Create anticipation without over-explaining.',
  track_story: 'Drop one specific detail that makes the listener lean in.',
  artist_context: "One true thing about this artist that most people haven't considered.",
  station_id: 'Brief, warm, present. Cleo is here. Nothing more needed.',
  genre_bridge: 'Narrate the musical shift like a journey, not a playlist change.',
  post_track_reflection: 'One honest reaction to what the listener is currently hearing. No recap.',
  listener_shoutout: 'Specific, not generic. Make someone feel seen.',
  session_checkin: 'Acknowledge the time spent together. Where are we in this journey?',
  sign_off: 'Warm send-off. Brief. Leave them wanting to come back.',
};

function buildDynamicPrompt(context: SegmentContext): string {
  const timeOfDay = getTimeOfDay();
  const vibeLabel: Record<Vibe, string> = {
    morning: 'Morning Drive',
    chill: 'Chill',
    workout: 'Workout',
    lateNight: 'Late Night',
    party: 'Party',
    general: 'General',
    focus: 'Focus',
    feelGood: 'Feel Good',
    throwback: 'Throwback',
    elevated: 'Elevated',
    melancholy: 'Melancholy',
    sunday: 'Sunday',
  };

  let prompt = `CURRENT SESSION CONTEXT
- Session vibe: ${vibeLabel[context.vibe]}
- Time of day: ${timeOfDay}
- Session phase: ${context.sessionPhase}
- Session duration: ${context.sessionDurationMinutes ?? 0} minutes in`;

  if (context.listenerName) {
    prompt += `\n- Listener name: ${context.listenerName}`;
  }

  // Delivery mode framing
  if (context.deliveryMode === 'pre_song') {
    if (context.previousTrack) {
      prompt += `\n\nDELIVERY MODE: pre_song
The listener just finished hearing "${context.previousTrack.title}" by ${context.previousTrack.artistName}. The next track is about to start. You may reflect on what was just heard and/or bridge to what's coming.`;
    } else {
      prompt += `\n\nDELIVERY MODE: pre_song
You are speaking between tracks. The next track is about to play. Set it up naturally.`;
    }
  } else {
    prompt += `\n\nDELIVERY MODE: post_song
The listener is currently hearing "${context.currentTrack.title}" by ${context.currentTrack.artistName} right now. Comment naturally, as if dropping in mid-listen. No need to hand off to the next song.`;
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

  if (context.tracksReferenced && context.tracksReferenced.length > 0) {
    prompt += `\n\nARTISTS HEARD THIS SESSION (available for organic callbacks):\n${context.tracksReferenced.join(', ')}`;
  }

  if (context.segmentHistory && context.segmentHistory.length > 0) {
    prompt += '\n\nSEGMENT HISTORY (last 3 — do not repeat these structures)';
    context.segmentHistory.slice(0, 3).forEach((seg, i) => {
      prompt += `\n${i + 1}. ${seg}`;
    });
  }

  const brief = SEGMENT_BRIEFS[context.segmentType];
  prompt += `\n\nSEGMENT TYPE: ${context.segmentType}
CREATIVE BRIEF: ${brief}

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

    console.log('[CleoScript] Calling Gemini for segment:', context.segmentType, `(${context.deliveryMode})`);
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

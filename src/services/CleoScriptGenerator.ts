import { CLEO_STATIC_CORE } from '../cleo/static-core';
import { getFallbackLine, type SegmentType, type Vibe } from '../cleo/fallbacks';
import { authenticatedFetch } from './api';
import type { EnrichedFacts } from './TrackEnrichmentService';
import { getTimeOfDay } from '../utils/time';

export type DeliveryMode = 'pre_song' | 'post_song' | 'eject_transition';
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
  maxWords?: number;
  previousSession?: {
    stationName: string;
    vibe: string;
    lastTrack: string;
    lastArtist: string;
    timeSince: string;
    artists: string[];
    sessionNumber: number;
    returningToSameStation: boolean;
    switchedStation: boolean;
  };
}

const TIMEOUT_MS = 10000;

const SEGMENT_BRIEFS: Record<SegmentType, string> = {
  song_intro: 'Tease or bridge. Create anticipation without over-explaining.',
  track_story: 'Drop one specific detail that makes the listener lean in.',
  artist_context: "One true thing about this artist that most people haven't considered.",
  station_id: 'Brief, warm, present. ONAY is here. Nothing more needed.',
  genre_bridge: 'Narrate the musical shift like a journey, not a playlist change.',
  post_track_reflection: 'One honest reaction to what the listener is currently hearing. No recap.',
  listener_shoutout: 'Specific, not generic. Make someone feel seen.',
  session_checkin: 'Acknowledge the time spent together. Where are we in this journey?',
  sign_off: 'Warm send-off. Brief. Leave them wanting to come back.',
};

/** Sanitize external-origin strings before injecting into Gemini prompt */
function sanitize(value: string, maxLen = 200): string {
  return value.replace(/[\n\r]/g, ' ').substring(0, maxLen).trim();
}

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
    prompt += `\n- Listener name: ${sanitize(context.listenerName, 50)}`;
  }

  // Delivery mode framing
  if (context.deliveryMode === 'pre_song') {
    if (context.previousTrack) {
      prompt += `\n\nDELIVERY MODE: pre_song
The listener was just hearing "${context.previousTrack.title}" by ${context.previousTrack.artistName}. "${context.currentTrack.title}" by ${context.currentTrack.artistName} just started playing. Bridge from what was heard to what's now playing — do NOT say the song is "coming up" or "next," it is already on.`;
    } else {
      prompt += `\n\nDELIVERY MODE: pre_song
"${context.currentTrack.title}" by ${context.currentTrack.artistName} just started playing. Introduce what the listener is now hearing — do NOT say the song is "coming up" or "next," it is already on.`;
    }
  } else if (context.deliveryMode === 'eject_transition') {
    prompt += `\n\nDELIVERY MODE: eject_transition
You are speaking OVER the fade-out of "${context.currentTrack.title}" by ${context.currentTrack.artistName}. The listener can still hear it underneath you, fading out.`;
    if (context.nextTrack) {
      prompt += ` Bridge into "${context.nextTrack.title}" by ${context.nextTrack.artistName} — it is about to begin.`;
    } else {
      prompt += ` Wrap this moment smoothly — another track is coming.`;
    }
    prompt += `
Do NOT say "that was" — the song is still audible. Do NOT say "coming up next" — speak as if the transition is already happening. Be confident, smooth, like a DJ talking over the outro.`;
  } else {
    prompt += `\n\nDELIVERY MODE: post_song
The listener is currently hearing "${context.currentTrack.title}" by ${context.currentTrack.artistName} right now. Comment naturally, as if dropping in mid-listen. Do not hand off to the next song.`;
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
    console.log(`[CleoScript] enrichedFacts for "${context.currentTrack.title}":`, JSON.stringify(facts).substring(0, 200));
    const hasAnyFact = facts.sample || facts.context || facts.producer ||
      facts.songwriter || facts.recordingLocation || facts.tags?.length || facts.year;
    if (hasAnyFact) {
      console.log(`[CleoScript] VERIFIED TRACK FACTS will be injected into prompt`);
      prompt += '\n\nVERIFIED TRACK FACTS (use only what is provided — never invent)';
      if (facts.producer) prompt += `\n- Producer: ${sanitize(facts.producer)}`;
      if (facts.songwriter) prompt += `\n- Written by: ${sanitize(facts.songwriter)}`;
      if (facts.sample) prompt += `\n- Sample: ${sanitize(facts.sample)}`;
      if (facts.context) prompt += `\n- Context: ${sanitize(facts.context, 300)}`;
      if (facts.recordingLocation) prompt += `\n- Recorded at: ${sanitize(facts.recordingLocation)}`;
      if (facts.tags && facts.tags.length > 0) prompt += `\n- Genre tags: ${facts.tags.join(', ')}`;
      if (facts.year) prompt += `\n- First released: ${facts.year}`;
      if (facts.releaseYear && !facts.year) prompt += `\n- Release date: ${facts.releaseYear}`;
    }
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

  if (context.previousSession) {
    const ps = context.previousSession;
    prompt += `\n\nPREVIOUS SESSION`;
    prompt += `\n- Last station: ${ps.stationName}`;
    prompt += `\n- Last vibe: ${ps.vibe}`;
    prompt += `\n- Last track: "${ps.lastTrack}" by ${ps.lastArtist}`;
    prompt += `\n- Time since: ${ps.timeSince}`;
    if (ps.artists.length > 0) {
      prompt += `\n- Artists from last session: ${ps.artists.join(', ')}`;
    }
    prompt += `\n- Session number: ${ps.sessionNumber}`;
    if (ps.returningToSameStation) {
      prompt += `\n- Returning to same station: yes`;
    }
    if (ps.switchedStation) {
      prompt += `\n- Switched to a different station: yes`;
    }
  }

  const brief = SEGMENT_BRIEFS[context.segmentType];
  const maxWords = context.maxWords ?? 75;
  let wordCountInstruction: string;
  if (maxWords <= 30) {
    wordCountInstruction = `15 to ${maxWords} words. One thought. In and out.`;
  } else if (maxWords >= 100) {
    wordCountInstruction = `90 to ${maxWords} words. Tell the story. Take your time — you have room to breathe.`;
  } else {
    wordCountInstruction = `40 to ${maxWords} words. Natural and flowing.`;
  }

  prompt += `\n\nSEGMENT TYPE: ${context.segmentType}
CREATIVE BRIEF: ${brief}

OUTPUT RULES
- ${wordCountInstruction}
- Plain text only. No quotes, no stage directions, no labels.
- Do not include the segment type name in your response.
- Begin with a delivery cue tag: [warm], [hype], [quiet], [playful], [reflective], or [matter-of-fact]. Choose the one that fits the moment.
- Capitalize ONE key word per segment for vocal emphasis.`;

  return prompt;
}

export async function generateSegment(context: SegmentContext): Promise<string> {
  const userPrompt = buildDynamicPrompt(context);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    console.log('[CleoScript] Calling Gemini for segment:', context.segmentType, `(${context.deliveryMode})`);
    const response = await authenticatedFetch('/generate-segment', {
      method: 'POST',
      body: JSON.stringify({
        systemPrompt: CLEO_STATIC_CORE,
        userPrompt,
      }),
      signal: controller.signal,
    });

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
  } finally {
    clearTimeout(timeout);
  }
}

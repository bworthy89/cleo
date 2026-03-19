# Cleo Polish — Moment-to-Moment DJ Experience Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cleo's voice, scripts, and DJ handoffs feel like a real radio host — natural delivery, correct temporal context, storytelling across sessions, and variety in how/when she speaks.

**Architecture:** Eight files modified in dependency order — types first, then services, then engines, then UI. AudioCoordinator gains a `previousTrack` buffer and dual pre/post timing paths. SegmentController exports `DeliveryMode`, gains session phase + callback tracking. CleoScriptGenerator gets richer prompt context. Cold opens and fallbacks expanded for 7 new vibes.

**Tech Stack:** TypeScript, React Native 0.83, Expo SDK 55, ElevenLabs TTS API, Gemini 2.5 Flash, Node.js/Express backend proxy.

---

## File Map

| File | What Changes |
|---|---|
| `cleo/src/cleo/fallbacks.ts` | Add `genre_bridge` + `post_track_reflection` to `SegmentType`; add 7 new vibes to `Vibe`; expand fallback library |
| `cleo/src/cleo/static-core.ts` | Rewrite WHAT YOU ALWAYS DO; add STORYTELLING + SESSION AWARENESS sections |
| `cleo/src/cleo/cold-opens.ts` | 7 new vibe pools (6 lines each); existing pools → 6 lines; `sameDayReturn` → 6 lines |
| `cleo/src/services/CleoScriptGenerator.ts` | Extend `SegmentContext`; update `vibeLabel`; add phase/mode/callbacks/briefs to prompt |
| `cleo/src/services/CleoVoiceEngine.ts` | Add `formatForSpeech()` pass before ElevenLabs |
| `cleo/src/engines/SegmentController.ts` | Export `DeliveryMode`; `BufferedSegment` with mode; `getDeliveryMode()`; session phase; `tracksReferenced`; updated rotation |
| `cleo/src/engines/AudioCoordinator.ts` | `previousTrack` buffer; `pendingPostSongTimer`; pre/post timing paths; timer cancel on re-entry |
| `cleo/server/src/routes/voice.ts` | ElevenLabs voice settings (stability, similarity_boost, style) |

**Verify TypeScript compiles** after each task: `cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit`

---

## Task 1: Update Type Unions in fallbacks.ts

**Files:**
- Modify: `cleo/src/cleo/fallbacks.ts`

Add the two new `SegmentType` values and seven new `Vibe` values to their unions. Add at least one fallback entry per new type so the rotation can safely reference them. Expand all existing fallback lines with higher-quality, speech-optimized writing.

- [ ] **Step 1: Update `SegmentType` union**

Replace lines 1–8 in `fallbacks.ts`:

```typescript
export type SegmentType =
  | 'song_intro'
  | 'track_story'
  | 'artist_context'
  | 'station_id'
  | 'listener_shoutout'
  | 'session_checkin'
  | 'genre_bridge'
  | 'post_track_reflection'
  | 'sign_off';
```

- [ ] **Step 2: Update `Vibe` union**

Replace line 10 in `fallbacks.ts`:

```typescript
export type Vibe =
  | 'morning' | 'chill' | 'workout' | 'lateNight' | 'party'
  | 'general' | 'focus' | 'feelGood' | 'throwback' | 'elevated' | 'melancholy' | 'sunday';
```

- [ ] **Step 3: Rewrite and expand the fallback library**

Replace the entire `fallbacks` array with the expanded version below. Every line passes this test: would a person actually say this out loud?

```typescript
const fallbacks: FallbackEntry[] = [
  // ── song_intro ───────────────────────────────────────────────────────
  {
    type: 'song_intro',
    vibe: 'chill',
    lines: [
      'This next one. Just trust it.',
      'Pay attention to how this one opens.',
      "I don't need to say much here. Just listen.",
      "This track has been in rotation for a reason — you'll hear it.",
      'One of my favorites in your library. Coming up now.',
      'Something about this one hits different every time.',
    ],
  },
  {
    type: 'song_intro',
    vibe: 'morning',
    lines: [
      "This one's going to carry you through. Promise.",
      'Right on time — this track was made for exactly this moment.',
      'Keep moving. This one keeps pace with you.',
      "Morning energy — this next one has it.",
      "You need this one right now. Trust me.",
      "Here we go. This one sets the whole tone.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'workout',
    lines: [
      "Lock in. This next one doesn't let up.",
      "Here it comes. Don't stop.",
      "This one hits different when you're moving.",
      "Stay with it — this track is built for this.",
      "No slowing down. Here we go.",
      "This one's going to push you. Let it.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'lateNight',
    lines: [
      'This next one knows what time it is.',
      'Sit with this one. No rush.',
      'Some tracks belong to the night. This is one of them.',
      "Late and quiet — this one fits.",
      "Here's something for exactly this hour.",
      "This one was made for moments like this.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'party',
    lines: [
      "Don't slow down — this next one won't let you.",
      'Keep that energy. Here we go.',
      "This one's going to take it up a notch.",
      "No stopping now. This next track has a different gear.",
      "You ready? Because this one doesn't ease in.",
      "Here it comes.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'general',
    lines: [
      'Next up.',
      "Here's what's coming.",
      'This one.',
      "Something worth your attention.",
      "Let this one land.",
      "Up next — give it a moment.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'focus',
    lines: [
      'Next track.',
      "Here's what's next.",
      'Coming up.',
      'This one keeps the momentum.',
      "Next one — no interruptions.",
      "Staying in it. Here we go.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'feelGood',
    lines: [
      "This next one — you're going to love it.",
      "Good things keep coming. Here's proof.",
      "Here's another one that just works.",
      "The playlist keeps delivering. This is next.",
      "Can't go wrong with this one.",
      "This one's a mood. In the best way.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'throwback',
    lines: [
      "This one takes you somewhere. Just wait.",
      "Here's one that hasn't aged a day.",
      "A reminder of exactly why this era was special.",
      "This track still holds up — completely.",
      "You know this one. Let it hit again.",
      "Some songs don't need an introduction. This is one of them.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'elevated',
    lines: [
      "This next one rewards your attention.",
      "Something with a little more weight. Here we go.",
      "Let this one settle in.",
      "This track has depth. Give it room.",
      "Here's something worth sitting with.",
      "Pay attention to the texture on this one.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'melancholy',
    lines: [
      "This one is honest. Let it be.",
      "Here's something that understands.",
      "Some music meets you where you are. This does.",
      "This next one doesn't pretend.",
      "Let this one in.",
      "Here's something quiet and true.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'sunday',
    lines: [
      "No hurry. This one.",
      "Here's something slow and good.",
      "The playlist knows what Sunday needs.",
      "This one's unhurried. Like today.",
      "Easy now. Here's the next one.",
      "Let this one breathe.",
    ],
  },

  // ── track_story ──────────────────────────────────────────────────────
  {
    type: 'track_story',
    lines: [
      "There's a story behind this one most people don't know. Listen closer.",
      "The way this came together — there's more to it than you'd think.",
      "This one has layers. The production alone is worth paying attention to.",
      "Someone put their whole heart into making this. You can hear it.",
      "The story behind this recording is one of my favorites.",
      "This track didn't happen by accident. Every detail was placed.",
    ],
  },

  // ── artist_context ───────────────────────────────────────────────────
  {
    type: 'artist_context',
    lines: [
      'This artist has been on a journey. You can hear it in this.',
      "There's a reason they keep coming back to your rotation.",
      'Listen to enough of their catalog and you start to hear the evolution.',
      'Not everyone can make music that sticks with you like this.',
      'Every detail here is intentional. That's what separates this artist.',
      "This is someone who figured something out — and it shows.",
    ],
  },

  // ── station_id ───────────────────────────────────────────────────────
  {
    type: 'station_id',
    lines: [
      "You're with Cleo. This one's for you.",
      'Still here. Still playing the good stuff.',
      'Cleo — keeping you company.',
      "Your music. My voice. Let's keep going.",
      "This is what we do.",
      'Still with you.',
    ],
  },

  // ── listener_shoutout ────────────────────────────────────────────────
  {
    type: 'listener_shoutout',
    lines: [
      "For everyone who found their way here — good call.",
      "Shoutout to the headphone listeners — this one especially.",
      "Night shift, late studiers, insomniacs — this next one is yours.",
      "Someone said this playlist got them through a tough week. I believe it.",
      "You showed up. That's not nothing.",
      "For whoever needs this right now — here it is.",
    ],
  },

  // ── session_checkin ──────────────────────────────────────────────────
  {
    type: 'session_checkin',
    vibe: 'chill',
    lines: [
      "Still with me? Good. We've got more.",
      "We're deep into this now. The playlist has earned your attention.",
      "You've been here a while. So have I. Neither of us is leaving.",
      'This is what a good session feels like.',
      "Deep in it now. Stay.",
    ],
  },
  {
    type: 'session_checkin',
    vibe: 'morning',
    lines: [
      "Still moving? Good. We've got more.",
      "Deep into the morning now. Keep going.",
      "You're doing the thing. I'm keeping pace.",
      "How far are we into this commute? Doesn't matter — there's more.",
      "Still here with you. Morning's earning it.",
    ],
  },
  {
    type: 'session_checkin',
    vibe: 'workout',
    lines: [
      "Still going? So am I.",
      "Deep in the session now. Don't stop.",
      "You haven't quit. That's the whole point.",
      "We're in the hard part. Keep moving.",
      "This is where it counts. Stay with it.",
    ],
  },
  {
    type: 'session_checkin',
    vibe: 'lateNight',
    lines: [
      "Still up. Still here.",
      "We've been at this a while. Neither of us is going anywhere.",
      "Late and deep into it. That's a specific kind of good.",
      "The city's quieter than it was. The music isn't.",
      "We're in it now. Stay.",
    ],
  },
  {
    type: 'session_checkin',
    vibe: 'party',
    lines: [
      "Still going? Good. So is this.",
      "We're deep in it now — no slowing down.",
      "This energy hasn't dropped. Keep up.",
      "The night's not over. Not even close.",
      "Still here. Still locked in.",
    ],
  },
  {
    type: 'session_checkin',
    lines: [
      "We've been here a while. Still good.",
      "Session's running long — in the best way.",
      "Still here. Still playing what matters.",
      "The playlist keeps earning it. So do you for staying.",
      "Good session. And we're not done.",
    ],
  },

  // ── genre_bridge ─────────────────────────────────────────────────────
  {
    type: 'genre_bridge',
    lines: [
      "We've been in one lane — this next one takes a turn.",
      "The playlist's about to shift. Stay with it.",
      "Different energy coming up. Trust the transition.",
      "This next one pulls the thread somewhere unexpected.",
      "We move now. Different feel, same intention.",
      "One world to another. Here's the bridge.",
    ],
  },

  // ── post_track_reflection ────────────────────────────────────────────
  {
    type: 'post_track_reflection',
    lines: [
      "That one earns the silence after it.",
      "Some tracks you just sit with for a second.",
      "Every time. Every single time.",
      "That's why it's in your library.",
      "Hard to follow that one. But we will.",
      "That track knows exactly what it's doing.",
    ],
  },

  // ── sign_off ─────────────────────────────────────────────────────────
  {
    type: 'sign_off',
    lines: [
      "That's a wrap. Good session — you picked well. I'll be here when you're ready.",
      "And that's the end of this one. Go do something good with that energy.",
      'We made it through. Same time tomorrow?',
      'Good music, good company. Until next time — take care of yourself.',
      "That's all I've got for now. You know where to find me.",
    ],
  },
];
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors from files not yet updated).

- [ ] **Step 5: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/cleo/fallbacks.ts && git commit -m "feat(cleo): expand SegmentType/Vibe unions and rewrite fallback library"
```

---

## Task 2: ElevenLabs Voice Settings

**Files:**
- Modify: `cleo/server/src/routes/voice.ts`

Lower stability for natural variation, increase similarity to preserve voice character, lower style to remove over-enunciation.

- [ ] **Step 1: Update voice settings**

In `server/src/routes/voice.ts`, replace the `voice_settings` object (around line 33):

```typescript
voice_settings: {
  stability: 0.30,
  similarity_boost: 0.85,
  style: 0.20,
  use_speaker_boost: true,
},
```

- [ ] **Step 2: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add server/src/routes/voice.ts && git commit -m "feat(voice): tune ElevenLabs settings for more natural delivery"
```

---

## Task 3: Speech Formatting Layer

**Files:**
- Modify: `cleo/src/services/CleoVoiceEngine.ts`

Add a `formatForSpeech()` post-process function that runs on Gemini output before sending to ElevenLabs. This inserts natural pause cues using em-dashes and ellipses, and strips any accidental formatting artifacts.

- [ ] **Step 1: Add `formatForSpeech()` and wire it in**

Replace the full contents of `src/services/CleoVoiceEngine.ts`:

```typescript
import { playAudioFromBase64 } from '../../modules/expo-music-kit';
import { API_BASE_URL } from './api';

/**
 * Post-process Gemini output for natural ElevenLabs delivery.
 * Em-dashes signal a beat/pause. Ellipses trail off naturally.
 * Strips quotation marks and stage directions.
 */
function formatForSpeech(text: string): string {
  return text
    // Remove any stray quotation marks
    .replace(/["""]/g, '')
    // Remove stage directions like (pause) or [beat]
    .replace(/[\(\[][^\)\]]{1,20}[\)\]]/g, '')
    // Comma before "and/but/so" at clause boundary → em-dash for stronger pause
    .replace(/, (and|but|so) /g, ' — $1 ')
    // Clean up any double spaces
    .replace(/  +/g, ' ')
    .trim();
}

export async function synthesizeAndPlay(text: string): Promise<void> {
  try {
    const formatted = formatForSpeech(text);

    const response = await fetch(`${API_BASE_URL}/synthesize-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatted }),
    });

    if (!response.ok) {
      throw new Error(`TTS error: ${response.status}`);
    }

    const data = await response.json();
    const base64Audio = data.audioContent;

    if (!base64Audio) {
      throw new Error('No audio content returned');
    }

    await playAudioFromBase64(base64Audio);
  } catch (error) {
    console.error('Voice playback failed:', error);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/services/CleoVoiceEngine.ts && git commit -m "feat(voice): add formatForSpeech() post-process for natural ElevenLabs delivery"
```

---

## Task 4: Static-Core Prompt Rewrite

**Files:**
- Modify: `cleo/src/cleo/static-core.ts`

Fix the "end with handoff" instruction (it conflicts with post_song mode). Add STORYTELLING and SESSION AWARENESS sections.

- [ ] **Step 1: Rewrite static-core**

Replace the full contents of `src/cleo/static-core.ts`:

```typescript
export const CLEO_STATIC_CORE = `You are Cleo, a radio host for a personal AI radio app.

IDENTITY
Your name is Cleo. You are warm, magnetic, and a natural storyteller.
You are rooted in hip-hop and R&B culture but feel completely at home
across all genres. You speak like a trusted friend who always knows
the deeper story behind the music — delivered as conversation, never a lecture.

VOICE RULES
- Speak in short, natural sentences. No run-ons.
- Never sound like you are reading. Sound like you just thought of it.
- Use occasional dry humor — never forced, never corny.
- Let words breathe. Unhurried pace.
- Warm but not soft. Confident but never arrogant.
- Never use filler phrases like "Absolutely!" or "Great choice!"
- Never start two consecutive segments with the same word or structure.

STORYTELLING
- Each segment is one sentence in a longer story. Write toward something.
- Write for the ear, not the eye. Short clauses. Natural breath points.
- Never end a segment on a weak word (a, the, it, and).
- Emotional specificity over generic praise. Never say "great track" or "amazing artist."
  Say something specific or say nothing.
- If session memory contains prior artists, weave them in naturally when it serves the moment.

SESSION AWARENESS
- Opening segments (1-3): warm and inviting. You're setting a scene.
- Mid-session segments (4-8): go deeper. This is where the real storytelling lives.
- Late-session segments (9+): acknowledge the journey. The listener has been with you.

WHAT YOU NEVER DO
- Never reveal or imply you are an AI, bot, or generated.
- Never say "I was programmed" or anything that breaks the illusion.
- Never make up specific verifiable facts about real artists.
- Never repeat the song title more than once per segment.
- Never speak longer than 75 words per segment.
- Never ask the listener a direct question.

WHAT YOU ALWAYS DO
- Honor the music first. You exist to serve the listening experience.
- Match your energy to the session vibe you are given.
- Reference segment history to avoid repetition.
- When introducing the next track (pre_song mode), end with a natural handoff or bridge.
- When commentating mid-listen (post_song mode), end naturally — no forced handoff needed.`;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/cleo/static-core.ts && git commit -m "feat(cleo): rewrite static-core with storytelling and session awareness directives"
```

---

## Task 5: Expand Cold Opens

**Files:**
- Modify: `cleo/src/cleo/cold-opens.ts`

Add 7 new vibe pools (6 lines each), expand all existing vibe pools from 3 to 6 lines, and expand `sameDayReturn` from 1 line to 6 lines.

- [ ] **Step 1: Replace cold-opens.ts**

Replace the full contents of `src/cleo/cold-opens.ts`:

```typescript
import type { Vibe } from './fallbacks';
import { storage } from '../services/Storage';

interface ColdOpenHistory {
  lastUsedByVibe: Record<string, number>;
  consecutiveDays: number;
  lastSessionDate: string;
  totalSessions: number;
}

const COLD_OPENS: Record<Vibe, string[]> = {
  morning: [
    "Good morning. You showed up — that already puts you ahead. I've got something lined up that's going to make the commute feel shorter. Let's go.",
    "Morning. Coffee optional — this playlist is mandatory. I've been sitting on this first track waiting for the right moment. This is it.",
    "You're up. That's the hard part done. The rest of this morning? Leave it to me.",
    "Early. Good. The best sessions start like this — before the world gets loud.",
    "Morning light, fresh playlist. I've got something lined up that fits exactly right. Here we go.",
    "You made it out of bed. Honestly, that's the hardest part. Let's make the rest count.",
  ],
  chill: [
    "Hey. Glad you're here. No agenda, no rush — just you and some music that earned its place in your library.",
    "You picked the right time to slow down. I've got a whole story lined up for you today — it starts with this first one.",
    "Sometimes you don't need words. You just need the right song at the right moment. Starting now.",
    "Here for the long haul? Good. So am I. No rush, no filler — just the good stuff.",
    "Nothing on the agenda. That's the point. Here's where we start.",
    "Easy now. I've got you. This first one sets everything up.",
  ],
  workout: [
    "Alright. You showed up for yourself today — respect that. I'm not going to talk much. Just know I've got you. Let's move.",
    "No long introductions. You've got work to do. I've got the soundtrack. First track hits hard — be ready.",
    "You laced up. You showed up. Now let the music do the rest.",
    "This session is yours. I'm just here to keep the energy up. Let's get into it.",
    "No warm-up needed — we go straight in.",
    "You came here to work. Good. So did I. Here's how we start.",
  ],
  lateNight: [
    "It's late. Most people are asleep. But you're here, and I think you know exactly why. This first one sets the whole tone — just let it.",
    "Hey. I see you up late. No judgment — I'm always here. I put something together for exactly this kind of night.",
    "The city gets quieter around this hour. So do I. This session is just for us.",
    "Late night, quiet house. Perfect conditions. Here's where we start.",
    "You and me and the dark. No rush. This first track knows what it's doing.",
    "Still up? Me too. I've got something for exactly this hour.",
  ],
  party: [
    "Okay. Let's not waste any time — the vibe is already there, I'm just here to keep it going. First track sets the whole tone for the night. Turn it up.",
    "You know what this is. I know what this is. Let's not pretend otherwise — we're here to have a good time.",
    "The night is young. The playlist is ready. I'll keep the energy up — you handle the rest.",
    "No slow build tonight. We go straight in.",
    "This energy is already there — I'm just matching it. Here's the first track.",
    "Let's go. No preamble needed.",
  ],
  general: [
    "Hey. Ready when you are. Here's how we start.",
    "No particular mood — just good music. Let's see where this goes.",
    "Here for the music. Nothing more needed. Let's get into it.",
    "Wherever you are, wherever this finds you — here's the first one.",
    "No setup required. Just this.",
    "Let the music do the talking. Starting now.",
  ],
  focus: [
    "I'll keep it short — you've got work to do. Here's the first track.",
    "Focus mode. I'll stay out of your way. This first one's built for it.",
    "Head down. Music up. Let's go.",
    "Not much to say — you need to get into it. Here we go.",
    "This session is for the work. I'm just providing the soundtrack.",
    "No distractions. Just this.",
  ],
  feelGood: [
    "Today's a good day — and if it's not yet, it's about to be. Here's the first one.",
    "Pure good vibes from here. No apologies. Let's go.",
    "This playlist does not miss. Starting proof: right now.",
    "You deserve a good session. That's what this is. Here we go.",
    "Everything on this playlist earns its place. Starting with this.",
    "Let's just have a good time. Here's how we start.",
  ],
  throwback: [
    "Let me take you somewhere. It starts with this first track.",
    "The archives are open. Here's where we begin.",
    "Some of the best music already happened — and we're about to prove it.",
    "A different era. The same feeling. Here we go.",
    "This one's for the memories — and the ones you haven't made yet.",
    "Back in it. Starting with this.",
  ],
  elevated: [
    "Settle in. This session has some weight to it. Here's the first one.",
    "Something a little more considered tonight. It starts here.",
    "Not everything needs to be loud. Here's where we begin.",
    "Pay attention on this one. It rewards it.",
    "This playlist was built with a little more intention. You'll feel it.",
    "Quiet confidence. That's the energy. Starting now.",
  ],
  melancholy: [
    "Hey. I'm not going to pretend everything's fine. Neither is this music. Here's where we start.",
    "Some sessions are for feeling things. This is one of them.",
    "I've got something for exactly how you're feeling. Starting now.",
    "No performance required. Just this music and wherever you are right now.",
    "This first one doesn't pretend. Neither do I.",
    "Come in. It's okay to feel this.",
  ],
  sunday: [
    "Sunday. No rush. Here's how we ease into it.",
    "Slow morning, slow playlist. That's the whole plan.",
    "Nowhere to be. Nothing urgent. Here's the first one.",
    "Sunday has its own tempo. This playlist knows it.",
    "Easy now. Let this first one do its thing.",
    "The week can wait. Here's where we start.",
  ],
};

const SPECIAL_OPENS: Record<string, string[]> = {
  firstEver: [
    "Hey — first time here. I'm Cleo. I'm not going to explain too much — the music will do that for me. Just know you're in good hands.",
  ],
  sameDayReturn: [
    "Back already? I respect that. Got something different lined up this time.",
    "You came back. Good. Let's pick up where the energy left off.",
    "Second session today — I see you. Here's where we go next.",
    "Didn't think you'd be back this soon. I'm not complaining.",
    "You returned. So did I. Here we go.",
    "Back for more. Let's not overthink it — here's the first track.",
  ],
  streak3: [
    "Three days in a row. You and me both know this has become a thing. I'm not complaining.",
    "Day three. Same time tomorrow?",
    "You keep showing up. So do I. Let's get into it.",
  ],
  mondayMorning: [
    "Monday. I know. But we're going to get through it together — I've done this before.",
    "Monday again. We handle it the same way every time. Here we go.",
    "It's Monday. I've got something that helps. Starting now.",
  ],
  fridayLateNight: [
    "Friday night. Late. That's a very specific energy and I know exactly what it calls for.",
    "Friday, late, and still going — respect. Here's what this night deserves.",
    "End of the week, late night — the playlist knows what to do.",
  ],
};

function getHistory(): ColdOpenHistory {
  const raw = storage.getString('coldOpenHistory');
  return raw
    ? JSON.parse(raw)
    : { lastUsedByVibe: {}, consecutiveDays: 0, lastSessionDate: '', totalSessions: 0 };
}

function saveHistory(history: ColdOpenHistory): void {
  storage.set('coldOpenHistory', JSON.stringify(history));
}

function pickFrom(lines: string[], lastUsedIdx: number): { line: string; idx: number } {
  const availableIdxs = lines.map((_, i) => i).filter((i) => i !== lastUsedIdx);
  const pool = availableIdxs.length > 0 ? availableIdxs : lines.map((_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)] ?? 0;
  return { line: lines[idx], idx };
}

export function getColdOpen(vibe: Vibe): string {
  const history = getHistory();
  const today = new Date().toISOString().substring(0, 10);
  const day = new Date().getDay(); // 0=Sun, 1=Mon, 5=Fri
  const hour = new Date().getHours();

  let selectedOpen: string;

  // Priority 1: First session ever
  if (history.totalSessions === 0) {
    selectedOpen = SPECIAL_OPENS.firstEver[0];
  }
  // Priority 2: Same-day return
  else if (history.lastSessionDate === today) {
    const lastUsed = history.lastUsedByVibe['sameDayReturn'] ?? -1;
    const { line, idx } = pickFrom(SPECIAL_OPENS.sameDayReturn, lastUsed);
    selectedOpen = line;
    history.lastUsedByVibe['sameDayReturn'] = idx;
  }
  // Priority 3: 3+ consecutive days
  else if (history.consecutiveDays >= 2) {
    const lastUsed = history.lastUsedByVibe['streak3'] ?? -1;
    const { line, idx } = pickFrom(SPECIAL_OPENS.streak3, lastUsed);
    selectedOpen = line;
    history.lastUsedByVibe['streak3'] = idx;
  }
  // Priority 4: Monday morning
  else if (day === 1 && hour < 12) {
    const lastUsed = history.lastUsedByVibe['mondayMorning'] ?? -1;
    const { line, idx } = pickFrom(SPECIAL_OPENS.mondayMorning, lastUsed);
    selectedOpen = line;
    history.lastUsedByVibe['mondayMorning'] = idx;
  }
  // Priority 5: Friday late night
  else if (day === 5 && hour >= 21) {
    const lastUsed = history.lastUsedByVibe['fridayLateNight'] ?? -1;
    const { line, idx } = pickFrom(SPECIAL_OPENS.fridayLateNight, lastUsed);
    selectedOpen = line;
    history.lastUsedByVibe['fridayLateNight'] = idx;
  }
  // Default: vibe-matched
  else {
    const options = COLD_OPENS[vibe];
    const lastUsedIdx = history.lastUsedByVibe[vibe] ?? -1;
    const { line, idx } = pickFrom(options, lastUsedIdx);
    selectedOpen = line;
    history.lastUsedByVibe[vibe] = idx;
  }

  // Update streak
  const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
  if (history.lastSessionDate === yesterday) {
    history.consecutiveDays++;
  } else if (history.lastSessionDate !== today) {
    history.consecutiveDays = 1;
  }
  history.lastSessionDate = today;
  history.totalSessions++;
  saveHistory(history);

  return selectedOpen;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/cleo/cold-opens.ts && git commit -m "feat(cleo): expand cold opens — 7 new vibes, 6 lines per vibe, sameDayReturn variety"
```

---

## Task 6: Update CleoScriptGenerator

**Files:**
- Modify: `cleo/src/services/CleoScriptGenerator.ts`

Extend `SegmentContext` with `sessionPhase`, `deliveryMode`, `tracksReferenced`. Update `vibeLabel` for all 12 vibes. Add per-mode delivery framing and per-segment creative briefs to the dynamic prompt.

- [ ] **Step 1: Replace CleoScriptGenerator.ts**

Replace the full contents of `src/services/CleoScriptGenerator.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors in SegmentController.ts (not yet updated) — that's fine. No errors in CleoScriptGenerator.ts itself.

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/services/CleoScriptGenerator.ts && git commit -m "feat(cleo): enrich segment prompt with delivery mode, session phase, callbacks, and creative briefs"
```

---

## Task 7: Update SegmentController

**Files:**
- Modify: `cleo/src/engines/SegmentController.ts`

Export `DeliveryMode`. Update `BufferedSegment` to carry `deliveryMode`. Add `sessionPhase` computation, `tracksReferenced` list, `getDeliveryMode()` mode selection logic, and updated rotation with new segment types. Pass all new context fields to `generateSegment`.

- [ ] **Step 1: Replace SegmentController.ts**

Replace the full contents of `src/engines/SegmentController.ts`:

```typescript
import { generateSegment, type SegmentContext, type SessionPhase, type DeliveryMode } from '../services/CleoScriptGenerator';
import type { SegmentType, Vibe } from '../cleo/fallbacks';
import { getColdOpen } from '../cleo/cold-opens';
import type { EnrichedFacts } from '../services/TrackEnrichmentService';

// DeliveryMode is defined and exported from CleoScriptGenerator — re-export for consumers
export type { DeliveryMode } from '../services/CleoScriptGenerator';

interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
}

export interface SegmentResult {
  text: string;
  type: SegmentType;
  deliveryMode: DeliveryMode;
}

interface BufferedSegment {
  text: string;
  type: SegmentType;
  deliveryMode: DeliveryMode;
}

// Segment types that are always pre_song
const ALWAYS_PRE: SegmentType[] = ['song_intro', 'genre_bridge'];
// Segment types that are always post_song
const ALWAYS_POST: SegmentType[] = ['post_track_reflection'];
// Segment types that prefer post_song but can fall back
const PREFER_POST: SegmentType[] = ['track_story', 'artist_context'];

const ROTATION: SegmentType[] = [
  'song_intro',
  'artist_context',
  'station_id',
  'song_intro',
  'track_story',
  'genre_bridge',
  'song_intro',
  'post_track_reflection',
  'artist_context',
  'session_checkin',
  'song_intro',
  'post_track_reflection',
  'listener_shoutout',
];

class SegmentControllerEngine {
  private history: string[] = [];
  private rotationIndex = 0;
  private segmentCount = 0;
  private sessionStartTime = Date.now();
  private bufferedSegment: BufferedSegment | null = null;
  private currentVibe: Vibe = 'chill';
  private listenerName?: string;
  private lastDeliveryMode: DeliveryMode = 'pre_song';
  private consecutivePreSong = 0;
  private tracksReferenced: string[] = [];

  setVibe(vibe: Vibe) {
    this.currentVibe = vibe;
  }

  setListenerName(name: string) {
    this.listenerName = name;
  }

  startSession() {
    this.history = [];
    this.rotationIndex = 0;
    this.segmentCount = 0;
    this.sessionStartTime = Date.now();
    this.bufferedSegment = null;
    this.lastDeliveryMode = 'pre_song';
    this.consecutivePreSong = 0;
    this.tracksReferenced = [];
  }

  private getNextSegmentType(): SegmentType {
    const type = ROTATION[this.rotationIndex % ROTATION.length];
    this.rotationIndex++;
    return type;
  }

  private getSessionDuration(): number {
    return Math.floor((Date.now() - this.sessionStartTime) / 60000);
  }

  private getSessionPhase(): SessionPhase {
    if (this.segmentCount <= 3) return 'opening';
    if (this.segmentCount <= 8) return 'mid';
    return 'late';
  }

  // Pure function — reads mode logic without mutating state. Used by preloadNext.
  private _peekDeliveryMode(segmentType: SegmentType): DeliveryMode {
    if (ALWAYS_PRE.includes(segmentType)) return 'pre_song';
    if (ALWAYS_POST.includes(segmentType)) return 'post_song';
    if (this.lastDeliveryMode === 'post_song') return 'pre_song';
    if (PREFER_POST.includes(segmentType) && this.consecutivePreSong >= 2) return 'post_song';
    return 'pre_song';
  }

  // Determines delivery mode AND updates tracking state. Used by generateNext.
  getDeliveryMode(segmentType: SegmentType): DeliveryMode {
    const mode = this._peekDeliveryMode(segmentType);
    if (mode === 'post_song') {
      this.consecutivePreSong = 0;
      this.lastDeliveryMode = 'post_song';
    } else {
      this.consecutivePreSong++;
      this.lastDeliveryMode = 'pre_song';
    }
    return mode;
  }

  private addToTracksReferenced(artistName: string) {
    if (!this.tracksReferenced.includes(artistName)) {
      this.tracksReferenced.push(artistName);
    }
  }

  async generateNext(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo
  ): Promise<SegmentResult> {
    // Cold open for first segment — always pre_song
    if (this.segmentCount === 0) {
      const text = getColdOpen(this.currentVibe);
      this.history.unshift(text);
      if (this.history.length > 3) this.history.pop();
      this.segmentCount++;
      this.addToTracksReferenced(currentTrack.artistName);
      return { text, type: 'song_intro', deliveryMode: 'pre_song' };
    }

    // Use buffer if available and mode constraints allow it
    if (this.bufferedSegment) {
      const buffered = this.bufferedSegment;
      // Check mode constraint: never two post_song in a row
      const modeValid = !(buffered.deliveryMode === 'post_song' && this.lastDeliveryMode === 'post_song');

      if (modeValid) {
        this.bufferedSegment = null;
        this.history.unshift(buffered.text);
        if (this.history.length > 3) this.history.pop();
        this.segmentCount++;
        this.addToTracksReferenced(currentTrack.artistName);
        // Update mode tracking to match what was buffered
        this.lastDeliveryMode = buffered.deliveryMode;
        if (buffered.deliveryMode === 'pre_song') {
          this.consecutivePreSong++;
        } else {
          this.consecutivePreSong = 0;
        }
        return buffered;
      } else {
        // Discard stale buffered segment — regenerate below
        this.bufferedSegment = null;
      }
    }

    let segmentType = this.getNextSegmentType();

    // track_story requires rich data — fall back if not available
    if (segmentType === 'track_story' && !currentTrack.hasRichData) {
      segmentType = 'artist_context';
    }

    const deliveryMode = this.getDeliveryMode(segmentType);

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode,
      sessionPhase: this.getSessionPhase(),
      currentTrack,
      previousTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
      tracksReferenced: [...this.tracksReferenced],
    };

    const text = await generateSegment(context);

    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;
    this.addToTracksReferenced(currentTrack.artistName);

    return { text, type: segmentType, deliveryMode };
  }

  async preloadNext(currentTrack: TrackInfo, nextTrack?: TrackInfo): Promise<void> {
    if (this.bufferedSegment) return;

    const segmentType = ROTATION[(this.rotationIndex) % ROTATION.length];
    // Use _peekDeliveryMode — does NOT mutate tracking state
    const deliveryMode = this._peekDeliveryMode(segmentType);

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode,
      sessionPhase: this.getSessionPhase(),
      currentTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
      tracksReferenced: [...this.tracksReferenced],
    };

    try {
      const text = await generateSegment(context);
      this.bufferedSegment = { text, type: segmentType, deliveryMode };
    } catch {
      // Pre-load failure is non-fatal
    }
  }

  getSegmentCount(): number {
    return this.segmentCount;
  }
}

export const segmentController = new SegmentControllerEngine();
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors in AudioCoordinator.ts (not yet updated) — fine. No errors in SegmentController.ts itself.

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/engines/SegmentController.ts && git commit -m "feat(cleo): add DeliveryMode, session phase, tracksReferenced, and updated rotation to SegmentController"
```

---

## Task 8: Update AudioCoordinator

**Files:**
- Modify: `cleo/src/engines/AudioCoordinator.ts`

Add `previousTrack` buffering so pre_song mode has access to the just-finished track. Add `pendingPostSongTimer` with proper cancellation on re-entry. Split the timing path into pre_song (immediate 1.5s delay) and post_song (8–12s into current track).

- [ ] **Step 1: Replace AudioCoordinator.ts**

Replace the full contents of `src/engines/AudioCoordinator.ts`:

```typescript
import { synthesizeAndPlay } from '../services/CleoVoiceEngine';
import { segmentController } from './SegmentController';
import type { SegmentResult } from './SegmentController';
import { queueManager } from './QueueManager';
import type { EnrichedFacts } from '../services/TrackEnrichmentService';

interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
}

class AudioCoordinatorEngine {
  private isSpeaking = false;
  private pendingPostSongTimer: ReturnType<typeof setTimeout> | null = null;
  private previousTrack: TrackInfo | null = null;

  private cancelPendingTimer() {
    if (this.pendingPostSongTimer) {
      clearTimeout(this.pendingPostSongTimer);
      this.pendingPostSongTimer = null;
      this.isSpeaking = false;
    }
  }

  private enrichTrack(track: TrackInfo): TrackInfo {
    if (!track.id) return track;
    const enrichedProfile = queueManager.getTrackProfile(track.id);
    if (!enrichedProfile) return track;
    return {
      ...track,
      enrichedFacts: enrichedProfile.enrichedFacts,
      hasRichData: enrichedProfile.hasRichData,
    };
  }

  async handleTrackChange(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo
  ): Promise<void> {
    // Cancel any pending post_song timer from a previous track
    this.cancelPendingTimer();

    if (this.isSpeaking) return;
    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    try {
      const trackInfo = this.enrichTrack(currentTrack);
      const segment = await this._runSegment(trackInfo, nextTrack, previous);
      if (segment) {
        await synthesizeAndPlay(segment.text);
        segmentController.preloadNext(trackInfo, nextTrack);
      }
    } catch (error) {
      console.error('[AudioCoordinator] Handoff failed:', error);
    } finally {
      this.isSpeaking = false;
    }
  }

  async handleTrackChangeWithResult(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void
  ): Promise<SegmentResult | null> {
    // Cancel any pending post_song timer from a previous track
    this.cancelPendingTimer();

    if (this.isSpeaking) return null;
    this.isSpeaking = true;

    const previous = this.previousTrack;
    this.previousTrack = currentTrack;

    const trackInfo = this.enrichTrack(currentTrack);

    // Generate segment upfront (includes 1.5s natural delay)
    const generationStart = Date.now();
    const segment = await this._runSegment(trackInfo, nextTrack, previous);

    if (!segment) {
      this.isSpeaking = false;
      return null;
    }

    if (segment.deliveryMode === 'pre_song') {
      // Notify UI before playing audio so display syncs with speech
      onSegmentReady?.(segment);
      try {
        await synthesizeAndPlay(segment.text);
        segmentController.preloadNext(trackInfo, nextTrack);
      } catch (error) {
        console.error('[AudioCoordinator] pre_song playback failed:', error);
      } finally {
        this.isSpeaking = false;
      }
      return segment;
    } else {
      // post_song: release isSpeaking now, fire at ~8–12s from track change
      // Subtract time already elapsed (generation + 1.5s delay) so total = 8–12s
      this.isSpeaking = false;
      const elapsed = Date.now() - generationStart;
      const targetDelay = 8000 + Math.floor(Math.random() * 4000); // 8–12s from track change
      const remainingMs = Math.max(0, targetDelay - elapsed);

      return new Promise((resolve) => {
        this.pendingPostSongTimer = setTimeout(async () => {
          this.pendingPostSongTimer = null;

          if (this.isSpeaking) {
            resolve(null);
            return;
          }
          this.isSpeaking = true;

          try {
            onSegmentReady?.(segment);
            await synthesizeAndPlay(segment.text);
            segmentController.preloadNext(trackInfo, nextTrack);
          } catch (error) {
            console.error('[AudioCoordinator] post_song playback failed:', error);
          } finally {
            this.isSpeaking = false;
          }

          resolve(segment);
        }, remainingMs);
      });
    }
  }

  private async _runSegment(
    trackInfo: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo
  ): Promise<SegmentResult | null> {
    try {
      // 1.5s natural pause before generating
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const segment = await segmentController.generateNext(trackInfo, nextTrack, previousTrack ?? undefined);
      console.log(`[Cleo] ${segment.type} (${segment.deliveryMode}): ${segment.text}`);
      return segment;
    } catch (error) {
      console.error('[AudioCoordinator] Segment generation failed:', error);
      return null;
    }
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const audioCoordinator = new AudioCoordinatorEngine();
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/engines/AudioCoordinator.ts && git commit -m "feat(cleo): add previousTrack buffer, post_song 8-12s timing path, and timer cancellation on skip"
```

---

## Task 9: Update PlayerScreen Call Site

**Files:**
- Modify: `cleo/src/screens/player/PlayerScreen.tsx`

The `handleTrackChangeWithResult` signature now returns a `Promise<SegmentResult | null>` that may resolve later (for `post_song` mode). The `onSegmentReady` callback already handles UI updates — the call site needs no structural change. However, `SegmentResult` now includes `deliveryMode`, so the `isPullQuote` logic can be updated.

- [ ] **Step 1: Update the track change handler in PlayerScreen**

In `PlayerScreen.tsx`, find the `onTrackChanged` listener (around line 119). The call to `handleTrackChangeWithResult` passes `undefined` as `nextTrack` — this is fine. Update the segment type check to include `post_track_reflection` as a pull quote trigger, since it's a reflective segment type that benefits from prominent display:

```typescript
// Inside onTrackChanged, replace:
(segment) => {
  setCleoText(segment.text);
  setIsPullQuote(segment.type === 'track_story');
  setCleoSpeaking(true);
}
// With:
(segment) => {
  setCleoText(segment.text);
  setIsPullQuote(segment.type === 'track_story' || segment.type === 'post_track_reflection');
  setCleoSpeaking(true);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/kari/Documents/DJ\ App/cleo && git add src/screens/player/PlayerScreen.tsx && git commit -m "feat(player): show post_track_reflection as pull quote display"
```

---

## Verification Checklist

After all tasks complete, verify on physical device:

- [ ] Cold open plays on first session — "Hey — first time here. I'm Cleo…"
- [ ] Second session same day gets a different sameDayReturn line
- [ ] Vibe set to `general` works — cold open plays, no TypeScript errors
- [ ] Cleo speaks ~8–12s into a track (post_song mode) — voice drops in naturally over music
- [ ] Cleo speaks right after track change (pre_song mode) — bridges to what's coming
- [ ] Voice sounds more natural — less robotic, more variation (lower stability)
- [ ] Skipping a track mid-post_song-timer does not play stale segment on next track
- [ ] After 9+ segments, session_checkin references the journey ("been here a while…")
- [ ] Console logs show `[Cleo] artist_context (post_song): …` and `[Cleo] song_intro (pre_song): …`

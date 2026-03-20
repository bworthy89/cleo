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

export type Vibe =
  | 'morning' | 'chill' | 'workout' | 'lateNight' | 'party'
  | 'general' | 'focus' | 'feelGood' | 'throwback' | 'elevated' | 'melancholy' | 'sunday';

interface FallbackEntry {
  type: SegmentType;
  vibe?: Vibe;
  lines: string[];
}

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
      "Every detail here is intentional. That's what separates this artist.",
      "This is someone who figured something out — and it shows.",
    ],
  },

  // ── station_id ───────────────────────────────────────────────────────
  {
    type: 'station_id',
    lines: [
      "You're with ONAY. This one's for you.",
      'Still here. Still playing the good stuff.',
      'ONAY — keeping you company.',
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

const recentlyUsed: string[] = [];
const MAX_RECENT = 5;

export function getFallbackLine(type: SegmentType, vibe?: Vibe): string {
  let candidates = fallbacks.filter(
    (f) => f.type === type && (f.vibe === vibe || !f.vibe)
  );

  if (candidates.length === 0) {
    candidates = fallbacks.filter((f) => f.type === type);
  }

  const allLines = candidates.flatMap((c) => c.lines);
  const available = allLines.filter((l) => !recentlyUsed.includes(l));
  const pool = available.length > 0 ? available : allLines;

  const line = pool[Math.floor(Math.random() * pool.length)];

  recentlyUsed.push(line);
  if (recentlyUsed.length > MAX_RECENT) {
    recentlyUsed.shift();
  }

  return line;
}

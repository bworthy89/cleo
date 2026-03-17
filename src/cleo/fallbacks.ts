export type SegmentType =
  | 'song_intro'
  | 'station_id'
  | 'listener_shoutout'
  | 'session_checkin'
  | 'sign_off';

export type Vibe = 'morning' | 'chill' | 'workout' | 'lateNight' | 'party';

interface FallbackEntry {
  type: SegmentType;
  vibe?: Vibe;
  lines: string[];
}

const fallbacks: FallbackEntry[] = [
  {
    type: 'song_intro',
    vibe: 'chill',
    lines: [
      'This next one. Just… trust it.',
      'Pay attention to this one — it earns it.',
      "I don't need to say much about this one. Just listen.",
      "This track has been in rotation for a reason. You'll hear it.",
      'Coming up next — one of my favorites in your library.',
    ],
  },
  {
    type: 'song_intro',
    vibe: 'morning',
    lines: [
      "This one's going to carry you through. Promise.",
      'Right on time. This next track was made for exactly this moment.',
      'Keep moving — this one keeps pace with you.',
    ],
  },
  {
    type: 'song_intro',
    vibe: 'workout',
    lines: [
      "Lock in. This next one doesn't let up.",
      "Here it comes. Don't stop.",
      "This one hits different when you're moving. Go.",
    ],
  },
  {
    type: 'song_intro',
    vibe: 'lateNight',
    lines: [
      'This next one knows what time it is.',
      'Sit with this one. No rush.',
      'Some tracks just belong to the night. This is one of them.',
    ],
  },
  {
    type: 'song_intro',
    vibe: 'party',
    lines: [
      "Don't slow down — this next one won't let you.",
      'Keep that energy. Here we go.',
      "This one's going to take it up a notch. Stay ready.",
    ],
  },
  {
    type: 'station_id',
    lines: [
      "You're with Cleo. This one's for you.",
      'Still here. Still playing the good stuff.',
      'Cleo here — keeping you company.',
      "Your music. My voice. Let's keep going.",
      "This is what we do — just you and the music.",
      'Cleo, keeping it going.',
    ],
  },
  {
    type: 'listener_shoutout',
    lines: [
      "Got a message from somebody out there who said this playlist is exactly what they needed tonight. You're not alone.",
      "Shoutout to everyone listening with headphones in — this one's especially for you.",
      'Night shift workers, late studiers, insomniacs — I see all of you. This next one is yours.',
      'Someone told me this playlist got them through a tough week. I believe it. Keep going.',
      'For everyone who found their way here tonight — good call.',
    ],
  },
  {
    type: 'session_checkin',
    lines: [
      "Still with me? Good. We've got more.",
      "We're deep into this session now. The playlist has earned your attention — keep giving it.",
      "You've been here a while. So have I. Neither of us is leaving yet.",
      'This is what a good session feels like. Settle in.',
      'Some sessions just hit right. This is one of them.',
    ],
  },
  {
    type: 'sign_off',
    lines: [
      "That's a wrap. Good session — you picked well. I'll be here when you're ready for another one.",
      "And that's the end of this one. Go do something good with that energy.",
      'We made it through. Same time tomorrow?',
      'Good music, good company. Until next time — take care of yourself out there.',
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

import type { Vibe } from './types';

export interface VibeArc {
  vibe: Vibe;
  /** One-line UI-facing descriptor (e.g. "hushed, warm, drifting") */
  descriptor: string;
  /** Full prose arc for the LLM prompt */
  arc: string;
  /** Preferred genres/qualities — soft signals, not filters */
  preferred: string[];
  /** Avoid list — soft signals, not filters */
  avoid: string[];
}

export const VIBE_ARCS: Record<Vibe, VibeArc> = {
  morning: {
    vibe: 'morning',
    descriptor: 'Sun\u2019s up, gentle forward motion',
    arc: 'Opens fresh and clear \u2014 a song that sounds like a window opening. Mid-tempo, major key. Picks up steadily but never sprints; the day is starting, not a workout. Peak is a gently uplifting mid-tempo anthem, never club energy. Close leaves the listener ready to move \u2014 not sleepy, not peaked-out.',
    preferred: ['folk-pop', 'sunny indie', 'alt-pop', 'soul-adjacent pop', 'warm acoustic'],
    avoid: ['heavy bass', 'trap', '2am vibes'],
  },
  focus: {
    vibe: 'focus',
    descriptor: 'Head-down, unobtrusive momentum',
    arc: 'Opens textural and undemanding \u2014 instrumental or near-instrumental track 1, no vocal hooks that pull you out of what you\u2019re doing. Body stays in lane; variation comes from timbral shifts, not dynamic swings. No traditional peak \u2014 a mid-session plateau at best. Close suggests a natural stopping point.',
    preferred: ['ambient', 'lo-fi', 'post-rock instrumental', 'instrumental hip-hop', 'minimal techno', 'neoclassical piano'],
    avoid: ['lyric-heavy storytelling', 'loud dynamic shifts', 'aggressive genres'],
  },
  workout: {
    vibe: 'workout',
    descriptor: 'Sustained drive',
    arc: 'Arrives running \u2014 immediate energy, clear pulse, 120+ BPM, no easing in. Body holds the plateau; every track keeps the pulse up, no mid-session breathers. Peak is the hardest-hitting cut in the pool, late-middle. Descent is minimal until the last track, which comes down but keeps momentum \u2014 a finish line, not a collapse.',
    preferred: ['hip-hop', 'hard dance', 'EDM', 'rock', 'high-energy pop', 'drum & bass'],
    avoid: ['acoustic ballads', 'downtempo', 'sub-100 BPM except the final track'],
  },
  feelGood: {
    vibe: 'feelGood',
    descriptor: 'Warm, uplifting, communal',
    arc: 'Opens instantly warm \u2014 a groove you can nod to from the first bar. Major key, hook-forward. Body builds generosity, each track slightly more engaging than the last. Peak is the track in the pool that makes people sing along \u2014 big hook, obvious joy. Descent stays warm. Close leaves a smile.',
    preferred: ['classic soul', 'Motown', 'funk', 'reggae', 'upbeat Afrobeats', 'sunshine pop', 'R&B grooves'],
    avoid: ['melancholy', 'moody', 'ironic detachment', 'trap'],
  },
  lateNight: {
    vibe: 'lateNight',
    descriptor: 'Hushed, warm, drifting',
    arc: 'Opens low-lit \u2014 slow-burn vocal or spare R&B, 75-90 BPM, feels like a single lamp on. Tracks 2-3 add texture in the same register \u2014 warmth builds, volume doesn\u2019t. Peak is a groove, never a banger \u2014 deep and restrained, 2am college radio. Descent comes way down. Close is hushed: solo piano, acoustic, or a vocal with space around it.',
    preferred: ['neo-soul', 'downtempo', 'smooth R&B', 'vocal jazz', 'quiet storm', 'ambient vocals'],
    avoid: ['four-on-the-floor', 'shouting', 'club energy'],
  },
  melancholy: {
    vibe: 'melancholy',
    descriptor: 'Reflective, sad in a good way',
    arc: 'Opens slow without wallowing \u2014 piano, strings, or spare vocal that sits with the listener. Body deepens the feeling without rushing. Peak is emotional, not energetic \u2014 the track that hits hardest, usually minor key or unresolved. Descent stays in register \u2014 no forced upswing. Close leaves the listener held, not dropped. Quiet resolve.',
    preferred: ['indie folk', 'singer-songwriter', 'chamber pop', 'slowcore', 'sad R&B', 'ambient with vocal texture'],
    avoid: ['uplifting resolutions', 'pop-positive choruses', 'energetic tempos'],
  },
  party: {
    vibe: 'party',
    descriptor: 'Saturday night, builds and releases',
    arc: 'Arrives confident but not peaked \u2014 a groove that pulls people into the room, 100-115 BPM. Body climbs steadily, each track slightly harder than the last. Peak is mid-to-late \u2014 the biggest track in the pool, most-played, most-danceable. Brief descent drops to released communal energy \u2014 everyone-singing-along. Close leaves the room elevated, not exhausted.',
    preferred: ['hip-hop', 'dance-pop', 'Afrobeats', 'house', 'funk', 'disco revivals'],
    avoid: ['slow ballads', 'introspective cuts', 'anything that kills momentum'],
  },
};

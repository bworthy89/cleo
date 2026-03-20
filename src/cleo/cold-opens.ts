import type { Vibe } from './fallbacks';
import { getObject, setObject, StorageKeys } from '../services/Storage';

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

const DEFAULT_HISTORY: ColdOpenHistory = { lastUsedByVibe: {}, consecutiveDays: 0, lastSessionDate: '', totalSessions: 0 };

function getHistory(): ColdOpenHistory {
  return getObject<ColdOpenHistory>(StorageKeys.COLD_OPEN_HISTORY) ?? DEFAULT_HISTORY;
}

function saveHistory(history: ColdOpenHistory): void {
  setObject(StorageKeys.COLD_OPEN_HISTORY, history);
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

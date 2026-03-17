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
    "Good morning. You showed up — that already puts you ahead. I've got something lined up that's going to make the commute feel shorter than it is. Let's go.",
    "Morning. Coffee optional — this playlist is mandatory. I've been sitting on this first track waiting for the right moment. This is it. Here we go.",
    "You're up. That's the hard part. The rest of this morning? Leave it to me. Let's ease into it.",
  ],
  chill: [
    "Hey. Glad you're here. No agenda, no rush — just you and some music that earned its place in your library. I'll be right here with you. Let's get into it.",
    "You picked the right time to slow down. I've got a whole story lined up for you today — it starts with this first one. Pay attention to how it opens.",
    "Sometimes you don't need words. You just need the right song at the right moment. I'm going to give you that. Starting now.",
  ],
  workout: [
    "Alright. You showed up for yourself today — respect that. I'm not going to talk much. Just know I've got you the whole way through. Let's move.",
    "No long introductions. You've got work to do. I've got the soundtrack. First track hits hard — be ready.",
    "You laced up. You showed up. Now let the music do the rest. Lock in.",
  ],
  lateNight: [
    "It's late. Most people are asleep. But you're here, and I think you know exactly why. I'm not going to overthink it either. This first one sets the whole tone — just let it.",
    "Hey. I see you up late. No judgment — I'm always here. I put something together for exactly this kind of night. Let it breathe.",
    "The city gets quieter around this hour. So do I. This session is just for us. Here's where we start.",
  ],
  party: [
    "Okay. Let's not waste any time — the vibe is already there, I'm just here to keep it going. First track is going to set the whole tone for the night. Turn it up.",
    "You know what this is. I know what this is. Let's not pretend otherwise — we're here to have a good time. Starting right now.",
    "The night is young. The playlist is ready. I'll keep the energy up — you just handle the rest. Here we go.",
  ],
};

const SPECIAL_OPENS: Record<string, string> = {
  firstEver: "Hey — first time here. I'm Cleo. I'm not going to explain too much — the music will do that for me. Just know you're in good hands. Here's how we start.",
  sameDayReturn: "Back already? I respect that. Let's pick up where the energy left off — I've got something different lined up this time.",
  streak3: "Three days in a row. You and me both know this has become a thing. I'm not complaining. Let's get into it.",
  mondayMorning: "Monday. I know. But we're going to get through it together — I've done this before. First track is going to help, I promise.",
  fridayLateNight: "Friday night. Late. That's a very specific energy and I know exactly what it calls for. No warm up needed — we go straight in.",
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

export function getColdOpen(vibe: Vibe): string {
  const history = getHistory();
  const today = new Date().toISOString().substring(0, 10);
  const day = new Date().getDay(); // 0=Sun, 1=Mon, 5=Fri
  const hour = new Date().getHours();

  let selectedOpen: string;

  // Priority 1: First session ever
  if (history.totalSessions === 0) {
    selectedOpen = SPECIAL_OPENS.firstEver;
  }
  // Priority 2: Same-day return
  else if (history.lastSessionDate === today) {
    selectedOpen = SPECIAL_OPENS.sameDayReturn;
  }
  // Priority 3: 3+ consecutive days
  else if (history.consecutiveDays >= 2) {
    // Will become 3 after we update
    selectedOpen = SPECIAL_OPENS.streak3;
  }
  // Priority 4: Monday morning
  else if (day === 1 && hour < 12) {
    selectedOpen = SPECIAL_OPENS.mondayMorning;
  }
  // Priority 5: Friday late night
  else if (day === 5 && hour >= 21) {
    selectedOpen = SPECIAL_OPENS.fridayLateNight;
  }
  // Default: vibe-matched, avoid last used
  else {
    const options = COLD_OPENS[vibe];
    const lastUsedIdx = history.lastUsedByVibe[vibe] ?? -1;
    const availableIdxs = options.map((_, i) => i).filter((i) => i !== lastUsedIdx);
    const idx = availableIdxs[Math.floor(Math.random() * availableIdxs.length)] ?? 0;
    selectedOpen = options[idx];
    history.lastUsedByVibe[vibe] = idx;
  }

  // Update history
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

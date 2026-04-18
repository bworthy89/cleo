// Test harness for the Ask ONAY intent classifier.
//
// Runs a set of canonical prompts through Gemini with the proposed
// classifier system prompt and prints the structured JSON it returns.
// Use this to evaluate classifier quality before wiring it into
// /curate-intent in production.
//
//   cd server && npx tsx scripts/test-curation-intent.ts

import 'dotenv/config';
import { GeminiProvider } from '../src/providers/llm/gemini.js';

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

const VIBES = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
] as const;

const SYSTEM_PROMPT = `You are ONAY, an AI radio host classifying a listener's playlist request. Your job: read the request, decide the intent, and pull out structured parameters. This drives a curation pipeline that grounds track selection in Apple Music catalog data.

Return ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.

Response shape:
{
  "intent": "one of: ${INTENT_TYPES.join(', ')}",
  "artists": ["Artist Name", ...],
  "seedTracks": [{ "title": "Song", "artist": "Artist" }, ...],
  "vibe": "one of: ${VIBES.join(', ')} — null if not mood-driven",
  "era": "e.g. 1990s, early 2000s, 2010s — null if not era-driven",
  "genre": "e.g. hip hop, alt-R&B, indie folk — null if not genre-driven",
  "stance": "2-3 sentences in your voice, explaining the curation choice and the arc you'd take. Literary, warm, specific.",
  "playlistTitle": "A stylized playlist title",
  "conversationalResponse": "What you'd say opening the chat — warm, 1-2 sentences",
  "options": ["wider — ...", "tighter — ...", "different vibe — ..."]
}

Intent taxonomy:

- single-artist: "best of X", "all of X", "X songs", "give me X" — listener wants one specific artist's catalog, nothing else. artists = [that one artist].
- artist-circle: "X and their collaborators", "X's inner circle", "the Sonder crew" — artist plus their close network. artists = named artist(s).
- scene: "X inspired", "like X", "X vibes", "in the spirit of X", "if you liked X" — aesthetic continuation. artists = seed artist(s); expand to similar during curation.
- mood: "Sunday morning", "late-night chill", "focus music", "party set" — no artist named, mood-driven. vibe must be set.
- era-genre: "90s hip hop", "2000s indie rock", "early 2010s blog rap" — era or genre or both. era and/or genre set.
- specific-track: "play 'Rolling Stone' by Brent Faiyaz", "that one Lucky Daye song about his ex", "the Blonde song that fades out" — listener named or described a specific track. seedTracks populated.
- seed-track-plus: "songs like 'Rolling Stone' by Brent Faiyaz", "more like that Frank Ocean song" — seed track named AND the listener wants similars. seedTracks populated.
- deep-cuts: "hidden gems of Frank Ocean", "X's b-sides", "underrated tracks by Y" — listener explicitly wants curatorial deep picks, not hits. artists = named artist(s).
- mixed: anything that combines the above or doesn't fit cleanly. Fall through.

Rules:
- If the listener names an artist plainly ("best of Brent Faiyaz"), intent is single-artist. Never scene or mood unless they ask for similars or a mood.
- Vibe is only set when the request is mood-driven. "Brent Faiyaz inspired" might end up late-night, but vibe is for mood-driven requests, not scene requests — let the curation pipeline infer scene vibes separately.
- Stance is ONAY's real opinion of how to shape this playlist. Not "here's a playlist." Something like "Opens on 'Trust' — his breakout — so the listener remembers why they fell for him, then the 2018–2020 run is the body, closes on 'Rolling Stone' because that's the emotional peak."
- Options let the listener steer: always 3, always actionable, always written in ONAY's voice.
- Playlist titles are editorial: "Brent Faiyaz — the essentials, late-night cut" not "Brent Faiyaz Hits."
- conversationalResponse opens the chat naturally.`;

// Core 8 cases covering every intent type. Free-tier Gemini limits us
// to ~10 req/min so we keep the set small and evaluate the hit rate
// + the stance/options quality on representative examples.
const TEST_CASES: Array<{ prompt: string; expected: string }> = [
  { prompt: 'best of brent faiyaz',                          expected: 'single-artist' },
  { prompt: 'brent faiyaz inspired',                         expected: 'scene' },
  { prompt: 'songs like rolling stone by brent faiyaz',      expected: 'seed-track-plus' },
  { prompt: 'play rolling stone by brent faiyaz',            expected: 'specific-track' },
  { prompt: 'hidden gems of frank ocean',                    expected: 'deep-cuts' },
  { prompt: 'sunday morning coffee vibes',                   expected: 'mood' },
  { prompt: '90s hip hop classics',                          expected: 'era-genre' },
  { prompt: 'brent faiyaz and his collaborators',            expected: 'artist-circle' },
];

function tryParse(text: string): any {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
}

async function main(): Promise<void> {
  const gemini = new GeminiProvider();
  const pad = (s: string, w: number): string => s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);

  console.log('\nAsk ONAY — Intent Classifier Test\n' + '='.repeat(80));

  let agreements = 0;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < TEST_CASES.length; i++) {
    const { prompt, expected } = TEST_CASES[i];
    // Gemini free tier is 10 RPM → pace at 1 per 8s.
    if (i > 0) await sleep(8000);
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await gemini.generate({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: `Listener request: "${prompt}"`,
          maxTokens: 2048,
          temperature: 0.4,
        });
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('429') && attempt < 3) {
          console.log(`    [rate limited, waiting ${attempt * 15}s]`);
          await sleep(attempt * 15_000);
          continue;
        }
        throw err;
      }
    }
    if (!result) continue;
    const parsed = tryParse(result.text);
    const got = parsed?.intent ?? '<parse-failed>';
    const agreed = expected.split('/').map(s => s.trim()).includes(got) ? '✓' : ' ';
    if (agreed === '✓') agreements++;
    console.log(`\n${agreed} ${pad(prompt, 46)} → ${pad(got, 18)}  (expected: ${expected})`);
    if (parsed) {
      if (parsed.artists?.length)   console.log(`    artists:    ${parsed.artists.join(', ')}`);
      if (parsed.seedTracks?.length) console.log(`    seedTracks: ${parsed.seedTracks.map((t: any) => `"${t.title}" by ${t.artist}`).join('; ')}`);
      if (parsed.vibe)              console.log(`    vibe:       ${parsed.vibe}`);
      if (parsed.era)               console.log(`    era:        ${parsed.era}`);
      if (parsed.genre)             console.log(`    genre:      ${parsed.genre}`);
      if (parsed.stance)            console.log(`    stance:     ${parsed.stance}`);
      if (parsed.playlistTitle)     console.log(`    title:      ${parsed.playlistTitle}`);
      if (parsed.options?.length)   console.log(`    options:    ${parsed.options.join(' | ')}`);
    } else {
      console.log(`    RAW: ${result.text.slice(0, 300)}`);
    }
  }

  console.log(`\n${'='.repeat(80)}\nIntent agreement: ${agreements} / ${TEST_CASES.length}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

# Segment Story Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ONAY's between-track segments from generic bridges into rich, genre-aware, fact-grounded DJ commentary. Add Wikipedia/Last.fm/Spotify enrichment, tier transitions into fact bridges + deep dives, and reshape the bake pipeline to drain enrichment on chosen tracks before segment generation.

**Architecture:** Two-tier segment prompting (fact bridge 40-60w, deep dive 80-120w, ~25%/75% split) selected by the sequencer via a new `featureSlots` response field. Genre-aware voice via a 10-family playbook embedded in the system prompt. Hybrid data strategy with a "don't invent specifics" guardrail. New pipeline: sequencer → enrich only the chosen N tracks → parallel segment gen (concurrency cap 4) → response. All segments ready before client gets manifest.

**Tech Stack:** Node 18+, TypeScript strict, Express, Jest + ts-jest, Zod 4, existing Ollama/Gemini LLM providers, existing Cartesia/ElevenLabs TTS providers, MMKV for client persistence, React Native / Expo SDK 55 client.

**Spec:** `docs/superpowers/specs/2026-04-18-segment-story-design.md`

---

## File Structure

### New files (server)
- `server/src/services/broadcast/GenreFamily.ts` — type, normalizer, playbook dictionary
- `server/src/services/broadcast/audio-features-format.ts` — Spotify-features-to-prose helper
- `server/src/services/enrichment/http-timeout.ts` — AbortController-based fetch timeout helper
- `server/src/services/enrichment/rate-limiter.ts` — extracted `RateLimitedFetcher` shared across fetchers
- `server/src/services/enrichment/fetchers/GeniusFetcher.ts` — extracted
- `server/src/services/enrichment/fetchers/MusicBrainzFetcher.ts` — extracted
- `server/src/services/enrichment/fetchers/WikipediaFetcher.ts` — new
- `server/src/services/enrichment/fetchers/LastFmFetcher.ts` — new
- `server/src/services/enrichment/fetchers/SpotifyFetcher.ts` — new

### New test files
- `server/__tests__/broadcast/GenreFamily.test.ts`
- `server/__tests__/broadcast/audio-features-format.test.ts`
- `server/__tests__/enrichment/http-timeout.test.ts`
- `server/__tests__/enrichment/fetchers/WikipediaFetcher.test.ts`
- `server/__tests__/enrichment/fetchers/LastFmFetcher.test.ts`
- `server/__tests__/enrichment/fetchers/SpotifyFetcher.test.ts`

### Modified files (server)
- `server/src/services/enrichment/EnrichmentCache.ts` — schema additions
- `server/src/services/enrichment/BackgroundEnricher.ts` — parallel track loop, `drainNow()` method
- `server/src/services/enrichment/DefaultEnrichmentFetcher.ts` — composite wiring
- `server/src/services/broadcast/types.ts` — `genreNames`, `featureSlots`, `tier`
- `server/src/services/broadcast/ManifestBuilder.ts` — assign `tier` on slots from `featureSlots`
- `server/src/services/broadcast/TrackSequencer.ts` — response schema, prompt, featureSlots fixups
- `server/src/services/broadcast/SequenceCache.ts` — persist `featureSlots` in cache value
- `server/src/services/broadcast/SegmentScriptBuilder.ts` — tier routing, playbook, guardrail, richer user prompt
- `server/src/services/broadcast/BroadcastOrchestrator.ts` — new pipeline order, parallel capped segment gen
- `server/src/routes/broadcast.ts` — Zod schema extension
- `server/.env.example` — new env var placeholders

### Modified files (client / native)
- `src/engines/BroadcastPlayer.types.ts` — mirror schema additions
- `src/services/MusicKitPlayer.ts` — surface `genreNames` from native bridge
- `modules/expo-music-kit/index.ts` — type surface for `genreNames`
- `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` — include `genreNames` in serialized track dict
- `src/components/broadcast/TuningInOverlay.tsx` — cycling status label

---

## Task 1: Genre Family Module

**Files:**
- Create: `server/src/services/broadcast/GenreFamily.ts`
- Test: `server/__tests__/broadcast/GenreFamily.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/broadcast/GenreFamily.test.ts`:

```ts
import { normalizeGenreFamily, GENRE_PLAYBOOK, type GenreFamily } from '../../src/services/broadcast/GenreFamily';

describe('normalizeGenreFamily', () => {
  it('returns generic for empty input', () => {
    expect(normalizeGenreFamily()).toBe('generic');
    expect(normalizeGenreFamily('')).toBe('generic');
    expect(normalizeGenreFamily([])).toBe('generic');
  });

  it.each<[string, GenreFamily]>([
    ['jazz', 'jazz'],
    ['post-bop', 'jazz'],
    ['bossa nova', 'jazz'],
    ['hip-hop', 'hipHop'],
    ['hip hop', 'hipHop'],
    ['trap', 'hipHop'],
    ['boom-bap', 'hipHop'],
    ['neo-soul', 'rnb'],
    ['Motown', 'rnb'],
    ['funk', 'rnb'],
    ['R&B', 'rnb'],
    ['rock', 'rock'],
    ['indie', 'rock'],
    ['punk', 'rock'],
    ['deep house', 'electronic'],
    ['EDM', 'electronic'],
    ['ambient', 'electronic'],
    ['folk', 'folk'],
    ['country', 'folk'],
    ['singer-songwriter', 'folk'],
    ['pop', 'pop'],
    ['K-pop', 'pop'],
    ['Afrobeats', 'global'],
    ['reggaeton', 'global'],
    ['gospel', 'gospel'],
    ['praise and worship', 'gospel'],
  ])('normalizes %s → %s', (raw, expected) => {
    expect(normalizeGenreFamily(raw)).toBe(expected);
  });

  it('routes gospel before rnb (priority)', () => {
    expect(normalizeGenreFamily('black gospel soul')).toBe('gospel');
  });

  it('accepts string arrays', () => {
    expect(normalizeGenreFamily(['Alternative/Indie', 'Rock'])).toBe('rock');
  });

  it('falls back to generic on unknown', () => {
    expect(normalizeGenreFamily('kosmische')).toBe('generic');
  });
});

describe('GENRE_PLAYBOOK', () => {
  it('has entries for all 10 families', () => {
    const families: GenreFamily[] = [
      'jazz', 'hipHop', 'rnb', 'rock', 'electronic',
      'folk', 'pop', 'global', 'gospel', 'generic',
    ];
    for (const f of families) {
      expect(GENRE_PLAYBOOK[f]).toBeDefined();
      expect(GENRE_PLAYBOOK[f].length).toBeGreaterThan(0);
    }
  });

  it('entries are short (under 400 chars)', () => {
    for (const snippet of Object.values(GENRE_PLAYBOOK)) {
      expect(snippet.length).toBeLessThan(400);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/GenreFamily.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write implementation**

Create `server/src/services/broadcast/GenreFamily.ts`:

```ts
export type GenreFamily =
  | 'jazz' | 'hipHop' | 'rnb' | 'rock' | 'electronic'
  | 'folk' | 'pop' | 'global' | 'gospel' | 'generic';

/**
 * Map a raw genre string (from MusicBrainz, Apple Music, or Last.fm) to one
 * of our playbook families. Keyword matching with priority order — gospel
 * before rnb so "gospel soul" routes to gospel; electronic before pop for
 * electro-pop crossovers; hipHop before rnb for hip-hop soul.
 */
export function normalizeGenreFamily(raw?: string | string[]): GenreFamily {
  if (!raw) return 'generic';
  const s = (Array.isArray(raw) ? raw.join(' ') : raw).toLowerCase();
  if (!s.trim()) return 'generic';
  if (/gospel|spirituals?|praise.+worship|quartet.+gospel/.test(s)) return 'gospel';
  if (/jazz|bebop|bossa|fusion|big band|post[- ]?bop/.test(s)) return 'jazz';
  if (/hip[- ]?hop|rap|trap|drill|boom[- ]?bap/.test(s)) return 'hipHop';
  if (/r&?b|soul|motown|quiet storm|neo[- ]?soul|funk/.test(s)) return 'rnb';
  if (/electronic|edm|house|techno|trance|dnb|drum.?and.?bass|dubstep|garage|ambient|idm/.test(s)) return 'electronic';
  if (/afrobeat|reggae|reggaeton|cumbia|samba|latin|highlife|global|world/.test(s)) return 'global';
  if (/folk|country|bluegrass|americana|singer.?songwriter/.test(s)) return 'folk';
  if (/rock|punk|grunge|indie|alternative|metal/.test(s)) return 'rock';
  if (/pop|k-?pop|j-?pop/.test(s)) return 'pop';
  return 'generic';
}

export const GENRE_PLAYBOOK: Record<GenreFamily, string> = {
  jazz: 'Speak with quiet authority. Name sidemen, labels, sessions. Use "changes," "voicing," "modal." Reference eras — Blue Note, post-bop, spiritual, fusion. Respect craft over hype.',
  hipHop: 'Know the producers. Know the samples. Know the region. Use "beat," "flip," "pocket," "bars." Distinguish boom-bap from trap from drill when relevant. Credit where it\u2019s due \u2014 this genre runs on lineage.',
  rnb: 'Linger on voice. Name the run, the vamp, the break. Reference the lineage \u2014 Motown, Stax, Philly, quiet storm, neo-soul. Groove talk, not chart talk.',
  rock: 'Riffs, gear, session work, scenes. Distinguish classic rock from indie from punk from alternative. Talk like someone who\u2019s been to the shows.',
  electronic: 'Know the sub-genre (deep house \u2260 UK garage \u2260 dnb \u2260 ambient). Talk build and drop, pad, arpeggio, sample. Reference the scene \u2014 Detroit, Berlin, Chicago, London.',
  folk: 'Songwriting craft. Fingerpicking, arrangement, lyrical economy. Respect the tradition without turning it into a history lesson.',
  pop: 'Hooks and songwriters. Acknowledge the craft \u2014 pop is hard. Name producers and co-writers when known. Era-aware (Max Martin decade, solo era, K-pop wave).',
  global: 'Lead with respect. Use the culture\u2019s own vocabulary (Afrobeats, reggaeton, cumbia, highlife, bossa). Never exoticize. Name-check the lineage within the tradition, not from outside.',
  gospel: 'Reverent but alive. Name the tradition \u2014 quartet, contemporary, praise & worship, choir. Use the vocabulary: testimony, shout, call-and-response, spirit. Respect the lineage from Thomas Dorsey and Mahalia through Kirk Franklin and Fred Hammond without flattening it.',
  generic: 'Thoughtful, curious, warm. Lean on the perceptual when you don\u2019t know the lore.',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/GenreFamily.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/GenreFamily.ts server/__tests__/broadcast/GenreFamily.test.ts
git commit -m "feat(broadcast): add GenreFamily type, normalizer, and playbook"
```

---

## Task 2: Audio Features Formatter

**Files:**
- Create: `server/src/services/broadcast/audio-features-format.ts`
- Test: `server/__tests__/broadcast/audio-features-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/broadcast/audio-features-format.test.ts`:

```ts
import { formatAudioFeatures, type AudioFeatures } from '../../src/services/broadcast/audio-features-format';

describe('formatAudioFeatures', () => {
  it('formats tempo, key, valence, energy', () => {
    const f: AudioFeatures = {
      tempo: 72, key: 9, mode: 0, valence: 0.28, energy: 0.4, danceability: 0.3,
    };
    const out = formatAudioFeatures(f);
    expect(out).toContain('72 BPM');
    expect(out).toContain('A minor');
    expect(out).toContain('downcast');
    expect(out).toContain('restrained');
  });

  it('handles major key', () => {
    const f: AudioFeatures = {
      tempo: 120, key: 0, mode: 1, valence: 0.9, energy: 0.9, danceability: 0.8,
    };
    expect(formatAudioFeatures(f)).toContain('C major');
    expect(formatAudioFeatures(f)).toContain('bright');
    expect(formatAudioFeatures(f)).toContain('driving');
  });

  it('omits tempo below 1', () => {
    const f: AudioFeatures = {
      tempo: 0, key: 0, mode: 1, valence: 0.5, energy: 0.5, danceability: 0.5,
    };
    expect(formatAudioFeatures(f)).not.toContain('BPM');
  });

  it('returns non-empty string for all-default inputs', () => {
    const f: AudioFeatures = {
      tempo: 100, key: 5, mode: 1, valence: 0.5, energy: 0.5, danceability: 0.5,
    };
    expect(formatAudioFeatures(f).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/audio-features-format.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write implementation**

Create `server/src/services/broadcast/audio-features-format.ts`:

```ts
export interface AudioFeatures {
  tempo: number;
  valence: number;
  energy: number;
  danceability: number;
  key: number;
  mode: number;
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function valenceBand(v: number): string {
  if (v < 0.35) return 'downcast';
  if (v < 0.55) return 'reflective';
  if (v < 0.75) return 'warm';
  return 'bright';
}

function energyBand(e: number): string {
  if (e < 0.35) return 'restrained';
  if (e < 0.65) return 'steady';
  return 'driving';
}

export function formatAudioFeatures(f: AudioFeatures): string {
  const parts: string[] = [];
  if (f.tempo >= 1) parts.push(`${Math.round(f.tempo)} BPM`);
  const pitch = PITCH_CLASSES[f.key] ?? '';
  if (pitch) parts.push(`${pitch} ${f.mode === 1 ? 'major' : 'minor'}`);
  parts.push(`${valenceBand(f.valence)} mood`);
  parts.push(`${energyBand(f.energy)} energy`);
  return parts.join(', ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/audio-features-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/audio-features-format.ts server/__tests__/broadcast/audio-features-format.test.ts
git commit -m "feat(broadcast): add audio features formatter helper"
```

---

## Task 3: HTTP Timeout Helper + Shared Rate Limiter

**Files:**
- Create: `server/src/services/enrichment/http-timeout.ts`
- Create: `server/src/services/enrichment/rate-limiter.ts`
- Test: `server/__tests__/enrichment/http-timeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/enrichment/http-timeout.test.ts`:

```ts
import { fetchWithTimeout } from '../../src/services/enrichment/http-timeout';

describe('fetchWithTimeout', () => {
  it('resolves when underlying fetch resolves in time', async () => {
    const fakeFetch = jest.fn().mockResolvedValue(new Response('ok'));
    const res = await fetchWithTimeout('https://example.com', { timeoutMs: 1000, fetchImpl: fakeFetch });
    expect(await res.text()).toBe('ok');
  });

  it('rejects when underlying fetch exceeds timeout', async () => {
    const slow = () => new Promise((_r, reject) => {
      setTimeout(() => reject(new Error('cancelled')), 50);
    });
    const fakeFetch: typeof fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        slow().catch(reject);
      });
    }) as typeof fetch;
    await expect(
      fetchWithTimeout('https://example.com', { timeoutMs: 10, fetchImpl: fakeFetch }),
    ).rejects.toThrow(/abort/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/http-timeout.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the timeout helper**

Create `server/src/services/enrichment/http-timeout.ts`:

```ts
export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * fetch() wrapper with AbortController-based timeout. Default timeout is 10s
 * to match our per-call budget for enrichment API requests.
 */
export async function fetchWithTimeout(
  url: string | URL,
  opts: FetchWithTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, fetchImpl = fetch, ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_ENRICHMENT_TIMEOUT_MS = 10_000;
```

- [ ] **Step 4: Create the shared rate limiter**

Create `server/src/services/enrichment/rate-limiter.ts`:

```ts
/**
 * Shared promise-chain serializer with minimum interval between calls.
 * Extracted from DefaultEnrichmentFetcher so each source fetcher can use
 * its own queue without duplicating the class.
 */
export class RateLimitedFetcher {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await new Promise(r => setTimeout(r, this.minIntervalMs));
      return fn();
    });
    this.queue = result.catch(() => {});
    return result as Promise<T>;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/http-timeout.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/enrichment/http-timeout.ts server/src/services/enrichment/rate-limiter.ts server/__tests__/enrichment/http-timeout.test.ts
git commit -m "feat(enrichment): add HTTP timeout helper and shared RateLimitedFetcher"
```

---

## Task 4: Extract Genius + MusicBrainz Fetchers

Refactor-only: pull the existing `fetchGenius` / `fetchMusicBrainz` methods from `DefaultEnrichmentFetcher` into their own modules sharing the new `RateLimitedFetcher`.

**Files:**
- Create: `server/src/services/enrichment/fetchers/GeniusFetcher.ts`
- Create: `server/src/services/enrichment/fetchers/MusicBrainzFetcher.ts`
- Modify: `server/src/services/enrichment/DefaultEnrichmentFetcher.ts`

- [ ] **Step 1: Create the Genius fetcher**

Create `server/src/services/enrichment/fetchers/GeniusFetcher.ts`:

```ts
import type { EnrichmentRecord } from '../EnrichmentCache';
import { RateLimitedFetcher } from '../rate-limiter';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const GENIUS_MIN_INTERVAL_MS = 1100;

export interface GeniusFetcherDeps {
  token?: string;
  fetchImpl?: typeof fetch;
}

export class GeniusFetcher {
  private readonly queue = new RateLimitedFetcher(GENIUS_MIN_INTERVAL_MS);

  constructor(private readonly deps: GeniusFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    const token = this.deps.token ?? process.env.GENIUS_ACCESS_TOKEN;
    if (!token) return null;
    return this.queue.schedule(async () => {
      const query = encodeURIComponent(`${title} ${artist}`);
      const searchRes = await fetchWithTimeout(
        `https://api.genius.com/search?q=${query}`,
        {
          timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
          fetchImpl: this.deps.fetchImpl,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json() as {
        response?: { hits?: Array<{ result: { id: number } }> };
      };
      const topId = searchData.response?.hits?.[0]?.result?.id;
      if (!topId) return null;
      const detailRes = await fetchWithTimeout(
        `https://api.genius.com/songs/${topId}`,
        {
          timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
          fetchImpl: this.deps.fetchImpl,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!detailRes.ok) return null;
      const detail = await detailRes.json() as {
        response?: { song?: {
          producer_artists?: Array<{ name: string }>;
          release_date_for_display?: string;
          song_relationships?: Array<{
            relationship_type: string;
            songs?: Array<{ title: string; primary_artist?: { name: string } }>;
          }>;
        } };
      };
      const song = detail.response?.song;
      if (!song) return null;
      const out: Partial<EnrichmentRecord> = {};
      if (song.producer_artists?.length) {
        out.producer = song.producer_artists.map(p => p.name).join(', ');
      }
      if (song.release_date_for_display) {
        const yearMatch = song.release_date_for_display.match(/\b(\d{4})\b/);
        if (yearMatch) out.releaseYear = yearMatch[1];
      }
      const samples = song.song_relationships?.find(r => r.relationship_type === 'samples');
      const sampled = samples?.songs?.[0];
      if (sampled) {
        out.sample = `Samples "${sampled.title}" by ${sampled.primary_artist?.name ?? 'unknown'}`;
      }
      if (Object.keys(out).length === 0) return null;
      out.source = 'genius';
      return out;
    });
  }
}
```

- [ ] **Step 2: Create the MusicBrainz fetcher**

Create `server/src/services/enrichment/fetchers/MusicBrainzFetcher.ts`:

```ts
import type { EnrichmentRecord } from '../EnrichmentCache';
import { RateLimitedFetcher } from '../rate-limiter';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const MB_MIN_INTERVAL_MS = 1100;

const MOOD_WORDS = new Set([
  'chill', 'mellow', 'upbeat', 'melancholy', 'moody', 'energetic',
  'warm', 'bright', 'dark', 'romantic', 'aggressive', 'smooth',
  'dreamy', 'intimate', 'reflective', 'hopeful', 'sad', 'happy',
]);

export interface MusicBrainzFetcherDeps {
  fetchImpl?: typeof fetch;
}

export class MusicBrainzFetcher {
  private readonly queue = new RateLimitedFetcher(MB_MIN_INTERVAL_MS);

  constructor(private readonly deps: MusicBrainzFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.queue.schedule(async () => {
      const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
      const res = await fetchWithTimeout(
        `https://musicbrainz.org/ws/2/recording/?query=${query}&limit=1&fmt=json`,
        {
          timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
          fetchImpl: this.deps.fetchImpl,
          headers: {
            'User-Agent': 'CleoRadioApp/1.0 (bworthy89@gmail.com)',
            Accept: 'application/json',
          },
        },
      );
      if (!res.ok) return null;
      const data = await res.json() as {
        recordings?: Array<{
          tags?: Array<{ name: string; count?: number }>;
          'first-release-date'?: string;
        }>;
      };
      const rec = data.recordings?.[0];
      if (!rec) return null;
      const sortedTags = (rec.tags ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .map(t => t.name);
      const moodTags = sortedTags.filter(t => MOOD_WORDS.has(t.toLowerCase()));
      const out: Partial<EnrichmentRecord> = {};
      if (sortedTags.length) out.genre = sortedTags[0];
      if (moodTags.length) out.moodTags = moodTags.slice(0, 5);
      if (rec['first-release-date']) {
        out.releaseYear = rec['first-release-date'].substring(0, 4);
      }
      if (Object.keys(out).length === 0) return null;
      out.source = 'musicbrainz';
      return out;
    });
  }
}
```

- [ ] **Step 3: Gut DefaultEnrichmentFetcher to compose the new classes**

Replace contents of `server/src/services/enrichment/DefaultEnrichmentFetcher.ts`:

```ts
import type { EnrichmentFetcher } from './BackgroundEnricher';
import type { EnrichmentRecord } from './EnrichmentCache';
import { GeniusFetcher } from './fetchers/GeniusFetcher';
import { MusicBrainzFetcher } from './fetchers/MusicBrainzFetcher';

export class DefaultEnrichmentFetcher implements EnrichmentFetcher {
  private readonly genius = new GeniusFetcher();
  private readonly mb = new MusicBrainzFetcher();

  async fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.genius.fetch(title, artist);
  }

  async fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.mb.fetch(title, artist);
  }
}
```

- [ ] **Step 4: Run the existing enrichment test suite to verify refactor didn't break anything**

Run: `cd server && npx jest __tests__/enrichment/`
Expected: PASS (all existing tests green).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/fetchers/GeniusFetcher.ts server/src/services/enrichment/fetchers/MusicBrainzFetcher.ts server/src/services/enrichment/DefaultEnrichmentFetcher.ts
git commit -m "refactor(enrichment): extract Genius and MusicBrainz fetchers into modules"
```

---

## Task 5: Wikipedia Fetcher

**Files:**
- Create: `server/src/services/enrichment/fetchers/WikipediaFetcher.ts`
- Test: `server/__tests__/enrichment/fetchers/WikipediaFetcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/enrichment/fetchers/WikipediaFetcher.test.ts`:

```ts
import { WikipediaFetcher } from '../../../src/services/enrichment/fetchers/WikipediaFetcher';

function mockFetchMap(map: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    for (const [pattern, body] of Object.entries(map)) {
      if (href.includes(pattern)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('WikipediaFetcher', () => {
  it('returns summary + notable facts from a successful search', async () => {
    const fakeFetch = mockFetchMap({
      '/search/title': { pages: [{ key: 'Adore_(Prince_song)', title: 'Adore (Prince song)' }] },
      '/page/summary/': { extract: 'Adore is a 1987 song by Prince from Sign o\u2019 the Times.' },
      '/page/html/': ('<h2>Background</h2><p>Prince recorded the track at Paisley Park.</p>' +
                      '<h2>Recording</h2><p>The song uses a falsetto vocal throughout.</p>'),
    });
    // page/html endpoint returns text not JSON; adjust mock:
    const mixedFetch: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/page/html/')) {
        return new Response(
          '<h2>Background</h2><p>Prince recorded the track at Paisley Park.</p>' +
          '<h2>Recording</h2><p>The song uses a falsetto vocal throughout.</p>',
          { status: 200 },
        );
      }
      return fakeFetch(url, {});
    }) as typeof fetch;

    const w = new WikipediaFetcher({ fetchImpl: mixedFetch });
    const result = await w.fetch('Adore', 'Prince');
    expect(result?.wikipediaSummary).toContain('Adore is a 1987 song');
    expect(result?.notableFacts?.length ?? 0).toBeGreaterThan(0);
    expect(result?.source).toBe('wikipedia');
  });

  it('returns null when search yields no results', async () => {
    const fakeFetch = mockFetchMap({ '/search/title': { pages: [] } });
    const w = new WikipediaFetcher({ fetchImpl: fakeFetch });
    expect(await w.fetch('Obscure Track', 'Unknown')).toBeNull();
  });

  it('returns null when summary fetch fails', async () => {
    const fakeFetch: typeof fetch = (async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/search/title')) {
        return new Response(JSON.stringify({ pages: [{ key: 'x', title: 'x' }] }), { status: 200 });
      }
      return new Response('server error', { status: 500 });
    }) as typeof fetch;
    const w = new WikipediaFetcher({ fetchImpl: fakeFetch });
    expect(await w.fetch('X', 'Y')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/fetchers/WikipediaFetcher.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write implementation**

Create `server/src/services/enrichment/fetchers/WikipediaFetcher.ts`:

```ts
import type { EnrichmentRecord } from '../EnrichmentCache';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const NOTABLE_SECTIONS = ['Background', 'Recording', 'Composition', 'Release', 'Writing'];
const MAX_NOTABLE_FACTS = 3;

export interface WikipediaFetcherDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Wikipedia enrichment via the REST v1 search + summary + html endpoints.
 * One search call to find the best page, one summary call for the intro,
 * one html call to mine Background / Recording sections. All three are fast
 * and unauthenticated. No rate limiting needed for our scale.
 */
export class WikipediaFetcher {
  constructor(private readonly deps: WikipediaFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    const f = this.deps.fetchImpl;
    try {
      const pageKey = await this.searchBestPage(`${title} ${artist}`, f);
      if (!pageKey) return null;
      const summary = await this.fetchSummary(pageKey, f);
      if (!summary) return null;
      const notableFacts = await this.fetchNotableFacts(pageKey, f);
      const out: Partial<EnrichmentRecord> = { wikipediaSummary: summary, source: 'wikipedia' };
      if (notableFacts.length) out.notableFacts = notableFacts;
      return out;
    } catch {
      return null;
    }
  }

  private async searchBestPage(query: string, fetchImpl?: typeof fetch): Promise<string | null> {
    const url = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetchWithTimeout(url, { timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS, fetchImpl });
    if (!res.ok) return null;
    const data = await res.json() as { pages?: Array<{ key: string; title: string }> };
    return data.pages?.[0]?.key ?? null;
  }

  private async fetchSummary(pageKey: string, fetchImpl?: typeof fetch): Promise<string | null> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageKey)}`;
    const res = await fetchWithTimeout(url, { timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS, fetchImpl });
    if (!res.ok) return null;
    const data = await res.json() as { extract?: string };
    const extract = (data.extract ?? '').trim();
    if (!extract) return null;
    return extract.slice(0, 600);
  }

  private async fetchNotableFacts(pageKey: string, fetchImpl?: typeof fetch): Promise<string[]> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(pageKey)}`;
    const res = await fetchWithTimeout(url, { timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS, fetchImpl });
    if (!res.ok) return [];
    const html = await res.text();
    const facts: string[] = [];
    for (const section of NOTABLE_SECTIONS) {
      const regex = new RegExp(`<h2[^>]*>\\s*${section}[^<]*<\\/h2>\\s*<p>([^<]+)<`, 'i');
      const match = html.match(regex);
      if (match?.[1]) {
        const text = this.stripHtml(match[1]).trim();
        if (text.length > 30) {
          facts.push(text.slice(0, 400));
          if (facts.length >= MAX_NOTABLE_FACTS) break;
        }
      }
    }
    return facts;
  }

  private stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/fetchers/WikipediaFetcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/fetchers/WikipediaFetcher.ts server/__tests__/enrichment/fetchers/WikipediaFetcher.test.ts
git commit -m "feat(enrichment): add WikipediaFetcher with search + summary + section mining"
```

---

## Task 6: Last.fm Fetcher

**Files:**
- Create: `server/src/services/enrichment/fetchers/LastFmFetcher.ts`
- Test: `server/__tests__/enrichment/fetchers/LastFmFetcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/enrichment/fetchers/LastFmFetcher.test.ts`:

```ts
import { LastFmFetcher } from '../../../src/services/enrichment/fetchers/LastFmFetcher';

function mockFetch(responses: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('track.getInfo')) {
      return new Response(JSON.stringify(responses.track), { status: 200 });
    }
    if (href.includes('artist.getInfo')) {
      return new Response(JSON.stringify(responses.artist), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('LastFmFetcher', () => {
  it('returns tags, moodTags, and artistBio when data is available', async () => {
    const fetchImpl = mockFetch({
      track: {
        track: {
          toptags: { tag: [{ name: 'chill' }, { name: 'neo-soul' }, { name: 'mellow' }] },
        },
      },
      artist: {
        artist: {
          bio: { summary: 'A soulful singer with a distinctive voice. <a>Read more</a>' },
        },
      },
    });
    const f = new LastFmFetcher({ apiKey: 'test-key', fetchImpl });
    const result = await f.fetch('Track', 'Artist');
    expect(result?.moodTags).toContain('chill');
    expect(result?.artistBio).toContain('soulful singer');
    expect(result?.artistBio).not.toContain('<a>');
    expect(result?.source).toBe('lastfm');
  });

  it('returns null without an API key', async () => {
    const fetchImpl = jest.fn();
    const f = new LastFmFetcher({ apiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await f.fetch('T', 'A')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when both endpoints fail', async () => {
    const fetchImpl: typeof fetch = (async () => new Response('error', { status: 500 })) as typeof fetch;
    const f = new LastFmFetcher({ apiKey: 'k', fetchImpl });
    expect(await f.fetch('T', 'A')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/fetchers/LastFmFetcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `server/src/services/enrichment/fetchers/LastFmFetcher.ts`:

```ts
import type { EnrichmentRecord } from '../EnrichmentCache';
import { RateLimitedFetcher } from '../rate-limiter';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const LASTFM_MIN_INTERVAL_MS = 200;

const MOOD_WORDS = new Set([
  'chill', 'mellow', 'upbeat', 'melancholy', 'moody', 'energetic',
  'warm', 'bright', 'dark', 'romantic', 'aggressive', 'smooth',
  'dreamy', 'intimate', 'reflective', 'hopeful', 'sad', 'happy',
]);

export interface LastFmFetcherDeps {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class LastFmFetcher {
  private readonly queue = new RateLimitedFetcher(LASTFM_MIN_INTERVAL_MS);

  constructor(private readonly deps: LastFmFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    const key = this.deps.apiKey ?? process.env.LASTFM_API_KEY;
    if (!key) return null;
    return this.queue.schedule(async () => {
      const [track, artistInfo] = await Promise.all([
        this.getTrackInfo(title, artist, key),
        this.getArtistInfo(artist, key),
      ]);
      const out: Partial<EnrichmentRecord> = {};
      if (track?.moodTags?.length) out.moodTags = track.moodTags;
      if (artistInfo?.bio) out.artistBio = artistInfo.bio;
      if (Object.keys(out).length === 0) return null;
      out.source = 'lastfm';
      return out;
    });
  }

  private async getTrackInfo(title: string, artist: string, key: string): Promise<{ moodTags?: string[] } | null> {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${key}&format=json`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      track?: { toptags?: { tag?: Array<{ name: string }> } };
    };
    const tags = (data.track?.toptags?.tag ?? []).map(t => t.name);
    const moodTags = tags.filter(t => MOOD_WORDS.has(t.toLowerCase())).slice(0, 5);
    return moodTags.length ? { moodTags } : null;
  }

  private async getArtistInfo(artist: string, key: string): Promise<{ bio?: string } | null> {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(artist)}&api_key=${key}&format=json`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      artist?: { bio?: { summary?: string } };
    };
    const raw = (data.artist?.bio?.summary ?? '').trim();
    if (!raw) return null;
    const stripped = raw
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped ? { bio: stripped.slice(0, 400) } : null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/fetchers/LastFmFetcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/fetchers/LastFmFetcher.ts server/__tests__/enrichment/fetchers/LastFmFetcher.test.ts
git commit -m "feat(enrichment): add LastFmFetcher for mood tags + artist bio"
```

---

## Task 7: Spotify Fetcher

**Files:**
- Create: `server/src/services/enrichment/fetchers/SpotifyFetcher.ts`
- Test: `server/__tests__/enrichment/fetchers/SpotifyFetcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/enrichment/fetchers/SpotifyFetcher.test.ts`:

```ts
import { SpotifyFetcher } from '../../../src/services/enrichment/fetchers/SpotifyFetcher';

function mockSpotifyFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/api/token')) {
      return new Response(JSON.stringify({ access_token: 'fake_token', expires_in: 3600 }), { status: 200 });
    }
    if (href.includes('/v1/search')) {
      return new Response(JSON.stringify(map.search), { status: 200 });
    }
    if (href.includes('/v1/audio-features/')) {
      return new Response(JSON.stringify(map.features), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('SpotifyFetcher', () => {
  it('returns audio features after search + lookup', async () => {
    const fetchImpl = mockSpotifyFetch({
      search: { tracks: { items: [{ id: 'track123' }] } },
      features: {
        tempo: 72.1, valence: 0.28, energy: 0.4,
        danceability: 0.3, key: 9, mode: 0,
      },
    });
    const f = new SpotifyFetcher({ clientId: 'id', clientSecret: 'secret', fetchImpl });
    const result = await f.fetch('Track', 'Artist');
    expect(result?.audioFeatures?.tempo).toBeCloseTo(72.1, 1);
    expect(result?.audioFeatures?.key).toBe(9);
    expect(result?.audioFeatures?.mode).toBe(0);
    expect(result?.source).toBe('spotify');
  });

  it('returns null without credentials', async () => {
    const fetchImpl = jest.fn();
    const f = new SpotifyFetcher({ clientId: undefined, clientSecret: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await f.fetch('T', 'A')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when search yields no hits', async () => {
    const fetchImpl = mockSpotifyFetch({ search: { tracks: { items: [] } }, features: {} });
    const f = new SpotifyFetcher({ clientId: 'i', clientSecret: 's', fetchImpl });
    expect(await f.fetch('T', 'A')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/fetchers/SpotifyFetcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write implementation**

Create `server/src/services/enrichment/fetchers/SpotifyFetcher.ts`:

```ts
import type { EnrichmentRecord } from '../EnrichmentCache';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

export interface SpotifyFetcherDeps {
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export class SpotifyFetcher {
  private token: CachedToken | null = null;

  constructor(private readonly deps: SpotifyFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    const id = this.deps.clientId ?? process.env.SPOTIFY_CLIENT_ID;
    const secret = this.deps.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) return null;
    const token = await this.ensureToken(id, secret);
    if (!token) return null;
    const trackId = await this.searchTrack(title, artist, token);
    if (!trackId) return null;
    const features = await this.fetchFeatures(trackId, token);
    if (!features) return null;
    return { audioFeatures: features, source: 'spotify' };
  }

  private async ensureToken(id: string, secret: string): Promise<string | null> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };
    return this.token.value;
  }

  private async searchTrack(title: string, artist: string, token: string): Promise<string | null> {
    const q = encodeURIComponent(`track:${title} artist:${artist}`);
    const res = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`,
      {
        timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
        fetchImpl: this.deps.fetchImpl,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      tracks?: { items?: Array<{ id: string }> };
    };
    return data.tracks?.items?.[0]?.id ?? null;
  }

  private async fetchFeatures(trackId: string, token: string): Promise<EnrichmentRecord['audioFeatures'] | null> {
    const res = await fetchWithTimeout(
      `https://api.spotify.com/v1/audio-features/${encodeURIComponent(trackId)}`,
      {
        timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
        fetchImpl: this.deps.fetchImpl,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      tempo?: number; valence?: number; energy?: number;
      danceability?: number; key?: number; mode?: number;
    };
    if (
      data.tempo === undefined || data.valence === undefined || data.energy === undefined ||
      data.danceability === undefined || data.key === undefined || data.mode === undefined
    ) return null;
    return {
      tempo: data.tempo,
      valence: data.valence,
      energy: data.energy,
      danceability: data.danceability,
      key: data.key,
      mode: data.mode,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/enrichment/fetchers/SpotifyFetcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/fetchers/SpotifyFetcher.ts server/__tests__/enrichment/fetchers/SpotifyFetcher.test.ts
git commit -m "feat(enrichment): add SpotifyFetcher for audio features"
```

---

## Task 8: EnrichmentRecord Schema Extensions + Composite Wiring

Extend the cached record shape to carry the new fields and wire the new fetchers into `DefaultEnrichmentFetcher` so `BackgroundEnricher` can call them.

**Files:**
- Modify: `server/src/services/enrichment/EnrichmentCache.ts`
- Modify: `server/src/services/enrichment/BackgroundEnricher.ts`
- Modify: `server/src/services/enrichment/DefaultEnrichmentFetcher.ts`
- Modify: `server/.env.example`

- [ ] **Step 1: Extend EnrichmentRecord**

Edit `server/src/services/enrichment/EnrichmentCache.ts`. Replace the existing `EnrichmentRecord` interface with:

```ts
export interface EnrichmentRecord {
  // existing
  genre?: string;
  moodTags?: string[];
  releaseYear?: string;
  producer?: string;
  sample?: string;

  // new
  wikipediaSummary?: string;
  notableFacts?: string[];
  artistBio?: string;
  audioFeatures?: {
    tempo: number;
    valence: number;
    energy: number;
    danceability: number;
    key: number;
    mode: number;
  };

  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'wikipedia' | 'lastfm' | 'spotify' | 'hybrid';
}
```

- [ ] **Step 2: Extend EnrichmentFetcher interface and composite**

Edit `server/src/services/enrichment/BackgroundEnricher.ts`. Change the `EnrichmentFetcher` interface (near top of file) to:

```ts
export interface EnrichmentFetcher {
  fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchWikipedia(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchLastFm(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
  fetchSpotify(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null>;
}
```

Then update `enrichOne` to call all five sources in parallel and merge results. Replace the existing `enrichOne` body with:

```ts
private async enrichOne(track: ManifestTrack): Promise<void> {
  const existing = this.cache.get(track.title, track.artistName);
  if (existing && Date.now() - existing.lastEnrichedAt < REFRESH_THRESHOLD_MS) {
    return;
  }
  const [genius, mb, wiki, lastfm, spotify] = await Promise.all([
    this.fetcher.fetchGenius(track.title, track.artistName).catch(() => null),
    this.fetcher.fetchMusicBrainz(track.title, track.artistName).catch(() => null),
    this.fetcher.fetchWikipedia(track.title, track.artistName).catch(() => null),
    this.fetcher.fetchLastFm(track.title, track.artistName).catch(() => null),
    this.fetcher.fetchSpotify(track.title, track.artistName).catch(() => null),
  ]);
  if (!genius && !mb && !wiki && !lastfm && !spotify) return;
  const merged: Partial<EnrichmentRecord> = {
    ...(mb ?? {}),
    ...(wiki ?? {}),
    ...(lastfm ?? {}),
    ...(spotify ?? {}),
    ...(genius ?? {}),
  };
  const sources = [genius, mb, wiki, lastfm, spotify].filter(x => x != null);
  const source: EnrichmentRecord['source'] = sources.length > 1 ? 'hybrid' : (sources[0]?.source ?? 'hybrid');
  const record: EnrichmentRecord = {
    ...merged,
    lastEnrichedAt: Date.now(),
    source,
  };
  await this.cache.set(track.title, track.artistName, record);
}
```

- [ ] **Step 3: Wire new fetchers into DefaultEnrichmentFetcher**

Replace `server/src/services/enrichment/DefaultEnrichmentFetcher.ts` contents:

```ts
import type { EnrichmentFetcher } from './BackgroundEnricher';
import type { EnrichmentRecord } from './EnrichmentCache';
import { GeniusFetcher } from './fetchers/GeniusFetcher';
import { MusicBrainzFetcher } from './fetchers/MusicBrainzFetcher';
import { WikipediaFetcher } from './fetchers/WikipediaFetcher';
import { LastFmFetcher } from './fetchers/LastFmFetcher';
import { SpotifyFetcher } from './fetchers/SpotifyFetcher';

export class DefaultEnrichmentFetcher implements EnrichmentFetcher {
  private readonly genius = new GeniusFetcher();
  private readonly mb = new MusicBrainzFetcher();
  private readonly wiki = new WikipediaFetcher();
  private readonly lastfm = new LastFmFetcher();
  private readonly spotify = new SpotifyFetcher();

  fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.genius.fetch(title, artist);
  }
  fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.mb.fetch(title, artist);
  }
  fetchWikipedia(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.wiki.fetch(title, artist);
  }
  fetchLastFm(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.lastfm.fetch(title, artist);
  }
  fetchSpotify(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.spotify.fetch(title, artist);
  }
}
```

- [ ] **Step 4: Add env var placeholders to .env.example**

Read `server/.env.example` first, then append (if not already present):

```
# Last.fm — track tags and artist bio for enrichment; optional
LASTFM_API_KEY=

# Spotify — audio features (tempo, valence, energy, key); optional
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

- [ ] **Step 5: Update existing BackgroundEnricher test mock to cover new sources**

Edit `server/__tests__/enrichment/BackgroundEnricher.test.ts`. Wherever the test creates a mock `EnrichmentFetcher`, add stubs for the new methods returning `null`. For example, any place like `const fetcher = { fetchGenius: ..., fetchMusicBrainz: ... };` must also include `fetchWikipedia: async () => null, fetchLastFm: async () => null, fetchSpotify: async () => null`.

- [ ] **Step 6: Run all enrichment tests to verify no regressions**

Run: `cd server && npx jest __tests__/enrichment/`
Expected: PASS (all existing tests plus new ones green).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/enrichment/EnrichmentCache.ts server/src/services/enrichment/BackgroundEnricher.ts server/src/services/enrichment/DefaultEnrichmentFetcher.ts server/.env.example server/__tests__/enrichment/BackgroundEnricher.test.ts
git commit -m "feat(enrichment): wire Wikipedia, Last.fm, Spotify into enricher; extend record schema"
```

---

## Task 9: Parallel Enrichment + drainNow()

Restructure `BackgroundEnricher` so tracks enrich in parallel, and add a `drainNow(tracks)` method the orchestrator can `await` before segment generation.

**Files:**
- Modify: `server/src/services/enrichment/BackgroundEnricher.ts`
- Modify: `server/__tests__/enrichment/BackgroundEnricher.test.ts`

- [ ] **Step 1: Add failing test for drainNow**

Append to `server/__tests__/enrichment/BackgroundEnricher.test.ts`:

```ts
describe('BackgroundEnricher.drainNow', () => {
  it('enriches all tracks in parallel and resolves when done', async () => {
    const calls: string[] = [];
    const mockFetcher: EnrichmentFetcher = {
      fetchGenius: async (t) => { calls.push(`genius:${t}`); return { producer: 'P' }; },
      fetchMusicBrainz: async () => null,
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
      fetchSpotify: async () => null,
    };
    const cache = new InMemoryCache();
    const enricher = new BackgroundEnricher(cache as unknown as EnrichmentCache, mockFetcher);
    const tracks: ManifestTrack[] = [
      { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 0 },
      { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 0 },
      { id: '3', title: 'C', artistName: 'X', albumTitle: '', duration: 0 },
    ];
    await enricher.drainNow(tracks);
    expect(cache.data.size).toBe(3);
  });

  it('skips already-cached tracks within refresh window', async () => {
    const mockFetcher: EnrichmentFetcher = {
      fetchGenius: jest.fn().mockResolvedValue({ producer: 'P' }),
      fetchMusicBrainz: async () => null,
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
      fetchSpotify: async () => null,
    };
    const cache = new InMemoryCache();
    cache.data.set('a|x', {
      producer: 'Existing',
      lastEnrichedAt: Date.now(),
      source: 'genius',
    });
    const enricher = new BackgroundEnricher(cache as unknown as EnrichmentCache, mockFetcher);
    await enricher.drainNow([
      { id: '1', title: 'a', artistName: 'x', albumTitle: '', duration: 0 },
    ]);
    expect(mockFetcher.fetchGenius).not.toHaveBeenCalled();
  });
});
```

You may need `InMemoryCache` helper — add it to the existing test file if not present:

```ts
class InMemoryCache {
  data = new Map<string, EnrichmentRecord>();
  get(title: string, artist: string) {
    return this.data.get(`${title.toLowerCase()}|${artist.toLowerCase()}`) ?? null;
  }
  async set(title: string, artist: string, r: EnrichmentRecord) {
    this.data.set(`${title.toLowerCase()}|${artist.toLowerCase()}`, r);
  }
  async load() {}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx jest __tests__/enrichment/BackgroundEnricher.test.ts`
Expected: FAIL with "drainNow is not a function" or similar.

- [ ] **Step 3: Add drainNow and keep enqueue backward-compatible**

Edit `server/src/services/enrichment/BackgroundEnricher.ts`. Replace the class body (keeping imports and REFRESH_THRESHOLD_MS at top) with:

```ts
export class BackgroundEnricher {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly cache: EnrichmentCache,
    private readonly fetcher: EnrichmentFetcher,
  ) {}

  /**
   * Fire-and-forget enrichment. Serializes across tracks behind a single
   * chain; errors per track are swallowed. Use this when the caller does not
   * need to wait on completion (e.g. warm-up after a re-bake).
   */
  enqueue(tracks: ManifestTrack[]): void {
    for (const track of tracks) {
      this.queue = this.queue.then(() =>
        this.enrichOne(track).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[BackgroundEnricher] "${track.title}" by ${track.artistName} failed: ${msg}`);
        }),
      );
    }
  }

  /**
   * Awaitable drain: enrich tracks in parallel. Returns when all tracks have
   * been processed (or skipped as already-cached). Used by the orchestrator
   * as a synchronous pre-step before segment generation. Each track runs all
   * source fetchers in parallel; across tracks, each source's rate limiter
   * bucket serializes calls within the shared batch.
   */
  async drainNow(tracks: ManifestTrack[]): Promise<void> {
    await Promise.all(
      tracks.map(track =>
        this.enrichOne(track).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[BackgroundEnricher] "${track.title}" by ${track.artistName} failed: ${msg}`);
        }),
      ),
    );
  }

  /** @deprecated Use drainNow. Preserved for legacy fire-and-forget callers. */
  async drain(): Promise<void> {
    await this.queue;
  }

  private async enrichOne(track: ManifestTrack): Promise<void> {
    const existing = this.cache.get(track.title, track.artistName);
    if (existing && Date.now() - existing.lastEnrichedAt < REFRESH_THRESHOLD_MS) {
      return;
    }
    const [genius, mb, wiki, lastfm, spotify] = await Promise.all([
      this.fetcher.fetchGenius(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchMusicBrainz(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchWikipedia(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchLastFm(track.title, track.artistName).catch(() => null),
      this.fetcher.fetchSpotify(track.title, track.artistName).catch(() => null),
    ]);
    if (!genius && !mb && !wiki && !lastfm && !spotify) return;
    const merged: Partial<EnrichmentRecord> = {
      ...(mb ?? {}),
      ...(wiki ?? {}),
      ...(lastfm ?? {}),
      ...(spotify ?? {}),
      ...(genius ?? {}),
    };
    const sources = [genius, mb, wiki, lastfm, spotify].filter(x => x != null);
    const source: EnrichmentRecord['source'] = sources.length > 1 ? 'hybrid' : (sources[0]?.source ?? 'hybrid');
    const record: EnrichmentRecord = {
      ...merged,
      lastEnrichedAt: Date.now(),
      source,
    };
    await this.cache.set(track.title, track.artistName, record);
  }
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `cd server && npx jest __tests__/enrichment/BackgroundEnricher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/enrichment/BackgroundEnricher.ts server/__tests__/enrichment/BackgroundEnricher.test.ts
git commit -m "feat(enrichment): add drainNow() with parallel-across-tracks enrichment"
```

---

## Task 10: ManifestTrack.genreNames + Zod Schema

Add optional `genreNames` to `ManifestTrack` and the broadcast-create Zod schema.

**Files:**
- Modify: `server/src/services/broadcast/types.ts`
- Modify: `server/src/routes/broadcast.ts`
- Modify: `server/__tests__/routes/` (add a Zod test if none exists for this field)

- [ ] **Step 1: Extend ManifestTrack**

Edit `server/src/services/broadcast/types.ts`. Change `ManifestTrack` to:

```ts
export interface ManifestTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  artworkUrl?: string;
  /** Apple Music genre tags as surfaced from the client's MusicKit bridge.
   *  Server-side fallback when MusicBrainz / Last.fm don't return a genre.
   *  Optional for backward compatibility with pre-upgrade clients. */
  genreNames?: string[];
}
```

- [ ] **Step 2: Find the existing Zod schema for broadcast create**

Run: `grep -n "ManifestTrack\|tracks:" server/src/routes/broadcast.ts`
Identify where the Zod schema for `tracks` is defined.

- [ ] **Step 3: Extend the Zod track object**

Edit `server/src/routes/broadcast.ts`. Locate the Zod track object (it currently has id, title, artistName, albumTitle, duration, artworkUrl). Add:

```ts
genreNames: z.array(z.string().max(100)).max(10).optional(),
```

The constraints: max 100 chars per genre string, max 10 genres per track — keeps adversarial inputs bounded.

- [ ] **Step 4: Run broadcast route tests**

Run: `cd server && npx jest __tests__/routes/`
Expected: PASS (existing route tests still green; genreNames is optional).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/types.ts server/src/routes/broadcast.ts
git commit -m "feat(broadcast): add ManifestTrack.genreNames + Zod schema"
```

---

## Task 11: Manifest featureSlots + SegmentSlot tier

Extend the manifest + slot types to carry the new tiering info.

**Files:**
- Modify: `server/src/services/broadcast/types.ts`

- [ ] **Step 1: Add SegmentTier type and extend slot + manifest**

Edit `server/src/services/broadcast/types.ts`. After the existing `SegmentSlotKind` type, add:

```ts
export type SegmentTier = 'cold_open' | 'fact_bridge' | 'deep_dive' | 'sign_off';
```

Change `SegmentSlot` to include tier:

```ts
export interface SegmentSlot {
  index: number;
  kind: SegmentSlotKind;
  beforeTrackId?: string;
  afterTrackId?: string;
  variantCount: number;
  status: 'pending' | 'ready' | 'failed';
  audioUrls?: string[];
  /** Tier used to build this slot's prompt. 'cold_open' / 'sign_off' match
   *  their kind; transitions are either 'fact_bridge' or 'deep_dive' based
   *  on the sequencer's featureSlots. Optional for backward compatibility. */
  tier?: SegmentTier;
}
```

Change `Manifest` to include featureSlots:

```ts
export interface Manifest {
  broadcastId: string;
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  createdAt: number;
  tracks: ManifestTrack[];
  segmentSlots: SegmentSlot[];
  /** Transition slot indices nominated for deep-dive treatment by the
   *  sequencer. Valid range: 1..N-1 where N is the track count. Optional
   *  for backward compat with manifests created before tiering. */
  featureSlots?: number[];
}
```

- [ ] **Step 2: Run all broadcast-related tests to verify no breakage**

Run: `cd server && npx jest __tests__/broadcast/`
Expected: PASS (existing tests use `ManifestTrack` without `featureSlots` / `tier` — optional fields don't break them).

- [ ] **Step 3: Commit**

```bash
git add server/src/services/broadcast/types.ts
git commit -m "feat(broadcast): add SegmentTier type + Manifest.featureSlots + SegmentSlot.tier"
```

---

## Task 12: ManifestBuilder Assigns tier

Populate `tier` on each segment slot based on the incoming `featureSlots` array.

**Files:**
- Modify: `server/src/services/broadcast/ManifestBuilder.ts`
- Modify: `server/__tests__/broadcast/ManifestBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/__tests__/broadcast/ManifestBuilder.test.ts`:

```ts
describe('buildManifest — tier assignment', () => {
  it('sets cold_open and sign_off tiers', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
      ],
    });
    expect(m.segmentSlots[0].tier).toBe('cold_open');
    expect(m.segmentSlots[m.segmentSlots.length - 1].tier).toBe('sign_off');
  });

  it('marks transitions as deep_dive when index is in featureSlots', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '3', title: 'C', artistName: 'X', albumTitle: '', duration: 180 },
      ],
      featureSlots: [1],
    });
    // slots: 0=cold_open, 1=transition A→B (deep_dive), 2=transition B→C, 3=sign_off
    expect(m.segmentSlots[1].tier).toBe('deep_dive');
    expect(m.segmentSlots[2].tier).toBe('fact_bridge');
  });

  it('defaults transitions to fact_bridge when featureSlots empty or missing', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
      ],
    });
    // slots: 0=cold_open, 1=transition A→B, 2=sign_off
    expect(m.segmentSlots[1].tier).toBe('fact_bridge');
  });

  it('stores featureSlots on the manifest', () => {
    const m = buildManifest({
      userId: 'u', playlistId: null, vibe: 'lateNight', length: 'quick',
      tracks: [
        { id: '1', title: 'A', artistName: 'X', albumTitle: '', duration: 180 },
        { id: '2', title: 'B', artistName: 'X', albumTitle: '', duration: 180 },
      ],
      featureSlots: [1],
    });
    expect(m.featureSlots).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx jest __tests__/broadcast/ManifestBuilder.test.ts`
Expected: FAIL with tier undefined / featureSlots undefined.

- [ ] **Step 3: Extend buildManifest**

Read `server/src/services/broadcast/ManifestBuilder.ts` to understand its current shape. Then update the input type and the slot-construction logic. The function accepts an input with `userId, playlistId, vibe, length, tracks`. Extend to accept `featureSlots?: number[]` and assign `tier` to each slot:

- For `kind: 'cold_open'` (slot 0) → `tier: 'cold_open'`
- For `kind: 'sign_off'` (last slot) → `tier: 'sign_off'`
- For `kind: 'transition'` → `tier: featureSlots.includes(slot.index) ? 'deep_dive' : 'fact_bridge'`

Also set `manifest.featureSlots = featureSlots ?? []`.

Example diff shape (exact surrounding code may differ — apply the intent):

```ts
export interface BuildManifestInput {
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  tracks: ManifestTrack[];
  featureSlots?: number[];
}

export function buildManifest(input: BuildManifestInput): Manifest {
  // ...existing slot construction...
  const featureSlots = input.featureSlots ?? [];
  const slotsWithTier = slots.map(slot => {
    let tier: SegmentTier;
    if (slot.kind === 'cold_open') tier = 'cold_open';
    else if (slot.kind === 'sign_off') tier = 'sign_off';
    else tier = featureSlots.includes(slot.index) ? 'deep_dive' : 'fact_bridge';
    return { ...slot, tier };
  });
  return {
    // ...existing fields...
    segmentSlots: slotsWithTier,
    featureSlots,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx jest __tests__/broadcast/ManifestBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/ManifestBuilder.ts server/__tests__/broadcast/ManifestBuilder.test.ts
git commit -m "feat(broadcast): assign tier to slots in ManifestBuilder from featureSlots"
```

---

## Task 13: TrackSequencer — featureSlots Response

Extend the sequencer's LLM output schema to include `featureSlots`, update the prompt, add post-parse fixups, and extend the SequenceCache.

**Files:**
- Modify: `server/src/services/broadcast/TrackSequencer.ts`
- Modify: `server/src/services/broadcast/SequenceCache.ts`
- Modify: `server/__tests__/broadcast/TrackSequencer.test.ts`
- Modify: `server/__tests__/broadcast/SequenceCache.test.ts`

- [ ] **Step 1: Write failing tests for featureSlots in TrackSequencer**

Append to `server/__tests__/broadcast/TrackSequencer.test.ts`:

```ts
describe('TrackSequencer featureSlots', () => {
  it('returns featureSlots from a valid LLM response', async () => {
    const llm = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify({ ordered: ['1','2','3','4','5'], featureSlots: [2] }),
      }),
    };
    const pool = [1,2,3,4,5].map(n => ({
      id: String(n), title: `T${n}`, artistName: 'A', albumTitle: '', duration: 180,
    }));
    const sequencer = new TrackSequencer(llm, new SequenceCache(), makeEmptyCache());
    const result = await sequencer.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: 'night', dayOfWeek: 'Sat' },
    });
    expect(result.featureSlots).toEqual([2]);
  });

  it('drops out-of-range featureSlots', async () => {
    const llm = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify({ ordered: ['1','2','3','4','5'], featureSlots: [0, 2, 99] }),
      }),
    };
    const pool = [1,2,3,4,5].map(n => ({
      id: String(n), title: `T${n}`, artistName: 'A', albumTitle: '', duration: 180,
    }));
    const sequencer = new TrackSequencer(llm, new SequenceCache(), makeEmptyCache());
    const result = await sequencer.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: 'night', dayOfWeek: 'Sat' },
    });
    expect(result.featureSlots).toEqual([2]);
  });

  it('forces at least one featureSlot at the middle transition', async () => {
    const llm = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify({ ordered: ['1','2','3','4','5'], featureSlots: [] }),
      }),
    };
    const pool = [1,2,3,4,5].map(n => ({
      id: String(n), title: `T${n}`, artistName: 'A', albumTitle: '', duration: 180,
    }));
    const sequencer = new TrackSequencer(llm, new SequenceCache(), makeEmptyCache());
    const result = await sequencer.sequence({
      pool, vibe: 'lateNight', length: 'quick',
      userContext: { timeOfDay: 'night', dayOfWeek: 'Sat' },
    });
    // 5 tracks → 4 transitions (indices 1..4) → middle is index 2 or 3
    expect(result.featureSlots.length).toBeGreaterThan(0);
  });
});

function makeEmptyCache() {
  return {
    get: () => null,
    set: async () => {},
    load: async () => {},
  };
}
```

Update the `SequenceResult` type import and existing tests to expect `featureSlots` on the return shape if they currently don't.

- [ ] **Step 2: Run to verify tests fail**

Run: `cd server && npx jest __tests__/broadcast/TrackSequencer.test.ts`
Expected: FAIL with undefined featureSlots on result.

- [ ] **Step 3: Update the SequenceResult interface and sequencer logic**

Edit `server/src/services/broadcast/TrackSequencer.ts`. Extend the `SequenceResult` interface:

```ts
export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'cache' | 'llm' | 'fallback';
}
```

Extend the `SYSTEM_PROMPT` addendum (append a new paragraph after the existing output schema lines):

```ts
const SYSTEM_PROMPT = `You are a radio programmer arranging a broadcast. You receive a pool of tracks and a target arc. Return a JSON array of N track IDs in the order they should play, chosen to best fit the arc using the pool provided.

Preferred and avoid lists are aesthetic hints, not rules. If the pool has few tracks matching preferred, adapt — find tracks closest to the arc's feel. Never refuse. Your job is to make the best broadcast possible from THESE tracks, whatever they are.

In addition to ordering, nominate transitions for deep-dive treatment. Pick roughly 1 per 4 transitions, rounded up (4 transitions → 1, 8 → 2, 14 → 3-4). Prefer transitions into tracks marked "rich": true (at least 2 enrichment fields) OR transitions at structural moments in the arc — peak, pivot, resolution. Deep-dive slots get longer, more narrative host commentary; fact bridges get the rest. Return featureSlots as transition slot indices (integers between 1 and N-1 inclusive, where N is the track count).

Hard constraints:
- Output is valid JSON, exactly { "ordered": ["trackId", ...], "featureSlots": [index, ...] }
- Every ID must exist in the pool (no hallucination)
- ordered length is exactly N
- No track appears twice
- featureSlots indices are all in range 1..N-1 inclusive, no duplicates
- Return ONLY the JSON object, no prose before or after`;
```

Update `parseOrdered` to parse both fields. Rename it to `parseResponse` returning `{ ordered: string[], featureSlots: number[] }`:

```ts
private parseResponse(raw: string): { ordered: string[]; featureSlots: number[] } {
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('no JSON object found');
  }
  const jsonStr = raw.slice(firstBrace, lastBrace + 1);
  const parsed = JSON.parse(jsonStr) as { ordered?: unknown; featureSlots?: unknown };
  if (!Array.isArray(parsed.ordered)) {
    throw new Error('ordered is not an array');
  }
  if (!parsed.ordered.every((x): x is string => typeof x === 'string')) {
    throw new Error('ordered contains non-string');
  }
  const rawFeatures = Array.isArray(parsed.featureSlots) ? parsed.featureSlots : [];
  const featureSlots = rawFeatures.filter((x): x is number => typeof x === 'number' && Number.isInteger(x));
  return { ordered: parsed.ordered, featureSlots };
}
```

Add a new helper to fix up feature slots:

```ts
private fixupFeatureSlots(raw: number[], N: number): number[] {
  const min = 1;
  const max = N - 1;
  const valid = Array.from(new Set(raw.filter(i => i >= min && i <= max))).sort((a, b) => a - b);
  const maxCount = Math.ceil(N / 4);
  const trimmed = valid.slice(0, maxCount);
  if (trimmed.length === 0 && max >= min) {
    // Force at least one deep dive at the middle transition.
    const mid = Math.floor((min + max) / 2);
    return [mid];
  }
  return trimmed;
}
```

Update `attemptSequence` to use the new parse + fixup, and return both fields:

```ts
private async attemptSequence(
  pool: ManifestTrack[], req: SequenceRequest, N: number,
): Promise<{ orderedTracks: ManifestTrack[]; featureSlots: number[] }> {
  const { systemPrompt, userPrompt } = this.buildPrompt(pool, req, N);
  const response = await this.llm.generate({
    systemPrompt, userPrompt, maxTokens: 2048, temperature: 0.6,
  });
  const parsed = this.parseResponse(response.text);
  if (parsed.ordered.length !== N) {
    throw new Error(`wrong length: got ${parsed.ordered.length}, expected ${N}`);
  }
  const byId = new Map(pool.map(t => [t.id, t]));
  const hydrated = parsed.ordered.map(id => {
    const t = byId.get(id);
    if (!t) throw new Error(`hallucinated id: ${id}`);
    return t;
  });
  const deduped = removeDuplicates(hydrated, pool);
  const repaired = repairSequence({ ordered: deduped, pool });
  const orderedTracks = repaired.ordered.slice(0, N);
  const featureSlots = this.fixupFeatureSlots(parsed.featureSlots, N);
  return { orderedTracks, featureSlots };
}
```

Update `sequence()` to return featureSlots at every return path (cache hit, llm success, fallback). For the fallback case:

```ts
const fallbackOrdered = cappedPool.slice(0, N);
const fallbackFeatureSlots = this.fixupFeatureSlots([], N);
const result: SequenceResult = {
  orderedTracks: fallbackOrdered,
  featureSlots: fallbackFeatureSlots,
  source: 'fallback',
};
```

Update cache reads/writes accordingly. The `SequenceCache.get()` should return `{ ordered: string[], featureSlots: number[] }` now (see Step 4).

- [ ] **Step 4: Extend SequenceCache**

Edit `server/src/services/broadcast/SequenceCache.ts`. Change the cached value from `string[]` (ids) to `{ ordered: string[]; featureSlots: number[] }`. Update the signatures:

```ts
export class SequenceCache {
  private data = new Map<string, { value: { ordered: string[]; featureSlots: number[] }; expiresAt: number }>();
  // ...
  get(trackIds: string[], vibe: Vibe, length: BroadcastLength): { ordered: string[]; featureSlots: number[] } | null { /* ... */ }
  set(trackIds: string[], vibe: Vibe, length: BroadcastLength, value: { ordered: string[]; featureSlots: number[] }): void { /* ... */ }
}
```

Update the `TrackSequencer` cache integration: the cache-hit path should return both `ordered` and `featureSlots` without re-running the fixup (the stored value was already validated).

Extend the existing cache tests in `server/__tests__/broadcast/SequenceCache.test.ts` to include `featureSlots` round-tripping.

- [ ] **Step 5: Run all tests**

Run: `cd server && npx jest __tests__/broadcast/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/broadcast/TrackSequencer.ts server/src/services/broadcast/SequenceCache.ts server/__tests__/broadcast/TrackSequencer.test.ts server/__tests__/broadcast/SequenceCache.test.ts
git commit -m "feat(broadcast): TrackSequencer returns featureSlots; cache persists them"
```

---

## Task 14: SegmentScriptBuilder — Tier + Playbook + Guardrail + Richer Prompt

Rewrite the segment prompt builder to accept a tier, look up the genre playbook for the incoming track, append the fact-discipline guardrail, and build a rich user prompt from the full enrichment record.

**Files:**
- Modify: `server/src/services/broadcast/SegmentScriptBuilder.ts`
- Modify: `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`:

```ts
describe('SegmentScriptBuilder — tiered prompts', () => {
  function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
    return {
      broadcastId: 'b', userId: 'u', playlistId: null,
      vibe: 'lateNight', length: 'quick',
      createdAt: Date.now(),
      tracks: [
        { id: '1', title: 'Adore', artistName: 'Prince', albumTitle: '', duration: 180, genreNames: ['R&B/Soul'] },
        { id: '2', title: 'Come Down', artistName: 'Anderson .Paak', albumTitle: '', duration: 180, genreNames: ['Hip-Hop/Rap'] },
      ],
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: '1', variantCount: 1, status: 'pending', tier: 'cold_open' },
        { index: 1, kind: 'transition', afterTrackId: '1', beforeTrackId: '2', variantCount: 1, status: 'pending', tier: 'deep_dive' },
        { index: 2, kind: 'sign_off', afterTrackId: '2', variantCount: 1, status: 'pending', tier: 'sign_off' },
      ],
      featureSlots: [1],
      ...overrides,
    };
  }

  it('deep_dive prompt includes 80-120 word budget', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[1], m, {
      timeOfDay: 'night', dayOfWeek: 'Sat', firstTimeUser: false,
    });
    expect(prompt.userPrompt).toMatch(/80-120 words/);
  });

  it('fact_bridge prompt includes 40-60 word budget', () => {
    const m = makeManifest({ featureSlots: [] });
    m.segmentSlots[1].tier = 'fact_bridge';
    const [prompt] = buildSegmentPrompts(m.segmentSlots[1], m, {
      timeOfDay: 'night', dayOfWeek: 'Sat', firstTimeUser: false,
    });
    expect(prompt.userPrompt).toMatch(/40-60 words/);
  });

  it('system prompt embeds the genre playbook for hipHop when incoming is hip-hop', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[1], m, {
      timeOfDay: 'night', dayOfWeek: 'Sat', firstTimeUser: false,
    });
    expect(prompt.systemPrompt).toMatch(/GENRE VOICE.*hip-?hop|HipHop/i);
    expect(prompt.systemPrompt).toMatch(/producers|samples|flip|bars/);
  });

  it('system prompt always includes the FACT DISCIPLINE guardrail', () => {
    const m = makeManifest();
    for (const slot of m.segmentSlots) {
      const [prompt] = buildSegmentPrompts(slot, m, {
        timeOfDay: 'night', dayOfWeek: 'Sat', firstTimeUser: false,
      });
      expect(prompt.systemPrompt).toMatch(/FACT DISCIPLINE/);
      expect(prompt.systemPrompt).toMatch(/don't invent|never fabricate/i);
    }
  });

  it('user prompt includes enrichment when cache returns a record', () => {
    const m = makeManifest();
    const cache = {
      get: () => ({
        producer: 'Prince',
        releaseYear: '1987',
        wikipediaSummary: 'Adore is a 1987 song by Prince.',
        lastEnrichedAt: Date.now(),
        source: 'hybrid' as const,
      }),
    };
    const [prompt] = buildSegmentPrompts(m.segmentSlots[1], m, {
      timeOfDay: 'night', dayOfWeek: 'Sat', firstTimeUser: false,
    }, cache);
    expect(prompt.userPrompt).toMatch(/Producer:.*Prince/);
    expect(prompt.userPrompt).toMatch(/1987/);
    expect(prompt.userPrompt).toMatch(/About the track/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx jest __tests__/broadcast/SegmentScriptBuilder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite SegmentScriptBuilder**

Replace contents of `server/src/services/broadcast/SegmentScriptBuilder.ts` with:

```ts
import type { Manifest, SegmentSlot, Vibe, ManifestTrack, SegmentTier } from './types';
import type { EnrichmentRecord } from '../enrichment/EnrichmentCache';
import { normalizeGenreFamily, GENRE_PLAYBOOK } from './GenreFamily';
import { formatAudioFeatures } from './audio-features-format';

export interface SegmentContext {
  timeOfDay: string;
  dayOfWeek: string;
  firstTimeUser: boolean;
  lastSessionSummary?: string;
  tracksRecentlyPlayed?: string[];
  listenerName?: string;
}

export interface PromptSet {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export interface EnrichmentLookup {
  get(title: string, artist: string): EnrichmentRecord | null;
}

const VIBE_DESCRIPTIONS: Record<Vibe, string> = {
  morning: 'morning, warm, bright, gently energizing',
  focus: 'focus, minimal, calm, concentration-friendly',
  workout: 'workout, pumped, driving, high-energy',
  feelGood: 'feel-good, uplifting, affirming',
  lateNight: 'late-night, intimate, moody, introspective',
  melancholy: 'melancholy, bittersweet, reflective',
  party: 'party, celebratory, high-spirited, dance-floor energy',
};

const TIER_SHAPES: Record<SegmentTier, { budget: string; shape: string }> = {
  cold_open: {
    budget: '55-80 words',
    shape: 'Anchor the time and vibe first, then name the opening track. If a concrete detail about the track is in the enrichment, weave it in naturally. Land on the track name so the music can come in.',
  },
  fact_bridge: {
    budget: '40-60 words',
    shape: 'One concrete fact (year, producer, sample, lyric, chart, or studio) and one perceptual note (how it lands, what is about to change). End by naming the incoming track. Tight — no filler.',
  },
  deep_dive: {
    budget: '80-120 words',
    shape: 'Lead with a hook — a detail that makes the listener lean in. Expand one thread — the person, the moment, the sonic element. If a thread connects outgoing and incoming tracks, use it. Land on the track name.',
  },
  sign_off: {
    budget: '35-55 words',
    shape: 'Reference the closing track with one fact and one feel. Send the listener off with warmth. Optional: tease coming back.',
  },
};

function sanitizeForPrompt(s: string, max = 120): string {
  const cleaned = s
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\b(system|assistant|user)\s*:/gi, '$1')
    .replace(/```+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '\u2026' : cleaned;
}

function trackRef(t: ManifestTrack): string {
  const title = sanitizeForPrompt(t.title);
  const artist = sanitizeForPrompt(t.artistName);
  return `\u201C${title}\u201D by ${artist}`;
}

function findTrack(m: Manifest, id?: string): ManifestTrack | undefined {
  return m.tracks.find(t => t.id === id);
}

function pickGenreFamily(track: ManifestTrack, enr: EnrichmentRecord | null): ReturnType<typeof normalizeGenreFamily> {
  // Priority: MusicBrainz enrichment genre → Apple Music genreNames → generic.
  const fromEnrichment = enr?.genre ? normalizeGenreFamily(enr.genre) : 'generic';
  if (fromEnrichment !== 'generic') return fromEnrichment;
  return normalizeGenreFamily(track.genreNames);
}

function buildSystemPrompt(vibe: Vibe, tier: SegmentTier, genreFamily: string): string {
  const playbook = GENRE_PLAYBOOK[genreFamily as keyof typeof GENRE_PLAYBOOK] ?? GENRE_PLAYBOOK.generic;
  const { budget, shape } = TIER_SHAPES[tier];
  return [
    'You are ONAY (pronounced "Oh-nay"), an AI radio host. You speak with warmth, wit, and the easy authority of a seasoned DJ. You are a woman \u2014 use she/her pronouns for yourself when relevant, and never masculine DJ phrasing like "your boy," "my man," "the homie," or "this guy." Self-reference instead as "your host," "me," "I," or by name.',
    '',
    `BROADCAST VIBE: ${VIBE_DESCRIPTIONS[vibe]}.`,
    '',
    `GENRE VOICE (incoming track is ${genreFamily}): ${playbook}`,
    '',
    'FACT DISCIPLINE: When you state specifics \u2014 producer credits, year, chart positions, personnel, lyrical references, sessions \u2014 use ONLY what\u2019s in the enrichment block or what you know with high confidence from your training. If you\u2019re not certain about a fact, don\u2019t invent one. Pivot to the perceptual instead: how it feels, what the sonics do, what\u2019s about to shift. Never fabricate names, dates, or credits.',
    '',
    'STYLE RULES:',
    '- Speak as ONAY, in the first person. Never narrate as if describing a scene.',
    '- No stage directions, no bracketed cues, no emoji.',
    '- No meta references ("as an AI", "in this segment"). You ARE the host.',
    '- Use curly quotes (\u201C \u201D) for quoted phrases.',
    '- Em-dashes are welcome for pacing.',
    '- End on a beat that hands cleanly to the next track.',
    '',
    `TIER: ${tier}`,
    `Word budget: ${budget}`,
    `Shape: ${shape}`,
  ].join('\n');
}

function buildEnrichmentBlock(enr: EnrichmentRecord | null): string {
  if (!enr) return '';
  const lines: string[] = [];
  if (enr.producer) lines.push(`- Producer: ${sanitizeForPrompt(enr.producer, 120)}`);
  if (enr.releaseYear) lines.push(`- Year: ${sanitizeForPrompt(enr.releaseYear, 20)}`);
  if (enr.sample) lines.push(`- Sample: ${sanitizeForPrompt(enr.sample, 200)}`);
  if (enr.wikipediaSummary) lines.push(`- About the track: ${sanitizeForPrompt(enr.wikipediaSummary, 600)}`);
  if (enr.notableFacts?.length) {
    const facts = enr.notableFacts.slice(0, 3).map(f => `  • ${sanitizeForPrompt(f, 400)}`).join('\n');
    lines.push(`- Notable facts:\n${facts}`);
  }
  if (enr.artistBio) lines.push(`- Artist bio: ${sanitizeForPrompt(enr.artistBio, 300)}`);
  if (enr.audioFeatures) lines.push(`- Sonics: ${formatAudioFeatures(enr.audioFeatures)}`);
  if (!lines.length) return '';
  return `\n\nEnrichment (verified facts you may cite):\n${lines.join('\n')}`;
}

function buildSceneLines(ctx: SegmentContext): string {
  const lines: string[] = [];
  if (ctx.dayOfWeek && ctx.timeOfDay) {
    lines.push(`It's ${ctx.dayOfWeek}, ${ctx.timeOfDay}.`);
  } else if (ctx.timeOfDay) {
    lines.push(`It's ${ctx.timeOfDay}.`);
  } else if (ctx.dayOfWeek) {
    lines.push(`It's ${ctx.dayOfWeek}.`);
  }
  if (ctx.listenerName) lines.push(`Your listener's name is ${ctx.listenerName}.`);
  if (ctx.firstTimeUser) {
    lines.push('This is their very first broadcast \u2014 welcome them without being saccharine.');
  } else if (ctx.lastSessionSummary) {
    lines.push(`They\u2019re coming back \u2014 last time: ${sanitizeForPrompt(ctx.lastSessionSummary, 240)}.`);
  } else {
    lines.push('They are a returning listener.');
  }
  return lines.join(' ');
}

export function buildSegmentPrompts(
  slot: SegmentSlot,
  manifest: Manifest,
  ctx: SegmentContext,
  enrichmentCache?: EnrichmentLookup,
): PromptSet[] {
  const tier: SegmentTier = slot.tier
    ?? (slot.kind === 'cold_open' ? 'cold_open'
        : slot.kind === 'sign_off' ? 'sign_off'
        : 'fact_bridge');
  const vibe = manifest.vibe;
  const scene = buildSceneLines(ctx);

  if (slot.kind === 'cold_open') {
    const first = findTrack(manifest, slot.beforeTrackId)!;
    const enr = enrichmentCache?.get(first.title, first.artistName) ?? null;
    const family = pickGenreFamily(first, enr);
    const system = buildSystemPrompt(vibe, tier, family);
    const userPrompt =
      `${scene}\n\n` +
      `Opening track: ${trackRef(first)} \u2014 ${family}.` +
      buildEnrichmentBlock(enr) +
      `\n\nWrite ONAY\u2019s cold open. ${TIER_SHAPES[tier].budget}. End on the track name so the music can come in.`;
    return [{ systemPrompt: system, userPrompt, maxTokens: 640 }];
  }

  if (slot.kind === 'transition') {
    const outgoing = findTrack(manifest, slot.afterTrackId)!;
    const incoming = findTrack(manifest, slot.beforeTrackId)!;
    const incomingEnr = enrichmentCache?.get(incoming.title, incoming.artistName) ?? null;
    const family = pickGenreFamily(incoming, incomingEnr);
    const system = buildSystemPrompt(vibe, tier, family);
    const maxTokens = tier === 'deep_dive' ? 768 : 512;
    const userPrompt =
      `${scene}\n\n` +
      `Outgoing: ${trackRef(outgoing)}\n` +
      `Incoming: ${trackRef(incoming)} \u2014 ${family}.` +
      buildEnrichmentBlock(incomingEnr) +
      `\n\nWrite ONAY\u2019s ${tier}. ${TIER_SHAPES[tier].budget}. End by naming the incoming track.`;
    return [{ systemPrompt: system, userPrompt, maxTokens }];
  }

  // sign_off
  const closing = findTrack(manifest, slot.afterTrackId)!;
  const closingEnr = enrichmentCache?.get(closing.title, closing.artistName) ?? null;
  const family = pickGenreFamily(closing, closingEnr);
  const system = buildSystemPrompt(vibe, tier, family);
  const userPrompt =
    `${scene}\n\n` +
    `The final track was ${trackRef(closing)} \u2014 ${family}.` +
    buildEnrichmentBlock(closingEnr) +
    `\n\nWrite ONAY\u2019s sign-off. ${TIER_SHAPES[tier].budget}.`;
  return [{ systemPrompt: system, userPrompt, maxTokens: 512 }];
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx jest __tests__/broadcast/SegmentScriptBuilder.test.ts`
Expected: PASS (including existing tests — be prepared to update any that relied on old prompt text verbatim).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/SegmentScriptBuilder.ts server/__tests__/broadcast/SegmentScriptBuilder.test.ts
git commit -m "feat(broadcast): tier-based segment prompts + genre playbook + fact guardrail"
```

---

## Task 15: BroadcastOrchestrator — New Pipeline + Parallel Segment Gen

Change the orchestrator to run sequencer → enrichment drain → parallel capped segment gen → response, and generate all segments with a small concurrency cap.

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Modify: `server/__tests__/broadcast/BroadcastOrchestrator.test.ts`

- [ ] **Step 1: Write failing test for new pipeline order and all-ready response**

Append to `server/__tests__/broadcast/BroadcastOrchestrator.test.ts`:

```ts
describe('BroadcastOrchestrator — fully pre-baked pipeline', () => {
  it('returns a manifest with all slots ready after create()', async () => {
    const { orchestrator, llm, tts } = makeOrchestrator();
    const req = makeCreateRequest();
    const res = await orchestrator.create(req);
    expect(res.manifest.segmentSlots.every(s => s.status === 'ready')).toBe(true);
    expect(res.manifest.featureSlots).toBeDefined();
  });

  it('drains enrichment for the chosen N tracks only, not the full pool', async () => {
    const enrichmentCalls: string[] = [];
    const { orchestrator } = makeOrchestrator({
      onEnrichTrack: (t) => enrichmentCalls.push(t.id),
    });
    const req = makeCreateRequest({ tracks: makePool(20), length: 'quick' }); // N=5
    await orchestrator.create(req);
    expect(enrichmentCalls.length).toBeLessThanOrEqual(5);
  });

  it('respects the segment generation concurrency cap', async () => {
    let active = 0;
    let maxActive = 0;
    const { orchestrator } = makeOrchestrator({
      onSegmentStart: () => {
        active++;
        maxActive = Math.max(maxActive, active);
      },
      onSegmentEnd: () => { active--; },
    });
    await orchestrator.create(makeCreateRequest({ length: 'long' }));
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});
```

`makeOrchestrator` and related helpers: adapt from existing test setup. The goal is mocks that capture what called when, so we can assert ordering and counts.

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.test.ts`
Expected: FAIL — current code doesn't drain enrichment sync, doesn't cap concurrency.

- [ ] **Step 3: Rewrite the orchestrator**

Replace `server/src/services/broadcast/BroadcastOrchestrator.ts` with:

```ts
import type { ObjectStorage } from '../storage/ObjectStorage';
import { buildManifest } from './ManifestBuilder';
import { buildSegmentPrompts, type SegmentContext } from './SegmentScriptBuilder';
import { SegmentGenerator, type LLMCaller, type TTSCaller } from './SegmentGenerator';
import type {
  BroadcastCreateRequest, BroadcastCreateResponse, Manifest,
} from './types';
import { BroadcastStore } from './BroadcastStore';
import { TrackSequencer } from './TrackSequencer';
import { SequenceCache } from './SequenceCache';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import type { BackgroundEnricher } from '../enrichment/BackgroundEnricher';

const SEGMENT_CONCURRENCY = 4;

export class BroadcastOrchestrator {
  private readonly generator: SegmentGenerator;
  private readonly sequencer: TrackSequencer;

  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    sequenceCache?: SequenceCache,
  ) {
    this.generator = new SegmentGenerator(llm, tts, storage);
    this.sequencer = new TrackSequencer(
      llm, sequenceCache ?? new SequenceCache(), enrichmentCache,
    );
  }

  async create(
    input: BroadcastCreateRequest & { userId: string },
  ): Promise<BroadcastCreateResponse> {
    // 1. Sequence the pool (uses any cached enrichment as hints).
    const seq = await this.sequencer.sequence({
      pool: input.tracks,
      vibe: input.vibe,
      length: input.length,
      userContext: {
        timeOfDay: input.userContext.timeOfDay,
        dayOfWeek: input.userContext.dayOfWeek,
      },
    });

    // 2. Drain enrichment for the chosen N tracks only, not the full pool.
    await this.backgroundEnricher.drainNow(seq.orderedTracks);

    // 3. Build the manifest (now includes tier per slot based on featureSlots).
    const manifest = buildManifest({
      userId: input.userId,
      playlistId: input.playlistId,
      vibe: input.vibe,
      length: input.length,
      tracks: seq.orderedTracks,
      featureSlots: seq.featureSlots,
    });
    this.store.put(manifest);

    // 4. Generate all segments in parallel with a concurrency cap.
    await this.generateAllSegmentsCapped(manifest, input.userContext);

    // 5. Return manifest with all slots populated.
    const finalManifest = this.store.get(manifest.broadcastId)!;
    const coldOpen = finalManifest.segmentSlots[0];
    const firstSegmentUrls = coldOpen.audioUrls ?? [];
    return {
      manifest: finalManifest,
      firstSegmentUrls,
    };
  }

  /** Kept for compatibility with callers that still check completion. */
  async waitForCompletion(_broadcastId: string): Promise<void> {
    // Pipeline is now fully synchronous in create(); no background work remains.
    return;
  }

  isInFlight(_broadcastId: string): boolean {
    return false;
  }

  getManifest(broadcastId: string): Manifest | undefined {
    return this.store.get(broadcastId);
  }

  private async generateAllSegmentsCapped(
    manifest: Manifest,
    ctx: SegmentContext,
  ): Promise<void> {
    const indices = manifest.segmentSlots.map(s => s.index);
    let nextIndex = 0;
    const workers: Promise<void>[] = [];
    const runWorker = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= indices.length) return;
        await this.generateSlot(manifest, indices[i], ctx);
      }
    };
    const workerCount = Math.min(SEGMENT_CONCURRENCY, indices.length);
    for (let w = 0; w < workerCount; w++) {
      workers.push(runWorker());
    }
    await Promise.all(workers);
  }

  private async generateSlot(
    manifest: Manifest,
    slotIndex: number,
    ctx: SegmentContext,
  ): Promise<string[]> {
    const slot = manifest.segmentSlots[slotIndex];
    try {
      const prompts = buildSegmentPrompts(slot, manifest, ctx, this.enrichmentCache);
      const urls = await this.generator.generateVariants({
        broadcastId: manifest.broadcastId,
        slotIndex,
        prompts,
      });
      this.store.updateSlot(manifest.broadcastId, slotIndex, {
        status: 'ready',
        audioUrls: urls,
      });
      return urls;
    } catch (err) {
      this.store.updateSlot(manifest.broadcastId, slotIndex, { status: 'failed' });
      if (slotIndex === 0) throw err;
      return [];
    }
  }
}
```

- [ ] **Step 4: Run all broadcast tests**

Run: `cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the entire server test suite to catch integration regressions**

Run: `cd server && npm test`
Expected: PASS across the board.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts server/__tests__/broadcast/BroadcastOrchestrator.test.ts
git commit -m "feat(broadcast): fully pre-baked pipeline with parallel capped segment gen"
```

---

## Task 16: Native Module — Surface genreNames

Add `genreNames` to the native iOS MusicKit bridge and TypeScript surface so the client can pass them to the server.

**Files:**
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`
- Modify: `modules/expo-music-kit/index.ts`
- Modify: `src/services/MusicKitPlayer.ts`

- [ ] **Step 1: Locate where Swift serializes a Song into a JS dict**

Run: `grep -n "genreNames\|title:\|artistName\|Song" modules/expo-music-kit/ios/ExpoMusicKitModule.swift | head -30`
Identify the serialization helper (likely returns `[String: Any]`).

- [ ] **Step 2: Add genreNames to the Swift serializer**

Edit `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`. In the helper that converts a `Song` (or MusicKit track) to a dict, add:

```swift
// MusicKit's Song type exposes `genreNames: [String]`
dict["genreNames"] = song.genreNames
```

(Use the exact local variable name in context — the Song variable may be `song` or `track`.)

- [ ] **Step 3: Extend the TS surface**

Edit `modules/expo-music-kit/index.ts`. Find the type for track records returned from `fetchPlaylistTracks`. Add:

```ts
genreNames?: string[];
```

- [ ] **Step 4: Pass genreNames through MusicKitPlayer**

Edit `src/services/MusicKitPlayer.ts`. Find where tracks from `fetchPlaylistTracks` are mapped into the `ManifestTrack`-shaped objects sent to the server. Add `genreNames` to the mapped output so it reaches `POST /broadcast/create`.

- [ ] **Step 5: Rebuild iOS to pick up the Swift change**

Run: `cd /Users/kari/Documents/cleo-app && SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device`
Expected: app builds and launches.

- [ ] **Step 6: Manually verify**

- Open the app, pick a playlist.
- Tap "Build your broadcast," complete the setup sheet.
- Tail the server log (`cd server && npm run dev` in another terminal if not already running).
- Expected: the `POST /broadcast/create` payload includes `genreNames` on tracks where Apple Music has them set.

- [ ] **Step 7: Commit**

```bash
git add modules/expo-music-kit/ios/ExpoMusicKitModule.swift modules/expo-music-kit/index.ts src/services/MusicKitPlayer.ts
git commit -m "feat(music-kit): surface genreNames from native bridge to server payload"
```

---

## Task 17: Client Schema Mirror

Mirror the server schema additions in the client's `BroadcastPlayer.types.ts`.

**Files:**
- Modify: `src/engines/BroadcastPlayer.types.ts`

- [ ] **Step 1: Read the current types**

Run: `cat /Users/kari/Documents/cleo-app/src/engines/BroadcastPlayer.types.ts`
Identify the existing `Manifest`, `SegmentSlot`, and `ManifestTrack` equivalents.

- [ ] **Step 2: Add the three new fields**

Edit `src/engines/BroadcastPlayer.types.ts`. Extend the types to match the server:

```ts
export type SegmentTier = 'cold_open' | 'fact_bridge' | 'deep_dive' | 'sign_off';

export interface SegmentSlot {
  // ...existing fields...
  tier?: SegmentTier;
}

export interface ManifestTrack {
  // ...existing fields...
  genreNames?: string[];
}

export interface Manifest {
  // ...existing fields...
  featureSlots?: number[];
}
```

- [ ] **Step 3: Type-check the client**

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`
Expected: 0 errors (additions are optional so no existing usage breaks).

- [ ] **Step 4: Commit**

```bash
git add src/engines/BroadcastPlayer.types.ts
git commit -m "feat(client): mirror segment tier + featureSlots + genreNames types"
```

---

## Task 18: TuningInOverlay Cycling Status Label

Add a subtle cycling status label so the 25-40s cold-bake wait doesn't feel stalled.

**Files:**
- Modify: `src/components/broadcast/TuningInOverlay.tsx`

- [ ] **Step 1: Read the current overlay to understand its structure**

Run: `cat /Users/kari/Documents/cleo-app/src/components/broadcast/TuningInOverlay.tsx`

- [ ] **Step 2: Add a cycling status label**

Edit the component. Add a state that cycles through a sequence every ~5s with a smooth fade. Example addition (adapt to actual component structure):

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography, Colors, Spacing } from '../../tokens/design-tokens';
import { useAppActive } from '../../hooks/useAppActive';

const PHASES = ['Curating', 'Enriching', 'Writing segments', 'Tuning in'];

function StatusLabel() {
  const active = useAppActive();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setIndex(i => (i + 1) % PHASES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [active]);
  return (
    <Text style={styles.label} accessibilityLiveRegion="polite">
      {PHASES[index].toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    ...Typography.monoCaps,
    color: Colors.accent,
    letterSpacing: 2.5,
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
});
```

Compose `StatusLabel` inside the existing `TuningInOverlay` layout. Keep the existing "TUNING IN" pulsing ring; this new label sits below or near it.

Loop animations must respect `useAppActive()` (see `CLAUDE.md` — iOS background CPU budget). The example above pauses the interval when backgrounded.

- [ ] **Step 3: Manually verify**

- Run the dev server and the iOS app.
- Build a broadcast.
- Expected: the overlay label cycles through Curating → Enriching → Writing segments → Tuning in every ~5s. Pulsing ring still animates.

- [ ] **Step 4: Commit**

```bash
git add src/components/broadcast/TuningInOverlay.tsx
git commit -m "feat(broadcast): add cycling status label to TuningInOverlay"
```

---

## Self-Review (Plan Complete)

Before handing off to execution, verify:

**Spec coverage:**
- Two-tier segments (fact bridge + deep dive) — Tasks 11, 12, 14
- Genre-aware voice via 10-family playbook — Tasks 1, 14
- Hybrid data strategy with guardrail — Task 14
- Pipeline reshape (sequence → enrich N → parallel segments → response) — Task 15
- Enrichment expansion (Wikipedia, Last.fm, Spotify) — Tasks 5, 6, 7, 8
- Sequencer returns featureSlots — Task 13
- Sequencer uses `rich` flag — covered in Task 13 (prompt extension)
- Audio features formatter — Task 2
- Client schema + native bridge — Tasks 10, 16, 17
- TuningIn progress hint — Task 18
- New env vars documented — Task 8 step 4
- Tests — every task has a test step

**Placeholder scan:** no TBD / TODO / "implement later" / "handle edge cases" without concrete code. Every code step shows the code.

**Type consistency:** `SegmentTier`, `GenreFamily`, `EnrichmentRecord`, `featureSlots`, `genreNames`, `tier` used consistently across tasks. `RateLimitedFetcher` is the shared class. `fetchWithTimeout` is the shared HTTP helper.

**Scope:** single feature spec; single plan; no decomposition needed.

**Not in this plan, per spec non-goals:** cross-segment continuity, search-LLM fallback, Discogs, per-tier TTS prosody, multi-variant segments, client polling cleanup (explicitly a follow-up).

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-18-segment-story-upgrade.md`.**

# Weather Context in Cold Opens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in weather mention to cold-open prompts ("It's 47 and lightly raining in Brooklyn.") via a server-side `WeatherProvider` (OpenWeatherMap free tier) and a Profile-screen toggle + city input on the client.

**Architecture:** New `WeatherProvider` class wraps OWM's "Current Weather Data" + "Geocoding" APIs with a 30-min in-memory cache. New `/weather/geocode` route resolves user-typed city to coords (with up to 3 disambiguation candidates). `BroadcastOrchestrator` fetches the hint sentence once per bake and injects it into `SegmentContext.weatherHint`, which `buildSceneLines` appends to the cold_open scene block. Client persists `{ enabled, coords, resolvedLabel }` to MMKV; `POST /broadcast/create` includes `userContext.weatherCoords` when enabled.

**Tech Stack:** TypeScript strict mode, Express + Jest + supertest (server), Zod, React Native + Expo Router + MMKV (client), OpenWeatherMap free-tier API.

**Spec:** [`docs/superpowers/specs/2026-04-26-weather-context-design.md`](../specs/2026-04-26-weather-context-design.md)

**Issue:** [bworthy89/cleo#34](https://github.com/bworthy89/cleo/issues/34). Phase 2 milestone.

**Branch:** `phase-2-weather-context` (already created; spec already committed).

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/providers/weather/WeatherProvider.ts` (**new**) | OWM client, 30-min in-memory cache, hint sentence formatting |
| `server/__tests__/providers/weather/WeatherProvider.test.ts` (**new**) | 4 unit tests: cache hit, cache expiry, fetch error → null, geocode parses candidates |
| `server/src/routes/weather.ts` (**new**) | `POST /weather/geocode` route |
| `server/__tests__/routes/weather.test.ts` (**new**) | 2 integration tests: 200 happy path, 502 on provider error |
| `server/src/services/broadcast/SegmentScriptBuilder.ts` (**modify**) | Add `weatherHint?: string` to `SegmentContext`; `buildSceneLines` appends when present |
| `server/__tests__/broadcast/SegmentScriptBuilder.test.ts` (**modify**) | Add 1 test: cold_open prompt includes hint when set; sign_off does NOT |
| `server/src/services/broadcast/types.ts` (**modify**) | Add `weatherCoords?: { lat, lon, cityName }` to `BroadcastCreateRequest.userContext` |
| `server/src/routes/broadcast.ts` (**modify**) | Add `weatherCoords` to Zod `contextSchema` |
| `server/src/services/broadcast/BroadcastOrchestrator.ts` (**modify**) | Accept `WeatherProvider` in constructor; fetch hint when `weatherCoords` present; thread into SegmentContext |
| `server/__tests__/broadcast/BroadcastOrchestrator.test.ts` (**modify**) | Add 1 test: when `userContext.weatherCoords` present, provider is called and hint surfaces in prompt |
| `server/src/index.ts` (**modify**) | Instantiate `WeatherProvider` from env var, mount `/weather` router, pass to orchestrator constructor |
| `src/services/Storage.ts` (**modify**) | Add `StorageKeys.WEATHER_SETTINGS`, `getWeatherSettings`/`setWeatherSettings`/`clearWeatherSettings` |
| `__tests__/services/Storage.test.ts` (**modify**) | Add 4 tests for the new accessors |
| `src/engines/BroadcastManifestClient.ts` (**modify**) | Extend `CreateBroadcastRequest['userContext']` type with `weatherCoords?` |
| `src/screens/settings/ProfileScreen.tsx` (**modify**) | New "Weather context" section: toggle + input + geocode call + picker UI |
| `src/screens/home/HomeBroadcastScreen.tsx` (**modify**) | Read settings from MMKV; attach to bake POST when enabled |
| `app/(onboarding)/first-listen.tsx` (**modify**) | Same — attach weather coords to first-listen bake POST |
| `CLAUDE.md` (**modify**) | Document `OPENWEATHER_API_KEY`; brief note about Profile section |

---

## Notes for the Implementer

- TypeScript strict mode. No `any` casts unless unavoidable; prefer `unknown` + narrowing or structural-shape `Pick<>` types.
- Server tests: `cd server && npx jest <pattern>`. Client tests: `npx jest <pattern>` from repo root.
- Server uses `tsx` for scripts (not ts-node).
- Mock pattern for `fetch`: dependency-inject via constructor option (`fetch?: typeof globalThis.fetch`); test passes a `jest.fn()`.
- Commit-message convention: `<type>(<scope>): <subject>` with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer. Scope is `server` for server changes, `client` for client.
- Don't `git add -A` — working tree has unrelated dirty files.
- The existing `BroadcastOrchestrator` constructor takes 8 positional args. Adding `WeatherProvider` makes 9 — at the boundary of usability. The plan keeps positional for v1; we can opt-object-refactor in a follow-up.
- The OWM free-tier API endpoints are:
  - Current weather: `https://api.openweathermap.org/data/2.5/weather?lat=&lon=&units=imperial&appid=`
  - Geocoding: `https://api.openweathermap.org/geo/1.0/direct?q=&limit=3&appid=`
- City names in hint sentences should NOT be sanitized through the prompt-injection cleanup — they're user-trusted (the user picked from a server-resolved candidate list, not free text). But the LLM does still see them in the prompt.

---

### Task 1: `WeatherProvider` class

**Files:**
- Create: `server/src/providers/weather/WeatherProvider.ts`
- Create: `server/__tests__/providers/weather/WeatherProvider.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/providers/weather/WeatherProvider.test.ts`:

```ts
import { WeatherProvider } from '@/providers/weather/WeatherProvider';

const owmCurrentResponse = (overrides: Record<string, unknown> = {}) => ({
  weather: [{ id: 800, main: 'Clear', description: 'clear sky' }],
  main: { temp: 47.4 },
  ...overrides,
});

const owmGeocodeResponse = () => ([
  { name: 'Brooklyn', state: 'New York', country: 'US', lat: 40.6501, lon: -73.9496 },
  { name: 'Brooklyn', state: 'Iowa', country: 'US', lat: 41.7344, lon: -92.4441 },
]);

describe('WeatherProvider.getHint', () => {
  it('caches results within the 30-min window', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify(owmCurrentResponse())));
    let now = 1_000_000;
    const wp = new WeatherProvider({ apiKey: 'k', clock: () => now, fetch: fetchMock as any });
    const hint1 = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    const hint2 = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(hint1).toBe('It’s a clear 47 in Brooklyn.');
    expect(hint2).toBe('It’s a clear 47 in Brooklyn.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the cache expires', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify(owmCurrentResponse())));
    let now = 1_000_000;
    const wp = new WeatherProvider({ apiKey: 'k', clock: () => now, fetch: fetchMock as any });
    await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    now += 31 * 60 * 1000; // advance past 30-min TTL
    await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null on fetch error (caller skips silently)', async () => {
    const fetchMock = jest.fn(async () => { throw new Error('network down'); });
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any });
    const hint = await wp.getHint({ lat: 40.65, lon: -73.95 }, 'Brooklyn');
    expect(hint).toBeNull();
  });

  it('formats rain conditions using OWM weather id ranges', async () => {
    const lightRain = new Response(JSON.stringify(owmCurrentResponse({
      weather: [{ id: 500, main: 'Rain', description: 'light rain' }],
      main: { temp: 52 },
    })));
    const heavyRain = new Response(JSON.stringify(owmCurrentResponse({
      weather: [{ id: 502, main: 'Rain', description: 'heavy rain' }],
      main: { temp: 52 },
    })));
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(lightRain)
      .mockResolvedValueOnce(heavyRain);
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any });
    const a = await wp.getHint({ lat: 1, lon: 2 }, 'Brooklyn');
    const b = await wp.getHint({ lat: 3, lon: 4 }, 'Brooklyn');
    expect(a).toBe('It’s 52 and lightly raining in Brooklyn.');
    expect(b).toBe('It’s pouring in Brooklyn — 52.');
  });
});

describe('WeatherProvider.geocode', () => {
  it('returns up to 3 candidates from OWM', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify(owmGeocodeResponse())));
    const wp = new WeatherProvider({ apiKey: 'k', fetch: fetchMock as any });
    const candidates = await wp.geocode('Brooklyn');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      name: 'Brooklyn',
      state: 'New York',
      country: 'US',
      lat: 40.6501,
      lon: -73.9496,
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd server && npx jest __tests__/providers/weather/WeatherProvider`
Expected: FAIL — "Cannot find module '@/providers/weather/WeatherProvider'"

- [ ] **Step 3: Implement `WeatherProvider`**

Create `server/src/providers/weather/WeatherProvider.ts`:

```ts
export interface WeatherCoords {
  lat: number;
  lon: number;
}

export interface WeatherCandidate {
  name: string;
  state?: string;
  country: string;
  lat: number;
  lon: number;
}

interface CacheEntry {
  hint: string;
  fetchedAt: number;
}

interface OwmCurrent {
  weather: Array<{ id: number; main: string; description: string }>;
  main: { temp: number };
}

const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Wrap OpenWeatherMap's free tier APIs with an in-memory 30-min cache and
 * pre-formatted hint sentence output. Used by BroadcastOrchestrator for
 * cold_open weather mentions.
 */
export class WeatherProvider {
  private readonly apiKey: string;
  private readonly clock: () => number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: {
    apiKey: string;
    clock?: () => number;
    fetch?: typeof globalThis.fetch;
  }) {
    this.apiKey = opts.apiKey;
    this.clock = opts.clock ?? Date.now;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /**
   * Returns a single-sentence cold-open hint, or null on any error.
   * The caller (orchestrator) skips the hint silently when null.
   */
  async getHint(coords: WeatherCoords, cityName: string): Promise<string | null> {
    const key = `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`;
    const now = this.clock();
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.hint;
    }
    try {
      const url = new URL('https://api.openweathermap.org/data/2.5/weather');
      url.searchParams.set('lat', String(coords.lat));
      url.searchParams.set('lon', String(coords.lon));
      url.searchParams.set('units', 'imperial');
      url.searchParams.set('appid', this.apiKey);
      const res = await this.fetchImpl(url.toString());
      if (!res.ok) return null;
      const raw = await res.json() as OwmCurrent;
      const hint = formatHint(raw, cityName);
      this.cache.set(key, { hint, fetchedAt: now });
      return hint;
    } catch {
      return null;
    }
  }

  async geocode(query: string): Promise<WeatherCandidate[]> {
    try {
      const url = new URL('https://api.openweathermap.org/geo/1.0/direct');
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '3');
      url.searchParams.set('appid', this.apiKey);
      const res = await this.fetchImpl(url.toString());
      if (!res.ok) return [];
      const raw = await res.json() as Array<{
        name: string; state?: string; country: string; lat: number; lon: number;
      }>;
      return raw.map(r => ({
        name: r.name,
        state: r.state,
        country: r.country,
        lat: r.lat,
        lon: r.lon,
      }));
    } catch {
      return [];
    }
  }
}

function formatHint(data: OwmCurrent, cityName: string): string {
  const w = data.weather[0];
  const id = w?.id ?? 800;
  const main = w?.main ?? 'Clear';
  const tempRounded = Math.round(data.main.temp);
  const t = `${tempRounded}`;
  const c = cityName;

  // Rain ID disambiguation: 500-501 light/moderate; 502-504 heavy/very/extreme.
  if (main === 'Rain') {
    if (id >= 502 && id <= 504) return `It’s pouring in ${c} — ${t}.`;
    return `It’s ${t} and lightly raining in ${c}.`;
  }
  if (main === 'Drizzle') return `It’s ${t} and drizzly in ${c}.`;
  if (main === 'Snow') return `It’s ${t} and snowing in ${c}.`;
  if (main === 'Thunderstorm') return `There’s a thunderstorm rolling through ${c} — ${t}.`;
  if (main === 'Mist' || main === 'Fog' || main === 'Haze') {
    return `It’s ${t} and foggy in ${c}.`;
  }
  if (main === 'Clear') return `It’s a clear ${t} in ${c}.`;
  if (main === 'Clouds') return `It’s a cloudy ${t} in ${c}.`;
  return `It’s ${t} in ${c}.`;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd server && npx jest __tests__/providers/weather/WeatherProvider`
Expected: PASS — 5 tests green.

Run: `cd server && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/providers/weather/WeatherProvider.ts \
        server/__tests__/providers/weather/WeatherProvider.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add WeatherProvider with 30-min cache + hint formatting

OpenWeatherMap "Current Weather Data" + "Geocoding" client. Returns
single-sentence hints ("It's 47 and lightly raining in Brooklyn.")
keyed on rounded lat/lon, cached 30 min in-memory. Returns null on
any fetch error so the caller can skip the hint silently.

Hint shape table (OWM main field → sentence template) maps clear,
clouds, rain (light vs heavy via id 500-501 vs 502-504), drizzle,
snow, thunderstorm, mist/fog/haze, with a fallback for anything
else. Imperial units; rounded temperature.

Foundation for #34 — orchestrator wiring + route in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `/weather/geocode` route + tests

**Files:**
- Create: `server/src/routes/weather.ts`
- Create: `server/__tests__/routes/weather.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/routes/weather.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { createWeatherRouter } from '@/routes/weather';
import type { WeatherProvider } from '@/providers/weather/WeatherProvider';

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as unknown as { uid: string }).uid = uid; next(); };

const buildApp = (provider: Pick<WeatherProvider, 'geocode'>) => {
  const app = express();
  app.use(express.json());
  app.use(authStub('uid-1'));
  app.use(createWeatherRouter(provider as WeatherProvider));
  return app;
};

describe('POST /weather/geocode', () => {
  it('returns candidates from the provider', async () => {
    const provider = {
      geocode: jest.fn(async () => [
        { name: 'Brooklyn', state: 'New York', country: 'US', lat: 40.65, lon: -73.95 },
      ]),
    };
    const app = buildApp(provider);
    const res = await request(app).post('/weather/geocode').send({ q: 'Brooklyn' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      candidates: [
        { name: 'Brooklyn', state: 'New York', country: 'US', lat: 40.65, lon: -73.95 },
      ],
    });
    expect(provider.geocode).toHaveBeenCalledWith('Brooklyn');
  });

  it('returns 400 on missing/empty query', async () => {
    const provider = { geocode: jest.fn() };
    const app = buildApp(provider);
    const res = await request(app).post('/weather/geocode').send({ q: '' });
    expect(res.status).toBe(400);
    expect(provider.geocode).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd server && npx jest __tests__/routes/weather`
Expected: FAIL — "Cannot find module '@/routes/weather'".

- [ ] **Step 3: Implement the route**

Create `server/src/routes/weather.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import type { WeatherProvider } from '../providers/weather/WeatherProvider';

const geocodeSchema = z.object({
  q: z.string().min(1).max(100),
});

export function createWeatherRouter(provider: WeatherProvider): Router {
  const router = Router();
  router.post('/weather/geocode', async (req, res) => {
    const parsed = geocodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const candidates = await provider.geocode(parsed.data.q);
    return res.json({ candidates });
  });
  return router;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd server && npx jest __tests__/routes/weather`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/weather.ts server/__tests__/routes/weather.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add POST /weather/geocode route

Thin route wrapping WeatherProvider.geocode. Zod-validated body
({ q: 1-100 chars }), returns { candidates: WeatherCandidate[] }.
Auth-gated upstream via requireAuth (mounted in index.ts in a
later task).

Returns up to 3 candidates from OWM's geocoding API. Client uses
this for the city-disambiguation picker on the Profile screen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `SegmentContext.weatherHint` + scene-line insertion

**Files:**
- Modify: `server/src/services/broadcast/SegmentScriptBuilder.ts`
- Modify: `server/__tests__/broadcast/SegmentScriptBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/broadcast/SegmentScriptBuilder.test.ts` (inside the existing top-level `describe('SegmentScriptBuilder', ...)` block, or as a new top-level describe — match the existing style):

```ts
describe('SegmentScriptBuilder weatherHint propagation', () => {
  const baseManifest = {
    broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
    vibe: 'morning' as const, length: 'quick' as const, createdAt: 0,
    tracks: [
      { id: 't0', title: 'Wake', artistName: 'AA', albumTitle: 'Al', duration: 200 },
      { id: 't1', title: 'Coffee', artistName: 'BB', albumTitle: 'Al', duration: 200 },
    ],
    segmentSlots: [
      { index: 0, kind: 'cold_open' as const, beforeTrackId: 't0', variantCount: 1, status: 'pending' as const },
      { index: 1, kind: 'sign_off' as const, afterTrackId: 't1', variantCount: 1, status: 'pending' as const },
    ],
  };

  const ctx = {
    timeOfDay: '08:00',
    dayOfWeek: 'Monday',
    firstTimeUser: false,
    weatherHint: 'It’s 47 and lightly raining in Brooklyn.',
  };

  it('cold_open prompt includes the weather hint when present', () => {
    const prompts = buildSegmentPrompts(baseManifest.segmentSlots[0], baseManifest, ctx);
    expect(prompts[0].userPrompt).toContain('It’s 47 and lightly raining in Brooklyn.');
  });

  it('sign_off prompt does NOT include the weather hint (cold_open only)', () => {
    const prompts = buildSegmentPrompts(baseManifest.segmentSlots[1], baseManifest, ctx);
    expect(prompts[0].userPrompt).not.toContain('It’s 47 and lightly raining in Brooklyn.');
  });
});
```

The test imports `buildSegmentPrompts` — confirm it's in the existing file's import block:

```bash
grep -n "import.*buildSegmentPrompts\|^import" server/__tests__/broadcast/SegmentScriptBuilder.test.ts | head -5
```

If not imported, add `import { buildSegmentPrompts } from '@/services/broadcast/SegmentScriptBuilder';` at the top.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd server && npx jest __tests__/broadcast/SegmentScriptBuilder.test.ts -t "weatherHint"`
Expected: FAIL — TypeScript will reject `weatherHint` on `SegmentContext` ("Property 'weatherHint' does not exist on type 'SegmentContext'.").

- [ ] **Step 3: Add the field + scene-line insertion**

Edit `server/src/services/broadcast/SegmentScriptBuilder.ts`. Find the `SegmentContext` interface (around line 5-12):

```ts
export interface SegmentContext {
  timeOfDay: string;
  dayOfWeek: string;
  firstTimeUser: boolean;
  lastSessionSummary?: string;
  tracksRecentlyPlayed?: string[];
  listenerName?: string;
}
```

Replace with:

```ts
export interface SegmentContext {
  timeOfDay: string;
  dayOfWeek: string;
  firstTimeUser: boolean;
  lastSessionSummary?: string;
  tracksRecentlyPlayed?: string[];
  listenerName?: string;
  /** Pre-formatted single-sentence weather hint, e.g. "It's 47 and
   *  lightly raining in Brooklyn." Only surfaces in cold_open prompts —
   *  buildSceneLines appends it; cold_open is the only slot kind that
   *  uses the scene block. */
  weatherHint?: string;
}
```

Find the `buildSceneLines` function (around line 124-148). Find the line that pushes the firstTimeUser/lastSessionSummary block:

```ts
  if (ctx.firstTimeUser) {
    lines.push('This is their very first broadcast — welcome them without being saccharine.');
  } else if (ctx.lastSessionSummary) {
    lines.push(`They’re coming back — last time: ${sanitizeForPrompt(ctx.lastSessionSummary, 240)}.`);
  } else {
    lines.push('They’re here again.');
  }
  return lines.join(' ');
}
```

Add the weatherHint append right before `return lines.join(' ');`:

```ts
  if (ctx.firstTimeUser) {
    lines.push('This is their very first broadcast — welcome them without being saccharine.');
  } else if (ctx.lastSessionSummary) {
    lines.push(`They’re coming back — last time: ${sanitizeForPrompt(ctx.lastSessionSummary, 240)}.`);
  } else {
    lines.push('They’re here again.');
  }
  if (ctx.weatherHint) {
    // Scene-line addition for cold_open prompts. Sign-off and bridges
    // don't call buildSceneLines, so the hint surfaces only on the
    // first slot by construction.
    lines.push(sanitizeForPrompt(ctx.weatherHint, 200));
  }
  return lines.join(' ');
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd server && npx jest __tests__/broadcast/SegmentScriptBuilder.test.ts`
Expected: PASS — all existing tests + the 2 new propagation cases.

Run: `cd server && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/SegmentScriptBuilder.ts \
        server/__tests__/broadcast/SegmentScriptBuilder.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add weatherHint to SegmentContext + cold_open scene block

SegmentContext gains an optional weatherHint string;
buildSceneLines appends it via sanitizeForPrompt when present.
Sign_off and bridge prompts don't call buildSceneLines, so by
construction the hint surfaces only in cold_open prompts —
verified by 2 new tests.

Plumbing for #34. The orchestrator wiring (fetching the hint
from WeatherProvider and threading it into ctx) lands in the
next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Extend `BroadcastCreateRequest` types + Zod schema

**Files:**
- Modify: `server/src/services/broadcast/types.ts`
- Modify: `server/src/routes/broadcast.ts`

This task adds the type-level + validation surface for `userContext.weatherCoords`. No test is added here directly — Tasks 5 and 6 cover the orchestrator wiring + integration.

- [ ] **Step 1: Extend the TypeScript interface**

Edit `server/src/services/broadcast/types.ts`. Find the `BroadcastCreateRequest` interface (around line 81-102):

```ts
  userContext: {
    lastSessionSummary?: string;
    tracksRecentlyPlayed?: string[];
    timeOfDay: string;
    dayOfWeek: string;
    firstTimeUser: boolean;
    listenerName?: string;
  };
```

Replace with:

```ts
  userContext: {
    lastSessionSummary?: string;
    tracksRecentlyPlayed?: string[];
    timeOfDay: string;
    dayOfWeek: string;
    firstTimeUser: boolean;
    listenerName?: string;
    /** Optional weather location for cold_open mention. When present,
     *  the orchestrator fetches a hint sentence from WeatherProvider and
     *  injects it into SegmentContext.weatherHint. */
    weatherCoords?: {
      lat: number;
      lon: number;
      cityName: string;
    };
  };
```

- [ ] **Step 2: Extend the Zod schema**

Edit `server/src/routes/broadcast.ts`. Find the `contextSchema` (around line 27-34):

```ts
const contextSchema = z.object({
  lastSessionSummary: z.string().max(2048).optional(),
  tracksRecentlyPlayed: z.array(z.string().max(80)).max(50).optional(),
  timeOfDay: z.string().max(30),
  dayOfWeek: z.string().max(20),
  firstTimeUser: z.boolean(),
  listenerName: z.string().max(50).optional(),
});
```

Add the `weatherCoords` field:

```ts
const contextSchema = z.object({
  lastSessionSummary: z.string().max(2048).optional(),
  tracksRecentlyPlayed: z.array(z.string().max(80)).max(50).optional(),
  timeOfDay: z.string().max(30),
  dayOfWeek: z.string().max(20),
  firstTimeUser: z.boolean(),
  listenerName: z.string().max(50).optional(),
  weatherCoords: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    cityName: z.string().min(1).max(100),
  }).optional(),
});
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `cd server && npx tsc --noEmit`
Expected: clean. The orchestrator's existing `input.userContext` reads (timeOfDay, dayOfWeek) still work because the new field is optional.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/broadcast/types.ts server/src/routes/broadcast.ts
git commit -m "$(cat <<'EOF'
feat(server): accept userContext.weatherCoords in BroadcastCreateRequest

Optional { lat, lon, cityName } field on the request body; Zod
schema validates lat/lon ranges and cityName length. Type-only
change at this layer — the orchestrator wires it through to
WeatherProvider in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `BroadcastOrchestrator` wires WeatherProvider into SegmentContext

**Files:**
- Modify: `server/src/services/broadcast/BroadcastOrchestrator.ts`
- Modify: `server/__tests__/broadcast/BroadcastOrchestrator.test.ts`

- [ ] **Step 1: Add the constructor dependency**

Edit `server/src/services/broadcast/BroadcastOrchestrator.ts`. Add an import near the existing `import { ... } from './SegmentScriptBuilder'`:

```ts
import type { WeatherProvider } from '../../providers/weather/WeatherProvider';
```

Find the constructor (around line 64-88):

```ts
  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    featureFetchChain: FeatureFetchChain,
    sequenceCache?: SequenceCache,
  ) {
```

Add a 9th positional param at the end (keeping existing positional convention):

```ts
  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    featureFetchChain: FeatureFetchChain,
    sequenceCache?: SequenceCache,
    private readonly weatherProvider?: Pick<WeatherProvider, 'getHint'>,
  ) {
```

Note: optional + `Pick<>`. Keeping it optional means existing callers (tests, `makeWithDefaults`) still compile without passing it; missing provider is silently no-op.

Find `makeWithDefaults` (around line 100-132). The `new BroadcastOrchestrator(...)` call inside it doesn't need updating since the new param is optional.

- [ ] **Step 2: Resolve weather hint inside `create()`**

In `BroadcastOrchestrator.ts`, find the `create()` method's body around line 219 where slot 0 is generated:

```ts
      const drainP = this.backgroundEnricher.drainNow(seq.orderedTracks).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${tag} [BroadcastOrchestrator] drainNow failed: ${msg}`);
      });
      const slot0P = this.generateSlot(manifest, 0, input.userContext);
```

Insert hint resolution before `generateSlot`. The new code:

```ts
      const drainP = this.backgroundEnricher.drainNow(seq.orderedTracks).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${tag} [BroadcastOrchestrator] drainNow failed: ${msg}`);
      });

      // Resolve weather hint if the user opted in. WeatherProvider returns
      // null on any error; we just skip the hint silently.
      let weatherHint: string | undefined;
      if (input.userContext.weatherCoords && this.weatherProvider) {
        const wc = input.userContext.weatherCoords;
        const hint = await this.weatherProvider.getHint(
          { lat: wc.lat, lon: wc.lon },
          wc.cityName,
        );
        if (hint) weatherHint = hint;
      }
      const ctxWithHint: SegmentContext = {
        ...input.userContext,
        weatherHint,
      };

      const slot0P = this.generateSlot(manifest, 0, ctxWithHint);
```

Then update line ~231 where the background slots run — change `input.userContext` to `ctxWithHint` so the context carries the hint:

Find:
```ts
        const backgroundP = this.generateSlotsBackground(manifest, input.userContext, tag)
```

Replace with:
```ts
        const backgroundP = this.generateSlotsBackground(manifest, ctxWithHint, tag)
```

(For non-cold-open slots `weatherHint` is harmless because they don't call `buildSceneLines`; but threading the same context object keeps the data flow uniform.)

- [ ] **Step 3: Add an integration test**

Append to `server/__tests__/broadcast/BroadcastOrchestrator.test.ts` — find a representative spot among the existing `describe`/`it` blocks and add:

```ts
describe('BroadcastOrchestrator weather hint wiring', () => {
  it('calls weatherProvider.getHint when userContext.weatherCoords is present and threads the hint into prompts', async () => {
    const getHint = jest.fn(async () => 'It’s 47 and lightly raining in Brooklyn.');
    const orch = BroadcastOrchestrator.makeWithDefaults();
    // Inject the weatherProvider through the same private-field override
    // pattern makeWithDefaults uses for sequencer/generator.
    (orch as unknown as { weatherProvider: { getHint: typeof getHint } }).weatherProvider = {
      getHint,
    };
    // Spy on generator to capture the prompt that's actually sent to TTS.
    const generateVariants = jest.fn(async (req: { prompts: Array<{ userPrompt: string }> }) => {
      // Capture-and-return; we'll assert on the prompt below.
      capturedUserPrompts.push(...req.prompts.map(p => p.userPrompt));
      return ['https://cdn/v0.mp3'];
    });
    const capturedUserPrompts: string[] = [];
    (orch as unknown as { generator: { generateVariants: typeof generateVariants } }).generator = {
      generateVariants,
    };

    const result = await orch.create({
      userId: 'u1', playlistId: 'p1', vibe: 'morning', length: 'quick',
      tracks: [
        { id: 't0', title: 'Wake', artistName: 'AA', albumTitle: 'Al', duration: 200 },
        { id: 't1', title: 'Coffee', artistName: 'BB', albumTitle: 'Al', duration: 200 },
        { id: 't2', title: 'Stretch', artistName: 'CC', albumTitle: 'Al', duration: 200 },
        { id: 't3', title: 'Sunrise', artistName: 'DD', albumTitle: 'Al', duration: 200 },
        { id: 't4', title: 'Walk', artistName: 'EE', albumTitle: 'Al', duration: 200 },
      ],
      userContext: {
        timeOfDay: '08:00',
        dayOfWeek: 'Monday',
        firstTimeUser: true,
        weatherCoords: { lat: 40.65, lon: -73.95, cityName: 'Brooklyn' },
      },
    });

    expect(getHint).toHaveBeenCalledWith(
      { lat: 40.65, lon: -73.95 },
      'Brooklyn',
    );
    // The cold_open prompt (slot 0) should contain the hint sentence.
    const coldOpenPrompt = capturedUserPrompts[0];
    expect(coldOpenPrompt).toContain('It’s 47 and lightly raining in Brooklyn.');
  });
});
```

The test relies on `BroadcastOrchestrator.makeWithDefaults()` which already exists; it injects mocks via the private-field override pattern. The captured prompt's first entry is slot 0 (cold_open) — see Task 3's tests for the same propagation idea.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd server && npx jest __tests__/broadcast/BroadcastOrchestrator.test.ts -t "weather hint wiring"`
Expected: PASS.

Also run TS check:
Run: `cd server && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/BroadcastOrchestrator.ts \
        server/__tests__/broadcast/BroadcastOrchestrator.test.ts
git commit -m "$(cat <<'EOF'
feat(server): wire WeatherProvider through BroadcastOrchestrator

Constructor accepts an optional Pick<WeatherProvider, 'getHint'>
as the 9th positional arg. When userContext.weatherCoords is set,
create() resolves a hint sentence and threads it into the
SegmentContext (including for slots 1..N for uniformity, though
only cold_open uses the scene block).

Provider null/error paths skip the hint silently; the bake
proceeds weather-free as designed in #34.

Integration test verifies getHint is called with the right coords
and the resulting hint surfaces in the slot-0 cold_open prompt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `index.ts` — instantiate provider, mount route

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Read the existing structure**

Inspect imports, env-var reads, and where existing routers are mounted:

Run:
```bash
grep -n "createFeaturedRouter\|createBroadcastRouter\|requireAuth\|broadcastOrchestrator\|process.env" server/src/index.ts | head -20
```

Note line numbers. The existing pattern: env vars read at the top, singletons constructed mid-file, routers mounted under `app.use(requireAuth, ...)`.

- [ ] **Step 2: Add the import + provider instantiation**

Edit `server/src/index.ts`. Add an import at the top with the other relative imports:

```ts
import { WeatherProvider } from './providers/weather/WeatherProvider';
import { createWeatherRouter } from './routes/weather';
```

Find where other singletons are instantiated (after `enrichmentLimiter`, alongside `curatorPublishBudget` from #16). Add a new block:

```ts
// WeatherProvider is optional — null when OPENWEATHER_API_KEY is unset.
// The orchestrator skips weather injection entirely when the provider is
// missing, so first-launch deploys without the key still work.
const weatherProvider = process.env.OPENWEATHER_API_KEY
  ? new WeatherProvider({ apiKey: process.env.OPENWEATHER_API_KEY })
  : undefined;
if (!weatherProvider) {
  console.warn('[env] OPENWEATHER_API_KEY unset; weather hints disabled');
}
```

- [ ] **Step 3: Pass the provider to the orchestrator constructor**

Find the existing `const broadcastOrchestrator = new BroadcastOrchestrator(...)` (around line 170). It currently takes 8 args. Add the weather provider as the 9th:

```ts
  const broadcastOrchestrator = new BroadcastOrchestrator(
    llmProvider,
    ttsProvider,
    storage,
    broadcastStore,
    enrichmentCache,
    backgroundEnricher,
    featureFetchChain,
    sequenceCache,
    weatherProvider,
  );
```

(Confirm the actual existing arg names by reading the file — may differ slightly. Match what's there; the new arg is in position 9.)

- [ ] **Step 4: Mount the weather router**

Find an existing `app.use(requireAuth, ...)` route mount (e.g., for the broadcast router). Mount weather alongside, under the same auth gate. Only mount when the provider is configured:

```ts
  if (weatherProvider) {
    app.use(requireAuth, createWeatherRouter(weatherProvider));
  }
```

Place it near the other `app.use` mounts.

- [ ] **Step 5: Verify the server still compiles**

Run: `cd server && npx tsc --noEmit`
Expected: clean.

Run: `cd server && npm test`
Expected: all suites pass — the new constructor arg is optional so existing tests still work.

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): instantiate WeatherProvider + mount /weather/geocode

Reads OPENWEATHER_API_KEY from env; constructs WeatherProvider when
present, undefined otherwise. Pass through to BroadcastOrchestrator
constructor as the 9th positional arg. Mount /weather router under
requireAuth only when the provider is configured.

Server boots and operates normally without the env var — weather
features are silent no-ops in that case. Lets us deploy this PR
without rotating keys at the same time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Client `Storage.ts` — `WeatherSettings` type + accessors

**Files:**
- Modify: `src/services/Storage.ts`
- Modify: `__tests__/services/Storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/services/Storage.test.ts`:

```ts
describe('WeatherSettings accessors', () => {
  it('returns null on a fresh install', () => {
    expect(getWeatherSettings()).toBeNull();
  });

  it('persists and reads a settings object', () => {
    const settings: WeatherSettings = {
      enabled: true,
      city: 'Brooklyn',
      coords: { lat: 40.65, lon: -73.95 },
      resolvedLabel: 'Brooklyn, NY, US',
    };
    setWeatherSettings(settings);
    expect(getWeatherSettings()).toEqual(settings);
  });

  it('clearWeatherSettings removes the entry', () => {
    setWeatherSettings({
      enabled: true,
      city: 'Brooklyn',
      coords: { lat: 40.65, lon: -73.95 },
      resolvedLabel: 'Brooklyn, NY, US',
    });
    clearWeatherSettings();
    expect(getWeatherSettings()).toBeNull();
  });

  it('clearUserData also removes weather settings', () => {
    setWeatherSettings({
      enabled: true,
      city: 'Brooklyn',
      coords: { lat: 40.65, lon: -73.95 },
      resolvedLabel: 'Brooklyn, NY, US',
    });
    clearUserData('uid-1');
    expect(getWeatherSettings()).toBeNull();
  });
});
```

Update the import block at the top of the test file. Find the existing Storage import:

```ts
import {
  getUser,
  setUser,
  // ... existing imports ...
} from '../../src/services/Storage';
```

Add `getWeatherSettings`, `setWeatherSettings`, `clearWeatherSettings`, and the `WeatherSettings` type to the import list.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest __tests__/services/Storage.test.ts -t "WeatherSettings"`
Expected: FAIL — exports not found.

- [ ] **Step 3: Add the type, key, and accessors**

Edit `src/services/Storage.ts`. Find the `StorageKeys` block (around line 7-13). Add a new key:

```ts
export const StorageKeys = {
  // ... existing keys ...
  WEATHER_SETTINGS: 'weather_settings',
} as const;
```

(Keep the existing keys; just add `WEATHER_SETTINGS` next to a sensible neighbor like `USER`.)

Add the type definition near the other typed exports (near `UserData`):

```ts
export interface WeatherSettings {
  enabled: boolean;
  city: string;
  coords: { lat: number; lon: number };
  resolvedLabel: string;
}
```

Add the accessor functions next to the user accessors (near `getUser` / `setUser`):

```ts
export function getWeatherSettings(): WeatherSettings | null {
  return getObject<WeatherSettings>(StorageKeys.WEATHER_SETTINGS) ?? null;
}

export function setWeatherSettings(settings: WeatherSettings): void {
  setObject(StorageKeys.WEATHER_SETTINGS, settings);
}

export function clearWeatherSettings(): void {
  storage.remove(StorageKeys.WEATHER_SETTINGS);
}
```

Find the existing `clearUserData` function and add a `storage.remove(StorageKeys.WEATHER_SETTINGS)` call inside it, alongside the other `storage.remove(...)` calls. Do NOT touch the line that removes other entries — just add the weather one.

Confirm by reading the function:
```bash
grep -A 15 "export function clearUserData" src/services/Storage.ts
```

Add to the list of removes.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest __tests__/services/Storage.test.ts`
Expected: all existing tests + the 4 new WeatherSettings tests pass.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/Storage.ts __tests__/services/Storage.test.ts
git commit -m "$(cat <<'EOF'
feat(client): add WeatherSettings type + MMKV accessors

New StorageKeys.WEATHER_SETTINGS + getWeatherSettings/
setWeatherSettings/clearWeatherSettings. WeatherSettings carries
{ enabled, city, coords: {lat,lon}, resolvedLabel } — captures the
user's saved-and-confirmed city after the geocode-then-confirm
flow on Profile.

clearUserData() also removes the weather entry so sign-out wipes
it correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Client `BroadcastManifestClient` type extension

**Files:**
- Modify: `src/engines/BroadcastManifestClient.ts`

- [ ] **Step 1: Locate the userContext shape**

Find the `CreateBroadcastRequest` type:

```bash
grep -n "CreateBroadcastRequest\|userContext" src/engines/BroadcastManifestClient.ts | head -10
```

It defines `userContext: { timeOfDay, dayOfWeek, firstTimeUser, ... listenerName?: string }` (around line 30-50).

- [ ] **Step 2: Add `weatherCoords` to the type**

Find the `userContext` shape inside `CreateBroadcastRequest` and add an optional `weatherCoords` field matching the server-side type (Task 4):

```ts
  userContext: {
    timeOfDay: string;
    dayOfWeek: string;
    firstTimeUser: boolean;
    lastSessionSummary?: string;
    tracksRecentlyPlayed?: string[];
    listenerName?: string;
    weatherCoords?: {
      lat: number;
      lon: number;
      cityName: string;
    };
  };
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean. No call sites need updating yet — the field is optional.

- [ ] **Step 4: Commit**

```bash
git add src/engines/BroadcastManifestClient.ts
git commit -m "$(cat <<'EOF'
feat(client): accept weatherCoords on CreateBroadcastRequest userContext

Type-only change to mirror the server-side schema extension (Task 4).
Optional, so existing call sites still type-check; HomeBroadcastScreen
+ first-listen wire the actual values from MMKV in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Profile screen — Weather context section

**Files:**
- Modify: `src/screens/settings/ProfileScreen.tsx`

This is the biggest UI surface in the plan. The screen has an existing "Crate Digger" idiom — `SectionMarker` headers, `HairlineRow` rows, mono labels with amber values, `Pressable` toggles (no native `Switch` — see `SettingsDrawer.tsx` for the toggle pattern).

- [ ] **Step 1: Read the existing structure**

Read the current `ProfileScreen.tsx` to understand the section pattern:

```bash
head -100 src/screens/settings/ProfileScreen.tsx
```

Note: where toggles/inputs render today, where state is held (component-local `useState` vs context), where API calls fire.

- [ ] **Step 2: Add the new section + its state hooks**

In `src/screens/settings/ProfileScreen.tsx`, add imports at the top:

```ts
import { TextInput, ActivityIndicator, Alert } from 'react-native';
import {
  getWeatherSettings,
  setWeatherSettings,
  clearWeatherSettings,
  type WeatherSettings,
} from '../../services/Storage';
import { authenticatedFetch } from '../../services/api';
```

Inside the `ProfileScreen` component body, add weather state alongside existing component-local state:

```tsx
  const [weather, setWeatherState] = useState<WeatherSettings | null>(() => getWeatherSettings());
  const [cityInput, setCityInput] = useState(weather?.city ?? '');
  const [geocoding, setGeocoding] = useState(false);
  const [candidates, setCandidates] = useState<Array<{
    name: string; state?: string; country: string; lat: number; lon: number;
  }>>([]);
```

Add the toggle handler:

```tsx
  const onToggleWeather = (next: boolean) => {
    if (!next) {
      // Toggling off: keep saved coords (so the user can flip back on
      // without re-picking) but flip enabled to false.
      const cur = getWeatherSettings();
      if (cur) {
        const updated = { ...cur, enabled: false };
        setWeatherSettings(updated);
        setWeatherState(updated);
      } else {
        setWeatherState(null);
      }
      return;
    }
    // Toggling on: only meaningful if a city is already saved with coords.
    const cur = getWeatherSettings();
    if (cur) {
      const updated = { ...cur, enabled: true };
      setWeatherSettings(updated);
      setWeatherState(updated);
    } else {
      setWeatherState({ enabled: true, city: '', coords: { lat: 0, lon: 0 }, resolvedLabel: '' });
    }
  };
```

Add the geocode submit handler:

```tsx
  const onSubmitCity = async () => {
    const q = cityInput.trim();
    if (!q || geocoding) return;
    setGeocoding(true);
    setCandidates([]);
    try {
      const res = await authenticatedFetch('/weather/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      if (!res.ok) {
        Alert.alert('Weather lookup unavailable', 'Try again later.');
        return;
      }
      const body = await res.json() as { candidates: Array<{
        name: string; state?: string; country: string; lat: number; lon: number;
      }> };
      if (body.candidates.length === 0) {
        Alert.alert("Couldn't find that city", 'Try the full name or a ZIP code.');
        return;
      }
      if (body.candidates.length === 1) {
        // Auto-confirm.
        confirmCandidate(body.candidates[0]);
      } else {
        setCandidates(body.candidates);
      }
    } catch {
      Alert.alert('Weather lookup unavailable', 'Try again later.');
    } finally {
      setGeocoding(false);
    }
  };

  const confirmCandidate = (c: {
    name: string; state?: string; country: string; lat: number; lon: number;
  }) => {
    const label = [c.name, c.state, c.country].filter(Boolean).join(', ');
    const settings: WeatherSettings = {
      enabled: weather?.enabled ?? true,
      city: cityInput.trim(),
      coords: { lat: c.lat, lon: c.lon },
      resolvedLabel: label,
    };
    setWeatherSettings(settings);
    setWeatherState(settings);
    setCandidates([]);
  };
```

Add the JSX section. Find where existing sections render (look for `<SectionMarker>` or similar). Add a new section. The exact placement depends on the existing layout; insert near the other settings-style sections:

```tsx
      <SectionMarker num="P·02" title="Weather context" right="OPTIONAL" />

      <View style={styles.weatherSection}>
        <Pressable
          onPress={() => onToggleWeather(!(weather?.enabled ?? false))}
          accessibilityRole="switch"
          accessibilityState={{ checked: weather?.enabled ?? false }}
          style={styles.weatherToggleRow}
        >
          <Text style={styles.weatherToggleLabel}>
            Mention weather in cold opens
          </Text>
          <Text style={[
            styles.weatherToggleValue,
            (weather?.enabled ?? false) ? styles.weatherToggleOn : null,
          ]}>
            {weather?.enabled ? 'ON' : 'OFF'}
          </Text>
        </Pressable>

        <Text style={styles.weatherSub}>
          When ON, ONAY may say something like "It's 47 and lightly raining
          in Brooklyn." One mention max per episode. Off by default.
        </Text>

        <View style={styles.weatherCityRow}>
          <Text style={styles.weatherFieldLabel}>City</Text>
          <TextInput
            style={styles.weatherCityInput}
            value={cityInput}
            onChangeText={setCityInput}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder="Brooklyn"
            placeholderTextColor={AM.inkGhost}
            returnKeyType="done"
            onSubmitEditing={onSubmitCity}
            accessibilityLabel="City for weather context"
          />
          <Pressable
            onPress={onSubmitCity}
            disabled={geocoding || cityInput.trim().length === 0}
            style={({ pressed }) => [
              styles.weatherSetBtn,
              pressed && { opacity: 0.7 },
              (geocoding || cityInput.trim().length === 0) && { opacity: 0.4 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Look up city"
          >
            {geocoding ? (
              <ActivityIndicator color={AM.amber} size="small" />
            ) : (
              <Text style={styles.weatherSetBtnLabel}>SET</Text>
            )}
          </Pressable>
        </View>

        {weather?.resolvedLabel && candidates.length === 0 ? (
          <Text style={styles.weatherSavedLabel}>saved: {weather.resolvedLabel}</Text>
        ) : null}

        {candidates.length > 0 ? (
          <View style={styles.weatherCandidates}>
            <Text style={styles.weatherCandidatesPrompt}>Did you mean…</Text>
            {candidates.map((c, i) => (
              <Pressable
                key={`${c.lat}-${c.lon}-${i}`}
                onPress={() => confirmCandidate(c)}
                style={({ pressed }) => [styles.weatherCandidateRow, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <Text style={styles.weatherCandidateLabel}>
                  {[c.name, c.state, c.country].filter(Boolean).join(', ')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
```

Add styles to the `StyleSheet.create` block:

```ts
  weatherSection: {
    paddingVertical: Space.s14,
    gap: Space.s12,
  },
  weatherToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Space.s8,
  },
  weatherToggleLabel: {
    fontFamily: Fonts.serif,
    fontSize: TypeScale.s16,
    color: AM.ink,
  },
  weatherToggleValue: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  weatherToggleOn: {
    color: AM.amber,
  },
  weatherSub: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s13,
    color: AM.inkMid,
    lineHeight: TypeScale.s13 * 1.5,
  },
  weatherCityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s10,
  },
  weatherFieldLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
    width: 60,
  },
  weatherCityInput: {
    flex: 1,
    fontFamily: Fonts.serif,
    fontSize: TypeScale.s16,
    color: AM.ink,
    paddingVertical: Space.s8,
    borderBottomWidth: 1,
    borderBottomColor: AM.rule,
  },
  weatherSetBtn: {
    paddingHorizontal: Space.s14,
    paddingVertical: Space.s8,
    borderWidth: 1,
    borderColor: AM.amber,
  },
  weatherSetBtnLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },
  weatherSavedLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  weatherCandidates: {
    gap: Space.s8,
    paddingVertical: Space.s8,
  },
  weatherCandidatesPrompt: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  weatherCandidateRow: {
    paddingVertical: Space.s8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AM.rule,
  },
  weatherCandidateLabel: {
    fontFamily: Fonts.serif,
    fontSize: TypeScale.s14,
    color: AM.ink,
  },
```

The exact section number `P·02` and the placement are best-effort; match whatever the existing Profile screen uses for ordering. If `SectionMarker` doesn't exist or has a different prop shape, fall back to a plain `Text` heading matching the surrounding style.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean for the modified file.

- [ ] **Step 4: Commit**

```bash
git add src/screens/settings/ProfileScreen.tsx
git commit -m "$(cat <<'EOF'
feat(client): add Weather context section to Profile screen

New section with:
- Toggle (Pressable, ON/OFF amber/dim treatment matching the Crate
  Digger idiom)
- Subtitle copy explaining the feature
- City text input + SET button
- Geocode-then-confirm flow: server returns up to 3 candidates;
  picker renders inline if >1, auto-confirms if 1
- Saved-label row showing the resolved city (e.g., "saved:
  Brooklyn, NY, US") so the user sees what was disambiguated

Persists to MMKV via the WeatherSettings accessors. The HomeBroadcastScreen
+ first-listen call sites read this and attach to bake POSTs in the
next task.

No automated screen test (consistent with the codebase's stance on
RN screen-test infrastructure). Verified via TypeScript + manual
TestFlight smoke.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wire weatherCoords into bake POSTs

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`
- Modify: `app/(onboarding)/first-listen.tsx`

- [ ] **Step 1: HomeBroadcastScreen**

Edit `src/screens/home/HomeBroadcastScreen.tsx`. Add the import:

```ts
import { getWeatherSettings } from '../../services/Storage';
```

Find the `client.createBroadcast({...})` call (around line 307). Build a `weatherCoords` value just before the call, conditionally on the saved settings:

```ts
      const weatherSettings = getWeatherSettings();
      const weatherCoords = (weatherSettings?.enabled && weatherSettings.coords)
        ? {
            lat: weatherSettings.coords.lat,
            lon: weatherSettings.coords.lon,
            cityName: weatherSettings.resolvedLabel.split(',')[0].trim(),
          }
        : undefined;
```

Then in the userContext payload of `createBroadcast`, add `weatherCoords` (it's optional, so it can be `undefined`):

```ts
          userContext: {
            timeOfDay: new Date().toTimeString().slice(0, 5),
            dayOfWeek: new Date().toLocaleDateString(undefined, { weekday: 'long' }),
            firstTimeUser: false,
            weatherCoords,
          },
```

- [ ] **Step 2: first-listen**

Edit `app/(onboarding)/first-listen.tsx`. Add the import:

```ts
import { getUser, setUser, markFirstListenCompleted, getWeatherSettings } from '../../src/services/Storage';
```

Find the `manifestClient.createBroadcast({...})` call inside `runBake` (around line 110). Build the same `weatherCoords` value and add to userContext:

```ts
      const weatherSettings = getWeatherSettings();
      const weatherCoords = (weatherSettings?.enabled && weatherSettings.coords)
        ? {
            lat: weatherSettings.coords.lat,
            lon: weatherSettings.coords.lon,
            cityName: weatherSettings.resolvedLabel.split(',')[0].trim(),
          }
        : undefined;

      // ... existing controller/timer setup ...

        const response = await manifestClient.createBroadcast(
          {
            playlistId: source.playlistId,
            vibe: defaultVibeForFirstListen(),
            length: 'quick',
            userContext: {
              timeOfDay: localTimeHHMM(),
              dayOfWeek: localDayOfWeek(),
              firstTimeUser: true,
              listenerName: name,
              weatherCoords,
            },
            tracks: source.tracks,
          },
          controller.signal,
        );
```

(Place the `weatherSettings`/`weatherCoords` fetch outside the try-block timer setup if that's cleaner; either placement is fine.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx jest`
Expected: full client suite green (no test changes; existing tests should still pass).

- [ ] **Step 4: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx app/\(onboarding\)/first-listen.tsx
git commit -m "$(cat <<'EOF'
feat(client): attach weatherCoords to bake POSTs when enabled

HomeBroadcastScreen + first-listen both read getWeatherSettings();
when settings.enabled is true and coords are set, attach
weatherCoords: { lat, lon, cityName } to userContext on
createBroadcast. cityName is the first comma-separated token of
resolvedLabel (e.g., "Brooklyn" from "Brooklyn, NY, US").

When settings is null or disabled, the field is undefined and
the server skips weather entirely.

Closes #34.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Documentation — `OPENWEATHER_API_KEY` + Profile note

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the env var to the server.env section**

Edit `CLAUDE.md`. Find the env var block under `server/.env` (search for `CURATOR_PUBLISH_CAP` for context). Add:

```text
OPENWEATHER_API_KEY                       # OpenWeatherMap free tier; unset → weather hints disabled
```

next to similar optional integration keys.

- [ ] **Step 2: Add a brief mention of the new Profile section**

Find the Profile/Settings discussion in CLAUDE.md (search for `ProfileScreen` or `(cleo)/index`). Add a short note:

> Profile gains a "Weather context" section: opt-in toggle + city input that resolves through `/weather/geocode` (server-side OWM call) and persists `{ enabled, coords, resolvedLabel }` to MMKV. When enabled, `POST /broadcast/create`'s userContext includes `weatherCoords`; the server fetches a hint sentence and injects into the cold_open prompt's scene block.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document OPENWEATHER_API_KEY + first-listen weather section

Adds the new env var to the server/.env reference (unset is fine —
weather hints become silent no-ops). Briefly notes the new Profile
section + its data flow through to the cold_open prompt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Pre-PR checklist

- [ ] All 11 tasks complete
- [ ] `cd server && npm test` — full server suite green (Tasks 1, 2, 3, 5 add tests; everything else passes)
- [ ] `cd server && npx tsc --noEmit` — clean
- [ ] `npx jest` from repo root — full client suite green (Task 7 adds tests)
- [ ] `npx tsc --noEmit` — clean
- [ ] **Manual TestFlight verification** on a real iOS device:
  - Profile shows the new Weather context section
  - Toggle ON → enter city → SET → resolves OR shows picker; saved label shows the disambiguated city
  - Trigger a bake; cold open mentions the weather (or doesn't, if conditions vary — check server logs for `[WeatherProvider]` calls and the resulting hint sentence)
  - Toggle OFF → bake; cold open omits weather mention; server skips the OWM fetch
- [ ] Server VPS deploy — same flow as before (rsync + npm ci + npm run build + pm2 restart). Set `OPENWEATHER_API_KEY=<key>` in `/home/cleo/cleo-broadcast/.env` *before* the PM2 restart, otherwise weather hints will silently no-op until the next deploy
- [ ] `coderabbit review --plain --base main --type committed` from repo root; verify each finding against current code, fix legitimate ones in new commits, re-run only if substantive
- [ ] `gh pr create --title "feat: weather context in cold opens (#34)"` with body summarizing the feature + the manual TestFlight result + the OWM API key configuration step

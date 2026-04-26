# Weather Context in Cold Opens — Design

**Date:** 2026-04-26
**Status:** Brainstorm-approved; awaiting user spec review
**Roadmap link:** [`2026-04-24-onay-roadmap-design.md`](2026-04-24-onay-roadmap-design.md) → Phase 2 → LT-5
**Issue:** [bworthy89/cleo#34](https://github.com/bworthy89/cleo/issues/34)

---

## Why

Phase 2's "parity sprint" pitch: *"ONAY does everything Yoodio/Radiant do that genuinely matters."* A common criticism of AI radio is that it feels stateless — every cold open is the same generic vibe-derived greeting. Real DJs anchor in the *moment*: time, weather, season. The roadmap calls out weather specifically because it's:

- Cheap to acquire (free OpenWeatherMap tier covers 1M calls/month, 10× our worst-case budget at 1k DAU)
- Universally relevant (every user has weather; no demographic skew)
- One mention buys outsized payoff (the moment ONAY says "It's 47 and lightly raining in Brooklyn" the user knows this isn't a pre-recorded loop)
- Bounded scope — no news, no traffic, no other context. One feature at a time.

This issue adds an opt-in weather mention to the cold-open prompt. Off by default; users explicitly enable on Profile + set their city.

## Scope

**In scope:**
- New `WeatherProvider` server class wrapping OpenWeatherMap's "Current Weather Data" + "Geocoding" APIs.
- Server-side geocode-then-confirm flow: client posts city text to `/weather/geocode`, server returns up to 3 candidates, user picks the right one.
- 30-minute in-memory cache keyed on rounded lat/lon (~1km granularity).
- Pre-formatted hint sentence ("It's 47 and lightly raining in Brooklyn.") inserted into `SegmentContext` and the cold_open prompt's scene block.
- Client opt-in toggle + city input on the Profile screen, persisted to MMKV.
- `userContext.weatherCoords` accepted by `POST /broadcast/create`'s Zod schema.
- Failure path: any OWM error → null hint → bake proceeds weather-free, no user-visible error.

**Out of scope:**
- News, traffic, sports, or any other external context (spec literal).
- Auto-geolocation via GPS / `expo-location`. Text city input only for v1; the silent-wrong-city failure mode of free-text-pass-through is sidestepped by the geocode-then-confirm flow.
- Multi-city support — one saved city per user. Travelers can re-pick.
- Localized weather copy (Spanish, etc.). English only; OWM's localized descriptions exist but the hint sentence is server-formatted — we'd be making the locale call ourselves.
- Weather in non-cold_open segments. Sign-off ("layer up out there") would be plausible but adds prompt complexity for marginal payoff; reconsider if user research wants it.
- Filesystem cache. In-memory is fine — 30-min TTL means warmth doesn't matter much, and PM2 restarts re-warm in <30 min.
- Per-user rate limiting on `/weather/geocode`. Geocoding is rare (one call per Profile-edit). The existing `generationLimiter` covers `POST /broadcast/create` budgets.
- Auto-detection of preferred units (°F vs °C) by saved country. Imperial only for v1.

## Approach

### Geocode-then-confirm flow

The user types "Brooklyn" once. Free-text pass-through to OWM's weather API would silently land on whichever Brooklyn it returns first (often Brooklyn, NY, but not guaranteed) — a confusing failure mode where weather looks correct but is for the wrong city. Instead:

1. Client `POST /weather/geocode { q: "Brooklyn" }`.
2. Server calls OWM Geocoding API, returns up to 3 candidates with `{ name, state?, country, lat, lon }`.
3. Client renders a one-tap picker if >1 result; auto-confirms if 1.
4. Selected coords + display label persisted to MMKV.
5. Subsequent `POST /broadcast/create` includes `userContext.weatherCoords: { lat, lon, cityName }`.

Server-mediated geocode keeps the OWM API key server-side and lets us add per-user rate limits later if abuse appears. One extra round-trip at city-set time is fine; it's a one-time UX cost.

### Hint format

Server formats the hint as a single human-readable sentence and passes it as a scene-block instruction line to the LLM, alongside the existing `"It's Sunday, 14:32."` and `"Call them Bakari."` lines. The LLM is free to use, paraphrase, or skip it — same loose contract as other scene lines.

Why pre-formatted (not structured `Weather: 47°F, light rain, Brooklyn`):

- The unit choice (°F), the rounding ("47" not "47.3"), and the verb selection ("lightly raining" not "drizzling") are all editorial decisions the server should own — not the LLM. A pre-formatted sentence locks those in.
- The TTS filesystem cache key is the *final* TTS-bound text. The closer we keep the LLM to a fixed phrasing for a given condition, the better the cross-bake cache hit rate. Pre-formatting biases toward consistency.

The "TTS cache dedupes across users in the same condition" claim from the issue is **aspirational** — TTS cache hits depend on identical LLM output, which depends on identical prompt + model determinism, neither of which is guaranteed across users with different names, playlists, etc. Pre-formatting maximizes the realistic cache wins (within a single user's same-condition repeats); cross-user wins are a bonus, not a guarantee.

### Hint sentence shapes

The provider picks one shape per condition based on OWM's `weather[0].main` field:

| OWM main | Sentence template (example) |
|---|---|
| `Clear` | "It's a clear {temp} in {city}." |
| `Clouds` | "It's a cloudy {temp} in {city}." |
| `Rain` (light) | "It's {temp} and lightly raining in {city}." |
| `Rain` (heavy) | "It's pouring in {city} — {temp}." |
| `Drizzle` | "It's {temp} and drizzly in {city}." |
| `Snow` | "It's {temp} and snowing in {city}." |
| `Thunderstorm` | "There's a thunderstorm rolling through {city} — {temp}." |
| `Mist`, `Fog`, `Haze` | "It's {temp} and foggy in {city}." |
| anything else | "It's {temp} in {city}." (fallback) |

Light vs. heavy rain disambiguated via OWM's `weather[0].id`: 500–501 (light/moderate rain) vs 502–504 (heavy / very-heavy / extreme rain). City name is the user-confirmed display label (e.g., `"Brooklyn"`), not OWM's localized name.

### Server architecture

**`server/src/providers/weather/WeatherProvider.ts`** (new):

```ts
export interface WeatherCoords { lat: number; lon: number; }

export interface WeatherCandidate {
  name: string;
  state?: string;
  country: string;
  lat: number;
  lon: number;
}

export class WeatherProvider {
  constructor(opts: {
    apiKey: string;
    clock?: () => number;
    fetch?: typeof globalThis.fetch;  // injectable for tests
    timeoutMs?: number;               // injectable for tests; default 5000ms
  });

  /**
   * Get the cold-open hint sentence for a coord. Returns null on any
   * fetch / parse error; caller should skip the hint silently.
   * 30-minute in-memory cache keyed on rounded (2-decimal) lat/lon.
   */
  getHint(coords: WeatherCoords, cityName: string): Promise<string | null>;

  /** Up to 3 candidate locations. Used by /weather/geocode. */
  geocode(query: string): Promise<WeatherCandidate[]>;
}
```

**`server/src/routes/weather.ts`** (new): `POST /weather/geocode { q: string }` → `{ candidates: WeatherCandidate[] }`. Auth-gated via `requireAuth`. No `/weather/hint` route — the bake path fetches that internally.

**`SegmentContext`** (`SegmentScriptBuilder.ts:5–12`): adds `weatherHint?: string`. `buildSceneLines` appends `if (ctx.weatherHint) lines.push(ctx.weatherHint);` to the scene block. Sign-off and bridge prompts don't include scene lines, so the hint surfaces only in cold_open by construction.

**`BroadcastOrchestrator`** wiring: when `userContext.weatherCoords` is present, call `weatherProvider.getHint(coords, cityName)` once per bake. On null result, skip; otherwise pass to `buildSegmentPrompts(ctx)` via `ctx.weatherHint`.

**`POST /broadcast/create`** Zod schema: extend `userContext` with `weatherCoords: z.object({ lat: z.number(), lon: z.number(), cityName: z.string().max(100) }).optional()`.

### Client architecture

**MMKV**: new key `WEATHER_SETTINGS = 'weather_settings'`, shape:
```ts
interface WeatherSettings {
  enabled: boolean;
  city: string;          // user's typed input, for re-display
  coords: { lat: number; lon: number };
  resolvedLabel: string; // "Brooklyn, NY, US" — display under input
}
```
Nullability lives on the accessor, not the type: `getWeatherSettings()` returns `WeatherSettings | null` (null when the key is unset or fails the runtime shape guard in `Storage.ts`).

**`Storage.ts`** new accessors: `getWeatherSettings()`, `setWeatherSettings(settings)`, `clearWeatherSettings()`.

**Profile screen**: new section with toggle + city input + result row. Submit calls `/weather/geocode`, renders picker if multiple results, persists selection to MMKV.

**`POST /broadcast/create` builder**: when `WeatherSettings.enabled === true && coords` present, append `userContext.weatherCoords: { ...coords, cityName: settings.resolvedLabel.split(',')[0] }`.

### Failure modes

| Failure | Behavior |
|---|---|
| User toggle OFF | `userContext.weatherCoords` not sent. Server skips weather fetch entirely. |
| User toggle ON but no coords saved (interrupted setup) | Same as OFF — no coords means no fetch. |
| `/weather/geocode` API call fails | Client surfaces `Alert.alert('Weather lookup unavailable', 'Try again later.')` from `ProfileScreen.onSubmitCity`. User's saved settings unchanged. |
| OWM "current weather" API fails during bake | Server logs once, returns null hint. Bake proceeds without weather. No user-visible error. |
| `OPENWEATHER_API_KEY` env var missing | `WeatherProvider` is never instantiated and `/weather/geocode` is not mounted; bake-time hint resolution short-circuits because `BroadcastOrchestrator` only calls `getHint` when the provider exists. Server logs a one-time startup warning. Lets us ship without the key configured — the toggle remains visible in Profile but city lookups will 404. |
| OWM rate-limited (429) | Treated as a fetch error → null hint, no retry within the bake. The 30-min cache + free-tier headroom make this rare. |
| User picks wrong candidate or city moves | They re-set on Profile. Stale settings persist until they re-pick. |

### Configuration

```env
# server/.env
OPENWEATHER_API_KEY=<from openweathermap.org free tier>
```

The free tier permits 60 calls/min and 1M/month. Worst-case at 1k DAU × 3 bakes/day = 3k bakes/day; with 30-min cache hit rate, expect <1k actual OWM calls/day → 30k/month — 3% of free-tier quota. No rate-limit handling needed at v1.

## Test strategy

- **`WeatherProvider.test.ts`** (new, 7 cases): cache hit within 30 min returns cached hint; cache expires after 30 min and re-fetches; thrown fetch error returns null (caller skips silently); non-2xx response (e.g. 429) returns null; `AbortController` aborts the fetch when it exceeds `timeoutMs`; rain-id range disambiguation produces the right hint sentence; `geocode` returns parsed candidates from a mocked OWM response. Uses `fetch` injection + `clock` injection + `timeoutMs` injection.
- **Weather route test** (new, 3 cases): `POST /weather/geocode` returns 200 with candidates under happy path; returns 400 on missing/empty query; returns 400 on whitespace-only query (Zod `.trim().min(1)`). The provider's `geocode` already swallows network errors and returns `[]`, so a route-level 502 path is intentionally absent — the route would respond 200 with an empty candidates array on OWM downtime, and the client's `Alert.alert("Couldn't find that city", …)` covers that case.
- **`SegmentScriptBuilder.test.ts`** extension (3 new cases): with `ctx.weatherHint` present, the cold_open user-prompt contains the sentence verbatim; the transition user-prompt does NOT; the sign_off user-prompt does NOT.
- **`BroadcastOrchestrator.test.ts`** extension (1 new case): when `userContext.weatherCoords` is present, `weatherProvider.getHint` is called once and the resolved hint flows into the prompt context. Mock `WeatherProvider`.
- **Client**: no automated screen test (consistent with the rest of the codebase). Profile UI verified manually on TestFlight.

## Files touched

- **Create** `server/src/providers/weather/WeatherProvider.ts` — provider class.
- **Create** `server/__tests__/providers/weather/WeatherProvider.test.ts` — 7 unit tests.
- **Create** `server/src/routes/weather.ts` — geocode route.
- **Create** `server/__tests__/routes/weather.test.ts` — route tests.
- **Modify** `server/src/services/broadcast/SegmentScriptBuilder.ts` — `SegmentContext.weatherHint`, `buildSceneLines` insertion.
- **Modify** `server/__tests__/broadcast/SegmentScriptBuilder.test.ts` — cold_open vs sign_off propagation.
- **Modify** `server/src/services/broadcast/types.ts` — `userContext.weatherCoords?` field.
- **Modify** `server/src/routes/broadcast.ts` — Zod schema extension.
- **Modify** `server/src/services/broadcast/BroadcastOrchestrator.ts` — hint fetch + prompt-context passthrough.
- **Modify** `server/__tests__/broadcast/BroadcastOrchestrator.test.ts` — wiring test.
- **Modify** `server/src/index.ts` — instantiate `WeatherProvider`, mount weather route.
- **Modify** `src/services/Storage.ts` — `getWeatherSettings` / `setWeatherSettings` / `clearWeatherSettings` accessors + new `StorageKeys.WEATHER_SETTINGS`.
- **Modify** `__tests__/services/Storage.test.ts` — accessor tests.
- **Modify** `src/screens/settings/ProfileScreen.tsx` — new "Weather context" section with toggle, input, geocode call, picker rendering.
- **Modify** `src/engines/BroadcastManifestClient.ts` — extend `CreateBroadcastRequest['userContext']` with the optional `weatherCoords` field; HomeBroadcastScreen + first-listen call sites populate it from MMKV when enabled.
- **Modify** `src/screens/home/HomeBroadcastScreen.tsx` — read settings, attach to bake POST.
- **Modify** `app/(onboarding)/first-listen.tsx` — same.
- **Modify** `CLAUDE.md` — document `OPENWEATHER_API_KEY` env var; add a one-line note to the project structure section about the new section on Profile.

## Open questions

None at design time. Imperial-only and one-mention-per-cold-open are explicit decisions; localization and per-user rate limits on geocode are deferred follow-ups if real-world usage warrants them.

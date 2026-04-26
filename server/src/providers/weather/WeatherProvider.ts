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
  const tempRounded = Math.round(data.main?.temp ?? 0);
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

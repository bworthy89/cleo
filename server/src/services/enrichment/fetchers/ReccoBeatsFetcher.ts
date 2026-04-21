import { normalizeLoudness } from '../../broadcast/audio-features';
import type { AudioFeatures } from '../../broadcast/audio-features';

const BATCH_SIZE = 10;
const BASE_URL = 'https://api.reccobeats.com/v1/audio-features';
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1000;
const BATCH_GAP_MS = 500;
const TIMEOUT_MS = 5000;

interface ReccoResponse {
  content?: Array<{
    id: string;
    isrc?: string;       // ReccoBeats added this to the response 2025-12-13
    tempo?: number;
    energy?: number;
    valence?: number;
    danceability?: number;
    acousticness?: number;
    loudness?: number;
    instrumentalness?: number;
  }>;
}

export class ReccoBeatsFetcher {
  async fetch(isrcs: string[]): Promise<Map<string, AudioFeatures>> {
    const results = new Map<string, AudioFeatures>();
    for (let i = 0; i < isrcs.length; i += BATCH_SIZE) {
      const chunk = isrcs.slice(i, i + BATCH_SIZE);
      const batch = await this.fetchBatch(chunk);
      for (const [id, features] of batch) results.set(id, features);
      if (i + BATCH_SIZE < isrcs.length) {
        await new Promise(r => setTimeout(r, BATCH_GAP_MS));
      }
    }
    return results;
  }

  private async fetchBatch(
    isrcs: string[],
  ): Promise<Map<string, AudioFeatures>> {
    // ReccoBeats expects `?ids=a,b,c` (comma-separated), NOT `?ids[]=a&ids[]=b`.
    // Passing `ids[]=…` returns HTTP 400 on every call. Confirmed against the
    // live endpoint during smoke test 2026-04-21.
    const url = `${BASE_URL}?ids=${isrcs.map(i => encodeURIComponent(i)).join(',')}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          lastErr = new Error(`ReccoBeats HTTP ${res.status}`);
          const retriable = res.status >= 500 || res.status === 429;
          if (retriable && attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          console.warn(`[ReccoBeats] ${lastErr}`);
          return new Map();
        }
        const json = await res.json() as ReccoResponse;
        const out = new Map<string, AudioFeatures>();
        for (const row of json.content ?? []) {
          if (!row.isrc) continue;
          const feat = this.toAudioFeatures(row);
          if (feat) out.set(row.isrc, feat);
        }
        return out;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        console.warn(`[ReccoBeats] fetch failed: ${err}`);
        return new Map();
      }
    }
    // Unreachable — all paths inside the loop return or continue, and
    // continue on the last attempt is gated by `attempt < MAX_RETRIES`.
    // Kept to satisfy TypeScript's control-flow analysis (TS2366).
    return new Map();
  }

  /** Map a ReccoBeats row to AudioFeatures. Missing fields → null (the
   *  caller treats nulls as "partial" and fills via synth). */
  private toAudioFeatures(
    row: NonNullable<ReccoResponse['content']>[number],
  ): AudioFeatures | null {
    const required = [
      row.tempo, row.energy, row.valence, row.danceability,
      row.acousticness, row.loudness, row.instrumentalness,
    ];
    if (required.some(v => v === undefined || v === null || Number.isNaN(v))) {
      return null; // skip partial rows here; FeatureFetchChain handles synth
    }
    return {
      tempo: row.tempo!,
      energy: row.energy!,
      valence: row.valence!,
      danceability: row.danceability!,
      acousticness: row.acousticness!,
      loudness: normalizeLoudness(row.loudness!),
      instrumentalness: row.instrumentalness!,
    };
  }
}

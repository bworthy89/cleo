import { normalizeLoudness } from '../../broadcast/audio-features';

const TIMEOUT_MS = 5000;

export interface DeezerPartial {
  tempo: number;       // BPM from Deezer
  loudness: number;    // normalized to 0-1
}

export class DeezerFeaturesFetcher {
  async fetch(isrc: string): Promise<DeezerPartial | null> {
    try {
      const url = `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const json = await res.json() as { bpm?: number; gain?: number };
      if (typeof json.bpm !== 'number' || json.bpm <= 0) return null;
      const gain = typeof json.gain === 'number' ? json.gain : -20;
      return {
        tempo: json.bpm,
        loudness: normalizeLoudness(gain),
      };
    } catch (err) {
      console.warn(`[Deezer] isrc:${isrc} fetch failed: ${err}`);
      return null;
    }
  }
}

export interface ScrobbleTrack {
  title: string;
  artistName: string;
  albumTitle?: string;
  duration: number;        // seconds
  startedAt?: number;      // unix seconds — required for scrobble, omitted for now-playing
}

export type LastFmResult =
  | { ok: true }
  | { ok: false; errorCode: number; errorMessage: string };

export interface ScrobblePayload {
  trackId: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  duration: number;
}

export interface ScrobbleEventPayload extends ScrobblePayload {
  startedAt: number;  // unix seconds
}

export interface ScrobblerApi {
  nowPlaying(p: ScrobblePayload): Promise<void>;
  scrobble(p: ScrobbleEventPayload): Promise<void>;
}

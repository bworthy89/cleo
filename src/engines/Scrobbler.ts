import type { ManifestTrack } from './BroadcastPlayer.types';
import type { ScrobblePayload, ScrobblerApi } from './Scrobbler.types';

const MIN_DURATION_S = 30;
const MAX_THRESHOLD_S = 240;

export class Scrobbler {
  private currentId: string | null = null;
  private startedAtMs = 0;
  private threshold = 0;
  private scrobbledThisTrack = false;

  constructor(private readonly api: ScrobblerApi) {}

  onTrackStarted(track: ManifestTrack): void {
    this.currentId = track.id;
    this.startedAtMs = Date.now();
    this.scrobbledThisTrack = false;

    if (track.duration < MIN_DURATION_S) {
      this.scrobbledThisTrack = true;
      return;
    }
    this.threshold = Math.min(track.duration * 0.5, MAX_THRESHOLD_S);

    const payload: ScrobblePayload = {
      trackId: track.id,
      title: track.title,
      artistName: track.artistName,
      albumTitle: track.albumTitle,
      duration: track.duration,
    };
    this.api.nowPlaying(payload).catch(() => {});
  }

  onElapsedTick(track: ManifestTrack, elapsedSec: number): void {
    if (this.scrobbledThisTrack) return;
    if (track.id !== this.currentId) return;
    if (elapsedSec < this.threshold) return;

    this.scrobbledThisTrack = true;
    this.api.scrobble({
      trackId: track.id,
      title: track.title,
      artistName: track.artistName,
      albumTitle: track.albumTitle,
      duration: track.duration,
      startedAt: Math.floor(this.startedAtMs / 1000),
    }).catch(() => {});
  }

  reset(): void {
    this.currentId = null;
    this.scrobbledThisTrack = false;
  }
}

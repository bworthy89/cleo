import { BroadcastSegmentCache } from './BroadcastSegmentCache';
import type {
  Manifest, PlayerState, PlayerStatus, Vibe,
} from './BroadcastPlayer.types';
import type { StingerKind } from './BroadcastStingers';

export interface MusicDeps {
  play: (ids?: string[]) => Promise<void>;
  pause: () => Promise<void>;
  skip: () => Promise<void>;
  setUpcomingQueue: (ids: string[]) => Promise<void>;
  onTrackChanged: (cb: (e: { trackId?: string }) => void) => () => void;
  onPlaybackStateChanged: (cb: (e: { status: string; playbackTime: number }) => void) => () => void;
}

export interface NativeDeps {
  activateDuckingSession: () => Promise<void>;
  deactivateDuckingSession: () => Promise<void>;
  playAudioFromBase64: (base64: string) => Promise<void>;
  stopAudio: () => Promise<void>;
}

export interface ManifestDeps {
  fetchSegmentAudio: (url: string) => Promise<string>;
  fetchManifest: (id: string) => Promise<Manifest>;
}

export interface StingerDeps {
  getStinger: (vibe: Vibe, kind: StingerKind) => Promise<string | null>;
  preloadStingers: () => Promise<void>;
}

export class BroadcastPlayer {
  private state: PlayerState = 'idle';
  private manifest: Manifest | null = null;
  private cache = new BroadcastSegmentCache();
  private currentTrackIndex = -1;
  private currentSegmentIndex = -1;
  private subscriptions: Array<() => void> = [];
  private trackEndedResolve: (() => void) | null = null;

  constructor(
    private readonly music: MusicDeps,
    private readonly native: NativeDeps,
    private readonly manifestClient: ManifestDeps,
    private readonly stingers: StingerDeps,
  ) {}

  getStatus(): PlayerStatus {
    return {
      state: this.state,
      currentTrackIndex: this.currentTrackIndex,
      currentSegmentIndex: this.currentSegmentIndex,
      broadcastId: this.manifest?.broadcastId ?? null,
      nowPlaying: this.describeNowPlaying(),
      progress: this.computeProgress(),
    };
  }

  async start(manifest: Manifest, firstSegmentUrls: string[]): Promise<void> {
    this.manifest = manifest;
    this.cache.clear();
    this.state = 'loading';
    await this.stingers.preloadStingers();

    for (let v = 0; v < firstSegmentUrls.length; v++) {
      try {
        const b64 = await this.manifestClient.fetchSegmentAudio(firstSegmentUrls[v]);
        this.cache.put(0, v, b64);
      } catch {
        // one variant failure is not fatal
      }
    }

    this.kickBackgroundFetch();

    this.subscriptions.push(
      this.music.onPlaybackStateChanged(this.handlePlaybackState),
      this.music.onTrackChanged(this.handleTrackChanged),
    );

    await this.runSegmentAt(0);
    if (!this.manifest) return;
    for (let i = 0; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);
      if (!this.manifest) return;
      await this.runSegmentAt(i + 1);
      if (!this.manifest) return;
    }
    this.state = 'ended';
  }

  async pause(): Promise<void> {
    await this.native.stopAudio().catch(() => {});
    await this.music.pause().catch(() => {});
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.state = 'playing_track';
    await this.music.play().catch(() => {});
  }

  async end(): Promise<void> {
    await this.native.stopAudio().catch(() => {});
    await this.music.pause().catch(() => {});
    this.subscriptions.forEach(unsub => {
      try { unsub(); } catch { /* ignore */ }
    });
    this.subscriptions = [];
    this.cache.clear();
    this.manifest = null;
    this.currentTrackIndex = -1;
    this.currentSegmentIndex = -1;
    this.trackEndedResolve = null;
    this.state = 'idle';
  }

  private async runSegmentAt(slotIndex: number): Promise<void> {
    if (!this.manifest) return;
    const slot = this.manifest.segmentSlots[slotIndex];
    if (!slot) return;

    this.currentSegmentIndex = slotIndex;
    this.state = 'playing_segment';
    const vibe = this.manifest.vibe;

    if (!this.cache.hasAny(slotIndex) && slot.status === 'ready' && slot.audioUrls) {
      for (let v = 0; v < slot.audioUrls.length; v++) {
        try {
          const b64 = await this.manifestClient.fetchSegmentAudio(slot.audioUrls[v]);
          this.cache.put(slotIndex, v, b64);
        } catch {
          // continue — one variant can fail
        }
      }
    }

    const segmentB64 = this.cache.pickVariant(slotIndex, slot.variantCount);
    if (!segmentB64) {
      // Nothing to play — skip silently. Transition audio is optional by design.
      this.currentSegmentIndex = -1;
      return;
    }

    await this.native.activateDuckingSession().catch(() => {});
    try {
      const stingerIn = await this.stingers.getStinger(vibe, 'in').catch(() => null);
      if (stingerIn) await this.native.playAudioFromBase64(stingerIn).catch(() => {});
      await this.native.playAudioFromBase64(segmentB64).catch(() => {});
      const stingerOut = await this.stingers.getStinger(vibe, 'out').catch(() => null);
      if (stingerOut) await this.native.playAudioFromBase64(stingerOut).catch(() => {});
    } finally {
      await this.native.deactivateDuckingSession().catch(() => {});
      this.currentSegmentIndex = -1;
    }
  }

  private async runTrackAt(trackIndex: number): Promise<void> {
    if (!this.manifest) return;
    const track = this.manifest.tracks[trackIndex];
    this.currentTrackIndex = trackIndex;
    this.state = 'playing_track';
    try {
      await this.music.play([track.id]);
    } catch {
      // Track not playable — skip and advance. Without this guard,
      // a bad track stalls the whole broadcast in playing_track state.
      return;
    }
    await this.waitForTrackEnd();
  }

  private waitForTrackEnd(): Promise<void> {
    return new Promise(resolve => {
      this.trackEndedResolve = () => resolve();
    });
  }

  private handlePlaybackState = (e: { status: string; playbackTime: number }) => {
    try {
      if (e.status === 'stopped' && this.state === 'playing_track') {
        this.trackEndedResolve?.();
      }
    } catch {
      // Swallow — one listener mishap must not kill subsequent dispatches
      // across the MusicKit listener iterator (per CLAUDE.md convention).
    }
  };

  private handleTrackChanged = (_e: { trackId?: string }) => {
    try {
      // Informational for now; state machine advances on 'stopped'.
    } catch {
      // Swallow (see handlePlaybackState).
    }
  };

  private kickBackgroundFetch(): void {
    if (!this.manifest) return;
    for (const slot of this.manifest.segmentSlots.slice(1)) {
      if (slot.status !== 'ready' || !slot.audioUrls) continue;
      for (let v = 0; v < slot.audioUrls.length; v++) {
        this.manifestClient
          .fetchSegmentAudio(slot.audioUrls[v])
          .then(b64 => { this.cache.put(slot.index, v, b64); })
          .catch(() => {});
      }
    }
  }

  private describeNowPlaying(): PlayerStatus['nowPlaying'] {
    if (!this.manifest) return null;
    if (this.currentSegmentIndex >= 0) {
      return { segmentKind: this.manifest.segmentSlots[this.currentSegmentIndex].kind };
    }
    if (this.currentTrackIndex >= 0) {
      return { trackId: this.manifest.tracks[this.currentTrackIndex].id };
    }
    return null;
  }

  private computeProgress(): number {
    if (!this.manifest) return 0;
    const total = this.manifest.tracks.length + this.manifest.segmentSlots.length;
    if (total === 0) return 0;
    const done = (this.currentTrackIndex + 1) + (this.currentSegmentIndex + 1);
    return Math.min(1, done / total);
  }
}


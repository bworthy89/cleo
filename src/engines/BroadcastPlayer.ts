import { BroadcastSegmentCache } from './BroadcastSegmentCache';
import type {
  Manifest, PlayerState, PlayerStatus, Vibe,
} from './BroadcastPlayer.types';
import type { StingerKind } from './BroadcastStingers';
import { setPersistedBroadcast, clearPersistedBroadcast } from '../services/Storage';

export interface MusicDeps {
  play: (ids?: string[]) => Promise<void>;
  pause: () => Promise<void>;
  skip: () => Promise<void>;
  setUpcomingQueue: (ids: string[]) => Promise<void>;
  onTrackChanged: (cb: (e: { trackId?: string }) => void) => () => void;
  onPlaybackStateChanged: (cb: (e: { status: string; playbackTime: number }) => void) => () => void;
  getPlaybackStatus?: () => Promise<string>;
  getPlaybackTime?: () => Promise<number>;
}

export interface NativeDeps {
  activateDuckingSession: () => Promise<void>;
  deactivateDuckingSession: () => Promise<void>;
  playAudioFromBase64: (base64: string) => Promise<void>;
  stopAudio: () => Promise<void>;
  releaseAudioSession?: () => Promise<void>;
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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly POLL_INTERVAL_MS = 3000;
  private isPaused = false;
  private resumePromise: Promise<void> | null = null;
  private resumeResolver: (() => void) | null = null;

  constructor(
    private readonly music: MusicDeps,
    private readonly native: NativeDeps,
    private readonly manifestClient: ManifestDeps,
    private readonly stingers: StingerDeps,
  ) {}

  getStatus(): PlayerStatus {
    const track =
      this.manifest && this.currentTrackIndex >= 0
        ? this.manifest.tracks[this.currentTrackIndex]
        : null;
    return {
      state: this.state,
      currentTrackIndex: this.currentTrackIndex,
      currentSegmentIndex: this.currentSegmentIndex,
      broadcastId: this.manifest?.broadcastId ?? null,
      vibe: this.manifest?.vibe ?? null,
      totalTracks: this.manifest?.tracks.length ?? 0,
      currentTrack: track ?? null,
      nowPlaying: this.describeNowPlaying(),
      progress: this.computeProgress(),
    };
  }

  async start(manifest: Manifest, firstSegmentUrls: string[]): Promise<void> {
    this.manifest = manifest;
    setPersistedBroadcast(manifest);
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
    this.schedulePolling();

    this.subscriptions.push(
      this.music.onPlaybackStateChanged(this.handlePlaybackState),
      this.music.onTrackChanged(this.handleTrackChanged),
    );

    await this.runSegmentAt(0);
    if (!this.manifest) return;
    await this.waitIfPaused();
    if (!this.manifest) return;
    for (let i = 0; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      await this.runSegmentAt(i + 1);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
    }
    this.state = 'ended';
    clearPersistedBroadcast();
  }

  /**
   * Pause the broadcast. Behavior is deliberately kind to in-flight segments:
   * if ONAY is mid-sentence we let her finish (AVAudioPlayer doesn't have a
   * gapless pause) and then park the loop before the next track. Tracks
   * themselves pause immediately via MusicKit.
   */
  async pause(): Promise<void> {
    if (this.state === 'idle' || this.state === 'ended') return;
    const wasPlayingTrack = this.state === 'playing_track';
    this.isPaused = true;
    if (wasPlayingTrack) {
      await this.music.pause().catch(() => {});
    }
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    if (!this.isPaused) return;
    this.isPaused = false;
    // Restore state + restart music if we paused mid-track.
    if (this.currentTrackIndex >= 0 && this.currentSegmentIndex < 0) {
      this.state = 'playing_track';
      await this.music.play().catch(() => {});
    } else if (this.currentSegmentIndex >= 0) {
      this.state = 'playing_segment';
    } else {
      this.state = 'loading';
    }
    this.wakePausedLoop();
  }

  private async waitIfPaused(): Promise<void> {
    while (this.isPaused) {
      if (!this.resumePromise) {
        this.resumePromise = new Promise(res => { this.resumeResolver = res; });
      }
      await this.resumePromise;
    }
  }

  private wakePausedLoop(): void {
    const resolver = this.resumeResolver;
    this.resumePromise = null;
    this.resumeResolver = null;
    resolver?.();
  }

  async end(): Promise<void> {
    // Unblock the main loop if it's parked on waitIfPaused, then clear
    // manifest so it exits cleanly on the next iteration check.
    this.isPaused = false;
    this.wakePausedLoop();
    await this.native.stopAudio().catch(() => {});
    await this.music.pause().catch(() => {});
    this.subscriptions.forEach(unsub => {
      try { unsub(); } catch { /* ignore */ }
    });
    this.subscriptions = [];
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.cache.clear();
    this.manifest = null;
    this.currentTrackIndex = -1;
    this.currentSegmentIndex = -1;
    this.trackEndedResolve = null;
    this.state = 'idle';
    clearPersistedBroadcast();
  }

  private schedulePolling(): void {
    if (!this.manifest) return;
    if (this.pollTimer) return;
    const anyPending = this.manifest.segmentSlots.some(s => s.status === 'pending');
    if (!anyPending) return;
    this.pollTimer = setInterval(() => {
      this.pollManifestOnce().catch(() => { /* transient — retry next tick */ });
    }, this.POLL_INTERVAL_MS);
  }

  async pollManifestOnce(): Promise<void> {
    if (!this.manifest) return;
    const updated = await this.manifestClient.fetchManifest(this.manifest.broadcastId);
    this.manifest = updated;
    // Background-fetch any slots that just flipped to ready
    this.kickBackgroundFetch();
    const allDone = updated.segmentSlots.every(s => s.status !== 'pending');
    if (allDone && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async runSegmentAt(slotIndex: number): Promise<void> {
    if (!this.manifest) return;
    const slot = this.manifest.segmentSlots[slotIndex];
    if (!slot) return;

    this.currentSegmentIndex = slotIndex;
    this.state = 'playing_segment';
    const vibe = this.manifest.vibe;

    if (slot.status === 'failed') {
      // Slot failed at bake time — skip silently, continue broadcast.
      this.currentSegmentIndex = -1;
      return;
    }

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
      // Release the audio session fully so MusicKit's ApplicationMusicPlayer
      // can reclaim it for the next track. Without this, TTS leaves the session
      // in mixWithOthers mode and MusicKit silently fails to start playback.
      if (this.native.releaseAudioSession) {
        await this.native.releaseAudioSession().catch(() => {});
      }
      this.currentSegmentIndex = -1;
    }
  }

  private async runTrackAt(trackIndex: number): Promise<void> {
    if (!this.manifest) return;
    const track = this.manifest.tracks[trackIndex];
    this.currentTrackIndex = trackIndex;
    this.state = 'playing_track';
    console.log(`[BroadcastPlayer] runTrackAt(${trackIndex}) id=${track.id} "${track.title}"`);
    try {
      await this.music.play([track.id]);
      console.log(`[BroadcastPlayer] music.play resolved for ${track.id}`);
    } catch (err) {
      console.warn(`[BroadcastPlayer] music.play threw for ${track.id}:`, err);
      return;
    }
    await this.waitForTrackEnd();
    console.log(`[BroadcastPlayer] track ended: ${track.id}`);
  }

  private waitForTrackEnd(): Promise<void> {
    return new Promise(resolve => {
      let resolved = false;
      const done = (reason: string) => {
        if (resolved) return;
        resolved = true;
        console.log(`[BroadcastPlayer] track-end detected via ${reason}`);
        resolve();
      };
      this.trackEndedResolve = () => done('event');

      // Poll loop: also watch MusicKit's reported status directly because
      // the 0.5s native-timer event can be dropped while Metro reconnects
      // or when the app is backgrounded. Polling once per second via
      // getPlaybackStatus is cheap and gives us a reliable fallback signal.
      const track = this.manifest?.tracks[this.currentTrackIndex];
      const maxSec = (track?.duration ?? 180) + 30;
      let elapsed = 0;
      let sawPlaying = false;
      const tick = async () => {
        if (resolved) return;
        elapsed += 1;
        if (this.music.getPlaybackStatus) {
          try {
            const status = await this.music.getPlaybackStatus();
            if (status === 'playing') sawPlaying = true;
            // Only treat "stopped" as end-of-track after we've confirmed
            // the track actually started. "paused" is explicitly excluded:
            // a user pause must not advance to the next segment.
            if (sawPlaying && status === 'stopped') {
              return done(`poll(status=${status})`);
            }
          } catch { /* swallow, keep polling */ }
        }
        if (elapsed >= maxSec) {
          console.warn(`[BroadcastPlayer] waitForTrackEnd timeout after ${maxSec}s — advancing`);
          return done('timeout');
        }
        setTimeout(tick, 1000);
      };
      setTimeout(tick, 1000);
    });
  }

  private handlePlaybackState = (e: { status: string; playbackTime: number }) => {
    try {
      console.log(`[BroadcastPlayer] playbackState: status=${e.status} time=${e.playbackTime} playerState=${this.state}`);
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


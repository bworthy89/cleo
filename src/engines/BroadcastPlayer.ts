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
  /** Tells the native module a broadcast is active so it keeps the 0.5s
   *  playback timer running in background — without this, when the phone
   *  locks the timer is invalidated and the broadcast can't advance. */
  setBroadcastActive?: (active: boolean) => Promise<void>;
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
  /** Reset at each runTrackAt; gates end-of-track detection so brief
   *  pre-playback 'paused'/'stopped' events during audio session handoff
   *  don't trigger a false track-end. */
  private sawPlayingForCurrentTrack = false;
  /** Highest playbackTime observed for the current track. Used to detect
   *  end-of-track when MusicKit's ApplicationMusicPlayer (single-track queue)
   *  resets position to 0 at end faster than the 0.5s event tick can catch
   *  `time >= duration - 0.5`. If we got close to duration and status is no
   *  longer 'playing', the track ended — even if current time reports 0. */
  private maxPlaybackTimeSeen = 0;
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
    if (this.native.setBroadcastActive) {
      await this.native.setBroadcastActive(true).catch(() => {});
    }
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
    if (this.native.setBroadcastActive) {
      await this.native.setBroadcastActive(false).catch(() => {});
    }
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
    // Resolve any in-flight waitForTrackEnd so the start() main loop unblocks
    // and observes manifest=null on the next iteration check (otherwise the
    // loop and its Promise leak indefinitely).
    this.trackEndedResolve?.();
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
    // Reset per-track signals so positional detection in handlePlaybackState
    // starts from a clean slate when this track begins.
    this.sawPlayingForCurrentTrack = false;
    this.maxPlaybackTimeSeen = 0;
    return new Promise(resolve => {
      let resolved = false;
      const done = (reason: string) => {
        if (resolved) return;
        resolved = true;
        console.log(`[BroadcastPlayer] track-end detected via ${reason}`);
        resolve();
      };
      this.trackEndedResolve = () => done('event');

      // Poll loop: checks both status and playback position every second.
      // Events via onPlaybackStateChanged can drop during Metro reconnects
      // or when backgrounded, and MusicKit's single-track queue doesn't
      // reliably transition to .stopped at end-of-track — so the positional
      // check (playbackTime reaching duration) is the primary end signal.
      const track = this.manifest?.tracks[this.currentTrackIndex];
      const duration = track?.duration ?? 180;
      const maxSec = duration + 30;
      let elapsed = 0;
      const tick = async () => {
        if (resolved) return;
        elapsed += 1;
        try {
          const status = this.music.getPlaybackStatus
            ? await this.music.getPlaybackStatus()
            : null;
          const time = this.music.getPlaybackTime
            ? await this.music.getPlaybackTime()
            : null;
          if (status === 'playing') this.sawPlayingForCurrentTrack = true;
          if (time !== null && time > this.maxPlaybackTimeSeen) {
            this.maxPlaybackTimeSeen = time;
          }

          // End detection, in order of preference:
          //  1. Positional: playbackTime reaches (duration - 0.5s) after we've
          //     seen the track start — catches the common case where MusicKit
          //     keeps reporting 'playing' or flips to 'paused' at track end
          //     rather than the cleaner 'stopped'.
          //  2. Reset-to-0: MusicKit's single-track queue resets position to
          //     0 at end-of-track. If maxTime got near duration and status is
          //     no longer 'playing', the track ended.
          //  3. Status-based: saw 'stopped' after saw 'playing'.
          // 'paused' mid-track is explicitly NOT end-of-track — a user pause
          // must not advance to the next segment.
          if (this.sawPlayingForCurrentTrack && time !== null && time >= duration - 0.5) {
            return done(`poll(position ${time.toFixed(1)}/${duration})`);
          }
          if (
            this.sawPlayingForCurrentTrack &&
            this.maxPlaybackTimeSeen >= duration - 2 &&
            status !== null && status !== 'playing'
          ) {
            return done(`poll(reset maxTime=${this.maxPlaybackTimeSeen.toFixed(1)}/${duration} status=${status})`);
          }
          if (this.sawPlayingForCurrentTrack && status === 'stopped') {
            return done(`poll(status=${status})`);
          }
        } catch { /* swallow, keep polling */ }

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
      if (this.state !== 'playing_track') return;
      if (e.status === 'playing') this.sawPlayingForCurrentTrack = true;
      if (e.playbackTime > this.maxPlaybackTimeSeen) {
        this.maxPlaybackTimeSeen = e.playbackTime;
      }

      const track = this.manifest?.tracks[this.currentTrackIndex];
      const duration = track?.duration ?? 0;
      // Positional end detection via the event stream: MusicKit emits
      // playbackTime every 0.5s. When we cross (duration - 0.5), the track
      // is done even if the .stopped status never fires.
      if (
        this.sawPlayingForCurrentTrack &&
        duration > 0 &&
        e.playbackTime >= duration - 0.5
      ) {
        this.trackEndedResolve?.();
        return;
      }
      // Reset-to-0 detection: ApplicationMusicPlayer with a single-track queue
      // transitions to `paused` with playbackTime=0 at end-of-track faster
      // than the 0.5s tick can catch time >= duration. If we saw the track
      // get close to duration and now status is not 'playing', it ended.
      if (
        this.sawPlayingForCurrentTrack &&
        duration > 0 &&
        this.maxPlaybackTimeSeen >= duration - 2 &&
        e.status !== 'playing'
      ) {
        this.trackEndedResolve?.();
        return;
      }
      if (this.sawPlayingForCurrentTrack && e.status === 'stopped') {
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


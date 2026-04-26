import { BroadcastSegmentCache } from './BroadcastSegmentCache';
import type {
  Manifest, PlayerState, PlayerStatus, Vibe,
} from './BroadcastPlayer.types';
import type { StingerKind } from './BroadcastStingers';
import {
  setPersistedBroadcast, clearPersistedBroadcast, addBroadcastToHistory,
  updatePersistedCursor,
} from '../services/Storage';
import { computeUpcoming } from './BroadcastPlayer.upcoming';

export interface MusicDeps {
  play: (ids?: string[]) => Promise<void>;
  pause: () => Promise<void>;
  skip: () => Promise<void>;
  setUpcomingQueue: (ids: string[]) => Promise<void>;
  onTrackChanged: (cb: (e: { trackId?: string }) => void) => () => void;
  onPlaybackStateChanged: (cb: (e: { status: string; playbackTime: number }) => void) => () => void;
  getPlaybackStatus?: () => Promise<string>;
  getPlaybackTime?: () => Promise<number>;
  // Lock-screen NowPlaying tile.
  setNowPlayingTrack: (payload: {
    title: string; artist: string; vibe: string; duration: number;
  }) => Promise<void>;
  setNowPlayingSegment: (payload: {
    vibe: string; kind: 'cold_open' | 'transition' | 'sign_off';
  }) => Promise<void>;
  setNowPlayingElapsed: (elapsed: number, playing: boolean) => Promise<void>;
  clearNowPlaying: () => Promise<void>;
  subscribeRemoteCommands: (handlers: {
    onPlay: () => void; onPause: () => void;
  }) => () => void;
  // Lock-screen Live Activity (iOS 16.2+; older iOS silently no-ops).
  startBroadcastLiveActivity: (
    attrs: { broadcastId: string; vibe: string; totalTracks: number },
    state: {
      kind: 'track' | 'cold_open' | 'transition' | 'sign_off';
      title: string; subtitle: string; trackNumber: number; playing: boolean;
    },
  ) => Promise<void>;
  updateBroadcastLiveActivity: (state: {
    kind: 'track' | 'cold_open' | 'transition' | 'sign_off';
    title: string; subtitle: string; trackNumber: number; playing: boolean;
  }) => Promise<void>;
  endBroadcastLiveActivity: () => Promise<void>;
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
  /** Next segment-slot index the main loop will consider. Promoted from a
   *  local in `runMainLoop` so `getStatus().upcoming` can match the loop's
   *  actual cursor between iterations. Reset to 0 on `start`, computed via
   *  `computeNextSegmentIdxAfter` on `resume`. */
  private nextSegmentIdx = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private elapsedPumpTimer: ReturnType<typeof setInterval> | null = null;
  private readonly POLL_INTERVAL_MS = 3000;
  /** How long runSegmentAt will wait for a pending slot to flip to ready
   *  before giving up and letting the existing silent-skip path fire.
   *  20s covers a cold CosyVoice boot + one provider failover; longer than
   *  that is a worse UX than skipping. */
  private readonly SEGMENT_READY_TIMEOUT_MS = 20_000;
  /** Tighter cadence than the 3s background poll so a waiting main loop
   *  picks up a newly-ready slot promptly. */
  private readonly SEGMENT_READY_POLL_INTERVAL_MS = 1_500;
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
      upcoming: computeUpcoming({
        manifest: this.manifest,
        state: this.state,
        currentTrackIndex: this.currentTrackIndex,
        currentSegmentIndex: this.currentSegmentIndex,
        nextSegmentIdx: this.nextSegmentIdx,
      }),
    };
  }

  async start(manifest: Manifest, firstSegmentUrls: string[]): Promise<void> {
    await this.initPlayback(manifest, { resumeFromIndex: -1, firstSegmentUrls });
    if (!this.manifest) return;
    this.nextSegmentIdx = 0;

    // Fresh start: play cold_open (slot 0), then enter the main loop at track 0.
    await this.runSegmentAt(0);
    if (!this.manifest) return;
    await this.waitIfPaused();
    if (!this.manifest) return;

    await this.runMainLoop(0, 1);
  }

  async resume(manifest: Manifest, trackCursor: number): Promise<void> {
    // Out-of-bounds cursor — nothing meaningful to resume into. Clear and bail.
    if (trackCursor >= manifest.tracks.length) {
      console.warn(`[BroadcastPlayer] resume called with cursor ${trackCursor} >= tracks.length ${manifest.tracks.length}; clearing`);
      clearPersistedBroadcast();
      return;
    }

    await this.initPlayback(manifest, { resumeFromIndex: trackCursor });
    if (!this.manifest) return;
    this.nextSegmentIdx = this.computeNextSegmentIdxAfter(trackCursor, manifest);

    if (trackCursor < 0) {
      // Never reached a track — behave exactly like a fresh start.
      this.nextSegmentIdx = 0;
      await this.runSegmentAt(0);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      await this.runMainLoop(0, 1);
      return;
    }

    // Find the transition segment that introduces tracks[trackCursor], if any.
    // Exclude cold_open so a cursor-at-track-0 path doesn't accidentally pick it.
    const resumeTrack = manifest.tracks[trackCursor];
    const introSlotIdx = manifest.segmentSlots.findIndex(
      s => s.beforeTrackId === resumeTrack.id && s.kind !== 'cold_open',
    );

    if (introSlotIdx >= 0) {
      // Ensure the intro segment audio is cached, then play it.
      const slot = manifest.segmentSlots[introSlotIdx];
      if (slot.status === 'ready' && slot.audioUrls) {
        for (let v = 0; v < slot.audioUrls.length; v++) {
          try {
            const b64 = await this.manifestClient.fetchSegmentAudio(slot.audioUrls[v]);
            this.cache.put(introSlotIdx, v, b64);
          } catch { /* one variant failure is not fatal */ }
        }
      }
      await this.runSegmentAt(introSlotIdx);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      this.nextSegmentIdx = introSlotIdx + 1;
      await this.runMainLoop(trackCursor, introSlotIdx + 1);
    } else {
      // No preceding segment — start directly at the track. Cursor was set
      // above via computeNextSegmentIdxAfter.
      await this.runMainLoop(trackCursor, this.nextSegmentIdx);
    }
  }

  /** Shared prelude: manifest + persistence + history + cache clear +
   *  stingers + background fetch + polling + music subscriptions. After
   *  this runs, the player is ready for the first `runSegmentAt` or
   *  `runTrackAt` call. */
  private async initPlayback(
    manifest: Manifest,
    opts: { resumeFromIndex: number; firstSegmentUrls?: string[] },
  ): Promise<void> {
    this.manifest = manifest;
    setPersistedBroadcast({
      manifest,
      trackCursor: opts.resumeFromIndex,
      updatedAt: Date.now(),
    });
    addBroadcastToHistory(manifest, opts.firstSegmentUrls ?? this.inferFirstSegmentUrls(manifest));
    this.cache.clear();
    this.state = 'loading';
    if (this.native.setBroadcastActive) {
      await this.native.setBroadcastActive(true).catch(() => {});
    }
    await this.stingers.preloadStingers();

    // Prime slot 0's variants only on a fresh start — on resume we
    // either skip cold_open entirely or load the intro slot on demand.
    if (opts.resumeFromIndex < 0 && opts.firstSegmentUrls) {
      for (let v = 0; v < opts.firstSegmentUrls.length; v++) {
        try {
          const b64 = await this.manifestClient.fetchSegmentAudio(opts.firstSegmentUrls[v]);
          this.cache.put(0, v, b64);
        } catch { /* one variant failure is not fatal */ }
      }
    }

    this.kickBackgroundFetch();
    this.schedulePolling();

    this.subscriptions.push(
      this.music.onPlaybackStateChanged(this.handlePlaybackState),
      this.music.onTrackChanged(this.handleTrackChanged),
    );

    this.subscriptions.push(
      this.music.subscribeRemoteCommands({
        onPlay:  () => { this.resumeFromPause().catch(() => {}); },
        onPause: () => { this.pause().catch(() => {}); },
      }),
    );

    // Kick off the Lock Screen / Dynamic Island Live Activity with the
    // cold_open segment as the initial state. Updates follow from
    // runTrackAt / runSegmentAt; dismissal happens in end() + runMainLoop's
    // natural-completion path.
    await this.music.startBroadcastLiveActivity(
      {
        broadcastId: manifest.broadcastId,
        vibe: manifest.vibe,
        totalTracks: manifest.tracks.length,
      },
      {
        kind: 'cold_open',
        title: 'Cold open',
        subtitle: `ONAY · ${manifest.vibe.toUpperCase()}`,
        trackNumber: 0,
        playing: true,
      },
    ).catch(() => {});
  }

  /** Shared main loop + natural end-of-broadcast teardown. Walks tracks
   *  in order starting at `startTrack`, firing the dual-cursor
   *  `beforeTrackId` check against `nextSegmentIdx` to decide whether to
   *  play a transition between consecutive tracks. */
  private async runMainLoop(startTrack: number, startSegIdx: number): Promise<void> {
    if (!this.manifest) return;
    this.nextSegmentIdx = startSegIdx;
    for (let i = startTrack; i < this.manifest.tracks.length; i++) {
      await this.runTrackAt(i);
      if (!this.manifest) return;
      await this.waitIfPaused();
      if (!this.manifest) return;

      const slots = this.manifest.segmentSlots;
      const nextTrack = this.manifest.tracks[i + 1];
      const nextSlot = slots[this.nextSegmentIdx];

      if (!nextTrack) {
        if (nextSlot && nextSlot.kind === 'sign_off') {
          await this.runSegmentAt(this.nextSegmentIdx);
          if (!this.manifest) return;
          await this.waitIfPaused();
          if (!this.manifest) return;
        }
        break;
      }

      if (nextSlot && nextSlot.beforeTrackId === nextTrack.id) {
        await this.runSegmentAt(this.nextSegmentIdx);
        if (!this.manifest) return;
        await this.waitIfPaused();
        if (!this.manifest) return;
        this.nextSegmentIdx += 1;
      }
    }
    // Sign-off has played; the final segment's releaseAudioSession fires
    // AVAudioSession.setActive(false, .notifyOthersOnDeactivation), which
    // prompts MusicKit's ApplicationMusicPlayer to resume its queued item.
    // Because nothing follows the sign-off to replace the queue, the user
    // hears the last track start over. Explicit pause marks the MusicKit
    // player user-paused so the auto-resume is suppressed.
    await this.music.pause().catch(() => {});
    await this.music.clearNowPlaying().catch(() => {});
    await this.music.endBroadcastLiveActivity().catch(() => {});
    this.state = 'ended';
    clearPersistedBroadcast();
  }

  /** Resume fallback: no segment precedes `startTrack`, so we need to
   *  find the earliest slot index we'd still need to run. That's the
   *  lowest i where segmentSlots[i].beforeTrackId maps to a track at
   *  position > startTrack, or where kind === 'sign_off'. Returns
   *  segmentSlots.length as a defensive fallback (nothing left to
   *  play). */
  private computeNextSegmentIdxAfter(startTrack: number, manifest: Manifest): number {
    const trackIndexById = new Map(
      manifest.tracks.map((t, idx) => [t.id, idx]),
    );
    for (let i = 0; i < manifest.segmentSlots.length; i++) {
      const slot = manifest.segmentSlots[i];
      if (slot.kind === 'sign_off') return i;
      if (slot.beforeTrackId) {
        const tIdx = trackIndexById.get(slot.beforeTrackId);
        if (tIdx !== undefined && tIdx > startTrack) return i;
      }
    }
    return manifest.segmentSlots.length;
  }

  /** When resuming, we don't have firstSegmentUrls handy from the
   *  server response — infer them from the manifest's slot 0 so history
   *  still gets a useful record. Returns [] if slot 0 isn't ready. */
  private inferFirstSegmentUrls(manifest: Manifest): string[] {
    const slot0 = manifest.segmentSlots[0];
    if (slot0?.status === 'ready' && slot0.audioUrls) return slot0.audioUrls;
    return [];
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
    try {
      const t = this.music.getPlaybackTime ? await this.music.getPlaybackTime() : 0;
      await this.music.setNowPlayingElapsed(t, false).catch(() => {});
    } catch { /* swallow */ }
    this.stopElapsedPump();
  }

  async resumeFromPause(): Promise<void> {
    if (!this.isPaused) return;
    this.isPaused = false;
    // Restore state + restart music if we paused mid-track.
    if (this.currentTrackIndex >= 0 && this.currentSegmentIndex < 0) {
      this.state = 'playing_track';
      await this.music.play().catch(() => {});
      this.startElapsedPump();
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
    this.stopElapsedPump();
    this.cache.clear();
    this.manifest = null;
    this.currentTrackIndex = -1;
    this.currentSegmentIndex = -1;
    this.nextSegmentIdx = 0;
    // Resolve any in-flight waitForTrackEnd so the start() main loop unblocks
    // and observes manifest=null on the next iteration check (otherwise the
    // loop and its Promise leak indefinitely).
    this.trackEndedResolve?.();
    this.trackEndedResolve = null;
    await this.music.clearNowPlaying().catch(() => {});
    await this.music.endBroadcastLiveActivity().catch(() => {});
    this.state = 'idle';
    // Deliberately do NOT clearPersistedBroadcast() here. end() is a user-
    // initiated bookmark ("stop for now"), not a completion signal — the
    // persisted cursor must survive so the Home screen can offer a Resume
    // card on re-entry. Natural completion (sign_off finishes in
    // runMainLoop) still clears the record. User-explicit teardown of the
    // resume offer is handled by the "Start Fresh" path on the Home screen.
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

  private startElapsedPump(): void {
    if (this.elapsedPumpTimer) return;
    this.elapsedPumpTimer = setInterval(async () => {
      if (!this.manifest || this.currentTrackIndex < 0) return;
      const playing = !this.isPaused && this.state === 'playing_track';
      try {
        const t = this.music.getPlaybackTime ? await this.music.getPlaybackTime() : 0;
        await this.music.setNowPlayingElapsed(t, playing).catch(() => {});
      } catch { /* one tick failure is not fatal */ }
    }, 1000);
  }

  private stopElapsedPump(): void {
    if (this.elapsedPumpTimer) {
      clearInterval(this.elapsedPumpTimer);
      this.elapsedPumpTimer = null;
    }
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

  /** Block until the given slot is no longer in 'pending' state (either
   *  'ready' or 'failed') or the timeout trips. Forces an immediate manifest
   *  poll on each tick so we don't wait on the 3s background cadence; cooperates
   *  with pause via waitIfPaused and bails out if end() nulls the manifest.
   *
   *  Timing out is not an error — the caller's downstream cache-miss path
   *  (pickVariant → undefined) silently skips the segment, which is the same
   *  behavior the player had before this helper existed. */
  private async waitForSegmentReady(slotIndex: number): Promise<void> {
    const deadline = Date.now() + this.SEGMENT_READY_TIMEOUT_MS;
    while (this.manifest) {
      const slot = this.manifest.segmentSlots[slotIndex];
      if (!slot || slot.status !== 'pending') return;
      if (Date.now() >= deadline) {
        console.warn(
          `[BroadcastPlayer] slot ${slotIndex} still pending after ${this.SEGMENT_READY_TIMEOUT_MS}ms — skipping`,
        );
        return;
      }
      try {
        await this.pollManifestOnce();
      } catch {
        // Transient network error — retry next tick.
      }
      if (!this.manifest) return;
      if (this.manifest.segmentSlots[slotIndex]?.status !== 'pending') return;
      await this.waitIfPaused();
      if (!this.manifest) return;
      await new Promise<void>(r => setTimeout(r, this.SEGMENT_READY_POLL_INTERVAL_MS));
    }
  }

  private async runSegmentAt(slotIndex: number): Promise<void> {
    if (!this.manifest) return;
    await this.waitForSegmentReady(slotIndex);
    if (!this.manifest) return;
    const slot = this.manifest.segmentSlots[slotIndex];
    if (!slot) return;
    const vibe = this.manifest.vibe;

    await this.music.setNowPlayingSegment({
      vibe,
      kind: slot.kind as 'cold_open' | 'transition' | 'sign_off',
    }).catch(() => {});
    if (!this.manifest) return;

    // Live Activity — flip to the segment state. cold_open uses its own
    // title; transitions / sign-offs share the "Between tracks" frame
    // with the outgoing track index so users can still glance at how
    // deep into the episode they are.
    const kind = slot.kind as 'cold_open' | 'transition' | 'sign_off';
    const segTitle =
      kind === 'cold_open' ? 'Cold open' :
      kind === 'sign_off'  ? 'Sign-off'  : 'Between tracks';
    await this.music.updateBroadcastLiveActivity({
      kind,
      title: segTitle,
      subtitle: `ONAY · ${vibe.toUpperCase()}`,
      trackNumber: Math.max(0, this.currentTrackIndex + 1),
      playing: true,
    }).catch(() => {});

    this.currentSegmentIndex = slotIndex;
    this.state = 'playing_segment';

    if (slot.status === 'failed' || slot.status === 'aborted') {
      // Slot failed or was aborted at bake time — skip silently, continue
      // broadcast. The player is not expected to encounter 'aborted' slots
      // under user-driven flows (aborted bakes never reach /player), but a
      // stale resume could surface one — defensive.
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
    updatePersistedCursor(trackIndex);
    this.state = 'playing_track';

    // Lock-screen tile — set ONAY-branded metadata BEFORE music.play so the
    // tile paints the moment the audio session goes active. The 1Hz pump
    // (started below) re-asserts the full dict every second to overwrite
    // any MusicKit clobber.
    console.log(`[LockScreenDiag] calling setNowPlayingTrack title="${track.title}" vibe=${this.manifest.vibe}`);
    await this.music.setNowPlayingTrack({
      title: track.title,
      artist: track.artistName,
      vibe: this.manifest.vibe,
      duration: track.duration ?? 180,
    }).then(
      () => console.log('[LockScreenDiag] setNowPlayingTrack resolved'),
      (err) => console.warn('[LockScreenDiag] setNowPlayingTrack REJECTED:', err),
    );

    // Live Activity — flip to the now-playing track state.
    await this.music.updateBroadcastLiveActivity({
      kind: 'track',
      title: track.title,
      subtitle: track.artistName,
      trackNumber: trackIndex + 1,
      playing: true,
    }).catch(() => {});

    this.startElapsedPump();

    console.log(`[BroadcastPlayer] runTrackAt(${trackIndex}) id=${track.id} "${track.title}"`);
    try {
      await this.music.play([track.id]);
      console.log(`[BroadcastPlayer] music.play resolved for ${track.id}`);
    } catch (err) {
      console.warn(`[BroadcastPlayer] music.play threw for ${track.id}:`, err);
      this.stopElapsedPump();
      return;
    }
    await this.waitForTrackEnd();
    this.stopElapsedPump();
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
          // Reset-to-0 requires playbackTime to actually be ≈0 — MusicKit's
          // single-track queue sets time=0 at end-of-track. A user pause near
          // the end of a track leaves time at the pause position (>0), so
          // without this guard we'd falsely advance the loop on a late-track
          // user pause and ONAY would start talking over the silence.
          if (
            this.sawPlayingForCurrentTrack &&
            this.maxPlaybackTimeSeen >= duration - 2 &&
            status !== null && status !== 'playing' &&
            time !== null && time < 1
          ) {
            return done(`poll(reset maxTime=${this.maxPlaybackTimeSeen.toFixed(1)}/${duration} status=${status} time=${time.toFixed(1)})`);
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
      // than the 0.5s tick can catch time >= duration. The playbackTime<1
      // guard disambiguates this from a user pause near end-of-track (where
      // time stays at the pause position) — without it, pausing in the last
      // 2s of any track falsely marks the track as ended.
      if (
        this.sawPlayingForCurrentTrack &&
        duration > 0 &&
        this.maxPlaybackTimeSeen >= duration - 2 &&
        e.status !== 'playing' &&
        e.playbackTime < 1
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
    const tracks = this.manifest.tracks.length;
    if (tracks === 0) return 0;
    // Monotonic broadcast progress: each started track advances the bar.
    // Using tracks+1 in the denominator reserves the final tick for sign_off
    // so the bar doesn't hit 100% while the last track is still playing.
    // The prior formula (tracks + segments as denominator, both indices as
    // numerator) snapped up and down as segments started and ended — tolerable
    // at dense N+1 cadence but ~30% swings under the sparse layout.
    const started = Math.max(0, this.currentTrackIndex + 1);
    const done = this.state === 'ended' ? tracks + 1 : started;
    return Math.min(1, done / (tracks + 1));
  }
}


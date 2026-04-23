import { BroadcastPlayer } from '../../src/engines/BroadcastPlayer';
import type { Manifest } from '../../src/engines/BroadcastPlayer.types';

// 2-track manifest under sparse-segment shape: cold_open + sign_off only.
// No transition between t0 and t1 because transitions fire before even-index
// tracks (2, 4, ...), and with only 2 tracks the second one is index 1.
const makeManifest = (): Manifest => ({
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [
    { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'AL', duration: 180 },
    { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'AL', duration: 180 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg0-v0.mp3'] },
    { index: 1, kind: 'sign_off', afterTrackId: 't1', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg1-v0.mp3'] },
  ],
});

// 3-track manifest under sparse-segment shape: cold_open + one transition
// before t2 + sign_off. Used in tests that need to exercise a mid-broadcast
// transition segment.
const makeManifest3 = (): Manifest => ({
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [
    { id: 't0', title: 'T0', artistName: 'A', albumTitle: 'AL', duration: 180 },
    { id: 't1', title: 'T1', artistName: 'A', albumTitle: 'AL', duration: 180 },
    { id: 't2', title: 'T2', artistName: 'A', albumTitle: 'AL', duration: 180 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg0-v0.mp3'] },
    { index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg1-v0.mp3'] },
    { index: 2, kind: 'sign_off', afterTrackId: 't2', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg2-v0.mp3'] },
  ],
});

type Listeners = {
  track?: (e: { trackId?: string }) => void;
  state?: (e: { status: string; playbackTime: number }) => void;
  remotePlay?: () => void;
  remotePause?: () => void;
};

const makeDeps = () => {
  const listeners: Listeners = {};
  const logs: string[] = [];
  return {
    logs,
    listeners,
    music: {
      play: jest.fn(async (ids?: string[]) => { logs.push(`play:${ids?.[0] ?? 'resume'}`); }),
      pause: jest.fn(async () => { logs.push('music.pause'); }),
      skip: jest.fn(async () => {}),
      setUpcomingQueue: jest.fn(async (ids: string[]) => { logs.push(`queue:${ids.join(',')}`); }),
      onTrackChanged: jest.fn((cb: (e: { trackId?: string }) => void) => {
        listeners.track = cb;
        return () => { listeners.track = undefined; };
      }),
      onPlaybackStateChanged: jest.fn((cb: (e: { status: string; playbackTime: number }) => void) => {
        listeners.state = cb;
        return () => { listeners.state = undefined; };
      }),
      setNowPlayingTrack:   jest.fn(async (p: any) => { logs.push(`np.track:${p.title}|${p.vibe}`); }),
      setNowPlayingSegment: jest.fn(async (p: any) => { logs.push(`np.segment:${p.kind}|${p.vibe}`); }),
      setNowPlayingElapsed: jest.fn(async (e: number, playing: boolean) => { logs.push(`np.elapsed:${e}|${playing}`); }),
      clearNowPlaying:      jest.fn(async () => { logs.push('np.clear'); }),
      subscribeRemoteCommands: jest.fn((h: { onPlay: () => void; onPause: () => void }) => {
        listeners.remotePlay  = h.onPlay;
        listeners.remotePause = h.onPause;
        return () => { listeners.remotePlay = undefined; listeners.remotePause = undefined; };
      }),
    },
    native: {
      activateDuckingSession: jest.fn(async () => { logs.push('duck.on'); }),
      deactivateDuckingSession: jest.fn(async () => { logs.push('duck.off'); }),
      playAudioFromBase64: jest.fn(async (b64: string) => { logs.push(`tts:${b64.slice(0, 16)}`); }),
      stopAudio: jest.fn(async () => { logs.push('tts.stop'); }),
    },
    manifestClient: {
      fetchSegmentAudio: jest.fn(async (url: string) => {
        const id = url.split('/').pop();
        return `BASE64_${id}`;
      }),
      fetchManifest: jest.fn(),
    },
    stingers: {
      getStinger: jest.fn(async (_v: unknown, _kind: string) => null),
      preloadStingers: jest.fn(async () => {}),
    },
    fireTrackChanged: (trackId?: string) => listeners.track?.({ trackId }),
    fireStateChanged: (status: string) => listeners.state?.({ status, playbackTime: 0 }),
    fireRemotePlay:  () => listeners.remotePlay?.(),
    fireRemotePause: () => listeners.remotePause?.(),
  };
};

describe('BroadcastPlayer', () => {
  it('starts idle and advances to loading/playing_segment on start()', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    expect(player.getStatus().state).toBe('idle');
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await Promise.resolve();
    expect(['loading', 'playing_segment']).toContain(player.getStatus().state);
  });

  it('ducks music and plays segment audio for the cold open', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    // Let microtasks flush enough for the cold_open to ducks + play.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(deps.logs).toContain('duck.on');
    expect(deps.logs.some(l => l.startsWith('tts:BASE64_seg0'))).toBe(true);
  });

  it('pause() during a segment lets ONAY finish speaking (no stopAudio) and parks the loop', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await player.pause();
    expect(deps.native.stopAudio).not.toHaveBeenCalled();
    expect(player.getStatus().state).toBe('paused');
  });

  it('pause() during loading still marks the player paused and blocks progression', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await player.pause();
    expect(player.getStatus().state).toBe('paused');
  });

  it('resume() wakes the main loop so advancement resumes', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await player.pause();
    expect(player.getStatus().state).toBe('paused');
    await player.resumeFromPause();
    expect(player.getStatus().state).not.toBe('paused');
  });

  it('end() cleans up and returns to idle', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await Promise.resolve();
    await player.end();
    expect(player.getStatus().state).toBe('idle');
  });

  it('end() preserves the persisted broadcast so the Home screen can offer Resume', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getPersistedBroadcast, clearPersistedBroadcast } =
      require('../../src/services/Storage');
    clearPersistedBroadcast();
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    // Let initPlayback seed the persisted record.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(getPersistedBroadcast()).toBeDefined();
    await player.end();
    // End is a bookmark, not a completion — the Resume CTA on Home depends
    // on this record surviving.
    const persisted = getPersistedBroadcast();
    expect(persisted).toBeDefined();
    expect(persisted.manifest.broadcastId).toBe('b1');
  });

  it('runTrackAt sets NowPlaying track metadata before music.play', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    // Drive past cold_open to hit runTrackAt(0).
    for (let i = 0; i < 80; i++) await Promise.resolve();
    const trackIdx = deps.logs.findIndex(l => l === 'play:t0');
    const npIdx = deps.logs.findIndex(l => l.startsWith('np.track:T0'));
    expect(npIdx).toBeGreaterThanOrEqual(0);
    expect(trackIdx).toBeGreaterThanOrEqual(0);
    expect(npIdx).toBeLessThan(trackIdx);
    await player.end();
  });

  it('wraps native listener errors so one throwing callback does not kill the player', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await Promise.resolve();
    expect(() => deps.fireStateChanged('playing')).not.toThrow();
    expect(() => deps.fireTrackChanged('t0')).not.toThrow();
  });

  it('polls manifest when slots start pending', async () => {
    const deps = makeDeps();
    const pending: Manifest = {
      ...makeManifest(),
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u0'] },
        { index: 1, kind: 'sign_off', afterTrackId: 't1', variantCount: 1, status: 'pending' },
      ],
    };
    const ready: Manifest = {
      ...pending,
      segmentSlots: [
        pending.segmentSlots[0],
        { ...pending.segmentSlots[1], status: 'ready', audioUrls: ['u1'] },
      ],
    };
    (deps.manifestClient.fetchManifest as jest.Mock).mockResolvedValueOnce(ready);

    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(pending, ['u0']);
    await Promise.resolve();
    await player.pollManifestOnce();

    expect(deps.manifestClient.fetchManifest).toHaveBeenCalledWith('b1');
    await player.end();
  });

  describe('pending-slot wait', () => {
    // 2-track manifest with cold_open ready + sign_off pending. The main loop
    // reaches sign_off after both tracks end; waitForSegmentReady must kick in.
    const makeCold0ReadySignPending = (): Manifest => ({
      broadcastId: 'bp', userId: 'u1', playlistId: 'p1',
      vibe: 'morning', length: 'quick', createdAt: Date.now(),
      tracks: [
        { id: 't0', title: 'T0', artistName: 'A', albumTitle: '', duration: 1 },
        { id: 't1', title: 'T1', artistName: 'A', albumTitle: '', duration: 1 },
      ],
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0',
          variantCount: 1, status: 'ready',
          audioUrls: ['https://cdn/seg0-v0.mp3'] },
        { index: 1, kind: 'sign_off', afterTrackId: 't1',
          variantCount: 1, status: 'pending' },
      ],
    });

    const driveBothTracksToEnd = async (deps: ReturnType<typeof makeDeps>) => {
      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < 80; i++) await Promise.resolve();
        deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
        deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      }
    };

    it('pending→ready while waiting plays the segment', async () => {
      const deps = makeDeps();
      const pending = makeCold0ReadySignPending();
      const ready: Manifest = {
        ...pending,
        segmentSlots: [
          pending.segmentSlots[0],
          { ...pending.segmentSlots[1], status: 'ready', audioUrls: ['https://cdn/seg1-v0.mp3'] },
        ],
      };
      // First poll returns ready — wait loop exits and runSegmentAt fetches the audio.
      (deps.manifestClient.fetchManifest as jest.Mock).mockResolvedValue(ready);

      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(pending, ['https://cdn/seg0-v0.mp3']);
      await driveBothTracksToEnd(deps);
      for (let i = 0; i < 80; i++) await Promise.resolve();

      // Sign-off played after wait completed.
      expect(deps.logs.some(l => l.startsWith('tts:BASE64_seg1'))).toBe(true);
      await player.end();
    });

    it('pending→failed while waiting skips cleanly (no audio fetched)', async () => {
      const deps = makeDeps();
      const pending = makeCold0ReadySignPending();
      const failed: Manifest = {
        ...pending,
        segmentSlots: [
          pending.segmentSlots[0],
          { ...pending.segmentSlots[1], status: 'failed' },
        ],
      };
      (deps.manifestClient.fetchManifest as jest.Mock).mockResolvedValue(failed);

      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(pending, ['https://cdn/seg0-v0.mp3']);
      await driveBothTracksToEnd(deps);
      for (let i = 0; i < 80; i++) await Promise.resolve();

      // Sign-off was 'failed' — nothing should have been played or fetched for slot 1.
      expect(deps.logs.some(l => l.startsWith('tts:BASE64_seg1'))).toBe(false);
      expect(deps.manifestClient.fetchSegmentAudio).not.toHaveBeenCalledWith(
        expect.stringContaining('seg1'),
      );
      // Broadcast reaches 'ended' — the loop didn't hang.
      expect(player.getStatus().state).toBe('ended');
      await player.end();
    });

    it('pending throughout past timeout skips and broadcast still ends (no hang)', async () => {
      const deps = makeDeps();
      const pending = makeCold0ReadySignPending();
      // Always pending — fetchManifest returns the same pending manifest forever.
      (deps.manifestClient.fetchManifest as jest.Mock).mockResolvedValue(pending);

      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      // Compress timeout + poll interval so the test runs in real-time without fake timers.
      const tuning = player as unknown as {
        SEGMENT_READY_TIMEOUT_MS: number;
        SEGMENT_READY_POLL_INTERVAL_MS: number;
      };
      tuning.SEGMENT_READY_TIMEOUT_MS = 50;
      tuning.SEGMENT_READY_POLL_INTERVAL_MS = 5;

      player.start(pending, ['https://cdn/seg0-v0.mp3']);
      await driveBothTracksToEnd(deps);
      // Flush through the wait loop's timeout (~50ms + slack) and the
      // post-sign-off teardown (music.pause, state='ended').
      await new Promise<void>(r => setTimeout(r, 150));
      for (let i = 0; i < 80; i++) await Promise.resolve();

      // Sign-off audio was never fetched (slot never left 'pending').
      expect(deps.logs.some(l => l.startsWith('tts:BASE64_seg1'))).toBe(false);
      // But the broadcast still reached 'ended' — the wait timed out rather than hanging.
      expect(player.getStatus().state).toBe('ended');
      await player.end();
    });
  });

  describe('background keepalive', () => {
    it('signals native module to keep timer alive when broadcast starts', async () => {
      const deps = makeDeps();
      const setBroadcastActive = jest.fn(async (_a: boolean) => {});
      const native = { ...deps.native, setBroadcastActive };
      const player = new BroadcastPlayer(
        deps.music, native, deps.manifestClient, deps.stingers,
      );

      player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(setBroadcastActive).toHaveBeenCalledWith(true);

      await player.end();
      expect(setBroadcastActive).toHaveBeenCalledWith(false);
    });

    it('does not crash if native module lacks setBroadcastActive', async () => {
      const deps = makeDeps();
      const player = new BroadcastPlayer(
        deps.music, deps.native, deps.manifestClient, deps.stingers,
      );
      // deps.native intentionally has no setBroadcastActive — must be safe to omit.
      // start() is fire-and-forget (the broadcast loop); end() is what we await.
      player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await expect(player.end()).resolves.not.toThrow();
    });
  });

  describe('track-end detection', () => {
    it('advances when MusicKit resets position to 0 after track ends (single-track queue)', async () => {
      // Uses a 3-track sparse manifest so a transition segment sits between
      // t1 and t2; ending t1 should kick the transition (seg1) TTS.
      const deps = makeDeps();
      const player = new BroadcastPlayer(
        deps.music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(makeManifest3(), ['https://cdn/seg0-v0.mp3']);
      // Flush cold_open segment and transition into runTrackAt(0)
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t0');

      // t0 ends — no transition before t1 under sparse shape, so we should
      // see play:t1 directly.
      deps.listeners.state?.({ status: 'playing', playbackTime: 10 });
      deps.listeners.state?.({ status: 'playing', playbackTime: 179 });
      deps.listeners.state?.({ status: 'paused', playbackTime: 0 });

      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t1');

      // Simulate MusicKit streaming playback events for t1, then track end +
      // position reset to exercise the reset-to-0 detector.
      deps.listeners.state?.({ status: 'playing', playbackTime: 10 });
      deps.listeners.state?.({ status: 'playing', playbackTime: 90 });
      deps.listeners.state?.({ status: 'playing', playbackTime: 179 });
      // Track ends: ApplicationMusicPlayer with single-track queue transitions
      // to paused with playbackTime=0 (position reset). This is the bug: the
      // direct positional check never saw time >= duration-0.5 (it hopped to 0),
      // and status is 'paused' not 'stopped'.
      deps.listeners.state?.({ status: 'paused', playbackTime: 0 });

      for (let i = 0; i < 40; i++) await Promise.resolve();
      // If end was detected, the next segment (transition) has started ducking + TTS
      expect(deps.logs.some(l => l.startsWith('tts:BASE64_seg1'))).toBe(true);

      await player.end();
    });

    it('pauses MusicKit after the sign-off so the last track does not auto-resume', async () => {
      // Regression — the final segment\'s releaseAudioSession uses
      // .notifyOthersOnDeactivation, which tells Apple MusicKit\'s session
      // it can resume. Because the queue still contains the last track
      // (no follow-up music.play replaces it), MusicKit auto-resumes and
      // the last song starts over after ONAY signs off. The fix: end the
      // natural-completion path with an explicit music.pause() so
      // MusicKit is marked user-paused before the release fires.
      //
      // Under sparse segment shape, a 2-track broadcast has only cold_open
      // (seg0) + sign_off (seg1) — no transition between t0 and t1.
      const deps = makeDeps();
      const player = new BroadcastPlayer(
        deps.music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);

      // Cold open → runTrackAt(0)
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t0');
      deps.listeners.state?.({ status: 'playing', playbackTime: 179 });
      deps.listeners.state?.({ status: 'paused',  playbackTime: 0 });

      // No transition under sparse shape — straight to runTrackAt(1)
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t1');
      deps.listeners.state?.({ status: 'playing', playbackTime: 179 });
      deps.listeners.state?.({ status: 'paused',  playbackTime: 0 });

      // Sign off (seg1) + post-loop teardown
      for (let i = 0; i < 40; i++) await Promise.resolve();

      const signOff = deps.logs.findIndex(l => l.startsWith('tts:BASE64_seg1'));
      const pause   = deps.logs.indexOf('music.pause');
      expect(signOff).toBeGreaterThan(-1);
      expect(pause).toBeGreaterThan(signOff);
      expect(player.getStatus().state).toBe('ended');

      await player.end();
    });

    it('does NOT advance on user pause (time does not reset to 0)', async () => {
      // Use a 3-track sparse manifest so there IS a downstream segment
      // (transition before t2, seg1) whose non-firing we can verify.
      const deps = makeDeps();
      const player = new BroadcastPlayer(
        deps.music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(makeManifest3(), ['https://cdn/seg0-v0.mp3']);
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t0');

      // Playing normally
      deps.listeners.state?.({ status: 'playing', playbackTime: 10 });
      deps.listeners.state?.({ status: 'playing', playbackTime: 45 });
      // User pauses mid-track — MusicKit keeps position, doesn't reset to 0
      deps.listeners.state?.({ status: 'paused', playbackTime: 45 });

      for (let i = 0; i < 20; i++) await Promise.resolve();
      // Transition segment (seg1) must NOT have started, and t1 must not
      // have begun either — the loop is parked mid-t0.
      expect(deps.logs.some(l => l.startsWith('tts:BASE64_seg1'))).toBe(false);
      expect(deps.logs).not.toContain('play:t1');

      await player.end();
    });
  });

  describe('sparse segments', () => {
    // 5 tracks, sparse segments: cold_open → t0 → t1 → trans(before t2) → t2
    // → t3 → trans(before t4) → t4 → sign_off
    const makeManifest5 = (): Manifest => ({
      broadcastId: 'b5', userId: 'u1', playlistId: 'p1',
      vibe: 'lateNight', length: 'quick', createdAt: Date.now(),
      tracks: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`, title: `Track ${i}`, artistName: 'A',
        albumTitle: '', duration: 1,
      })),
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0',
          variantCount: 1, status: 'ready', tier: 'cold_open',
          audioUrls: ['https://cdn/seg0-v0.mp3'] },
        { index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2',
          variantCount: 1, status: 'ready', tier: 'fact_bridge',
          audioUrls: ['https://cdn/seg1-v0.mp3'] },
        { index: 2, kind: 'transition', afterTrackId: 't3', beforeTrackId: 't4',
          variantCount: 1, status: 'ready', tier: 'deep_dive',
          audioUrls: ['https://cdn/seg2-v0.mp3'] },
        { index: 3, kind: 'sign_off', afterTrackId: 't4',
          variantCount: 1, status: 'ready', tier: 'sign_off',
          audioUrls: ['https://cdn/seg3-v0.mp3'] },
      ],
      featureSlots: [],
    });

    it('plays all 5 tracks in order interleaved with 4 segments', async () => {
      const deps = makeDeps();
      // getPlaybackStatus/getPlaybackTime let waitForTrackEnd's poll loop
      // detect end-of-track without relying on event-stream timing.
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(makeManifest5(), ['https://cdn/seg0-v0.mp3']);

      // Drive each track to 'playing' then 'stopped' via event stream so
      // waitForTrackEnd resolves. 5 tracks × a generous microtask flush.
      for (let t = 0; t < 5; t++) {
        for (let i = 0; i < 80; i++) await Promise.resolve();
        deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
        deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      }
      // Final flush to let sign_off + post-loop pause/teardown settle.
      for (let i = 0; i < 80; i++) await Promise.resolve();

      // Filter logs down to the segment/track order.
      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'tts:BASE64_seg0-v0.m',
        'play:t0',
        'play:t1',
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);

      await player.end();
    });

    it('2-track manifest with no transitions plays t0 → t1 → sign_off', async () => {
      const deps = makeDeps();
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };

      const manifest: Manifest = {
        broadcastId: 'b2', userId: 'u1', playlistId: 'p1',
        vibe: 'morning', length: 'quick', createdAt: Date.now(),
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: '', duration: 1 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: '', duration: 1 },
        ],
        segmentSlots: [
          { index: 0, kind: 'cold_open', beforeTrackId: 't0',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg0-v0.mp3'] },
          { index: 1, kind: 'sign_off', afterTrackId: 't1',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg1-v0.mp3'] },
        ],
      };

      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(manifest, ['https://cdn/seg0-v0.mp3']);

      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < 80; i++) await Promise.resolve();
        deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
        deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      }
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'tts:BASE64_seg0-v0.m',
        'play:t0',
        'play:t1',
        'tts:BASE64_seg1-v0.m',
      ]);

      await player.end();
    });

    it('3-track manifest plays t0 → t1 → trans(before t2) → t2 → sign_off', async () => {
      const deps = makeDeps();
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };

      const manifest: Manifest = {
        broadcastId: 'b3', userId: 'u1', playlistId: 'p1',
        vibe: 'morning', length: 'quick', createdAt: Date.now(),
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: '', duration: 1 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: '', duration: 1 },
          { id: 't2', title: 'T2', artistName: 'A', albumTitle: '', duration: 1 },
        ],
        segmentSlots: [
          { index: 0, kind: 'cold_open', beforeTrackId: 't0',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg0-v0.mp3'] },
          { index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg1-v0.mp3'] },
          { index: 2, kind: 'sign_off', afterTrackId: 't2',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg2-v0.mp3'] },
        ],
      };

      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(manifest, ['https://cdn/seg0-v0.mp3']);

      for (let t = 0; t < 3; t++) {
        for (let i = 0; i < 80; i++) await Promise.resolve();
        deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
        deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      }
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'tts:BASE64_seg0-v0.m',
        'play:t0',
        'play:t1',
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'tts:BASE64_seg2-v0.m',
      ]);

      await player.end();
    });

    it('progress is monotonic through a 5-track sparse broadcast', async () => {
      const deps = makeDeps();
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );

      const samples: number[] = [];
      const sample = () => samples.push(player.getStatus().progress);

      player.start(makeManifest5(), ['https://cdn/seg0-v0.mp3']);

      // Sample after every await microtask flush so we see the value during
      // segments, between states, and during tracks.
      for (let t = 0; t < 5; t++) {
        for (let i = 0; i < 80; i++) { await Promise.resolve(); sample(); }
        deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
        sample();
        deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
        sample();
      }
      for (let i = 0; i < 80; i++) { await Promise.resolve(); sample(); }

      // Each sample must be >= the previous sample.
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
      }
      // Final progress should have reached 100% once state transitions to 'ended'.
      expect(samples[samples.length - 1]).toBe(1);

      await player.end();
    });
  });

  describe('cursor persistence', () => {
    // We read back the persisted record via MMKV (mocked).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getPersistedBroadcast } = require('../../src/services/Storage');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { __resetAllStores } = require('../../__mocks__/react-native-mmkv');

    beforeEach(() => { __resetAllStores(); });

    it('seeds trackCursor=-1 at start() and advances to N as runTrackAt(N) fires', async () => {
      const deps = makeDeps();
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const manifest: Manifest = {
        broadcastId: 'bC', userId: 'u1', playlistId: 'p1',
        vibe: 'morning', length: 'quick', createdAt: Date.now(),
        tracks: [
          { id: 't0', title: 'T0', artistName: 'A', albumTitle: '', duration: 1 },
          { id: 't1', title: 'T1', artistName: 'A', albumTitle: '', duration: 1 },
        ],
        segmentSlots: [
          { index: 0, kind: 'cold_open', beforeTrackId: 't0',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg0-v0.mp3'] },
          { index: 1, kind: 'sign_off', afterTrackId: 't1',
            variantCount: 1, status: 'ready',
            audioUrls: ['https://cdn/seg1-v0.mp3'] },
        ],
      };

      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(manifest, ['https://cdn/seg0-v0.mp3']);

      // Immediately after start(), record is seeded with cursor -1.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(getPersistedBroadcast()?.trackCursor).toBe(-1);

      // Drive t0 to completion.
      for (let i = 0; i < 80; i++) await Promise.resolve();
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      for (let i = 0; i < 80; i++) await Promise.resolve();
      // Cursor should now be at 1 (runTrackAt(1) entered).
      expect(getPersistedBroadcast()?.trackCursor).toBe(1);

      // Drive t1 to completion; after sign_off the record should be cleared.
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      for (let i = 0; i < 80; i++) await Promise.resolve();
      expect(getPersistedBroadcast()).toBeUndefined();

      await player.end();
    });
  });

  describe('resume', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { __resetAllStores } = require('../../__mocks__/react-native-mmkv');

    beforeEach(() => { __resetAllStores(); });

    // 5-track sparse manifest: cold_open → t0 → t1 → trans(before t2) → t2 → t3 → trans(before t4) → t4 → sign_off
    const make5Manifest = (): Manifest => ({
      broadcastId: 'bR', userId: 'u1', playlistId: 'p1',
      vibe: 'lateNight', length: 'quick', createdAt: Date.now(),
      tracks: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`, title: `T${i}`, artistName: 'A', albumTitle: '', duration: 1,
      })),
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg0-v0.mp3'] },
        { index: 1, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg1-v0.mp3'] },
        { index: 2, kind: 'transition', afterTrackId: 't3', beforeTrackId: 't4',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg2-v0.mp3'] },
        { index: 3, kind: 'sign_off', afterTrackId: 't4',
          variantCount: 1, status: 'ready', audioUrls: ['https://cdn/seg3-v0.mp3'] },
      ],
    });

    const makeDriver = () => {
      const deps = makeDeps();
      const music = {
        ...deps.music,
        getPlaybackStatus: jest.fn(async () => 'stopped'),
        getPlaybackTime: jest.fn(async () => 1),
      };
      const driveTrackEnd = async () => {
        for (let i = 0; i < 80; i++) await Promise.resolve();
        deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
        deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
      };
      return { deps, music, driveTrackEnd };
    };

    it('cursor === -1 behaves identically to start (plays cold_open then all 5 tracks)', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), -1);
      for (let t = 0; t < 5; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'tts:BASE64_seg0-v0.m',
        'play:t0',
        'play:t1',
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      await player.end();
    });

    it('cursor=2 (transition precedes t2) replays seg1 then plays t2 onward — cold_open NOT replayed', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), 2);
      // Remaining flow: seg1 → t2 → t3 → seg2 → t4 → seg3
      for (let t = 0; t < 3; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      expect(order).not.toContain('tts:BASE64_seg0-v0.m');
      expect(order).not.toContain('play:t0');
      expect(order).not.toContain('play:t1');

      await player.end();
    });

    it('cursor=3 (no transition precedes t3) starts at t3 without any intro segment', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), 3);
      // Remaining flow: t3 → seg2 → t4 → seg3
      for (let t = 0; t < 2; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      await player.end();
    });

    it('cursor=1 (no transition precedes t1) starts at t1 — nextSegmentIdx skips past the cold_open slot', async () => {
      const { deps, music, driveTrackEnd } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.resume(make5Manifest(), 1);
      // Remaining: t1 → seg1 → t2 → t3 → seg2 → t4 → seg3
      for (let t = 0; t < 4; t++) await driveTrackEnd();
      for (let i = 0; i < 80; i++) await Promise.resolve();

      const order = deps.logs.filter(
        l => l.startsWith('tts:BASE64_seg') || l.startsWith('play:'),
      );
      expect(order).toEqual([
        'play:t1',
        'tts:BASE64_seg1-v0.m',
        'play:t2',
        'play:t3',
        'tts:BASE64_seg2-v0.m',
        'play:t4',
        'tts:BASE64_seg3-v0.m',
      ]);
      await player.end();
    });

  it('runSegmentAt pushes NowPlaying segment metadata for cold_open / transition / sign_off', async () => {
    const deps = makeDeps();
    const music = {
      ...deps.music,
      getPlaybackStatus: jest.fn(async () => 'stopped'),
      getPlaybackTime: jest.fn(async () => 1),
    };
    const player = new BroadcastPlayer(
      music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest3(), ['https://cdn/seg0-v0.mp3']);
    // Drive all 3 tracks through to sign-off.
    for (let t = 0; t < 3; t++) {
      for (let i = 0; i < 80; i++) await Promise.resolve();
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
    }
    for (let i = 0; i < 80; i++) await Promise.resolve();

    const kinds = deps.logs.filter(l => l.startsWith('np.segment:')).map(l => l.split(':')[1].split('|')[0]);
    expect(kinds).toEqual(['cold_open', 'transition', 'sign_off']);
    await player.end();
  });

  it('end() clears the NowPlaying tile', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await player.end();
    expect(deps.music.clearNowPlaying).toHaveBeenCalledTimes(1);
  });

  it('natural broadcast completion clears the NowPlaying tile', async () => {
    const deps = makeDeps();
    const music = {
      ...deps.music,
      getPlaybackStatus: jest.fn(async () => 'stopped'),
      getPlaybackTime: jest.fn(async () => 1),
    };
    const player = new BroadcastPlayer(
      music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < 80; i++) await Promise.resolve();
      deps.listeners.state?.({ status: 'playing', playbackTime: 0.1 });
      deps.listeners.state?.({ status: 'stopped', playbackTime: 1 });
    }
    for (let i = 0; i < 120; i++) await Promise.resolve();
    expect(deps.music.clearNowPlaying).toHaveBeenCalledTimes(1);
    await player.end();
  });

    it('cursor out of bounds clears persistence and does nothing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { setPersistedBroadcast, getPersistedBroadcast } =
        require('../../src/services/Storage');
      const manifest = make5Manifest();
      setPersistedBroadcast({ manifest, trackCursor: 99, updatedAt: Date.now() });

      const { deps, music } = makeDriver();
      const player = new BroadcastPlayer(
        music, deps.native, deps.manifestClient, deps.stingers,
      );
      await player.resume(manifest, 99);

      expect(getPersistedBroadcast()).toBeUndefined();
      expect(player.getStatus().state).toBe('idle');
      expect(deps.logs.some(l => l.startsWith('play:'))).toBe(false);
    });
  });

  it('elapsed pump pushes NowPlaying elapsed while playing and stops on pause', async () => {
    jest.useFakeTimers();
    const deps = makeDeps();
    let t = 0;
    const music = {
      ...deps.music,
      getPlaybackStatus: jest.fn(async () => 'playing'),
      getPlaybackTime:   jest.fn(async () => { t += 1; return t; }),
    };
    const player = new BroadcastPlayer(
      music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    // Allow cold_open + runTrackAt(0) to be reached.
    for (let i = 0; i < 80; i++) { await Promise.resolve(); }
    // Advance fake time by 3s — pump should have fired ~3 times.
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(1000);
      for (let j = 0; j < 5; j++) await Promise.resolve();
    }
    const playingTicks = (deps.music.setNowPlayingElapsed as jest.Mock).mock.calls
      .filter(c => c[1] === true).length;
    expect(playingTicks).toBeGreaterThanOrEqual(2);

    await player.pause();
    const beforePause = (deps.music.setNowPlayingElapsed as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(3000);
    for (let j = 0; j < 5; j++) await Promise.resolve();
    const afterPause = (deps.music.setNowPlayingElapsed as jest.Mock).mock.calls.length;
    // Pump may push a single playing:false tick when pause runs, but should
    // not keep ticking after — so afterPause - beforePause ≤ 1.
    expect(afterPause - beforePause).toBeLessThanOrEqual(1);

    await player.end();
    jest.useRealTimers();
  });

  it('remote pause from lock screen pauses the broadcast', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(deps.music.subscribeRemoteCommands).toHaveBeenCalled();
    deps.fireRemotePause();
    expect(player.getStatus().state).toBe('paused');
    deps.fireRemotePlay();
    expect(player.getStatus().state).not.toBe('paused');
    await player.end();
  });
});

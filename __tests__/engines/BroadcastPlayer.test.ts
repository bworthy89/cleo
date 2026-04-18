import { BroadcastPlayer } from '../../src/engines/BroadcastPlayer';
import type { Manifest } from '../../src/engines/BroadcastPlayer.types';

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
    { index: 1, kind: 'transition', afterTrackId: 't0', beforeTrackId: 't1', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg1-v0.mp3'] },
    { index: 2, kind: 'sign_off', afterTrackId: 't1', variantCount: 1, status: 'ready',
      audioUrls: ['https://cdn/seg2-v0.mp3'] },
  ],
});

type Listeners = {
  track?: (e: { trackId?: string }) => void;
  state?: (e: { status: string; playbackTime: number }) => void;
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
    await player.resume();
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
        { index: 1, kind: 'transition', afterTrackId: 't0', beforeTrackId: 't1', variantCount: 1, status: 'pending' },
        { index: 2, kind: 'sign_off', afterTrackId: 't1', variantCount: 1, status: 'pending' },
      ],
    };
    const ready: Manifest = {
      ...pending,
      segmentSlots: [
        pending.segmentSlots[0],
        { ...pending.segmentSlots[1], status: 'ready', audioUrls: ['u1'] },
        { ...pending.segmentSlots[2], status: 'ready', audioUrls: ['u2'] },
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
      const deps = makeDeps();
      const player = new BroadcastPlayer(
        deps.music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
      // Flush cold_open segment and transition into runTrackAt(0)
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t0');

      // Simulate MusicKit streaming playback events, then track end + position reset
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

      // Transition → runTrackAt(1)
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t1');
      deps.listeners.state?.({ status: 'playing', playbackTime: 179 });
      deps.listeners.state?.({ status: 'paused',  playbackTime: 0 });

      // Sign off + post-loop teardown
      for (let i = 0; i < 40; i++) await Promise.resolve();

      const signOff = deps.logs.findIndex(l => l.startsWith('tts:BASE64_seg2'));
      const pause   = deps.logs.indexOf('music.pause');
      expect(signOff).toBeGreaterThan(-1);
      expect(pause).toBeGreaterThan(signOff);
      expect(player.getStatus().state).toBe('ended');

      await player.end();
    });

    it('does NOT advance on user pause (time does not reset to 0)', async () => {
      const deps = makeDeps();
      const player = new BroadcastPlayer(
        deps.music, deps.native, deps.manifestClient, deps.stingers,
      );
      player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
      for (let i = 0; i < 40; i++) await Promise.resolve();
      expect(deps.logs).toContain('play:t0');

      // Playing normally
      deps.listeners.state?.({ status: 'playing', playbackTime: 10 });
      deps.listeners.state?.({ status: 'playing', playbackTime: 45 });
      // User pauses mid-track — MusicKit keeps position, doesn't reset to 0
      deps.listeners.state?.({ status: 'paused', playbackTime: 45 });

      for (let i = 0; i < 20; i++) await Promise.resolve();
      // Transition segment must NOT have started
      expect(deps.logs.some(l => l.startsWith('tts:BASE64_seg1'))).toBe(false);

      await player.end();
    });
  });
});

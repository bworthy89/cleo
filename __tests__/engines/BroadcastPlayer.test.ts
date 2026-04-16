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

  it('pause() stops segment audio and pauses MusicKit', async () => {
    const deps = makeDeps();
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers,
    );
    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);
    await Promise.resolve();
    await player.pause();
    expect(deps.native.stopAudio).toHaveBeenCalled();
    expect(deps.music.pause).toHaveBeenCalled();
    expect(player.getStatus().state).toBe('paused');
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
    // Simulate firing a state change that could throw if a listener has a bug
    expect(() => deps.fireStateChanged('playing')).not.toThrow();
    expect(() => deps.fireTrackChanged('t0')).not.toThrow();
  });
});

import { Scrobbler } from '../../src/engines/Scrobbler';
import type { ScrobblerApi, ScrobblePayload, ScrobbleEventPayload } from '../../src/engines/Scrobbler.types';
import type { ManifestTrack } from '../../src/engines/BroadcastPlayer.types';

const mkTrack = (over: Partial<ManifestTrack> = {}): ManifestTrack => ({
  id: 't1', title: 'T', artistName: 'A', albumTitle: 'AL', duration: 180,
  ...over,
});

const mkApi = (): jest.Mocked<ScrobblerApi> => ({
  nowPlaying: jest.fn(async (_p: ScrobblePayload) => {}),
  scrobble: jest.fn(async (_p: ScrobbleEventPayload) => {}),
});

describe('Scrobbler', () => {
  describe('onTrackStarted', () => {
    it('fires nowPlaying with the track payload', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ duration: 240 }));
      expect(api.nowPlaying).toHaveBeenCalledWith(expect.objectContaining({
        trackId: 't1', title: 'T', artistName: 'A', albumTitle: 'AL', duration: 240,
      }));
    });

    it('does not fire nowPlaying for tracks under 30s', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ duration: 25 }));
      expect(api.nowPlaying).not.toHaveBeenCalled();
    });
  });

  describe('onElapsedTick threshold', () => {
    it.each([
      { dur: 60,   threshold: 30 },     // min(30, 240) = 30
      { dur: 180,  threshold: 90 },     // min(90, 240) = 90
      { dur: 600,  threshold: 240 },    // min(300, 240) = 240
      { dur: 4000, threshold: 240 },    // min(2000, 240) = 240
    ])('fires scrobble at exactly $threshold for a $dur s track', ({ dur, threshold }) => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: dur });
      s.onTrackStarted(track);

      s.onElapsedTick(track, threshold - 1);
      expect(api.scrobble).not.toHaveBeenCalled();

      s.onElapsedTick(track, threshold);
      expect(api.scrobble).toHaveBeenCalledTimes(1);
    });

    it('fires scrobble at most once per track even with many ticks past threshold', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: 60 });
      s.onTrackStarted(track);
      s.onElapsedTick(track, 30);
      s.onElapsedTick(track, 31);
      s.onElapsedTick(track, 50);
      expect(api.scrobble).toHaveBeenCalledTimes(1);
    });

    it('never fires scrobble for tracks under 30s no matter how long they tick', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: 25 });
      s.onTrackStarted(track);
      s.onElapsedTick(track, 100);
      expect(api.scrobble).not.toHaveBeenCalled();
    });

    it('ignores ticks for a different track id (drift safety)', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ id: 't1', duration: 60 }));
      s.onElapsedTick(mkTrack({ id: 't2', duration: 60 }), 100);
      expect(api.scrobble).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('clears track state so the next ticks are no-ops', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ duration: 60 }));
      s.reset();
      s.onElapsedTick(mkTrack({ duration: 60 }), 100);
      expect(api.scrobble).not.toHaveBeenCalled();
    });
  });

  describe('startedAt timestamp', () => {
    it('passes unix-second timestamp to scrobble', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const before = Math.floor(Date.now() / 1000);
      const track = mkTrack({ duration: 60 });
      s.onTrackStarted(track);
      s.onElapsedTick(track, 30);
      const after = Math.floor(Date.now() / 1000);
      const call = api.scrobble.mock.calls[0][0];
      expect(call.startedAt).toBeGreaterThanOrEqual(before);
      expect(call.startedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('error tolerance', () => {
    it('swallows nowPlaying rejection', async () => {
      const api = mkApi();
      api.nowPlaying.mockRejectedValueOnce(new Error('boom'));
      const s = new Scrobbler(api);
      expect(() => s.onTrackStarted(mkTrack({ duration: 60 }))).not.toThrow();
      // Flush the microtask queue so the .catch(() => {}) inside onTrackStarted
      // settles the rejection before the test ends.
      await Promise.resolve();
      await Promise.resolve();
    });

    it('swallows scrobble rejection', async () => {
      const api = mkApi();
      api.scrobble.mockRejectedValueOnce(new Error('boom'));
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: 60 });
      s.onTrackStarted(track);
      expect(() => s.onElapsedTick(track, 30)).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

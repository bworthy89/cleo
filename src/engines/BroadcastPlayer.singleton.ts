import { BroadcastPlayer } from './BroadcastPlayer';
import { BroadcastManifestClient } from './BroadcastManifestClient';
import { getStinger, preloadStingers } from './BroadcastStingers';
import { Scrobbler } from './Scrobbler';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import * as LastFmService from '../services/LastFmService';
import {
  activateDuckingSession,
  deactivateDuckingSession,
  playAudioFromBase64,
  stopAudio,
  releaseAudioSession,
  setBroadcastActive,
} from '../../modules/expo-music-kit';

const scrobbler = new Scrobbler({
  nowPlaying: (p) => LastFmService.nowPlaying(p),
  scrobble: (p) => LastFmService.scrobble(p),
});

export const broadcastPlayer = new BroadcastPlayer(
  {
    play: (ids?: string[]) => musicKitPlayer.play(ids),
    pause: () => musicKitPlayer.pause(),
    skip: () => musicKitPlayer.skip(),
    setUpcomingQueue: (ids: string[]) => musicKitPlayer.setUpcomingQueue(ids),
    onTrackChanged: (cb) => musicKitPlayer.onTrackChanged(cb),
    onPlaybackStateChanged: (cb) => musicKitPlayer.onPlaybackStateChanged(cb),
    getPlaybackStatus: () => musicKitPlayer.getPlaybackStatus(),
    getPlaybackTime: () => musicKitPlayer.getPlaybackTime(),
    setNowPlayingTrack:   (p) => musicKitPlayer.setNowPlayingTrack(p),
    setNowPlayingSegment: (p) => musicKitPlayer.setNowPlayingSegment(p),
    setNowPlayingElapsed: (e, p) => musicKitPlayer.setNowPlayingElapsed(e, p),
    clearNowPlaying:      ()  => musicKitPlayer.clearNowPlaying(),
    subscribeRemoteCommands: (h) => musicKitPlayer.subscribeRemoteCommands(h),
    startBroadcastLiveActivity:  (a, s) => musicKitPlayer.startBroadcastLiveActivity(a, s),
    updateBroadcastLiveActivity: (s)    => musicKitPlayer.updateBroadcastLiveActivity(s),
    endBroadcastLiveActivity:    ()     => musicKitPlayer.endBroadcastLiveActivity(),
  },
  {
    activateDuckingSession, deactivateDuckingSession, playAudioFromBase64,
    stopAudio, releaseAudioSession, setBroadcastActive,
  },
  new BroadcastManifestClient(),
  { getStinger, preloadStingers },
  scrobbler,
);

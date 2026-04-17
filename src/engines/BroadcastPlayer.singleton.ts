import { BroadcastPlayer } from './BroadcastPlayer';
import { BroadcastManifestClient } from './BroadcastManifestClient';
import { getStinger, preloadStingers } from './BroadcastStingers';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import {
  activateDuckingSession,
  deactivateDuckingSession,
  playAudioFromBase64,
  stopAudio,
  releaseAudioSession,
  setBroadcastActive,
} from '../../modules/expo-music-kit';

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
  },
  {
    activateDuckingSession, deactivateDuckingSession, playAudioFromBase64,
    stopAudio, releaseAudioSession, setBroadcastActive,
  },
  new BroadcastManifestClient(),
  { getStinger, preloadStingers },
);

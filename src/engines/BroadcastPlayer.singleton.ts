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
} from '../../modules/expo-music-kit';

export const broadcastPlayer = new BroadcastPlayer(
  {
    play: (ids?: string[]) => musicKitPlayer.play(ids),
    pause: () => musicKitPlayer.pause(),
    skip: () => musicKitPlayer.skip(),
    setUpcomingQueue: (ids: string[]) => musicKitPlayer.setUpcomingQueue(ids),
    onTrackChanged: (cb) => musicKitPlayer.onTrackChanged(cb),
    onPlaybackStateChanged: (cb) => musicKitPlayer.onPlaybackStateChanged(cb),
  },
  { activateDuckingSession, deactivateDuckingSession, playAudioFromBase64, stopAudio, releaseAudioSession },
  new BroadcastManifestClient(),
  { getStinger, preloadStingers },
);

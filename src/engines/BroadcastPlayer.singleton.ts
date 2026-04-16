import { BroadcastPlayer } from './BroadcastPlayer';
import { BroadcastManifestClient } from './BroadcastManifestClient';
import { getStinger, preloadStingers } from './BroadcastStingers';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import {
  activateDuckingSession,
  deactivateDuckingSession,
  playAudioFromBase64,
  stopAudio,
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
  { activateDuckingSession, deactivateDuckingSession, playAudioFromBase64, stopAudio },
  new BroadcastManifestClient(),
  { getStinger, preloadStingers },
);

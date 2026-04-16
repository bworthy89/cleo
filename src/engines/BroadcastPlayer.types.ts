export type Vibe =
  | 'morning' | 'chill' | 'workout' | 'lateNight' | 'party'
  | 'general' | 'focus' | 'feelGood' | 'throwback' | 'elevated'
  | 'melancholy' | 'sunday';

export type BroadcastLength = 'quick' | 'standard' | 'long';

export type SegmentSlotKind = 'cold_open' | 'transition' | 'sign_off';

export interface SegmentSlot {
  index: number;
  kind: SegmentSlotKind;
  beforeTrackId?: string;
  afterTrackId?: string;
  variantCount: number;
  status: 'pending' | 'ready' | 'failed';
  audioUrls?: string[];
}

export interface ManifestTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  artworkUrl?: string;
}

export interface Manifest {
  broadcastId: string;
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  createdAt: number;
  tracks: ManifestTrack[];
  segmentSlots: SegmentSlot[];
}

export type PlayerState =
  | 'idle'
  | 'loading'
  | 'playing_segment'
  | 'playing_track'
  | 'paused'
  | 'ended'
  | 'error';

export type BroadcastPlayerState = PlayerState;

export interface PlayerStatus {
  state: PlayerState;
  currentTrackIndex: number;
  currentSegmentIndex: number;
  broadcastId: string | null;
  nowPlaying:
    | { segmentKind: SegmentSlotKind }
    | { trackId: string }
    | null;
  progress: number;
}

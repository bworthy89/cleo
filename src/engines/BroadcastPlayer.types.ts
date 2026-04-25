export type Vibe =
  | 'morning' | 'focus' | 'workout' | 'feelGood'
  | 'lateNight' | 'melancholy' | 'party';

export type BroadcastLength = 'quick' | 'standard' | 'long';

export type SegmentSlotKind = 'cold_open' | 'transition' | 'sign_off';

export type SegmentTier = 'cold_open' | 'fact_bridge' | 'tight_bridge' | 'deep_dive' | 'sign_off';

export interface SegmentSlot {
  index: number;
  kind: SegmentSlotKind;
  beforeTrackId?: string;
  afterTrackId?: string;
  variantCount: number;
  status: 'pending' | 'ready' | 'failed' | 'aborted';
  audioUrls?: string[];
  /** Tier used to build this slot's prompt. 'cold_open' / 'sign_off' match
   *  their kind; transitions are either 'fact_bridge' or 'deep_dive' based
   *  on the sequencer's featureSlots. Optional for backward compatibility. */
  tier?: SegmentTier;
}

export interface ManifestTrack {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  duration: number;
  artworkUrl?: string;
  /** Apple Music genre tags as surfaced from the client's MusicKit bridge.
   *  Server-side fallback when MusicBrainz / Last.fm don't return a genre.
   *  Optional for backward compatibility with pre-upgrade clients. */
  genreNames?: string[];
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
  /** Transition slot indices nominated for deep-dive treatment by the
   *  sequencer. Valid range: 1..N-1 where N is the track count. Optional
   *  for backward compatibility. */
  featureSlots?: number[];
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
  vibe: Vibe | null;
  totalTracks: number;
  currentTrack: ManifestTrack | null;
  nowPlaying:
    | { segmentKind: SegmentSlotKind }
    | { trackId: string }
    | null;
  progress: number;
}

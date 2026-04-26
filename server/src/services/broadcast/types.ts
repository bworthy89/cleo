/** Canonical vibe list — the single source of truth. `Vibe` is derived from
 *  this so adding a new entry updates the type automatically. Tests iterate
 *  `VIBE_LIST` instead of duplicating the array. */
export const VIBE_LIST = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
] as const;

export type Vibe = typeof VIBE_LIST[number];

export type BroadcastLength = 'quick' | 'standard' | 'long';

export type SegmentSlotKind =
  | 'cold_open'
  | 'transition'
  | 'sign_off';

export type SegmentTier =
  | 'cold_open'
  | 'fact_bridge'
  | 'tight_bridge'
  | 'deep_dive'
  | 'sign_off';

export interface SegmentSlot {
  index: number;
  kind: SegmentSlotKind;
  beforeTrackId?: string;
  afterTrackId?: string;
  variantCount: number;
  /** Lifecycle:
   *  - `pending`  — slot reserved at manifest-build time; bake worker not yet
   *                 done. Client polls until terminal.
   *  - `ready`    — segment audio generated and uploaded; `audioUrls` populated.
   *  - `failed`   — bake worker errored on this slot; skip silently and continue.
   *  - `aborted`  — bake was canceled (DELETE /broadcast/:id) before this slot
   *                 finished. Set by the abort handler on any non-terminal slot;
   *                 in-flight slot generation is allowed to complete naturally.
   *                 Treated like `failed` by the client (defensive — aborted
   *                 bakes never reach /player under user-driven flows). */
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
  /** Apple Music ISRC (International Standard Recording Code) for the track.
   *  Used as the lookup key for ReccoBeats / Deezer audio-feature fetches.
   *  Optional — pre-upgrade clients + tracks without an ISRC omit this. */
  isrc?: string;
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

export interface BroadcastCreateRequest {
  /** null allowed for curator-driven broadcasts where no source playlist exists */
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  userContext: {
    lastSessionSummary?: string;
    tracksRecentlyPlayed?: string[];
    timeOfDay: string;
    dayOfWeek: string;
    firstTimeUser: boolean;
    listenerName?: string;
    /** Optional weather location for cold_open mention. When present,
     *  the orchestrator fetches a hint sentence from WeatherProvider and
     *  injects it into SegmentContext.weatherHint. */
    weatherCoords?: {
      lat: number;
      lon: number;
      cityName: string;
    };
  };
  tracks: ManifestTrack[];
  /** When true, the orchestrator skips the DeterministicTrackSequencer's
   *  score-and-place pass and uses `tracks` in the order the caller supplied.
   *  Intended for Ask ONAY flows where Groq already curated the sequence —
   *  re-ordering server-side would disrupt the LLM's deliberate progression.
   *  Deep-dive slot nomination still runs; feature fetch still runs for
   *  commentary enrichment. */
  preserveOrder?: boolean;
}

export interface BroadcastCreateResponse {
  manifest: Manifest;
  firstSegmentUrls: string[];
}

import { generateSegment, type SegmentContext, type SessionPhase, type DeliveryMode } from '../services/CleoScriptGenerator';
import type { SegmentType, Vibe } from '../cleo/fallbacks';
import { getColdOpen } from '../cleo/cold-opens';
import type { EnrichedFacts } from '../services/TrackEnrichmentService';

// DeliveryMode is defined and exported from CleoScriptGenerator — re-export for consumers
export type { DeliveryMode } from '../services/CleoScriptGenerator';

interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
}

export interface SegmentResult {
  text: string;
  type: SegmentType;
  deliveryMode: DeliveryMode;
}

interface BufferedSegment {
  text: string;
  type: SegmentType;
  deliveryMode: DeliveryMode;
}

// Segment types that are always pre_song
const ALWAYS_PRE: SegmentType[] = ['song_intro', 'genre_bridge'];
// Segment types that are always post_song
const ALWAYS_POST: SegmentType[] = ['post_track_reflection'];
// Segment types that prefer post_song but can fall back
const PREFER_POST: SegmentType[] = ['track_story', 'artist_context'];

const ROTATION: SegmentType[] = [
  'song_intro',
  'artist_context',
  'station_id',
  'song_intro',
  'track_story',
  'genre_bridge',
  'song_intro',
  'post_track_reflection',
  'artist_context',
  'session_checkin',
  'song_intro',
  'post_track_reflection',
  'listener_shoutout',
];

class SegmentControllerEngine {
  private history: string[] = [];
  private rotationIndex = 0;
  private segmentCount = 0;
  private sessionStartTime = Date.now();
  private bufferedSegment: BufferedSegment | null = null;
  private currentVibe: Vibe = 'chill';
  private listenerName?: string;
  private lastDeliveryMode: DeliveryMode = 'pre_song';
  private consecutivePreSong = 0;
  private tracksReferenced: string[] = [];

  setVibe(vibe: Vibe) {
    this.currentVibe = vibe;
  }

  setListenerName(name: string) {
    this.listenerName = name;
  }

  startSession() {
    this.history = [];
    this.rotationIndex = 0;
    this.segmentCount = 0;
    this.sessionStartTime = Date.now();
    this.bufferedSegment = null;
    this.lastDeliveryMode = 'pre_song';
    this.consecutivePreSong = 0;
    this.tracksReferenced = [];
  }

  private getNextSegmentType(): SegmentType {
    const type = ROTATION[this.rotationIndex % ROTATION.length];
    this.rotationIndex++;
    return type;
  }

  private getSessionDuration(): number {
    return Math.floor((Date.now() - this.sessionStartTime) / 60000);
  }

  private getSessionPhase(): SessionPhase {
    if (this.segmentCount <= 3) return 'opening';
    if (this.segmentCount <= 8) return 'mid';
    return 'late';
  }

  // Pure function — reads mode logic without mutating state. Used by preloadNext.
  private _peekDeliveryMode(segmentType: SegmentType): DeliveryMode {
    if (ALWAYS_PRE.includes(segmentType)) return 'pre_song';
    if (ALWAYS_POST.includes(segmentType)) return 'post_song';
    if (this.lastDeliveryMode === 'post_song') return 'pre_song';
    if (PREFER_POST.includes(segmentType) && this.consecutivePreSong >= 2) return 'post_song';
    return 'pre_song';
  }

  // Determines delivery mode AND updates tracking state. Used by generateNext.
  getDeliveryMode(segmentType: SegmentType): DeliveryMode {
    const mode = this._peekDeliveryMode(segmentType);
    if (mode === 'post_song') {
      this.consecutivePreSong = 0;
      this.lastDeliveryMode = 'post_song';
    } else {
      this.consecutivePreSong++;
      this.lastDeliveryMode = 'pre_song';
    }
    return mode;
  }

  private addToTracksReferenced(artistName: string) {
    if (!this.tracksReferenced.includes(artistName)) {
      this.tracksReferenced.push(artistName);
    }
  }

  async generateNext(
    currentTrack: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo
  ): Promise<SegmentResult> {
    // Cold open for first segment — always pre_song
    if (this.segmentCount === 0) {
      const text = getColdOpen(this.currentVibe);
      this.history.unshift(text);
      if (this.history.length > 3) this.history.pop();
      this.segmentCount++;
      this.addToTracksReferenced(currentTrack.artistName);
      return { text, type: 'song_intro', deliveryMode: 'pre_song' };
    }

    // Use buffer if available and mode constraints allow it
    if (this.bufferedSegment) {
      const buffered = this.bufferedSegment;
      // Check mode constraint: never two post_song in a row
      const modeValid = !(buffered.deliveryMode === 'post_song' && this.lastDeliveryMode === 'post_song');

      if (modeValid) {
        this.bufferedSegment = null;
        this.history.unshift(buffered.text);
        if (this.history.length > 3) this.history.pop();
        this.segmentCount++;
        this.addToTracksReferenced(currentTrack.artistName);
        // Update mode tracking to match what was buffered
        this.lastDeliveryMode = buffered.deliveryMode;
        if (buffered.deliveryMode === 'pre_song') {
          this.consecutivePreSong++;
        } else {
          this.consecutivePreSong = 0;
        }
        return buffered;
      } else {
        // Discard stale buffered segment — regenerate below
        this.bufferedSegment = null;
      }
    }

    let segmentType = this.getNextSegmentType();

    // track_story requires rich data — fall back if not available
    if (segmentType === 'track_story' && !currentTrack.hasRichData) {
      segmentType = 'artist_context';
    }

    const deliveryMode = this.getDeliveryMode(segmentType);

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode,
      sessionPhase: this.getSessionPhase(),
      currentTrack,
      previousTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
      tracksReferenced: [...this.tracksReferenced],
    };

    const text = await generateSegment(context);

    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;
    this.addToTracksReferenced(currentTrack.artistName);

    return { text, type: segmentType, deliveryMode };
  }

  async preloadNext(currentTrack: TrackInfo, nextTrack?: TrackInfo): Promise<void> {
    if (this.bufferedSegment) return;

    const segmentType = ROTATION[(this.rotationIndex) % ROTATION.length];
    // Use _peekDeliveryMode — does NOT mutate tracking state
    const deliveryMode = this._peekDeliveryMode(segmentType);

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      deliveryMode,
      sessionPhase: this.getSessionPhase(),
      currentTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
      tracksReferenced: [...this.tracksReferenced],
    };

    try {
      const text = await generateSegment(context);
      this.bufferedSegment = { text, type: segmentType, deliveryMode };
    } catch {
      // Pre-load failure is non-fatal
    }
  }

  getSegmentCount(): number {
    return this.segmentCount;
  }
}

export const segmentController = new SegmentControllerEngine();

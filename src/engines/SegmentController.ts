import { generateSegment, type SegmentContext } from '../services/CleoScriptGenerator';
import type { SegmentType, Vibe } from '../cleo/fallbacks';
import { getColdOpen } from '../cleo/cold-opens';
import type { EnrichedFacts } from '../services/TrackEnrichmentService';

interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
}

interface SegmentResult {
  text: string;
  type: SegmentType;
}

const ROTATION: SegmentType[] = [
  'song_intro',
  'artist_context',
  'station_id',
  'song_intro',
  'track_story',
  'listener_shoutout',
  'song_intro',
  'artist_context',
  'session_checkin',
];

class SegmentControllerEngine {
  private history: string[] = [];
  private rotationIndex = 0;
  private segmentCount = 0;
  private sessionStartTime = Date.now();
  private bufferedSegment: SegmentResult | null = null;
  private currentVibe: Vibe = 'chill';
  private listenerName?: string;

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
  }

  private getNextSegmentType(): SegmentType {
    const type = ROTATION[this.rotationIndex % ROTATION.length];
    this.rotationIndex++;
    return type;
  }

  private getSessionDuration(): number {
    return Math.floor((Date.now() - this.sessionStartTime) / 60000);
  }

  async generateNext(currentTrack: TrackInfo, nextTrack?: TrackInfo): Promise<SegmentResult> {
    // Cold open for first segment
    if (this.segmentCount === 0) {
      const text = getColdOpen(this.currentVibe);
      this.history.unshift(text);
      if (this.history.length > 3) this.history.pop();
      this.segmentCount++;
      return { text, type: 'song_intro' };
    }

    if (this.bufferedSegment) {
      const buffered = this.bufferedSegment;
      this.bufferedSegment = null;
      this.history.unshift(buffered.text);
      if (this.history.length > 3) this.history.pop();
      this.segmentCount++;
      return buffered;
    }

    let segmentType = this.getNextSegmentType();

    // track_story requires rich data — fall back to artist_context if not available
    if (segmentType === 'track_story' && !currentTrack.hasRichData) {
      segmentType = 'artist_context';
    }

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      currentTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
    };

    const text = await generateSegment(context);

    this.history.unshift(text);
    if (this.history.length > 3) this.history.pop();
    this.segmentCount++;

    return { text, type: segmentType };
  }

  async preloadNext(currentTrack: TrackInfo, nextTrack?: TrackInfo): Promise<void> {
    if (this.bufferedSegment) return;

    const segmentType = ROTATION[(this.rotationIndex) % ROTATION.length];

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      currentTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
      enrichedFacts: currentTrack.enrichedFacts,
    };

    try {
      const text = await generateSegment(context);
      this.bufferedSegment = { text, type: segmentType };
    } catch {
      // Pre-load failure is non-fatal
    }
  }

  getSegmentCount(): number {
    return this.segmentCount;
  }
}

export const segmentController = new SegmentControllerEngine();

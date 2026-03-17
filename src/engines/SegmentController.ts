import { generateSegment, type SegmentContext } from '../services/CleoScriptGenerator';
import type { SegmentType, Vibe } from '../cleo/fallbacks';

interface TrackInfo {
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
}

interface SegmentResult {
  text: string;
  type: SegmentType;
}

const ROTATION: SegmentType[] = [
  'song_intro',
  'song_intro',
  'station_id',
  'song_intro',
  'song_intro',
  'listener_shoutout',
  'song_intro',
  'song_intro',
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
    if (this.bufferedSegment) {
      const buffered = this.bufferedSegment;
      this.bufferedSegment = null;
      this.history.unshift(buffered.text);
      if (this.history.length > 3) this.history.pop();
      this.segmentCount++;
      return buffered;
    }

    const segmentType = this.getNextSegmentType();

    const context: SegmentContext = {
      segmentType,
      vibe: this.currentVibe,
      currentTrack,
      nextTrack,
      sessionDurationMinutes: this.getSessionDuration(),
      segmentHistory: this.history.slice(0, 3),
      listenerName: this.listenerName,
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

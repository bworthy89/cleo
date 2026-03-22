/**
 * TransitionPreloader — pre-generates Cleo's eject transition script + TTS
 * mid-track, then fires the native playEjectTransition() at the eject point.
 *
 * State machine: idle → generating → ready → fired → done
 */

import { segmentController } from './SegmentController';
import { synthesize } from '../services/CleoVoiceEngine';
import { playEjectTransition, cancelEjectTransition } from '../../modules/expo-music-kit';
import { musicKitPlayer } from '../services/MusicKitPlayer';
import type { Vibe } from '../cleo/fallbacks';
import type { SegmentResult } from './SegmentController';
import type { TrackInfo } from '../types/TrackInfo';
import { logger } from '../services/logger';

type PreloaderState = 'idle' | 'generating' | 'ready' | 'fired' | 'done';

// ── Genre-based eject window sizing ──────────────────────────────────────

const GENRE_WINDOWS: { keywords: string[]; windowSec: number }[] = [
  { keywords: ['electronic', 'ambient', 'jazz'], windowSec: 22 },
  { keywords: ['pop', 'hip-hop', 'hip hop', 'r&b', 'rnb'], windowSec: 13 },
  { keywords: ['rock', 'indie', 'alternative'], windowSec: 16 },
];
const DEFAULT_WINDOW_SEC = 15;

function getEjectWindowSec(genreNames?: string[]): number {
  if (!genreNames || genreNames.length === 0) return DEFAULT_WINDOW_SEC;

  const lowerGenres = genreNames.map((g) => g.toLowerCase());
  for (const entry of GENRE_WINDOWS) {
    for (const keyword of entry.keywords) {
      if (lowerGenres.some((g) => g.includes(keyword))) {
        return entry.windowSec;
      }
    }
  }
  return DEFAULT_WINDOW_SEC;
}

// ── Pre-gen trigger delay ────────────────────────────────────────────────
// Start generation early — just a short delay after track starts so MusicKit
// has time to report track info. The TTS result is cached until the eject window.

const PRE_GEN_DELAY_SEC = 25; // start generating 25s into the track (after Cleo's intro finishes)

// ── TransitionPreloaderEngine ────────────────────────────────────────────

class TransitionPreloaderEngine {
  private state: PreloaderState = 'idle';
  private vibe: Vibe = 'general';
  private isSpeakingCheck: (() => boolean) | null = null;
  private generationId = 0;

  private currentTrack: TrackInfo | null = null;
  private nextTrack: TrackInfo | null = null;
  private previousTrack: TrackInfo | null = null;

  private cachedSegment: SegmentResult | null = null;
  private cachedBase64: string | null = null;
  private generatedNextTrackTitle: string | null = null;

  private preGenTriggerSec: number = 0;
  private ejectPointSec: number = 0;
  private preGenFired: boolean = false;
  private ejectFired: boolean = false;

  private unsubscribePlayback: (() => void) | null = null;
  private ejectWaitTimer: ReturnType<typeof setTimeout> | null = null;

  private onSegmentReady: ((segment: SegmentResult) => void) | null = null;
  private onEjectFired: (() => void) | null = null;
  private onFallback: (() => void) | null = null;

  // ── Public API ─────────────────────────────────────────────────────

  setVibe(vibe: Vibe): void {
    this.vibe = vibe;
  }

  setIsSpeakingCheck(fn: () => boolean): void {
    this.isSpeakingCheck = fn;
  }

  startForTrack(
    track: TrackInfo,
    nextTrack?: TrackInfo,
    previousTrack?: TrackInfo,
    onSegmentReady?: (segment: SegmentResult) => void,
    onEjectFired?: () => void,
    onFallback?: () => void
  ): void {
    this.reset();

    const durationSec = track.duration ?? 0;
    console.log(`[TransitionPreloader] startForTrack "${track.title}" — duration: ${durationSec}s`);
    if (durationSec < 30) {
      console.log('[TransitionPreloader] Track too short or no duration (<30s), skipping');
      return;
    }

    this.currentTrack = track;
    this.nextTrack = nextTrack ?? null;
    this.previousTrack = previousTrack ?? null;
    this.onSegmentReady = onSegmentReady ?? null;
    this.onEjectFired = onEjectFired ?? null;
    this.onFallback = onFallback ?? null;

    // Calculate timing points
    this.preGenTriggerSec = PRE_GEN_DELAY_SEC;

    const windowSec = getEjectWindowSec(track.genreNames);
    this.ejectPointSec = durationSec - windowSec;

    // Ensure eject point leaves enough room (at least 25s into the track)
    if (this.ejectPointSec < 25) {
      console.log('[TransitionPreloader] Track too short for eject window, skipping');
      return;
    }

    console.log(
      `[TransitionPreloader] Started for "${track.title}" — ` +
        `pregen at ${this.preGenTriggerSec}s, eject at ${this.ejectPointSec}s ` +
        `(duration ${durationSec}s, window ${windowSec}s)`
    );

    this.state = 'idle';
    this.preGenFired = false;
    this.ejectFired = false;

    // Poll playback time every 2s
    const pollInterval = setInterval(async () => {
      if (!this.currentTrack) return;
      try {
        const time = await musicKitPlayer.getPlaybackTime();

        // Trigger pre-generation (only if not already done, and Cleo isn't speaking)
        if (!this.preGenFired && time >= this.preGenTriggerSec) {
          const speaking = this.isSpeakingCheck ? this.isSpeakingCheck() : false;
          if (!speaking) {
            this.preGenFired = true;
            console.log(`[TransitionPreloader] Pre-gen trigger at ${time.toFixed(1)}s`);
            this.beginGeneration();
          }
        }

        // Trigger eject when we reach the eject point
        if (!this.ejectFired && time >= this.ejectPointSec) {
          this.ejectFired = true;
          if (this.state === 'ready' || this.state === 'generating') {
            console.log(`[TransitionPreloader] Eject trigger at ${time.toFixed(1)}s (state: ${this.state})`);
            this.tryFireEject();
          } else {
            // State is idle — generation never started or failed. Fall back.
            console.log(`[TransitionPreloader] Eject point reached but state is ${this.state} — falling back`);
            this.state = 'done';
            if (this.onFallback) this.onFallback();
          }
        }
      } catch (err) {
        logger.warn('TransitionPreloader', 'Poll error', err);
      }
    }, 2000);

    this.unsubscribePlayback = () => clearInterval(pollInterval);
  }

  cancel(): void {
    if (this.state === 'fired') {
      console.log('[TransitionPreloader] Cancelling fired eject transition');
      cancelEjectTransition().catch((err) =>
        console.log('[TransitionPreloader] cancelEjectTransition error:', err)
      );
    }
    this.reset();
  }

  /** Returns true if the preloader is actively monitoring a track (not reset/done) */
  isActive(): boolean {
    return this.currentTrack !== null && this.state !== 'done';
  }

  getState(): PreloaderState {
    return this.state;
  }

  getCachedSegment(): SegmentResult | null {
    return this.cachedSegment;
  }

  /**
   * Called after the AI queue upgrade reorders MusicKit's queue.
   * If the cached eject script references a next track that no longer matches
   * MusicKit's actual queue, regenerate the script + TTS proactively
   * (well before the eject fires) so the transition names the correct song.
   */
  revalidateNextTrack(): void {
    if (this.state !== 'ready' || !this.generatedNextTrackTitle) return;

    musicKitPlayer.getNextInQueue().then((realNext) => {
      if (!realNext || this.state !== 'ready') return;
      if (realNext.title !== this.generatedNextTrackTitle) {
        console.log(
          `[TransitionPreloader] Queue reordered: "${this.generatedNextTrackTitle}" → "${realNext.title}" — regenerating`
        );
        this.cachedSegment = null;
        this.cachedBase64 = null;
        this.generatedNextTrackTitle = null;
        this.state = 'idle';
        this.beginGeneration();
      }
    }).catch(() => {});
  }

  // ── Internal ───────────────────────────────────────────────────────

  private async beginGeneration(): Promise<void> {
    if (this.state !== 'idle') {
      console.log(`[TransitionPreloader] beginGeneration skipped — state is ${this.state}`);
      return;
    }

    this.state = 'generating';
    const myGenId = ++this.generationId;
    console.log('[TransitionPreloader] State: generating — calling generateEjectTransition');

    try {
      const track = this.currentTrack!;

      // Fetch the real next track from MusicKit's queue (not the session plan index)
      let nextTrack = this.nextTrack;
      try {
        const realNext = await musicKitPlayer.getNextInQueue();
        if (realNext) {
          nextTrack = { title: realNext.title, artistName: realNext.artistName };
          console.log(`[TransitionPreloader] Real next in queue: "${realNext.title}" by ${realNext.artistName}`);
        }
      } catch (err) {
        logger.warn('TransitionPreloader', 'getNextInQueue failed', err);
      }

      // Remember which next track we baked into the script
      this.generatedNextTrackTitle = nextTrack?.title ?? null;

      const segment = await segmentController.generateEjectTransition(
        track,
        nextTrack ?? undefined,
        this.previousTrack ?? undefined
      );

      if (myGenId !== this.generationId) return; // cancelled during generation

      if (!segment || !segment.text) {
        console.log('[TransitionPreloader] Generation returned empty segment');
        this.state = 'idle';
        return;
      }

      this.cachedSegment = segment;
      console.log(
        `[TransitionPreloader] Script generated (${segment.text.split(' ').length} words)`
      );

      // Synthesize TTS (retry up to 3 times with backoff for 429 rate limits)
      let base64Audio: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (myGenId !== this.generationId) return; // cancelled during synthesis
        base64Audio = await synthesize(segment.text, this.vibe);
        if (base64Audio) break;
        console.log(`[TransitionPreloader] TTS attempt ${attempt + 1} returned null, retrying in ${(attempt + 1) * 3}s...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
        if (myGenId !== this.generationId) return; // check after sleep too
      }
      if (myGenId !== this.generationId) return;
      if (!base64Audio) {
        console.log('[TransitionPreloader] TTS synthesis failed after 3 attempts');
        this.state = 'idle';
        return;
      }

      this.cachedBase64 = base64Audio;
      this.state = 'ready';
      console.log('[TransitionPreloader] State: ready — script + TTS cached');
      // Don't fire onSegmentReady here — it fires in fireEject() when ONAY starts speaking
    } catch (err) {
      console.log('[TransitionPreloader] Generation/synthesis error:', err);
      this.state = 'idle';
    }
  }

  private async tryFireEject(): Promise<void> {
    console.log(`[TransitionPreloader] tryFireEject — state: ${this.state}`);

    if (this.state === 'ready') {
      // Re-verify the next track hasn't changed since generation.
      // The AI queue upgrade can reorder MusicKit's queue after the script was generated,
      // making the cached next-track name stale (especially on the first track).
      try {
        const realNext = await musicKitPlayer.getNextInQueue();
        if (realNext && this.generatedNextTrackTitle && realNext.title !== this.generatedNextTrackTitle) {
          console.log(
            `[TransitionPreloader] Next track changed since generation: ` +
            `"${this.generatedNextTrackTitle}" → "${realNext.title}" — falling back to regenerate`
          );
          this.state = 'done';
          if (this.onFallback) this.onFallback();
          return;
        }
      } catch (err) {
        // getNextInQueue failed — proceed with cached data rather than blocking
      }

      // Check if Cleo is currently speaking
      const isSpeaking = this.isSpeakingCheck ? this.isSpeakingCheck() : false;
      if (isSpeaking) {
        console.log('[TransitionPreloader] Cleo is speaking, waiting up to 3s...');
        this.ejectWaitTimer = setTimeout(() => {
          this.ejectWaitTimer = null;
          if (this.state === 'ready' && !(this.isSpeakingCheck?.() ?? false)) {
            this.fireEject();
          } else {
            console.log('[TransitionPreloader] Still speaking after 3s, falling back');
            if (this.onFallback) this.onFallback();
          }
        }, 3000);
        return;
      }

      this.fireEject();
      return;
    }

    if (this.state === 'generating') {
      console.log('[TransitionPreloader] Still generating, waiting 3s for completion...');
      this.ejectWaitTimer = setTimeout(() => {
        this.ejectWaitTimer = null;
        if (this.state === 'ready') {
          this.fireEject();
        } else {
          console.log('[TransitionPreloader] Generation did not complete in time, falling back');
          if (this.onFallback) this.onFallback();
        }
      }, 3000);
      return;
    }

    // State is idle or unexpected — fallback
    console.log('[TransitionPreloader] Not ready for eject, falling back');
    if (this.onFallback) this.onFallback();
  }

  private fireEject(): void {
    if (!this.cachedBase64) {
      console.log('[TransitionPreloader] No cached audio, cannot fire eject');
      if (this.onFallback) this.onFallback();
      return;
    }

    const text = this.cachedSegment?.text ?? '';
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const estimatedTtsSec = wordCount / 2.5;
    const fadeInDelayMs = Math.round(estimatedTtsSec * 0.7 * 1000);

    console.log(
      `[TransitionPreloader] State: fired — playing eject transition ` +
        `(${wordCount} words, fadeInDelay ${fadeInDelayMs}ms)`
    );
    this.state = 'fired';

    // Notify UI so the speaking overlay shows when ONAY starts talking
    if (this.cachedSegment && this.onSegmentReady) {
      this.onSegmentReady(this.cachedSegment);
    }
    if (this.onEjectFired) this.onEjectFired();

    playEjectTransition(this.cachedBase64, fadeInDelayMs)
      .then(() => {
        this.state = 'done';
        console.log('[TransitionPreloader] State: done — eject transition complete');
      })
      .catch((err) => {
        console.log('[TransitionPreloader] playEjectTransition error:', err);
        this.state = 'done';
      });
  }

  private reset(): void {
    if (this.unsubscribePlayback) {
      this.unsubscribePlayback();
      this.unsubscribePlayback = null;
    }

    this.state = 'idle';
    this.currentTrack = null;
    this.nextTrack = null;
    this.previousTrack = null;
    this.cachedSegment = null;
    this.cachedBase64 = null;
    this.generatedNextTrackTitle = null;
    this.preGenTriggerSec = 0;
    this.ejectPointSec = 0;
    this.preGenFired = false;
    this.ejectFired = false;
    this.onSegmentReady = null;
    this.onEjectFired = null;
    this.onFallback = null;
    if (this.ejectWaitTimer) {
      clearTimeout(this.ejectWaitTimer);
      this.ejectWaitTimer = null;
    }
  }
}

export const transitionPreloader = new TransitionPreloaderEngine();

import type { ObjectStorage } from '../storage/ObjectStorage';
import { buildManifest } from './ManifestBuilder';
import { buildSegmentPrompts, type SegmentContext } from './SegmentScriptBuilder';
import { SegmentGenerator, type LLMCaller, type TTSCaller } from './SegmentGenerator';
import type {
  BroadcastCreateRequest, BroadcastCreateResponse, Manifest,
} from './types';
import { BroadcastStore } from './BroadcastStore';
import { TrackSequencer } from './TrackSequencer';
import { SequenceCache } from './SequenceCache';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import type { BackgroundEnricher } from '../enrichment/BackgroundEnricher';

/**
 * Maximum number of segments generated in parallel. Each segment costs one
 * LLM call + one TTS call; capping concurrency keeps us under the Gemini
 * free-tier rate limit (20 RPM) and the TTS provider burst caps while still
 * parallelizing enough to hit the ~5-8s p50 bake latency.
 */
const SEGMENT_CONCURRENCY = 4;

export class BroadcastOrchestrator {
  private readonly generator: SegmentGenerator;
  private readonly sequencer: TrackSequencer;
  /**
   * Tracks the background bake (slots 1..N) for each in-progress broadcast.
   * Callers that need completion (`bakeFeatured`, the featured publish route)
   * await `waitForCompletion(id)` which resolves when the entry is deleted
   * by the background task's .finally().
   */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    sequenceCache?: SequenceCache,
  ) {
    this.generator = new SegmentGenerator(llm, tts, storage);
    this.sequencer = new TrackSequencer(
      llm, sequenceCache ?? new SequenceCache(), enrichmentCache,
    );
  }

  async create(
    input: BroadcastCreateRequest & { userId: string },
  ): Promise<BroadcastCreateResponse> {
    // 1. Sequence the pool (uses any cached enrichment as hints).
    const seq = await this.sequencer.sequence({
      pool: input.tracks,
      vibe: input.vibe,
      length: input.length,
      userContext: {
        timeOfDay: input.userContext.timeOfDay,
        dayOfWeek: input.userContext.dayOfWeek,
      },
    });

    // 2. Build the manifest immediately — enrichment isn't needed to know
    //    which slots exist and which tracks they target.
    const manifest = buildManifest({
      userId: input.userId,
      playlistId: input.playlistId,
      vibe: input.vibe,
      length: input.length,
      tracks: seq.orderedTracks,
      featureSlots: seq.featureSlots,
    });
    this.store.put(manifest);

    // 3. Fire enrichment drain and slot 0 bake in parallel.
    //    Slot 0 is the cold_open — it sets the scene and names the first
    //    track. It works fine with an empty enrichment block, so we don't
    //    block it on the ~10-20s Genius/MusicBrainz fan-out. drainNow runs
    //    concurrently and populates the cache in time for slots 1..N.
    const drainP = this.backgroundEnricher.drainNow(seq.orderedTracks).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BroadcastOrchestrator] drainNow failed: ${msg}`);
    });
    const slot0P = this.generateSlot(manifest, 0, input.userContext);

    // 4. HTTP response is gated on slot 0 audio being baked AND enrichment
    //    being drained. We wait for drainNow so background slots 1..N have
    //    a populated cache (richer producer/sample hints); on warm cache
    //    drainNow returns near-instantly, so tune-in is F5 slot 0 time.
    await Promise.all([drainP, slot0P]);

    // 5. Fan out slots 1..N as a background task. Client polls
    //    /broadcast/:id/manifest to pick up audioUrls as slots complete.
    if (manifest.segmentSlots.length > 1) {
      const backgroundP = this.generateSlotsBackground(manifest, input.userContext)
        .finally(() => { this.inFlight.delete(manifest.broadcastId); });
      this.inFlight.set(manifest.broadcastId, backgroundP);
    }

    // 6. Return manifest with slot 0 ready; slots 1..N still 'pending'.
    const finalManifest = this.store.get(manifest.broadcastId)!;
    const coldOpen = finalManifest.segmentSlots[0];
    const firstSegmentUrls = coldOpen.audioUrls ?? [];
    return {
      manifest: finalManifest,
      firstSegmentUrls,
    };
  }

  /**
   * Wait for the background bake (slots 1..N) of a broadcast to complete.
   * Resolves immediately if the broadcast has no tracked background work
   * (single-slot manifest, already finished, or never created).
   */
  async waitForCompletion(broadcastId: string): Promise<void> {
    const p = this.inFlight.get(broadcastId);
    if (p) await p;
  }

  isInFlight(broadcastId: string): boolean {
    return this.inFlight.has(broadcastId);
  }

  /** Read the current manifest state (slots include their latest status + urls). */
  getManifest(broadcastId: string): Manifest | undefined {
    return this.store.get(broadcastId);
  }

  private async generateSlotsBackground(
    manifest: Manifest,
    ctx: SegmentContext,
  ): Promise<void> {
    // Slots 1..N run with the same concurrency cap as before; slot 0 was
    // already baked synchronously above.
    const indices = manifest.segmentSlots
      .filter(s => s.index > 0)
      .map(s => s.index);
    let nextIndex = 0;
    const runWorker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex++;
        if (i >= indices.length) return;
        try {
          await this.generateSlot(manifest, indices[i], ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[BroadcastOrchestrator] slot ${indices[i]} failed: ${msg}`);
        }
      }
    };
    const workerCount = Math.min(SEGMENT_CONCURRENCY, indices.length);
    const workers: Promise<void>[] = [];
    for (let w = 0; w < workerCount; w++) {
      workers.push(runWorker());
    }
    await Promise.all(workers);
  }

  private async generateSlot(
    manifest: Manifest,
    slotIndex: number,
    ctx: SegmentContext,
  ): Promise<string[]> {
    const slot = manifest.segmentSlots[slotIndex];
    try {
      const prompts = buildSegmentPrompts(slot, manifest, ctx, this.enrichmentCache);
      const urls = await this.generator.generateVariants({
        broadcastId: manifest.broadcastId,
        slotIndex,
        prompts,
      });
      this.store.updateSlot(manifest.broadcastId, slotIndex, {
        status: 'ready',
        audioUrls: urls,
      });
      return urls;
    } catch (err) {
      this.store.updateSlot(manifest.broadcastId, slotIndex, { status: 'failed' });
      if (slotIndex === 0) throw err;
      return [];
    }
  }
}

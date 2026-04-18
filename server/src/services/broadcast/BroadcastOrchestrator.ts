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

    // 2. Drain enrichment for the chosen N tracks only, not the full pool.
    //    Running this synchronously before segment generation lets the
    //    script builder pull producer / sample / bio hints for any track
    //    where a fresh enrichment lookup completes in time.
    await this.backgroundEnricher.drainNow(seq.orderedTracks);

    // 3. Build the manifest. Includes tier per slot based on featureSlots
    //    picked by the sequencer (deep_dive vs. fact_bridge transitions).
    const manifest = buildManifest({
      userId: input.userId,
      playlistId: input.playlistId,
      vibe: input.vibe,
      length: input.length,
      tracks: seq.orderedTracks,
      featureSlots: seq.featureSlots,
    });
    this.store.put(manifest);

    // 4. Generate all segments in parallel with a small concurrency cap.
    //    Cold-open failures still throw so the caller sees a 5xx; any
    //    subsequent-slot failure marks that slot 'failed' but leaves the
    //    rest of the broadcast playable.
    await this.generateAllSegmentsCapped(manifest, input.userContext);

    // 5. Return the final manifest with all slots populated.
    const finalManifest = this.store.get(manifest.broadcastId)!;
    const coldOpen = finalManifest.segmentSlots[0];
    const firstSegmentUrls = coldOpen.audioUrls ?? [];
    return {
      manifest: finalManifest,
      firstSegmentUrls,
    };
  }

  /**
   * No-op in the fully pre-baked pipeline. Kept for compatibility with
   * callers (`bakeFeatured`, the featured publish route) that were written
   * against the older two-phase sync+async pipeline — completion is now
   * guaranteed when `create()` resolves.
   */
  async waitForCompletion(_broadcastId: string): Promise<void> {
    return;
  }

  isInFlight(_broadcastId: string): boolean {
    return false;
  }

  /** Read the current manifest state (slots include their latest status + urls). */
  getManifest(broadcastId: string): Manifest | undefined {
    return this.store.get(broadcastId);
  }

  private async generateAllSegmentsCapped(
    manifest: Manifest,
    ctx: SegmentContext,
  ): Promise<void> {
    const indices = manifest.segmentSlots.map(s => s.index);
    let nextIndex = 0;
    const workers: Promise<void>[] = [];
    const runWorker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex++;
        if (i >= indices.length) return;
        await this.generateSlot(manifest, indices[i], ctx);
      }
    };
    const workerCount = Math.min(SEGMENT_CONCURRENCY, indices.length);
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

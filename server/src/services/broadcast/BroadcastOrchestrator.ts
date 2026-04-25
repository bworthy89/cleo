import { randomUUID } from 'crypto';
import type { ObjectStorage } from '../storage/ObjectStorage';
import { buildManifest } from './ManifestBuilder';
import { buildSegmentPrompts, type SegmentContext } from './SegmentScriptBuilder';
import { SegmentGenerator, type LLMCaller, type TTSCaller } from './SegmentGenerator';
import type {
  BroadcastCreateRequest, BroadcastCreateResponse, Manifest,
  ManifestTrack, BroadcastLength,
} from './types';
import { nominateDeepDives } from './deep-dives';
import { bakeTelemetry } from '../telemetry/BakeTelemetry';

const LENGTH_TO_N: Record<BroadcastLength, number> = {
  quick: 5, standard: 9, long: 15,
};
import { BroadcastStore } from './BroadcastStore';
import { LLMTrackSequencer, type ITrackSequencer } from './TrackSequencer';
import { DeterministicTrackSequencer } from './DeterministicTrackSequencer';
import { SequenceCache } from './SequenceCache';
import { EnrichmentCache } from '../enrichment/EnrichmentCache';
import type { BackgroundEnricher } from '../enrichment/BackgroundEnricher';
import type { FeatureFetchChain } from './FeatureFetchChain';

/**
 * Maximum number of segments generated in parallel. Each segment costs one
 * LLM call + one TTS call; capping concurrency keeps us under the Gemini
 * free-tier rate limit (20 RPM) and the TTS provider burst caps while still
 * parallelizing enough to hit the ~5-8s p50 bake latency.
 */
const SEGMENT_CONCURRENCY = 4;

/** Build the log prefix used to trace one bake across all its log lines.
 *  `grep "user=tester@x.com"` or `grep "id=A3F9K2X1"` on PM2 output surfaces
 *  everything the bake emitted. Short id is first 8 of the UUID uppercased
 *  so grep matches a tester-pasted screenshot of the player display verbatim. */
function buildBakeTag(broadcastId: string, user: string): string {
  return `[bake id=${broadcastId.slice(0, 8).toUpperCase()} user=${user}]`;
}

export class BroadcastOrchestrator {
  private readonly generator: SegmentGenerator;
  private readonly sequencer: ITrackSequencer;
  /**
   * Which sequencer implementation is active. Selected in the constructor
   * from `process.env.SEQUENCER_MODE`: 'llm' picks `LLMTrackSequencer`; any
   * other value (or unset) picks `DeterministicTrackSequencer`.
   */
  readonly sequencerMode: 'deterministic' | 'llm';
  /**
   * Tracks the background bake (slots 1..N) for each in-progress broadcast.
   * Callers that need completion (`bakeFeatured`, the featured publish route)
   * await `waitForCompletion(id)` which resolves when the entry is deleted
   * by the background task's .finally().
   */
  private readonly inFlight = new Map<string, Promise<void>>();

  /**
   * Broadcasts whose background bake has been signalled to stop. Workers
   * check this Set between slot generations and exit. Cleared in the same
   * .finally that clears `inFlight`.
   */
  private readonly aborted = new Set<string>();

  constructor(
    llm: LLMCaller,
    tts: TTSCaller,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
    private readonly enrichmentCache: EnrichmentCache,
    private readonly backgroundEnricher: BackgroundEnricher,
    featureFetchChain: FeatureFetchChain,
    sequenceCache?: SequenceCache,
  ) {
    this.generator = new SegmentGenerator(llm, tts, storage);

    const mode = process.env.SEQUENCER_MODE ?? 'deterministic';
    if (mode === 'llm') {
      this.sequencerMode = 'llm';
      this.sequencer = new LLMTrackSequencer(
        llm, sequenceCache ?? new SequenceCache(), enrichmentCache,
      );
    } else {
      this.sequencerMode = 'deterministic';
      this.sequencer = new DeterministicTrackSequencer(
        enrichmentCache, featureFetchChain,
      );
    }
  }

  /**
   * Test-only helper that constructs an orchestrator with no-op
   * dependencies. Lets tests inspect wiring (e.g. `sequencerMode`) without
   * pulling in real LLM / TTS / storage / feature-fetch backends.
   *
   * Pass `overrides` to substitute specific internals after construction.
   * This is the only authorized site for mutating the otherwise-readonly
   * sequencer/generator/backgroundEnricher fields; tests should not reach
   * into the class themselves.
   */
  static makeWithDefaults(overrides: {
    sequencer?: ITrackSequencer;
    generator?: Pick<SegmentGenerator, 'generateVariants'>;
    backgroundEnricher?: Pick<BackgroundEnricher, 'drainNow'>;
  } = {}): BroadcastOrchestrator {
    const noopLLM: LLMCaller = {
      generate: async () => ({ text: '' }),
    };
    const noopTTS: TTSCaller = {
      synthesize: async () => ({ audioContent: '' }),
    };
    const noopStorage: ObjectStorage = {
      put: async (key: string) => `noop://${key}`,
    };
    const store = new BroadcastStore();
    const cache = new EnrichmentCache('/tmp/noop-enrich.json');
    const enricher = overrides.backgroundEnricher
      ? (overrides.backgroundEnricher as unknown as BackgroundEnricher)
      : ({ drainNow: async () => {} } as unknown as BackgroundEnricher);
    const fetchChain = { fetchBatch: async () => new Map() } as unknown as FeatureFetchChain;
    const orch = new BroadcastOrchestrator(
      noopLLM, noopTTS, noopStorage, store, cache, enricher, fetchChain,
    );
    // Private-field overrides live here (one authorized site) rather than
    // in each test. Go through `unknown` to bypass TS's private-field check.
    if (overrides.sequencer) {
      (orch as unknown as { sequencer: ITrackSequencer }).sequencer = overrides.sequencer;
    }
    if (overrides.generator) {
      (orch as unknown as { generator: Pick<SegmentGenerator, 'generateVariants'> }).generator = overrides.generator;
    }
    return orch;
  }

  async create(
    input: BroadcastCreateRequest & { userId: string; userEmail?: string },
  ): Promise<BroadcastCreateResponse> {
    // 0. Generate the broadcast id up front so it can thread through BOTH
    //    the sequencer (as its deterministic PRNG seed) and the manifest
    //    builder. Same id everywhere means re-bakes with the same inputs
    //    produce the same track order.
    const broadcastId = randomUUID();
    const startedAt = Date.now();
    const handle = bakeTelemetry.startBake({
      broadcastId,
      vibe: input.vibe,
      length: input.length,
    });

    try {
      // Tester-triage tag. Prefix all bake-scoped logs so `grep "user=foo@bar"`
      // or `grep "id=a3f9k2"` surfaces the full lifecycle of one bake.
      const tag = buildBakeTag(broadcastId, input.userEmail ?? input.userId);
      console.log(
        `${tag} start vibe=${input.vibe} length=${input.length} ` +
        `pool=${input.tracks.length} preserveOrder=${input.preserveOrder ?? false}`,
      );

      // 1. Sequence the pool. When `preserveOrder` is set (Ask ONAY flow),
      //    skip the DeterministicTrackSequencer's score-and-place and use the
      //    caller's track order directly — Groq already curated the sequence
      //    and re-ordering here would disrupt the LLM's intent. Feature-slot
      //    nomination still runs via nominateDeepDives.
      let seq: { orderedTracks: ManifestTrack[]; featureSlots: number[] };
      if (input.preserveOrder) {
        const N = LENGTH_TO_N[input.length];
        if (input.tracks.length < N) {
          throw new Error(`insufficient tracks: need ${N}, got ${input.tracks.length}`);
        }
        const orderedTracks = input.tracks.slice(0, N);
        const featureSlots = nominateDeepDives(orderedTracks, this.enrichmentCache);
        seq = { orderedTracks, featureSlots };
        const orderLines = orderedTracks
          .map((t, i) => `  [${i}] ${t.id}  ${t.title} — ${t.artistName}`)
          .join('\n');
        console.log(`${tag} [Sequencer] source=preserved vibe=${input.vibe} N=${N} poolSize=${input.tracks.length}\n${orderLines}`);
      } else {
        seq = await this.sequencer.sequence({
          pool: input.tracks,
          vibe: input.vibe,
          length: input.length,
          userContext: {
            timeOfDay: input.userContext.timeOfDay,
            dayOfWeek: input.userContext.dayOfWeek,
          },
          broadcastId,
        });
      }

      // 2. Build the manifest immediately — enrichment isn't needed to know
      //    which slots exist and which tracks they target.
      const manifest = buildManifest({
        broadcastId,
        userId: input.userId,
        playlistId: input.playlistId,
        vibe: input.vibe,
        length: input.length,
        tracks: seq.orderedTracks,
        featureSlots: seq.featureSlots,
      });
      this.store.put(manifest);

      // Log the full manifest track order so we can verify client playback
      // matches what the sequencer produced. Format: one line per track with
      // zero-indexed position, Apple Music id, and "Title — Artist".
      const orderLines = seq.orderedTracks
        .map((t, i) => `  [${i}] ${t.id}  ${t.title} — ${t.artistName}`)
        .join('\n');
      console.log(`${tag} [Manifest] track order:\n${orderLines}`);

      // 3. Fire enrichment drain and slot 0 bake in parallel.
      //    Slot 0 is the cold_open — it sets the scene and names the first
      //    track. It works fine with an empty enrichment block, so we don't
      //    block it on the ~10-20s Genius/MusicBrainz fan-out. drainNow runs
      //    concurrently and populates the cache in time for slots 1..N.
      const drainP = this.backgroundEnricher.drainNow(seq.orderedTracks).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${tag} [BroadcastOrchestrator] drainNow failed: ${msg}`);
      });
      const slot0P = this.generateSlot(manifest, 0, input.userContext);

      // 4. HTTP response is gated on slot 0 audio being baked AND enrichment
      //    being drained. We wait for drainNow so background slots 1..N have
      //    a populated cache (richer producer/sample hints); on warm cache
      //    drainNow returns near-instantly, so tune-in is F5 slot 0 time.
      await Promise.all([drainP, slot0P]);
      handle.endSlotZero(Date.now() - startedAt);

      // 5. Fan out slots 1..N as a background task. Client polls
      //    /broadcast/:id/manifest to pick up audioUrls as slots complete.
      if (manifest.segmentSlots.length > 1) {
        const backgroundP = this.generateSlotsBackground(manifest, input.userContext, tag)
          .then(() => {
            handle.endBake({ durationMs: Date.now() - startedAt, status: 'completed' });
          })
          .catch((err) => {
            handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
            throw err;
          })
          .finally(() => {
            this.inFlight.delete(manifest.broadcastId);
            this.aborted.delete(manifest.broadcastId);
          });
        this.inFlight.set(manifest.broadcastId, backgroundP);
      } else {
        // Single-slot manifest: no background work, close the span now.
        handle.endBake({ durationMs: Date.now() - startedAt, status: 'completed' });
      }

      // 6. Return manifest with slot 0 ready; slots 1..N still 'pending'.
      const finalManifest = this.store.get(manifest.broadcastId)!;
      const coldOpen = finalManifest.segmentSlots[0];
      const firstSegmentUrls = coldOpen.audioUrls ?? [];
      return {
        manifest: finalManifest,
        firstSegmentUrls,
      };
    } catch (err) {
      handle.endBake({ durationMs: Date.now() - startedAt, status: 'failed' });
      throw err;
    }
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

  /** Number of bakes whose background slot generation hasn't yet resolved.
   *  Used by the admin status endpoint as a liveness signal. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Cooperative cancellation. Flips the abort flag and marks all pending
   * slots in the store as 'aborted' so client polling picks up the new
   * state. The 4-worker pool's loop check (in generateSlotsBackground) will
   * then exit on its next iteration; the in-flight TTS call holding the
   * lock is allowed to finish naturally — its slot becomes 'ready'.
   *
   * Idempotent: returns false when there is no in-flight bake (already
   * completed, never created, or already aborted-and-evicted).
   */
  abortBake(broadcastId: string): boolean {
    if (!this.inFlight.has(broadcastId)) return false;
    this.aborted.add(broadcastId);
    this.store.markPendingSlotsAborted(broadcastId);
    return true;
  }

  /** Read the current manifest state (slots include their latest status + urls). */
  getManifest(broadcastId: string): Manifest | undefined {
    return this.store.get(broadcastId);
  }

  private async generateSlotsBackground(
    manifest: Manifest,
    ctx: SegmentContext,
    tag: string,
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
          console.warn(`${tag} [BroadcastOrchestrator] slot ${indices[i]} failed: ${msg}`);
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

import type { LLMProvider } from '../../providers/llm/types';
import type { TTSProvider } from '../../providers/tts/types';
import type { ObjectStorage } from '../storage/ObjectStorage';
import { buildManifest } from './ManifestBuilder';
import { buildSegmentPrompts, type SegmentContext } from './SegmentScriptBuilder';
import { SegmentGenerator } from './SegmentGenerator';
import type {
  BroadcastCreateRequest, BroadcastCreateResponse, Manifest,
} from './types';
import { BroadcastStore } from './BroadcastStore';

export class BroadcastOrchestrator {
  private readonly generator: SegmentGenerator;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    llm: LLMProvider,
    tts: TTSProvider,
    storage: ObjectStorage,
    private readonly store: BroadcastStore,
  ) {
    this.generator = new SegmentGenerator(llm, tts, storage);
  }

  async create(
    input: BroadcastCreateRequest & { userId: string },
  ): Promise<BroadcastCreateResponse> {
    const manifest = buildManifest({
      userId: input.userId,
      playlistId: input.playlistId,
      vibe: input.vibe,
      length: input.length,
      tracks: input.tracks,
    });
    this.store.put(manifest);

    const firstUrls = await this.generateSlot(manifest, 0, input.userContext);

    const remaining = Promise.allSettled(
      manifest.segmentSlots.slice(1).map(slot =>
        this.generateSlot(manifest, slot.index, input.userContext),
      ),
    )
      .then(() => undefined)
      .finally(() => this.inFlight.delete(manifest.broadcastId));

    this.inFlight.set(manifest.broadcastId, remaining);

    return {
      manifest: this.store.get(manifest.broadcastId)!,
      firstSegmentUrls: firstUrls,
    };
  }

  async waitForCompletion(broadcastId: string): Promise<void> {
    const p = this.inFlight.get(broadcastId);
    if (p) await p;
  }

  isInFlight(broadcastId: string): boolean {
    return this.inFlight.has(broadcastId);
  }

  private async generateSlot(
    manifest: Manifest,
    slotIndex: number,
    ctx: SegmentContext,
  ): Promise<string[]> {
    const slot = manifest.segmentSlots[slotIndex];
    try {
      const prompts = buildSegmentPrompts(slot, manifest, ctx);
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

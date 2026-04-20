import { randomUUID } from 'crypto';
import type {
  Manifest, ManifestTrack, SegmentSlot, SegmentTier, Vibe, BroadcastLength,
} from './types';

export interface BuildManifestInput {
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  tracks: ManifestTrack[];
  /** Transition slot indices nominated for deep-dive treatment. When provided,
   *  any transition slot whose index appears here is tagged 'deep_dive';
   *  other transitions default to 'fact_bridge'. */
  featureSlots?: number[];
}

export function buildManifest(input: BuildManifestInput): Manifest {
  if (input.tracks.length === 0) {
    throw new Error('buildManifest requires at least one track');
  }

  const tracks = input.tracks;
  const featureSlots = input.featureSlots ?? [];
  const featureSet = new Set(featureSlots);
  const segmentSlots: SegmentSlot[] = [];

  segmentSlots.push({
    index: 0,
    kind: 'cold_open',
    beforeTrackId: tracks[0].id,
    afterTrackId: undefined,
    variantCount: 1,
    status: 'pending',
    tier: 'cold_open',
  });

  // Transitions fire before tracks at indices 2, 4, 6, … (every other track
  // starting from the third). Tier alternates fact_bridge → tight_bridge,
  // starting with fact_bridge. featureSlots overrides the computed tier to
  // deep_dive; the alternation counter still advances, so a deep_dive
  // consumes one turn. If a deep_dive lands where fact_bridge would have
  // been, the following transition is tight_bridge (and vice-versa).
  let alternationCounter = 0;
  for (let i = 2; i < tracks.length; i += 2) {
    const index = segmentSlots.length;
    const naturalTier: SegmentTier =
      alternationCounter % 2 === 0 ? 'fact_bridge' : 'tight_bridge';
    const tier: SegmentTier = featureSet.has(index) ? 'deep_dive' : naturalTier;
    segmentSlots.push({
      index,
      kind: 'transition',
      afterTrackId: tracks[i - 1].id,
      beforeTrackId: tracks[i].id,
      variantCount: 1,
      status: 'pending',
      tier,
    });
    alternationCounter += 1;
  }

  segmentSlots.push({
    index: segmentSlots.length,
    kind: 'sign_off',
    afterTrackId: tracks[tracks.length - 1].id,
    beforeTrackId: undefined,
    variantCount: 1,
    status: 'pending',
    tier: 'sign_off',
  });

  return {
    broadcastId: randomUUID(),
    userId: input.userId,
    playlistId: input.playlistId,
    vibe: input.vibe,
    length: input.length,
    createdAt: Date.now(),
    tracks,
    segmentSlots,
    featureSlots,
  };
}

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

  for (let i = 0; i < tracks.length - 1; i++) {
    const index = segmentSlots.length;
    const tier: SegmentTier = featureSet.has(index) ? 'deep_dive' : 'fact_bridge';
    segmentSlots.push({
      index,
      kind: 'transition',
      afterTrackId: tracks[i].id,
      beforeTrackId: tracks[i + 1].id,
      variantCount: 1,
      status: 'pending',
      tier,
    });
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

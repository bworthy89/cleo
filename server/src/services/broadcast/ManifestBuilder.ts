import { randomUUID } from 'crypto';
import type {
  Manifest, ManifestTrack, SegmentSlot, Vibe, BroadcastLength,
} from './types';

const LENGTH_TO_TRACK_COUNT: Record<BroadcastLength, number> = {
  quick: 5,
  standard: 9,
  long: 15,
};

export function buildManifest(input: {
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  tracks: ManifestTrack[];
}): Manifest {
  const trackCount = LENGTH_TO_TRACK_COUNT[input.length];
  if (input.tracks.length < trackCount) {
    throw new Error(`insufficient tracks: need ${trackCount}, got ${input.tracks.length}`);
  }

  const tracks = input.tracks.slice(0, trackCount);
  const segmentSlots: SegmentSlot[] = [];

  segmentSlots.push({
    index: 0,
    kind: 'cold_open',
    beforeTrackId: tracks[0].id,
    afterTrackId: undefined,
    variantCount: 1,
    status: 'pending',
  });

  for (let i = 0; i < tracks.length - 1; i++) {
    segmentSlots.push({
      index: segmentSlots.length,
      kind: 'transition',
      afterTrackId: tracks[i].id,
      beforeTrackId: tracks[i + 1].id,
      variantCount: 1,
      status: 'pending',
    });
  }

  segmentSlots.push({
    index: segmentSlots.length,
    kind: 'sign_off',
    afterTrackId: tracks[tracks.length - 1].id,
    beforeTrackId: undefined,
    variantCount: 1,
    status: 'pending',
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
  };
}

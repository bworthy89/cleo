import { randomUUID } from 'crypto';
import type {
  Manifest, ManifestTrack, SegmentSlot, Vibe, BroadcastLength,
} from './types';

export function buildManifest(input: {
  userId: string;
  playlistId: string | null;
  vibe: Vibe;
  length: BroadcastLength;
  tracks: ManifestTrack[];
}): Manifest {
  if (input.tracks.length === 0) {
    throw new Error('buildManifest requires at least one track');
  }

  const tracks = input.tracks;
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

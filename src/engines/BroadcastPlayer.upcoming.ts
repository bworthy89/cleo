import type {
  Manifest,
  PlayerState,
  UpcomingItem,
} from './BroadcastPlayer.types';

/**
 * Compute the upcoming-items list for the player's UP NEXT section.
 *
 * Pure function: takes a snapshot of the engine's externally-relevant state
 * and returns the list. The engine's `getStatus` calls this with `this`
 * fields so the UI sees a consistent, immediately-renderable list on every
 * 500ms poll.
 *
 * Algorithm:
 *   - Returns [] when manifest is null or state is 'ended' / 'idle' / 'error'.
 *   - Walks `tracks` from currentTrackIndex+1 to the end (current track is
 *     not "upcoming" — it's playing).
 *   - Maintains a local segment cursor seeded from `nextSegmentIdx` and
 *     consumes a slot whenever its `beforeTrackId` matches the next walked
 *     track.
 *   - After the track loop, considers the slot at the current cursor for a
 *     trailing sign_off entry.
 *   - A considered segment is SKIPPED (not added to output) when:
 *       1. cursor === currentSegmentIndex — the slot is currently playing,
 *          so it isn't "upcoming." `runMainLoop` increments its loop-local
 *          `nextSegmentIdx` only after `runSegmentAt` returns; while a
 *          segment is in flight, the engine's `nextSegmentIdx` field still
 *          points at it. This filter prevents the in-flight transition
 *          from being rendered as upcoming.
 *       2. status === 'failed' or 'aborted' — the runtime skips these
 *          silently, so the upcoming list should match.
 */
export function computeUpcoming(args: {
  manifest: Manifest | null;
  state: PlayerState;
  currentTrackIndex: number;
  currentSegmentIndex: number;
  nextSegmentIdx: number;
}): UpcomingItem[] {
  const { manifest, state, currentTrackIndex, currentSegmentIndex, nextSegmentIdx } = args;
  if (!manifest) return [];
  if (state === 'ended' || state === 'idle' || state === 'error') return [];

  const items: UpcomingItem[] = [];
  let cursor = nextSegmentIdx;

  const isLiveOrSkipped = (slotIndex: number, status: string): boolean =>
    slotIndex === currentSegmentIndex || status === 'failed' || status === 'aborted';

  for (let i = currentTrackIndex + 1; i < manifest.tracks.length; i++) {
    const track = manifest.tracks[i];

    const slot = manifest.segmentSlots[cursor];
    // Consume any slot whose beforeTrackId matches this track. Only TRANSITION
    // slots produce a row — cold_open is part of the broadcast frame and isn't
    // "upcoming" in the editorial sense; it lives in slot 0 with beforeTrackId
    // pointing at the first track, which would otherwise sneak in as a row on
    // a fresh-start cursor of 0.
    if (slot && slot.beforeTrackId === track.id) {
      if (slot.kind === 'transition' && !isLiveOrSkipped(cursor, slot.status)) {
        items.push({ kind: 'transition', key: `slot-${cursor}` });
      }
      cursor += 1;
    }

    items.push({
      kind: 'track',
      key: track.id,
      trackIndex: i,
      title: track.title,
      artistName: track.artistName,
      duration: track.duration,
    });
  }

  const trailing = manifest.segmentSlots[cursor];
  if (trailing && trailing.kind === 'sign_off' && !isLiveOrSkipped(cursor, trailing.status)) {
    items.push({ kind: 'sign_off', key: `slot-${cursor}` });
  }

  return items;
}

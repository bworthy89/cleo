import { useEffect, useState, useCallback } from 'react';
import { subscribeToOne, toggle as serviceToggle } from '../services/LikedTracksService';
import type { LikedTrackInput } from '../services/LikedTracksService.types';

export interface UseLikedTrackResult {
  isLiked: boolean;
  toggle: () => Promise<void>;
}

export function useLikedTrack(track: LikedTrackInput | null): UseLikedTrackResult {
  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    if (!track) {
      setIsLiked(false);
      return;
    }
    const unsub = subscribeToOne(track.id, ({ exists }) => {
      setIsLiked(exists);
    });
    return unsub;
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(async (): Promise<void> => {
    if (!track) return;
    try {
      await serviceToggle(track);
    } catch {
      // AuthRequiredError or transient Firestore errors: fail silently
      // on the player. The list is best-effort feedback; the user can
      // try again.
    }
  }, [track]);

  return { isLiked, toggle };
}

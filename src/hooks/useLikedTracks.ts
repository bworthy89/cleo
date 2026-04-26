import { useEffect, useState } from 'react';
import { subscribeToList } from '../services/LikedTracksService';
import type { LikedTrack } from '../services/LikedTracksService.types';

export interface UseLikedTracksResult {
  tracks: LikedTrack[];
  loading: boolean;
}

export function useLikedTracks(): UseLikedTracksResult {
  const [tracks, setTracks] = useState<LikedTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToList((next) => {
      setTracks(next);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { tracks, loading };
}

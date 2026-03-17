import { useRef } from 'react';
import { router } from 'expo-router';
import { HomeScreen } from '../../src/screens/home/HomeScreen';
import type { Vibe } from '../../src/cleo/fallbacks';

interface PlayerParams {
  stationName: string;
  playlistId: string;
  stationId: string;
  vibe: Vibe;
}

export default function MainIndex() {
  const lastPlayerParams = useRef<PlayerParams | null>(null);

  return (
    <HomeScreen
      onNavigateToPlayer={(params) => {
        lastPlayerParams.current = params;
        router.push({
          pathname: '/(main)/player',
          params: {
            stationName: params.stationName,
            playlistId: params.playlistId,
            stationId: params.stationId,
            vibe: params.vibe,
          },
        });
      }}
      onNavigateToSettings={() => {
        router.push('/(settings)/profile');
      }}
      onNavigateToActivePlayer={() => {
        if (lastPlayerParams.current) {
          router.push({
            pathname: '/(main)/player',
            params: {
              stationName: lastPlayerParams.current.stationName,
              playlistId: lastPlayerParams.current.playlistId,
              stationId: lastPlayerParams.current.stationId,
              vibe: lastPlayerParams.current.vibe,
            },
          });
        }
      }}
    />
  );
}

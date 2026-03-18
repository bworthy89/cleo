import { useLocalSearchParams, router } from 'expo-router';
import { PlayerScreen } from '../../src/screens/player/PlayerScreen';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function PlayerRoute() {
  const params = useLocalSearchParams<{
    stationName: string;
    playlistId: string;
    stationId: string;
    vibe: string;
  }>();

  return (
    <PlayerScreen
      stationName={params.stationName ?? 'Station'}
      playlistId={params.playlistId ?? ''}
      stationId={params.stationId ?? ''}
      vibe={(params.vibe as Vibe) ?? 'morning'}
      onBack={() => router.back()}
    />
  );
}

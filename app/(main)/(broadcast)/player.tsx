import { useLocalSearchParams } from 'expo-router';
import { BroadcastScreen } from '../../../src/screens/player/BroadcastScreen';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';
import type { Vibe } from '../../../src/cleo/fallbacks';

export default function PlayerRoute() {
  const params = useLocalSearchParams<{ stationName: string; playlistId: string; stationId: string; vibe: string; resume: string }>();
  return (
    <ErrorBoundary fallbackTitle="Player unavailable">
    <BroadcastScreen
      stationName={params.stationName ?? ''}
      playlistId={params.playlistId ?? ''}
      stationId={params.stationId ?? ''}
      vibe={(params.vibe ?? 'general') as Vibe}
      resume={params.resume === 'true'}
    />
    </ErrorBoundary>
  );
}

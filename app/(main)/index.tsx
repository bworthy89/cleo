import { router } from 'expo-router';
import { HomeScreen } from '../../src/screens/home/HomeScreen';

export default function MainIndex() {
  return (
    <HomeScreen
      onNavigateToPlayer={(params) => {
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
    />
  );
}

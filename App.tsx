import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { HomeScreen } from './src/screens/home/HomeScreen';
import { PlayerScreen } from './src/screens/player/PlayerScreen';
import type { Vibe } from './src/cleo/fallbacks';

SplashScreen.preventAutoHideAsync();

interface PlayerParams {
  stationName: string;
  playlistId: string;
  stationId: string;
  vibe: Vibe;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular: require('@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf'),
    WorkSans_400Regular: require('@expo-google-fonts/work-sans/400Regular/WorkSans_400Regular.ttf'),
    WorkSans_500Medium: require('@expo-google-fonts/work-sans/500Medium/WorkSans_500Medium.ttf'),
    EBGaramond_400Regular: require('@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf'),
    EBGaramond_400Regular_Italic: require('@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf'),
    DMMono_400Regular: require('@expo-google-fonts/dm-mono/400Regular/DMMono_400Regular.ttf'),
  });

  const [playerParams, setPlayerParams] = useState<PlayerParams | null>(null);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  if (playerParams) {
    return (
      <>
        <PlayerScreen
          stationName={playerParams.stationName}
          playlistId={playerParams.playlistId}
          stationId={playerParams.stationId}
          vibe={playerParams.vibe}
          onBack={() => setPlayerParams(null)}
        />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      <HomeScreen onNavigateToPlayer={setPlayerParams} />
      <StatusBar style="dark" />
    </>
  );
}

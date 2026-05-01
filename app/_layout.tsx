import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import { OfflineBanner, useNetworkStatus } from '../src/components/OfflineBanner';
import { initLogger, logger } from '../src/services/logger';
import { broadcastPlayer } from '../src/engines/BroadcastPlayer.singleton';

initLogger();

SplashScreen.preventAutoHideAsync();

// Foreground update check. ON_LOAD covers cold launches; this catches updates
// pushed while the app was backgrounded so a tester who keeps the app open
// for hours still gets rollbacks within minutes of foregrounding. Reload is
// gated on no-broadcast-active so it never interrupts audio.
async function checkForOtaUpdate() {
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    await Updates.fetchUpdateAsync();
    const state = broadcastPlayer.getStatus().state;
    const safeToReload = state === 'idle' || state === 'ended' || state === 'error';
    if (safeToReload) {
      await Updates.reloadAsync();
    }
    // If a broadcast is playing/loading/paused, leave the fetched update queued.
    // Next cold start picks it up automatically.
  } catch (err) {
    logger.warn('updates', 'foreground update check failed', err);
  }
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Anton_400Regular: require('@expo-google-fonts/anton/400Regular/Anton_400Regular.ttf'),
    Fraunces_300Light_Italic: require('@expo-google-fonts/fraunces/300Light_Italic/Fraunces_300Light_Italic.ttf'),
    Fraunces_400Regular_Italic: require('@expo-google-fonts/fraunces/400Regular_Italic/Fraunces_400Regular_Italic.ttf'),
    JetBrainsMono_400Regular: require('@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf'),
    JetBrainsMono_500Medium: require('@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (__DEV__) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void checkForOtaUpdate();
    });
    return () => sub.remove();
  }, []);

  const isOffline = useNetworkStatus();

  if (!fontsLoaded && !fontError) return null;

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(main)" />
      </Stack>
      <OfflineBanner isOffline={isOffline} />
    </View>
  );
}

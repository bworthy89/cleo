import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { OfflineBanner, useNetworkStatus } from '../src/components/OfflineBanner';
import { initLogger } from '../src/services/logger';

initLogger();

SplashScreen.preventAutoHideAsync();

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

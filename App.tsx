import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Colors, Typography, Spacing } from './src/tokens/design-tokens';

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular: require('@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf'),
    WorkSans_400Regular: require('@expo-google-fonts/work-sans/400Regular/WorkSans_400Regular.ttf'),
    WorkSans_500Medium: require('@expo-google-fonts/work-sans/500Medium/WorkSans_500Medium.ttf'),
    EBGaramond_400Regular: require('@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf'),
    EBGaramond_400Regular_Italic: require('@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf'),
    DMMono_400Regular: require('@expo-google-fonts/dm-mono/400Regular/DMMono_400Regular.ttf'),
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container} onLayout={onLayoutRootView}>
      <Text style={styles.title}>CLEO</Text>
      <Text style={styles.subtitle}>AI Radio Host</Text>
      <Text style={styles.cleoVoice}>
        "Every song has a story. I'm just here to tell it."
      </Text>
      <Text style={styles.mono}>ON AIR</Text>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 56,
    color: Colors.vibe.morning.text,
    letterSpacing: 4,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 14,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: Spacing.xl,
  },
  cleoVoice: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 18,
    color: Colors.accent,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  mono: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.accent,
    letterSpacing: 3,
  },
});

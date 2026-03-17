import { Pressable, SafeAreaView, StyleSheet, Text, View, Alert } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';

export default function MusicAuthScreen() {
  const handleConnect = async () => {
    const result = await musicKitPlayer.authorize();
    if (result.status === 'authorized') {
      router.push('/(onboarding)/vibe-setup');
    } else {
      Alert.alert(
        'Apple Music Required',
        'Cleo needs access to your Apple Music library to play your playlists. Please enable it in Settings.',
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🎵</Text>
        <Text style={styles.title}>Connect Your Music</Text>
        <Text style={styles.description}>
          Cleo plays music from your Apple Music library. Connect your account so she can access your playlists and start hosting your sessions.
        </Text>
      </View>
      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={handleConnect}>
          <Text style={styles.buttonText}>CONNECT APPLE MUSIC</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emoji: {
    fontSize: 64,
    marginBottom: Spacing.lg,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: Colors.vibe.morning.text,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  description: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.vibe.morning.text,
    textAlign: 'center',
    lineHeight: 24,
    opacity: 0.7,
  },
  bottom: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  button: {
    backgroundColor: Colors.base.black,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 14,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});

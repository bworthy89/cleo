import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View, Alert } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, TextColors, Surface } from '../../src/tokens/design-tokens';
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';

export default function MusicAuthScreen() {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await musicKitPlayer.authorize();
      if (result.status === 'authorized') {
        router.push('/(onboarding)/cleo-setup');
      } else {
        Alert.alert(
          'Apple Music Required',
          'Cleo needs access to your Apple Music library to play your playlists. Please enable it in Settings.',
        );
      }
    } catch {
      Alert.alert('Error', 'Could not connect to Apple Music. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={{ width: 40, height: 2, backgroundColor: Colors.accent, marginBottom: Spacing.lg }} />
        <Text style={styles.title}>Connect Your Music</Text>
        <Text style={styles.description}>
          Cleo plays music from your Apple Music library. Connect your account so she can access your playlists and start hosting your sessions.
        </Text>
      </View>
      <View style={styles.bottom}>
        <Text style={styles.cleoVoice}>I need access to your library to start hosting.</Text>
        <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handleConnect} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'CONNECTING...' : 'CONNECT APPLE MUSIC'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: TextColors.primary,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  description: {
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: TextColors.primary,
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
  buttonDisabled: {
    opacity: 0.3,
  },
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.base.white,
    letterSpacing: 3,
  },
  cleoVoice: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 16,
    color: Colors.accent,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
});

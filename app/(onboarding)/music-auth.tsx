import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, TextColors, Surface } from '../../src/tokens/design-tokens';
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';
import { getUser, setUser } from '../../src/services/Storage';

export default function MusicAuthScreen() {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await musicKitPlayer.authorize();
      if (result.status === 'authorized') {
        const existing = getUser();
        setUser({
          ...existing,
          appleMusicAuthorized: true,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        } as any);
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

  const handleSkip = () => {
    const existing = getUser();
    setUser({
      ...existing,
      appleMusicAuthorized: false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    } as any);
    router.push('/(onboarding)/cleo-setup');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.sectionLabel}>SIGNAL SOURCE</Text>
        <View style={styles.accentLine} />

        <Text style={styles.title}>Connect Your{'\n'}Library</Text>
        <Text style={styles.description}>
          Cleo plays music from your Apple Music library. Connect your account so she can access your playlists and start hosting your sessions.
        </Text>

        <View style={styles.featureList}>
          <View style={styles.featureRow}>
            <Ionicons name="musical-notes-outline" size={18} color={Colors.accent} />
            <Text style={styles.featureText}>Access your playlists and library</Text>
          </View>
          <View style={styles.featureRow}>
            <Ionicons name="mic-outline" size={18} color={Colors.accent} />
            <Text style={styles.featureText}>Cleo hosts between your tracks</Text>
          </View>
          <View style={styles.featureRow}>
            <Ionicons name="radio-outline" size={18} color={Colors.accent} />
            <Text style={styles.featureText}>Every session feels like live radio</Text>
          </View>
        </View>
      </View>

      <View style={styles.bottom}>
        <Text style={styles.cleoVoice}>
          I need access to your library to start hosting.
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            loading && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          onPress={handleConnect}
          disabled={loading}
          accessibilityLabel="Connect Apple Music"
          accessibilityRole="button"
        >
          <Ionicons name="musical-note" size={16} color={Colors.base.black} style={styles.buttonIcon} />
          <Text style={styles.buttonText}>
            {loading ? 'CONNECTING...' : 'CONNECT APPLE MUSIC'}
          </Text>
        </Pressable>
        <Pressable onPress={handleSkip} style={styles.skipWrapper} hitSlop={8}>
          <Text style={styles.skipText}>Skip for now</Text>
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
    paddingHorizontal: Spacing.lg,
  },
  sectionLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 3,
    color: Colors.accent,
    marginBottom: Spacing.sm,
  },
  accentLine: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    marginBottom: Spacing.xl,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 34,
    color: TextColors.primary,
    lineHeight: 42,
    marginBottom: Spacing.md,
  },
  description: {
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.secondary,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  featureList: {
    gap: Spacing.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  featureText: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
  },
  bottom: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  cleoVoice: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 16,
    color: Colors.accent,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  buttonIcon: {
    marginTop: 1,
  },
  buttonDisabled: {
    opacity: 0.3,
  },
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.base.black,
    letterSpacing: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  skipWrapper: {
    marginTop: Spacing.md,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  skipText: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
  },
});

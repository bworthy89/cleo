import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AM, Fonts, Space, TypeScale } from '../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../src/components/BroadcastBackdrop';
import { AmberCTA } from '../../src/components/AmberCTA';
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';
import { getUser, setUser } from '../../src/services/Storage';

export default function MusicAuthScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  const finish = (appleMusicAuthorized: boolean) => {
    const existing = getUser();
    setUser({
      name: existing?.name,
      appleMusicAuthorized,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    router.replace('/(main)');
  };

  const handleConnect = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await musicKitPlayer.authorize();
      if (result.status === 'authorized') {
        finish(true);
      } else {
        Alert.alert(
          'Apple Music Required',
          'ONAY needs access to your Apple Music library to play your playlists. Please enable it in Settings.',
        );
      }
    } catch {
      Alert.alert('Error', 'Could not connect to Apple Music. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => finish(false);

  return (
    <BroadcastBackdrop>
      <View style={[styles.root, { paddingTop: insets.top + Space.s34, paddingBottom: insets.bottom + Space.s34 }]}>
        <View style={styles.content}>
          <Text style={styles.sectionLabel}>SIGNAL SOURCE</Text>
          <View style={{ height: Space.s22 }} />
          <Text style={styles.heroLine}>Connect</Text>
          <Text style={[styles.heroLine, styles.heroAmber]}>your</Text>
          <Text style={styles.heroLine}>library.</Text>
          <View style={{ height: Space.s26 }} />
          <Text style={styles.description}>
            ONAY plays from your Apple Music library. Connect so she can pull your playlists and host between the tracks.
          </Text>
        </View>

        <View style={styles.bottom}>
          <AmberCTA
            label={loading ? 'Connecting\u2026' : 'Connect Apple Music'}
            onPress={handleConnect}
            disabled={loading}
            accessibilityHint="Opens Apple Music authorization"
          />
          <Pressable
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.skipText}>skip for now</Text>
          </Pressable>
        </View>
      </View>
    </BroadcastBackdrop>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Space.s26,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  sectionLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2.5,
    color: AM.inkDim,
  },
  heroLine: {
    fontFamily: Fonts.displayThin,
    fontSize: TypeScale.s44,
    fontStyle: 'italic',
    lineHeight: TypeScale.s44 * 1.05,
    letterSpacing: -0.8,
    color: AM.ink,
  },
  heroAmber: {
    color: AM.amber,
  },
  description: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.inkMid,
    lineHeight: TypeScale.s16 * 1.5,
  },
  bottom: {
    gap: Space.s10,
  },
  skip: {
    alignItems: 'center',
    paddingVertical: Space.s14,
  },
  skipText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
});

import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AM, Fonts, Space, TypeScale } from '../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../src/components/BroadcastBackdrop';
import { StampButton, LinerNotes, SpinningRecord } from '../../src/components/crate';
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
      <View style={[
        styles.root,
        { paddingTop: insets.top + Space.s32, paddingBottom: insets.bottom + Space.s22 },
      ]}>
        <View style={styles.content}>
          <Text style={styles.kicker}>SIGNAL SOURCE · 05 / 05</Text>

          {/* Spinning vinyl above the headline — quiet brand moment */}
          <View style={styles.vinylWrap}>
            <SpinningRecord size={120} tonearm={false} period={4200} />
          </View>

          <Text style={styles.headline}>
            Bring your{'\n'}
            <Text style={styles.headlineAmber}>library.</Text>
          </Text>

          <View style={styles.linerWrap}>
            <LinerNotes>
              ONAY plays from your Apple Music. Connect so she can pull your playlists
              and host between the tracks. We don&rsquo;t copy or keep any of it.
            </LinerNotes>
          </View>
        </View>

        <View style={styles.bottom}>
          <StampButton
            label={loading ? 'CONNECTING…' : 'CONNECT APPLE MUSIC'}
            sub="ONE-TIME · APPLE HANDLES THE PERMISSIONS"
            onPress={handleConnect}
            disabled={loading}
            kind="amber"
            accessibilityHint="Opens Apple Music authorization"
          />
          <Pressable
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            hitSlop={10}
            style={({ pressed }) => [styles.skip, pressed && { opacity: 0.5 }]}
          >
            <Text style={styles.skipText}>skip — I&rsquo;ll connect later</Text>
          </Pressable>
        </View>
      </View>
    </BroadcastBackdrop>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Space.s20,
  },
  content: {
    flex: 1,
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 3,
    color: AM.inkDim,
  },
  headline: {
    marginTop: Space.s26,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s42,
    color: AM.ink,
    letterSpacing: 0.8,
    lineHeight: 50,
    textAlign: 'center',
  },
  headlineAmber: {
    color: AM.amber,
  },
  vinylWrap: {
    alignItems: 'center',
    marginTop: Space.s30,
  },
  linerWrap: {
    marginTop: Space.s26,
  },
  bottom: {
    gap: Space.s14,
  },
  skip: {
    alignItems: 'center',
    paddingVertical: Space.s10,
  },
  skipText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
    textDecorationLine: 'underline',
  },
});

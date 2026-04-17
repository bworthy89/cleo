import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AM, Fonts, Space, TypeScale } from '../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../src/components/BroadcastBackdrop';
import { AmberCTA } from '../../src/components/AmberCTA';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }).start();
  }, [opacity]);

  return (
    <BroadcastBackdrop>
      <View style={[styles.root, { paddingTop: insets.top + Space.s34, paddingBottom: insets.bottom + Space.s34 }]}>
        <Animated.View style={[styles.content, { opacity }]}>
          <Text style={styles.wordmark}>onay</Text>
          <View style={{ height: Space.s40 }} />
          <Text style={styles.heroLine}>Every song,</Text>
          <Text style={[styles.heroLine, styles.heroAmber]}>a story.</Text>
          <Text style={styles.heroLine}>I tell it.</Text>
          <View style={{ height: Space.s34 }} />
          <Text style={styles.description}>
            Your personal radio host. No skips, no shuffle{'\u2014'}just a broadcast curated for where your night is headed.
          </Text>
        </Animated.View>

        <View style={styles.bottom}>
          <AmberCTA
            label="Tune in"
            onPress={() => router.push('/(onboarding)/music-auth')}
            accessibilityHint="Continue to the Apple Music connection step"
          />
          <Text style={styles.commitment}>no skips {'\u00b7'} no shuffle {'\u00b7'} sit with it</Text>
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
  wordmark: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 3,
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
  commitment: {
    textAlign: 'center',
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.inkDim,
  },
});

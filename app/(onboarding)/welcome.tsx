import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Surface, TextColors, Typography, Spacing } from '../../src/tokens/design-tokens';

export default function WelcomeScreen() {
  const [taglineDone, setTaglineDone] = useState(false);
  const descOpacity = useRef(new Animated.Value(0)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => setTaglineDone(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (taglineDone) {
      Animated.sequence([
        Animated.timing(descOpacity, { toValue: 1, duration: 600, delay: 400, useNativeDriver: true }),
        Animated.timing(buttonOpacity, { toValue: 1, duration: 600, delay: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [taglineDone]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>ONAY</Text>
        <View style={styles.accentLine} />
        <Text style={styles.tagline}>
          Every song has a story.{'\n'}I'm just here to tell it.
        </Text>
        <Animated.Text style={[styles.description, { opacity: descOpacity }]}>
          Your personal AI radio host. I curate frequencies that match your soul's current wavelength.
        </Animated.Text>
      </View>
      <Animated.View style={[styles.bottom, { opacity: buttonOpacity }]}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={() => router.push('/(onboarding)/music-auth')}
          accessibilityLabel="Continue to setup"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>TUNE IN</Text>
        </Pressable>
      </Animated.View>
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
  logo: {
    fontFamily: Typography.display.family,
    fontSize: 56,
    color: TextColors.primary,
    letterSpacing: 6,
  },
  accentLine: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  tagline: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 22,
    color: Colors.accent,
    lineHeight: 32,
    marginBottom: Spacing.md,
  },
  description: {
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.secondary,
    lineHeight: 22,
  },
  bottom: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  button: {
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.accent,
    letterSpacing: 3,
  },
  pressed: {
    opacity: 0.7,
  },
});

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
        <Text style={styles.title}>CLEO</Text>
        <Text style={styles.tagline}>Every song has a story. I'm just here to tell it.</Text>
        <Animated.Text style={[styles.description, { opacity: descOpacity }]}>
          Your personal AI radio host. I'll play your music, share the stories behind the songs, and make every session feel like it was made just for you.
        </Animated.Text>
      </View>
      <Animated.View style={[styles.bottom, { opacity: buttonOpacity }]}>
        <Pressable style={styles.button} onPress={() => router.push('/(onboarding)/music-auth')}>
          <Text style={styles.buttonText}>GET STARTED</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Surface.base },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 72,
    color: TextColors.primary,
    letterSpacing: 2.7,
    marginBottom: Spacing.lg,
  },
  tagline: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 18,
    color: Colors.accent,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  description: {
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: TextColors.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: Spacing.md,
  },
  bottom: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },
  button: { backgroundColor: Colors.accent, paddingVertical: Spacing.md, alignItems: 'center' },
  buttonText: { fontFamily: Typography.mono.family, fontSize: 12, color: Colors.base.black, letterSpacing: 1.5 },
});

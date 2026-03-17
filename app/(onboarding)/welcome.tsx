import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>CLEO</Text>
        <Text style={styles.tagline}>
          Every song has a story.{'\n'}I'm just here to tell it.
        </Text>
        <Text style={styles.description}>
          Your personal AI radio host. I'll play your music, share the stories behind the songs, and make every session feel like it was made just for you.
        </Text>
      </View>
      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={() => router.push('/(onboarding)/music-auth')}>
          <Text style={styles.buttonText}>GET STARTED</Text>
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
  title: {
    fontFamily: Typography.display.family,
    fontSize: 72,
    color: Colors.vibe.morning.text,
    letterSpacing: 8,
    marginBottom: Spacing.lg,
  },
  tagline: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 20,
    color: Colors.accent,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: Spacing.xl,
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

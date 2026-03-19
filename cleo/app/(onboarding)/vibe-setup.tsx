import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Tracking } from '../../src/tokens/design-tokens';
import { VibeSelector } from '../../src/components/VibeSelector';
import { setUser } from '../../src/services/Storage';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function VibeSetupScreen() {
  const [name, setName] = useState('');
  const [vibe, setVibe] = useState<Vibe>('chill');

  const handleContinue = () => {
    setUser({
      name: name.trim() || undefined,
      appleMusicAuthorized: true,
      createdAt: new Date().toISOString(),
      defaultVibe: vibe,
    });
    router.push('/(onboarding)/first-station');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Make It Yours</Text>

        <Text style={styles.label}>YOUR NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="What should Cleo call you?"
          placeholderTextColor="rgba(0,0,0,0.3)"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
        />

        <Text style={[styles.label, { marginTop: Spacing.xl }]}>DEFAULT VIBE</Text>
        <VibeSelector selected={vibe} onSelect={setVibe} />
      </View>
      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>CONTINUE</Text>
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
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 32,
    color: Colors.vibe.morning.text,
    marginBottom: Spacing.xl,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    marginBottom: Spacing.sm,
  },
  input: {
    fontFamily: Typography.label.family,
    fontSize: 18,
    color: Colors.vibe.morning.text,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.15)',
    paddingVertical: Spacing.md,
  },
  bottom: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  button: {
    backgroundColor: Colors.base.black,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});

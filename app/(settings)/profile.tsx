import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { getUser, setUser } from '../../src/services/Storage';
import { VibeSelector } from '../../src/components/VibeSelector';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function ProfileScreen() {
  const user = getUser();
  const [name, setName] = useState(user?.name ?? '');
  const [vibe, setVibe] = useState<Vibe>((user?.defaultVibe as Vibe) ?? 'chill');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setUser({
      ...user!,
      name: name.trim() || undefined,
      defaultVibe: vibe,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>YOUR NAME</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor="rgba(0,0,0,0.3)"
        autoCapitalize="words"
      />

      <Text style={[styles.label, { marginTop: Spacing.xl }]}>DEFAULT VIBE</Text>
      <VibeSelector selected={vibe} onSelect={setVibe} />

      <Text style={[styles.label, { marginTop: Spacing.xl }]}>APPLE MUSIC</Text>
      <Text style={styles.status}>✓ Connected</Text>

      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={handleSave}>
          <Text style={styles.buttonText}>{saved ? 'SAVED ✓' : 'SAVE'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
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
  status: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.accent,
    marginTop: Spacing.sm,
  },
  bottom: {
    marginTop: Spacing.xxl,
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

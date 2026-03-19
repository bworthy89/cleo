import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing, Opacity, Tracking, withAlpha } from '../../src/tokens/design-tokens';
import { getUser, setUser } from '../../src/services/Storage';
import { signOut } from '../../src/services/AuthService';
import { VibeSelector } from '../../src/components/VibeSelector';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function ProfileScreen() {
  const user = getUser();
  const [name, setName] = useState(user?.name ?? '');
  const [vibe, setVibe] = useState<Vibe>((user?.defaultVibe as Vibe) ?? 'chill');
  const [saved, setSaved] = useState(false);

  const currentUser = getUser();
  const userVibe = (currentUser?.defaultVibe as keyof typeof Colors.vibe) ?? 'morning';
  const vibeTheme = Colors.vibe[userVibe] ?? Colors.vibe.morning;

  const handleSave = () => {
    setUser({
      appleMusicAuthorized: user?.appleMusicAuthorized ?? false,
      createdAt: user?.createdAt ?? new Date().toISOString(),
      name: name.trim() || undefined,
      defaultVibe: vibe,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Your stations and settings will be kept for when you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/');
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: vibeTheme.bg }]}>
      <View>
        <Text style={[styles.label, { color: vibeTheme.text }]}>YOUR NAME</Text>
        <TextInput
          style={[styles.input, { color: vibeTheme.text }]}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor="rgba(0,0,0,0.3)"
          autoCapitalize="words"
        />

        <Text style={[styles.label, { marginTop: Spacing.xl, color: vibeTheme.text }]}>DEFAULT VIBE</Text>
        <VibeSelector selected={vibe} onSelect={setVibe} />

        <Text style={[styles.label, { marginTop: Spacing.xl, color: vibeTheme.text }]}>APPLE MUSIC</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: vibeTheme.accent, marginRight: Spacing.sm }} />
          <Text style={{ fontFamily: Typography.mono.family, fontSize: 10, letterSpacing: 2, color: vibeTheme.accent, textTransform: 'uppercase' }}>CONNECTED</Text>
        </View>

        <View style={styles.bottom}>
          <Pressable style={styles.button} onPress={handleSave}>
            <Text style={[styles.buttonText, saved && { color: vibeTheme.accent, backgroundColor: 'transparent' }]}>
              {saved ? 'SAVED' : 'SAVE'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.button, { backgroundColor: 'transparent', marginTop: Spacing.lg }]}
            onPress={handleLogout}
          >
            <Text style={[styles.buttonText, { color: vibeTheme.accent }]}>SIGN OUT</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: Spacing.sm,
  },
  input: {
    fontFamily: Typography.label.family,
    fontSize: 18,
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
    fontSize: 12,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});

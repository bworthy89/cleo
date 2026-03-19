import { Pressable, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { Colors, Typography } from '../../src/tokens/design-tokens';
import { getUser } from '../../src/services/Storage';

export default function SettingsLayout() {
  const user = getUser();
  const vibe = (user?.defaultVibe as keyof typeof Colors.vibe) ?? 'morning';
  const vibeTheme = Colors.vibe[vibe] ?? Colors.vibe.morning;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: vibeTheme.bg },
        headerTintColor: vibeTheme.text,
        headerTitleStyle: { fontFamily: 'WorkSans_500Medium', fontSize: 16 },
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={{
                fontFamily: Typography.mono.family,
                fontSize: 12,
                color: vibeTheme.text,
                letterSpacing: 1,
              }}>
                {'\u2190'} BACK
              </Text>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="host-settings" options={{ title: 'Host Settings' }} />
      <Stack.Screen name="history" options={{ title: 'Session History' }} />
    </Stack>
  );
}

import { Pressable, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { Colors, Typography } from '../../src/tokens/design-tokens';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: Colors.vibe.morning.bg },
        headerTintColor: Colors.vibe.morning.text,
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
                color: Colors.vibe.morning.text,
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

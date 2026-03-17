import { Stack } from 'expo-router';
import { Colors } from '../../src/tokens/design-tokens';

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
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="host-settings" options={{ title: 'Host Settings' }} />
      <Stack.Screen name="history" options={{ title: 'Session History' }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';

export default function BroadcastLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="player" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
    </Stack>
  );
}

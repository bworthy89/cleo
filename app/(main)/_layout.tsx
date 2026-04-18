import { Tabs } from 'expo-router';
import { CustomTabBar } from '../../src/components/TabBar';
import { SettingsProvider } from '../../src/contexts/SettingsContext';

export default function MainLayout() {
  return (
    <SettingsProvider>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
        initialRouteName="(broadcast)"
      >
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="(tonight)" />
        <Tabs.Screen name="(broadcast)" />
        <Tabs.Screen name="(crates)" />
        <Tabs.Screen name="(cleo)" />
      </Tabs>
    </SettingsProvider>
  );
}

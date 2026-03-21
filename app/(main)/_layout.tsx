import { Tabs } from 'expo-router';
import { CustomTabBar } from '../../src/components/TabBar';

export default function MainLayout() {
  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }} initialRouteName="(broadcast)">
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="(broadcast)" />
      <Tabs.Screen name="(arc)" />
      <Tabs.Screen name="(archive)" />
      <Tabs.Screen name="(cleo)" />
    </Tabs>
  );
}

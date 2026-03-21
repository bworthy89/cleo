// src/components/TabBar.tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar as TabBarTokens, Typography } from '../tokens/design-tokens';
import { TabIcon } from './TabIcon';
import type { TabIconName } from './TabIcon';
import { CleoPulseDot } from './CleoPulseDot';

const TABS: { key: string; label: string; icon: TabIconName }[] = [
  { key: '(broadcast)', label: 'Broadcast', icon: 'sensors' },
  { key: '(arc)', label: 'Arc', icon: 'timeline' },
  { key: '(archive)', label: 'Archive', icon: 'library_music' },
  { key: '(cleo)', label: 'ONAY', icon: 'blur_on' },
];

export function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || 20 }]}>
      <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.inner}>
        {TABS.map((tab) => {
          const routeIndex = state.routes.findIndex((r: any) => r.name === tab.key);
          const isActive = state.index === routeIndex;
          const color = isActive ? TabBarTokens.activeColor : TabBarTokens.inactiveColor;
          return (
            <Pressable
              key={tab.key}
              onPress={() => navigation.navigate(tab.key)}
              style={styles.tab}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <View style={{ position: 'relative' }}>
                <TabIcon name={tab.icon} size={TabBarTokens.iconSize} color={color} filled={isActive} />
                {tab.key === '(cleo)' && !isActive && <CleoPulseDot />}
              </View>
              <Text style={[styles.label, { color }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: TabBarTokens.radius,
    borderTopRightRadius: TabBarTokens.radius,
    overflow: 'hidden',
    backgroundColor: TabBarTokens.bg,
  },
  inner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 16,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 56,
    minHeight: 44,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: TabBarTokens.labelSize,
    fontWeight: '500',
    letterSpacing: TabBarTokens.labelTracking,
    textTransform: 'uppercase',
  },
});

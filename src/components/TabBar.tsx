import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space } from '../tokens/design-tokens';
import { NowPlayingBar } from './NowPlayingBar';

/**
 * 4-tab bar — exact port of source chrome.jsx: TONIGHT · BROADCAST · CRATES ·
 * ONAY, mono numerals above condensed display labels, hairline dividers
 * between tabs, oxblood underline on the active tab.
 */

const TABS: { key: string; label: string; num: string }[] = [
  { key: '(tonight)',   label: 'TONIGHT',   num: '01' },
  { key: '(broadcast)', label: 'BROADCAST', num: '02' },
  { key: '(crates)',    label: 'CRATES',    num: '03' },
  { key: '(cleo)',      label: 'ONAY',      num: '04' },
];

export function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || Space.s18 }]}>
      <NowPlayingBar />
      <View style={styles.inner}>
        {TABS.map((tab, i) => {
          const routeIndex = state.routes.findIndex((r: any) => r.name === tab.key);
          const isActive = state.index === routeIndex;
          const onPress = () => {
            Haptics.selectionAsync().catch(() => {});
            navigation.navigate(tab.key);
          };
          return (
            <Pressable
              key={tab.key}
              onPress={onPress}
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={[
                styles.tab,
                i < TABS.length - 1 && styles.tabDivider,
              ]}
            >
              <Text style={[styles.num, isActive && styles.numActive]}>{tab.num}</Text>
              <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
                {tab.label}
              </Text>
              {isActive && <View style={styles.underline} />}
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
    backgroundColor: AM.bg,
    borderTopWidth: 0.5,
    borderTopColor: AM.rule,
  },
  inner: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 4,
    position: 'relative',
    minHeight: 44,
  },
  tabDivider: {
    borderRightWidth: 0.5,
    borderRightColor: AM.rule,
  },
  num: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  numActive: {
    color: AM.oxblood,
  },
  label: {
    fontFamily: Fonts.display,
    fontSize: 13,
    letterSpacing: 0.8,
    lineHeight: 16,
  },
  labelActive: { color: AM.ink },
  labelInactive: { color: AM.inkMid },
  underline: {
    position: 'absolute',
    bottom: 4,
    width: 18,
    height: 2,
    backgroundColor: AM.oxblood,
  },
});

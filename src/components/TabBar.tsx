import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AM, Fonts, TypeScale, Space } from '../tokens/design-tokens';

const TABS: { key: string; label: string }[] = [
  { key: '(broadcast)', label: 'broadcast' },
  { key: '(cleo)',      label: 'you' },
];

export function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || Space.s18 }]}>
      <View style={styles.inner}>
        {TABS.map((tab) => {
          const routeIndex = state.routes.findIndex((r: any) => r.name === tab.key);
          const isActive = state.index === routeIndex;
          return (
            <Pressable
              key={tab.key}
              onPress={() => navigation.navigate(tab.key)}
              style={styles.tab}
              hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
                {tab.label}
              </Text>
              <View style={[styles.underline, isActive && styles.underlineActive]} />
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
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
  },
  inner: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 56,
    paddingTop: Space.s10,
    gap: Space.s40,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Space.s8,
    gap: Space.s6,
  },
  label: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s15,
    fontStyle: 'italic',
    letterSpacing: 0.3,
  },
  labelActive:   { color: AM.amber },
  labelInactive: { color: AM.inkDim },
  underline: {
    width: 16,
    height: 1,
    backgroundColor: 'transparent',
  },
  underlineActive: {
    backgroundColor: AM.amber,
  },
});

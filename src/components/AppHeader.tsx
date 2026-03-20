import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeaderTokens, Colors, Typography, ZIndex } from '../tokens/design-tokens';

interface AppHeaderProps {
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function AppHeader({ leftContent, rightContent }: AppHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, height: AppHeaderTokens.height + insets.top }]}>
      <BlurView intensity={AppHeaderTokens.blur} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.inner}>
        <View style={styles.left}>
          {leftContent}
          <Text style={styles.logo}>ONAY</Text>
        </View>
        {rightContent && <View style={styles.right}>{rightContent}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', top: 0, left: 0, right: 0,
    zIndex: ZIndex.header,
    backgroundColor: AppHeaderTokens.bg,
  },
  inner: {
    flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    fontFamily: Typography.mono.family,
    fontSize: AppHeaderTokens.logoSize,
    fontWeight: '500',
    color: Colors.accent,
    letterSpacing: AppHeaderTokens.logoTracking,
    textTransform: 'uppercase',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});

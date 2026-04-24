import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Space } from '../tokens/design-tokens';

interface HairlineRowProps {
  /** Left column — usually a uppercase mono label or reel number. */
  leading?: ReactNode;
  /** Middle — the main content, typically italic-serif. Flexes. */
  value: ReactNode;
  /** Right — chevron, duration, or dot. */
  trailing?: ReactNode;
  /** If set, row becomes a Pressable. Light haptic on press. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Render a 1px rule above this row instead of below. */
  topRule?: boolean;
  /** Override default vertical padding (14 for recent rows, 16 for picks). */
  verticalPadding?: number;
  /** Width of the leading column; defaults to auto (content-sized). */
  leadingWidth?: number;
  /** When true, the row is inert: no haptic, no onPress, Pressable disabled,
   *  and accessibilityState.disabled is set so VoiceOver announces "dimmed". */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function HairlineRow({
  leading,
  value,
  trailing,
  onPress,
  accessibilityLabel,
  topRule = false,
  verticalPadding = Space.s16,
  leadingWidth,
  disabled,
  style,
}: HairlineRowProps) {
  const rowStyle = [
    styles.row,
    topRule ? styles.topRule : styles.bottomRule,
    { paddingVertical: verticalPadding },
    style,
  ];

  const content = (
    <>
      {leading !== undefined && (
        <View style={[styles.leading, leadingWidth !== undefined && { width: leadingWidth }]}>
          {leading}
        </View>
      )}
      <View style={styles.value}>{value}</View>
      {trailing !== undefined && <View style={styles.trailing}>{trailing}</View>}
    </>
  );

  if (!onPress) {
    return <View style={rowStyle}>{content}</View>;
  }

  const handlePress = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [rowStyle, pressed && !disabled && { opacity: 0.75 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s16,
  },
  bottomRule: {
    borderBottomWidth: 1,
    borderBottomColor: AM.amberFaint,
  },
  topRule: {
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
  },
  leading: {
    flexShrink: 0,
  },
  value: {
    flex: 1,
  },
  trailing: {
    flexShrink: 0,
  },
});

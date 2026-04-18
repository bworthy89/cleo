import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, TypeScale } from '../../tokens/design-tokens';

interface Props {
  label: string;
  value?: string | null;
  placeholder?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Trailing glyph (defaults to "→"). */
  trailing?: string;
}

/**
 * Picklist line — mono label + display value + trailing chev.
 * FROM / VIBE / LENGTH rows on Home use this.
 */
export function CatalogRow({ label, value, placeholder, onPress, accessibilityLabel, trailing = '→' }: Props) {
  const handlePress = () => {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  const row = (
    <View style={styles.inner}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, !value && styles.valueDim]} numberOfLines={1}>
        {value ?? placeholder ?? ''}
      </Text>
      <Text style={styles.trail}>{trailing}</Text>
    </View>
  );

  if (!onPress) return <View style={styles.wrap}>{row}</View>;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label} ${value ?? placeholder ?? ''}`}
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.75 }]}
    >
      {row}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 14,
  },
  label: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
    width: 56,
  },
  value: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.ink,
    letterSpacing: 0.8,
  },
  valueDim: { color: AM.inkDim },
  trail: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.inkDim,
    lineHeight: TypeScale.s18,
  },
});

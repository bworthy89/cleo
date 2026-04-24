import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, type ViewStyle, type StyleProp } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../tokens/design-tokens';

interface AmberCTAProps {
  label: string;
  onPress: () => void;
  /** Accessibility label. Defaults to `label` if not supplied. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Analog Midnight primary CTA. Full-width, transparent body, 1px amber border,
 * sharp rectangle (no radius — intentional, matches the editorial tone). Press
 * intensifies the amber glow for 150ms then snaps back. Haptic on press.
 */
export function AmberCTA({
  label,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  style,
}: AmberCTAProps) {
  const glow = useRef(new Animated.Value(0.12)).current;

  const handlePressIn = () => {
    Animated.timing(glow, { toValue: 0.24, duration: 150, useNativeDriver: false }).start();
  };
  const handlePressOut = () => {
    Animated.timing(glow, { toValue: 0.12, duration: 150, useNativeDriver: false }).start();
  };

  const handlePress = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          shadowOpacity: glow,
          shadowColor: AM.amber,
          shadowOffset: { width: 0, height: 0 },
          shadowRadius: 24,
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={styles.button}
      >
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: AM.amber,
    backgroundColor: 'transparent',
  },
  button: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.s18,
    paddingHorizontal: Space.s18,
  },
  label: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.amber,
    letterSpacing: 2,
    textTransform: 'uppercase',
    lineHeight: 22,
  },
  disabled: {
    opacity: 0.4,
  },
});

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Spacing } from '../tokens/design-tokens';

interface OnAirIndicatorProps {
  active: boolean;
  accentColor?: string;
}

export function OnAirIndicator({ active, accentColor }: OnAirIndicatorProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (active) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      glow.start();
      return () => {
        pulse.stop();
        glow.stop();
        pulseAnim.setValue(1);
        glowAnim.setValue(0.3);
      };
    } else {
      pulseAnim.setValue(1);
      glowAnim.setValue(0.3);
    }
  }, [active]);

  const color = accentColor ?? Colors.accent;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.dot, { backgroundColor: color, opacity: glowAnim, transform: [{ scale: pulseAnim }] }]}
      />
      <Animated.Text style={[styles.label, { color, opacity: active ? glowAnim : 0.3 }]}>
        ON AIR
      </Animated.Text>
      <Animated.View
        style={[styles.dot, { backgroundColor: color, opacity: glowAnim, transform: [{ scale: pulseAnim }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontFamily: Typography.mono.family, fontSize: 10, letterSpacing: 3 },
});

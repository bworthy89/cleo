import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Spacing, Tracking } from '../tokens/design-tokens';

interface OnAirIndicatorProps {
  active: boolean;
  paused?: boolean;
  accentColor?: string;
}

export function OnAirIndicator({ active, paused, accentColor }: OnAirIndicatorProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.15)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const glowLoop = useRef<Animated.CompositeAnimation | null>(null);

  const color = accentColor ?? Colors.accent;
  const isLive = active && !paused;

  useEffect(() => {
    if (isLive) {
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        pulseLoop.current = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          ])
        );
        glowLoop.current = Animated.loop(
          Animated.sequence([
            Animated.timing(glowAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(glowAnim, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          ])
        );
        pulseLoop.current.start();
        glowLoop.current.start();
      });
    } else {
      pulseLoop.current?.stop();
      glowLoop.current?.stop();
      pulseLoop.current = null;
      glowLoop.current = null;
      pulseAnim.setValue(1);
      Animated.timing(glowAnim, {
        toValue: 0.15,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
    return () => {
      pulseLoop.current?.stop();
      glowLoop.current?.stop();
      pulseLoop.current = null;
      glowLoop.current = null;
    };
  }, [isLive]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            opacity: glowAnim,
            transform: [{ scale: pulseAnim }],
            shadowColor: color,
            shadowRadius: isLive ? 4 : 0,
            shadowOpacity: isLive ? 0.4 : 0,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      />
      <Animated.Text style={[styles.label, { color, opacity: glowAnim }]}>
        ON AIR
      </Animated.Text>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            opacity: glowAnim,
            transform: [{ scale: pulseAnim }],
            shadowColor: color,
            shadowRadius: isLive ? 4 : 0,
            shadowOpacity: isLive ? 0.4 : 0,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
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
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontFamily: Typography.mono.family, fontSize: 10, letterSpacing: Tracking.wide },
});

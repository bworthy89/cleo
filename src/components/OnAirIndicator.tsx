import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { AM, AMGlow } from '../tokens/design-tokens';
import { useAppActive } from '../hooks/useAppActive';

/**
 * 5px amber dot with a 6px amber glow. Pulses gently (1.8s, opacity 1→0.65→1)
 * when `active` is true — indicating a broadcast is currently playing. Pulse
 * loop is gated on `useAppActive()` so the animation stops when the app is
 * backgrounded (iOS 48s/60s background CPU budget — CLAUDE.md).
 *
 * Caller owns `active`. For AppHeader the caller polls broadcastPlayer state.
 */
export function OnAirIndicator({ active }: { active: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const appActive = useAppActive();

  useEffect(() => {
    if (!active || !appActive) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.65, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, appActive, opacity]);

  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel={active ? 'on air' : 'off air'}
      style={[styles.dot, active ? styles.dotActive : styles.dotIdle, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  dotActive: {
    backgroundColor: AM.amber,
    shadowColor: AMGlow.dot.shadowColor,
    shadowOffset: AMGlow.dot.shadowOffset,
    shadowOpacity: AMGlow.dot.shadowOpacity,
    shadowRadius: AMGlow.dot.shadowRadius,
  },
  dotIdle: {
    backgroundColor: AM.inkDim,
  },
});

export default OnAirIndicator;

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { AM, AMGlow } from '../tokens/design-tokens';
import { useAppActive } from '../hooks/useAppActive';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * 5px oxblood dot with a 6px oxblood glow. Pulses gently (1.8s, opacity 1→0.65→1)
 * when `active` is true — indicating a broadcast is currently playing.
 * Oxblood matches the record-label red of the crate-digger design's
 * TONIGHT ON ONAY stamp. Pulse loop is gated on `useAppActive()` so the
 * animation stops when the app is backgrounded, and on `useReduceMotion()`
 * so vestibular-sensitive users get a static dot.
 */
export function OnAirIndicator({ active }: { active: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const appActive = useAppActive();
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!active || !appActive || reduceMotion) {
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
  }, [active, appActive, reduceMotion, opacity]);

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
    backgroundColor: AM.oxblood,
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

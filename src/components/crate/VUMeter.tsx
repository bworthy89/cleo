import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AM } from '../../tokens/design-tokens';
import { useAppActive } from '../../hooks/useAppActive';
import { useReduceMotion } from '../../hooks/useReduceMotion';

interface Props {
  /** Level 0-1; informs which bars are "active". Default 0.8. */
  level?: number;
  /** Animate each bar; stops when backgrounded. Default true. */
  animate?: boolean;
  /** Color for mid-range bars. Default amber. */
  color?: string;
  /** Color for peak bars (top 20%). Default oxblood. */
  peakColor?: string;
  /** Number of bars. Default 24. */
  bars?: number;
  /** Bar width in px. Default 3. */
  barWidth?: number;
  /** Max bar height in px. Default 18. */
  height?: number;
  gap?: number;
}

/**
 * VU meter — a strip of vertical bars that pulse. No audio input yet;
 * purely visual. Pauses animation when `useAppActive` returns false to
 * keep iOS background CPU budget happy, and when `useReduceMotion` is
 * true so vestibular-sensitive users get a static-level snapshot.
 *
 * Decorative: hidden from the a11y tree (no semantic state for VoiceOver
 * to announce; the surrounding screen carries the meaning).
 *
 * Animates `scaleY` (with `transformOrigin` anchored at the bottom edge)
 * via the native driver, so all `bars` loops run on the UI thread for
 * free. Earlier revisions interpolated `height` with `useNativeDriver:
 * false`, which routed ~80 timings/sec onto the JS thread when visible —
 * fine on a fresh Pro, less fine when paired with scroll or playback.
 */
export function VUMeter({
  level = 0.8,
  animate = true,
  color = AM.amber,
  peakColor = AM.oxblood,
  bars = 24,
  barWidth = 3,
  height = 18,
  gap = 2,
}: Props) {
  const appActive = useAppActive();
  const reduceMotion = useReduceMotion();
  // Each bar's animated value is a normalized scale (0.2-1.0). The bar's
  // layout height is fixed at `height`; scaleY squashes/stretches it
  // around its bottom edge so growth reads as natural meter movement.
  //
  // `values` is sized from the initial `bars` prop and never resized.
  // All call sites currently pass a static `bars`; if a future caller
  // ever needs a dynamic count the array would have to be rebuilt
  // (or the component re-mounted via `key={bars}`).
  const values = useRef<Animated.Value[]>(
    Array.from({ length: bars }).map((_, i) => new Animated.Value(0.4 + ((i % 5) / 10))),
  ).current;

  useEffect(() => {
    if (!animate || !appActive || reduceMotion) {
      // Snap back to the seeded rest pattern so a mid-loop pause (Reduce
      // Motion toggled on, app backgrounded) doesn't leave bars frozen at
      // arbitrary scales. Mirrors the setValue resets in OnAirIndicator
      // and SpinningRecord.
      values.forEach((v, i) => v.setValue(0.4 + ((i % 5) / 10)));
      return;
    }
    const loops = values.map((v, i) => Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 0.3 + Math.random() * 0.7,
          duration: 400 + (i * 37) % 600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 0.2 + Math.random() * 0.5,
          duration: 420 + (i * 43) % 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [animate, appActive, reduceMotion, values]);

  return (
    <View
      style={[styles.row, { height, gap }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {values.map((v, i) => {
        const active = i / bars < level;
        const fill = !active ? AM.inkGhost : i > bars * 0.8 ? peakColor : color;
        return (
          <Animated.View
            key={i}
            style={{
              width: barWidth,
              height,
              backgroundColor: fill,
              transform: [{ scaleY: v }],
              transformOrigin: '50% 100%',
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});

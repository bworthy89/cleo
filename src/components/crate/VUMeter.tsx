import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AM } from '../../tokens/design-tokens';
import { useAppActive } from '../../hooks/useAppActive';

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
 * keep iOS background CPU budget happy.
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
  const values = useRef<Animated.Value[]>(
    Array.from({ length: bars }).map((_, i) => new Animated.Value(0.4 + ((i % 5) / 10))),
  ).current;

  useEffect(() => {
    if (!animate || !appActive) return;
    const loops = values.map((v, i) => Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 0.3 + Math.random() * 0.7,
          duration: 400 + (i * 37) % 600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(v, {
          toValue: 0.2 + Math.random() * 0.5,
          duration: 420 + (i * 43) % 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    ));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [animate, appActive, values]);

  return (
    <View style={[styles.row, { height, gap }]}>
      {values.map((v, i) => {
        const active = i / bars < level;
        const fill = !active ? AM.inkGhost : i > bars * 0.8 ? peakColor : color;
        return (
          <Animated.View
            key={i}
            style={{
              width: barWidth,
              height: v.interpolate({ inputRange: [0, 1], outputRange: [height * 0.2, height] }),
              backgroundColor: fill,
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

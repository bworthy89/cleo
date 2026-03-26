import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Colors } from '../tokens/design-tokens';
import { useAppActive } from '../hooks/useAppActive';

interface WaveformBarsProps {
  color?: string;
}

const BAR_HEIGHTS = [8, 14, 10, 16, 6];
const DELAYS = [0, 150, 300, 100, 250];
const BAR_WIDTH = 3;
const BAR_RADIUS = 2;
const DURATION = 600;

function Bar({ height, delay, color, active }: { height: number; delay: number; color: string; active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.sequence([
            Animated.timing(scale, { toValue: 0.4, duration: DURATION, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1, duration: DURATION, useNativeDriver: true }),
          ]),
        ]),
      );
      animRef.current = animation;
      animation.start();
    } else {
      animRef.current?.stop();
      animRef.current = null;
    }
    return () => {
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [active, delay, scale]);

  return (
    <Animated.View
      style={{
        width: BAR_WIDTH,
        height,
        borderRadius: BAR_RADIUS,
        backgroundColor: color,
        transform: [{ scaleY: scale }],
      }}
    />
  );
}

export function WaveformBars({ color = Colors.accent }: WaveformBarsProps) {
  const active = useAppActive();

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 20 }}
      accessibilityLabel="Audio visualization"
      accessibilityRole="image"
      accessible
    >
      {BAR_HEIGHTS.map((h, i) => (
        <Bar key={i} height={h} delay={DELAYS[i]} color={color} active={active} />
      ))}
    </View>
  );
}

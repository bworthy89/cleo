import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Colors } from '../tokens/design-tokens';

interface WaveformBarsProps {
  color?: string;
}

const BAR_HEIGHTS = [8, 14, 10, 16, 6];
const DELAYS = [0, 150, 300, 100, 250];
const BAR_WIDTH = 3;
const BAR_RADIUS = 2;
const DURATION = 600;

function Bar({ height, delay, color }: { height: number; delay: number; color: string }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.sequence([
          Animated.timing(scale, { toValue: 0.4, duration: DURATION, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: DURATION, useNativeDriver: true }),
        ]),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [delay, scale]);

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
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 20 }}
      accessibilityLabel="Audio visualization"
      accessibilityRole="image"
      accessible
    >
      {BAR_HEIGHTS.map((h, i) => (
        <Bar key={i} height={h} delay={DELAYS[i]} color={color} />
      ))}
    </View>
  );
}

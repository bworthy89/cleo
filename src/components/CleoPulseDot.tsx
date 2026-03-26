import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Colors } from '../tokens/design-tokens';
import { useAppActive } from '../hooks/useAppActive';

export function CleoPulseDot() {
  const progress = useRef(new Animated.Value(1)).current;
  const active = useAppActive();

  useEffect(() => {
    if (!active) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 0, duration: 2000, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, progress]);

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.5],
  });

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.3],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        right: 4,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: Colors.accent,
        shadowColor: Colors.accent,
        shadowRadius: 4,
        shadowOpacity: 0.6,
        shadowOffset: { width: 0, height: 0 },
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

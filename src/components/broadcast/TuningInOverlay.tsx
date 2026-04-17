import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { Colors, Spacing, Typography } from '../../tokens/design-tokens';
import { useAppActive } from '../../hooks/useAppActive';

interface Props { visible: boolean }

export function TuningInOverlay({ visible }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.6)).current;
  const appActive = useAppActive();

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  useEffect(() => {
    if (!visible || !appActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringScale, { toValue: 1.1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ringScale, { toValue: 0.6, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, appActive, ringScale]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: Colors.base.black,
          opacity,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Animated.View style={{
        width: 160, height: 160, borderRadius: 80,
        borderWidth: 2, borderColor: Colors.accent,
        transform: [{ scale: ringScale }],
      }} />
      <Text style={{
        color: Colors.accent,
        fontFamily: Typography.mono.family,
        fontSize: 12,
        marginTop: Spacing.lg,
        letterSpacing: 4,
      }}>
        TUNING IN
      </Text>
    </Animated.View>
  );
}

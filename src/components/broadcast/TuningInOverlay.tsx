import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { Grain } from '../Grain';
import { useAppActive } from '../../hooks/useAppActive';

interface Props { visible: boolean }

/**
 * Full-bleed overlay shown while the server is baking the broadcast. Single
 * amber ring fades in and out; italic-serif lowercase label. Pulse gated on
 * useAppActive() so the animation stops when backgrounded.
 */
export function TuningInOverlay({ visible }: Props) {
  const opacity     = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0.3)).current;
  const appActive   = useAppActive();

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
        Animated.timing(ringOpacity, { toValue: 0.8, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0.3, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, appActive, ringOpacity]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFillObject, styles.root, { opacity }]}
    >
      <Grain />
      <Animated.View style={[styles.ring, { opacity: ringOpacity }]} />
      <View style={{ height: Space.s32 }} />
      <Text style={styles.label}>{'tuning in\u2026'}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: AM.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: AM.amber,
  },
  label: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
    fontStyle: 'italic',
    color: AM.ink,
    letterSpacing: 0.5,
  },
});

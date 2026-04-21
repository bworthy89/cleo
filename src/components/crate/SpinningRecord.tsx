import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AM } from '../../tokens/design-tokens';
import { useAppActive } from '../../hooks/useAppActive';

interface Props {
  size?: number;
  /** Center label color for the vinyl center. Default oxblood. */
  labelColor?: string;
  /** Rotation period in ms. Default 3200. */
  period?: number;
  /** Show the tonearm drop animation. Default true. */
  tonearm?: boolean;
}

/**
 * Spinning vinyl with a small tonearm — used in TuningInOverlay and
 * as the "authenticating" indicator on login. Pauses when backgrounded.
 */
export function SpinningRecord({ size = 180, labelColor = AM.oxblood, period = 3200, tonearm = true }: Props) {
  const appActive = useAppActive();
  const rot = useRef(new Animated.Value(0)).current;
  const arm = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!appActive) return;
    const spin = Animated.loop(
      Animated.timing(rot, {
        toValue: 1,
        duration: period,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spin.start();
    return () => spin.stop();
  }, [appActive, rot, period]);

  useEffect(() => {
    if (!appActive || !tonearm) return;
    const drop = Animated.loop(
      Animated.sequence([
        Animated.timing(arm, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(arm, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    drop.start();
    return () => drop.stop();
  }, [appActive, tonearm, arm]);

  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const armRot = arm.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '2deg'] });

  return (
    <View style={{ width: size, height: size }}>
      {/* Vinyl disc */}
      <Animated.View style={[
        StyleSheet.absoluteFillObject,
        { transform: [{ rotate }] },
      ]}>
        {/* Outer black vinyl */}
        <View style={[
          StyleSheet.absoluteFillObject,
          { borderRadius: size / 2, backgroundColor: AM.bgDeep, borderWidth: 0.5, borderColor: AM.amberDim },
        ]} />
        {/* Concentric grooves — faint amber rings */}
        {[0.88, 0.76, 0.64, 0.52, 0.4].map(pct => (
          <View
            key={pct}
            style={{
              position: 'absolute',
              top: (size - size * pct) / 2,
              left: (size - size * pct) / 2,
              width: size * pct,
              height: size * pct,
              borderRadius: (size * pct) / 2,
              borderWidth: 0.5,
              borderColor: 'rgba(232,162,75,0.08)',
            }}
          />
        ))}
        {/* Center label — oxblood */}
        <View style={{
          position: 'absolute',
          top: (size - size * 0.34) / 2,
          left: (size - size * 0.34) / 2,
          width: size * 0.34,
          height: size * 0.34,
          borderRadius: (size * 0.34) / 2,
          backgroundColor: labelColor,
        }} />
        {/* Spindle hole */}
        <View style={{
          position: 'absolute',
          top: size / 2 - 3,
          left: size / 2 - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: AM.bgDeep,
        }} />
      </Animated.View>

      {/* Tonearm — sits above, rotates a few degrees */}
      {tonearm && (
        // `transformOrigin: '100% 50%'` pivots the arm around its right edge
        // where the pivot joint meets the turntable rim. Supported natively
        // in RN 0.76+ (we ship 0.83). Don't "simplify" this to translate +
        // rotate — the arm's position relative to the disc relies on this.
        <Animated.View style={{
          position: 'absolute',
          top: -6,
          right: -6,
          width: size * 0.62,
          height: 4,
          backgroundColor: AM.amber,
          transform: [{ rotate: armRot }],
          transformOrigin: '100% 50%',
        }} />
      )}
    </View>
  );
}

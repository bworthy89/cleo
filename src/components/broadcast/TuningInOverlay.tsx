import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale, ZIndex } from '../../tokens/design-tokens';
import { SpinningRecord } from '../crate/SpinningRecord';

interface Props {
  visible: boolean;
  /** Override the small mono label. Default "CUING UP". */
  label?: string;
  /** Override the display headline. Default "DROPPING THE NEEDLE…". */
  headline?: string;
  /** Override ONAY's italic line. */
  voiceLine?: string;
}

/**
 * Full-bleed overlay shown while the server is baking the broadcast.
 * Spinning vinyl + tonearm + liner-note quote. The record + text stay
 * mounted while the opacity animates out, so closing fades instead of
 * snapping off. We track a `mounted` flag so the tree is torn down only
 * after the fade-out completes.
 */
export function TuningInOverlay({
  visible,
  label = 'CUING UP',
  headline = 'DROPPING THE NEEDLE…',
  voiceLine = 'Give me a second. I want to start this one right.',
}: Props) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFillObject, styles.root, { opacity }]}
    >
      <SpinningRecord size={180} />
      <View style={{ height: Space.s30 }} />
      <View style={styles.textBlock}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.voice}>&ldquo;{voiceLine}&rdquo;</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: 'rgba(5, 4, 3, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: ZIndex.tuning,
  },
  textBlock: {
    alignItems: 'center',
    paddingHorizontal: Space.s26,
  },
  label: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amberDim,
    letterSpacing: 3,
    marginBottom: Space.s8,
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
    color: AM.ink,
    letterSpacing: 0.5,
  },
  voice: {
    marginTop: Space.s10,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s13,
    color: AM.inkMid,
    textAlign: 'center',
    lineHeight: TypeScale.s13 * 1.5,
  },
});

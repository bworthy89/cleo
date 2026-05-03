import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppActive } from '../../hooks/useAppActive';
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
  /**
   * Optional cancel handler. When provided, a TAKE IT BACK pressable
   * renders below the status label so the user can bail out of the
   * overlay on slow networks. Wiring this to AbortController + abortBake
   * (see HomeBroadcastScreen.playUserSourced) is what stops the server-side
   * bake; this component just surfaces the affordance.
   */
  onCancel?: () => void;
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
  onCancel,
}: Props) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);
  const [elapsed, setElapsed] = useState(0);

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

  // Reset elapsed when the overlay becomes invisible so each bake starts
  // at 0. Tick once per second while the overlay is visible.
  useEffect(() => {
    if (!visible) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [visible]);

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
        {elapsed >= 20 && (
          <Text style={styles.reassurance}>
            Still writing. Long sets take a minute.
          </Text>
        )}
        <CyclingStatusLabel active={visible} />
        {onCancel && (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel tuning in"
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
            style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.cancelLabel}>TAKE IT BACK</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const PHASES = ['CURATING', 'ENRICHING', 'WRITING SEGMENTS', 'TUNING IN'] as const;
const PHASE_INTERVAL_MS = 5000;
const FADE_DURATION_MS = 260;

/**
 * Subtle mono label that cycles through bake-pipeline phases so the
 * 25-40s cold-bake wait doesn't feel stalled. Pauses its interval when
 * the app is backgrounded (iOS background CPU budget).
 */
function CyclingStatusLabel({ active }: { active: boolean }) {
  const appActive = useAppActive();
  const running = active && appActive;
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setIndex((i) => (i + 1) % PHASES.length);
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    }, PHASE_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, opacity]);

  return (
    <Animated.Text
      accessibilityLiveRegion="polite"
      style={[styles.status, { opacity }]}
    >
      {PHASES[index]}
    </Animated.Text>
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
    lineHeight: 26,
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
  status: {
    marginTop: Space.s22,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amber,
    letterSpacing: 2.5,
    textAlign: 'center',
  },
  reassurance: {
    marginTop: Space.s10,
    alignSelf: 'center',
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
    lineHeight: 18,
    color: AM.inkMid,
    textAlign: 'center',
    paddingHorizontal: Space.s20,
  },
  cancel: {
    marginTop: Space.s30,
    alignSelf: 'center',
    paddingVertical: Space.s10,
    paddingHorizontal: Space.s20,
  },
  cancelLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 3,
    color: AM.inkDim,
  },
});

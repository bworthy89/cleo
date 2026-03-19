import { useEffect, useRef, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Spacing, ZIndex, isDarkVibe } from '../tokens/design-tokens';

interface PullQuoteOverlayProps {
  text: string;
  visible: boolean;
  vibeBg?: string;
  onFinish?: () => void;
}

/** Split text into clauses on commas, semicolons, em-dashes, and periods (keeping punctuation). */
function splitClauses(text: string): string[] {
  // Split on punctuation boundaries, keeping the delimiter attached to the preceding clause
  const parts = text.split(/(?<=[,;.!?\u2014\u2013])\s+/).filter((s) => s.trim().length > 0);
  return parts.length > 0 ? parts : [text];
}

export function PullQuoteOverlay({ text, visible, vibeBg, onFinish }: PullQuoteOverlayProps) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // For dark vibes, use a deeper shade; for light vibes, use near-black
  const backdropColor = vibeBg && isDarkVibe(vibeBg) ? '#020204' : Colors.base.black;

  const clauses = useMemo(() => splitClauses(text), [text]);
  const clauseAnims = useRef<Animated.Value[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Keep anim array in sync with clause count
  if (clauseAnims.current.length !== clauses.length) {
    clauseAnims.current = clauses.map(() => new Animated.Value(0));
  }

  useEffect(() => {
    if (!visible) {
      backdropOpacity.setValue(0);
      translateY.setValue(0);
      clauseAnims.current.forEach((a) => a.setValue(0));
      return;
    }

    // Reset
    clauseAnims.current.forEach((a) => a.setValue(0));
    translateY.setValue(0);

    const targetBackdropOpacity = vibeBg && isDarkVibe(vibeBg) ? 0.85 : 0.7;
    const wordCount = text.split(/\s+/).length;
    const holdTime = Math.max(1000, wordCount * 200);

    if (reduceMotion) {
      backdropOpacity.setValue(targetBackdropOpacity);
      clauseAnims.current.forEach((a) => a.setValue(1));
      setTimeout(() => {
        backdropOpacity.setValue(0);
        clauseAnims.current.forEach((a) => a.setValue(0));
        onFinish?.();
      }, holdTime);
      return;
    }

    // 1. Fade in backdrop
    // 2. Stagger clause fade-ins (200ms each, 150ms apart)
    const clauseFadeIns = clauseAnims.current.map((anim, i) =>
      Animated.timing(anim, {
        toValue: 1,
        duration: 200,
        delay: i * 150,
        useNativeDriver: true,
      })
    );

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: targetBackdropOpacity,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.stagger(150, clauseFadeIns),
    ]).start(() => {
      setTimeout(() => {
        // Dissolve everything upward
        Animated.parallel([
          ...clauseAnims.current.map((anim) =>
            Animated.timing(anim, {
              toValue: 0,
              duration: 600,
              useNativeDriver: true,
            })
          ),
          Animated.timing(translateY, {
            toValue: -30,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onFinish?.();
        });
      }, holdTime);
    });
  }, [visible, text]);

  if (!visible || !text) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[styles.backdrop, { backgroundColor: backdropColor, opacity: backdropOpacity }]} />
      <Animated.View style={[styles.textContainer, { transform: [{ translateY }] }]}>
        {clauses.map((clause, i) => (
          <Animated.Text
            key={`${i}-${clause.slice(0, 8)}`}
            style={[
              styles.quoteText,
              { opacity: clauseAnims.current[i] ?? 0 },
            ]}
          >
            {clause}{i < clauses.length - 1 ? ' ' : ''}
          </Animated.Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: ZIndex.overlay,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  textContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    maxWidth: '90%',
  },
  quoteText: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 28,
    color: Colors.base.white,
    textAlign: 'center',
    lineHeight: 40,
  },
});

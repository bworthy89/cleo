import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Spacing, isDarkVibe } from '../tokens/design-tokens';

interface PullQuoteOverlayProps {
  text: string;
  visible: boolean;
  vibeBg?: string;
  onFinish?: () => void;
}

export function PullQuoteOverlay({ text, visible, vibeBg, onFinish }: PullQuoteOverlayProps) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // For dark vibes, use a deeper shade; for light vibes, use near-black
  const backdropColor = vibeBg && isDarkVibe(vibeBg) ? '#020204' : Colors.base.black;

  useEffect(() => {
    if (!visible) {
      backdropOpacity.setValue(0);
      textOpacity.setValue(0);
      translateY.setValue(0);
      return;
    }

    // Fade in backdrop and text
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: vibeBg && isDarkVibe(vibeBg) ? 0.85 : 0.7,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 600,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Hold for 1 second, then dissolve upward
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(textOpacity, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
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
      }, 1000);
    });
  }, [visible, text]);

  if (!visible || !text) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[styles.backdrop, { backgroundColor: backdropColor, opacity: backdropOpacity }]} />
      <Animated.Text
        style={[
          styles.quoteText,
          {
            opacity: textOpacity,
            transform: [{ translateY }],
          },
        ]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  quoteText: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 28,
    color: Colors.base.white,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    lineHeight: 40,
  },
});

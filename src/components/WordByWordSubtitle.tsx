import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Animation, Spacing } from '../tokens/design-tokens';

interface WordByWordSubtitleProps {
  text: string;
  visible: boolean;
  accentColor?: string;
  onFinish?: () => void;
}

export function WordByWordSubtitle({ text, visible, accentColor, onFinish }: WordByWordSubtitleProps) {
  const color = accentColor ?? Colors.accent;
  const words = text.split(/\s+/);
  const opacities = useRef(words.map(() => new Animated.Value(0))).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start(() => {
        opacities.forEach((o) => o.setValue(0));
        containerOpacity.setValue(1);
        onFinish?.();
      });
      return;
    }

    containerOpacity.setValue(1);
    opacities.forEach((o) => o.setValue(0));

    const animations = opacities.map((opacity, index) =>
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        delay: index * Animation.wordFade.stagger,
        useNativeDriver: true,
      })
    );

    Animated.parallel(animations).start();
  }, [visible, text]);

  if (!text) return null;

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <View style={styles.wordWrap}>
        {words.map((word, index) => (
          <Animated.Text
            key={`${word}-${index}`}
            style={[styles.word, { opacity: opacities[index] ?? 1, color }]}
          >
            {word}{' '}
          </Animated.Text>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    minHeight: 60,
  },
  wordWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  word: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 18,
    lineHeight: 28,
  },
});

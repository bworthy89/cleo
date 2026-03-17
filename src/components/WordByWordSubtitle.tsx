import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Typography, Colors, Animation } from '../tokens/design-tokens';

interface WordByWordSubtitleProps {
  text: string;
  visible: boolean;
  onFinish?: () => void;
}

export function WordByWordSubtitle({ text, visible, onFinish }: WordByWordSubtitleProps) {
  const words = text.split(/\s+/);
  const opacities = useRef(words.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!visible) {
      // Reset all opacities
      opacities.forEach((o) => o.setValue(0));
      return;
    }

    // Stagger fade-in for each word
    const animations = opacities.map((opacity, index) =>
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        delay: index * Animation.wordFade.stagger,
        useNativeDriver: true,
      })
    );

    Animated.parallel(animations).start(() => {
      // Hold for 1 second after all words visible
      setTimeout(() => {
        // Fade out all words
        Animated.timing(new Animated.Value(1), {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }).start();
        onFinish?.();
      }, 1000);
    });
  }, [visible, text]);

  if (!visible || !text) return null;

  return (
    <View style={styles.container}>
      <View style={styles.wordWrap}>
        {words.map((word, index) => (
          <Animated.Text
            key={`${word}-${index}`}
            style={[styles.word, { opacity: opacities[index] ?? 1 }]}
          >
            {word}{' '}
          </Animated.Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
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
    color: Colors.accent,
    lineHeight: 28,
  },
});

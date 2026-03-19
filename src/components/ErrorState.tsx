import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Typography, Spacing, Opacity } from '../tokens/design-tokens';

interface ErrorStateProps {
  message?: string;
  accentColor: string;
  textColor: string;
  onRetry?: () => void;
}

export function ErrorState({ message, accentColor, textColor, onRetry }: ErrorStateProps) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={[styles.cleoVoice, { color: accentColor }]}>
        {message ?? "Lost my signal for a second there."}
      </Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, { borderColor: textColor, opacity: pressed ? 0.5 : Opacity.muted }]}
          accessibilityLabel="Try again"
          accessibilityRole="button"
        >
          <Text style={[styles.retryText, { color: textColor }]}>TRY AGAIN</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  cleoVoice: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 18,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
  },
  retryText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.5,
  },
});

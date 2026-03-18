import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../tokens/design-tokens';

interface StationCardProps {
  name: string;
  artworkUrl?: string;
  accentColor?: string;
  width?: number;
  onPress: () => void;
}

const DEFAULT_WIDTH = 160;

export function StationCard({ name, artworkUrl, accentColor, width, onPress }: StationCardProps) {
  const cardWidth = width ?? DEFAULT_WIDTH;
  const cardHeight = cardWidth * 1.5;
  const accent = accentColor ?? Colors.accent;

  return (
    <Pressable
      style={({ pressed }) => [
        { width: cardWidth, height: cardHeight },
        styles.card,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
    >
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.placeholder]} />
      )}
      <Text style={styles.label} numberOfLines={2}>
        {name}
      </Text>
      <View style={[styles.accentLine, { backgroundColor: accent }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginRight: Spacing.md,
    overflow: 'hidden',
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  artwork: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  placeholder: {
    backgroundColor: Colors.base.black,
  },
  label: {
    position: 'absolute',
    bottom: Spacing.sm + 2,
    left: Spacing.sm,
    right: Spacing.sm,
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: Colors.base.white,
    textTransform: 'uppercase',
    letterSpacing: 1,
    lineHeight: 15,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  accentLine: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
  },
});

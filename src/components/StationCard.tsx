import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../tokens/design-tokens';

interface StationCardProps {
  name: string;
  artworkUrl?: string;
  onPress: () => void;
}

export function StationCard({ name, artworkUrl, onPress }: StationCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.placeholder]} />
      )}
      <View style={styles.labelContainer}>
        <Text style={styles.label} numberOfLines={2}>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

const CARD_WIDTH = 160;
const CARD_HEIGHT = CARD_WIDTH * 1.5; // 2:3 portrait ratio per PRD

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginRight: Spacing.md,
    borderRadius: 6,
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
  labelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.base.white,
    textTransform: 'uppercase',
    letterSpacing: 1,
    lineHeight: 14,
  },
});

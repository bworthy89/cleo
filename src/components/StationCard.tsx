import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../tokens/design-tokens';

interface StationCardProps {
  name: string;
  artworkUrl?: string;
  onPress: () => void;
}

export function StationCard({ name, artworkUrl, onPress }: StationCardProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.placeholder]} />
      )}
      <View style={styles.labelContainer}>
        <Text style={styles.label} numberOfLines={1}>
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
    overflow: 'hidden',
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
    padding: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: Colors.base.white,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

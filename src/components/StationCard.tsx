import { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing, Tracking, Shadow } from '../tokens/design-tokens';

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
  const shimmerAnim = useRef(new Animated.Value(0.3)).current;

  // Shimmer animation when no artwork
  useEffect(() => {
    if (artworkUrl) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 0.6, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [artworkUrl]);

  return (
    <Pressable
      style={({ pressed }) => [
        { width: cardWidth, height: cardHeight },
        styles.card,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      accessibilityLabel={`Station: ${name}`}
      accessibilityRole="button"
    >
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={styles.artwork} />
      ) : (
        <Animated.View style={[styles.artwork, styles.placeholder, { opacity: shimmerAnim }]} />
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
    letterSpacing: Tracking.normal,
    lineHeight: 15,
    textShadowColor: `rgba(0,0,0,${Shadow.text.opacity})`,
    textShadowOffset: Shadow.text.offset,
    textShadowRadius: Shadow.text.radius,
  },
  accentLine: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
  },
});

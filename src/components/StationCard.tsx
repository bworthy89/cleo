import { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppActive } from '../hooks/useAppActive';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Surface, TextColors, Typography, Spacing, Radius, Shadow } from '../tokens/design-tokens';

interface StationCardProps {
  name: string;
  artworkUrl?: string;
  accentColor?: string;
  width?: number;
  onPress: () => void;
}

const DEFAULT_WIDTH = 140;

export function StationCard({ name, artworkUrl, accentColor, width, onPress }: StationCardProps) {
  const cardWidth = width ?? DEFAULT_WIDTH;
  const cardHeight = Math.round(cardWidth * 1.43);
  const shimmerAnim = useRef(new Animated.Value(0.3)).current;
  const active = useAppActive();

  // Shimmer animation when no artwork — pauses when backgrounded
  useEffect(() => {
    if (artworkUrl || !active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 0.6, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [artworkUrl, active]);

  return (
    <Pressable
      style={({ pressed }) => [
        { width: cardWidth, height: cardHeight, borderRadius: Radius.sm },
        styles.card,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      accessibilityLabel={`Station: ${name}`}
      accessibilityRole="button"
    >
      {artworkUrl ? (
        <Image source={{ uri: artworkUrl }} style={[styles.artwork, { borderRadius: Radius.sm }]} />
      ) : (
        <Animated.View
          style={[
            styles.artwork,
            { borderRadius: Radius.sm, backgroundColor: Surface.high, opacity: shimmerAnim },
          ]}
        />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)']}
        style={[styles.gradient, { borderRadius: Radius.sm }]}
      />
      <Text style={styles.label} numberOfLines={2}>
        {name}
      </Text>
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
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  label: {
    position: 'absolute',
    bottom: Spacing.sm + 2,
    left: Spacing.sm,
    right: Spacing.sm,
    fontFamily: Typography.display.family,
    fontSize: 14,
    color: TextColors.primary,
    lineHeight: 18,
    textShadowColor: `rgba(0,0,0,${Shadow.text.opacity})`,
    textShadowOffset: Shadow.text.offset,
    textShadowRadius: Shadow.text.radius,
  },
});

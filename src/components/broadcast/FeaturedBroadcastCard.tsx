import { View, Text, Pressable, Image } from 'react-native';
import { Colors, Surface, TextColors, Spacing, Typography, Radius } from '../../tokens/design-tokens';
import type { FeaturedBroadcast } from '../../engines/BroadcastCurationClient';

interface Props {
  broadcast: FeaturedBroadcast;
  onPress: () => void;
}

export function FeaturedBroadcastCard({ broadcast, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${broadcast.title}`}
      style={{
        backgroundColor: Surface.container,
        borderLeftWidth: 2,
        borderLeftColor: Colors.accent,
        padding: Spacing.md,
        borderRadius: Radius.sm,
        marginBottom: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {broadcast.artworkUrl && (
        <Image
          source={{ uri: broadcast.artworkUrl }}
          style={{ width: 64, height: 64, borderRadius: Radius.sm, marginRight: Spacing.md }}
        />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 18 }}>
          {broadcast.title}
        </Text>
        <Text style={{ color: TextColors.secondary, marginTop: 2 }} numberOfLines={2}>
          {broadcast.description}
        </Text>
        <Text style={{
          color: Colors.accent,
          fontFamily: Typography.mono.family,
          fontSize: 10,
          letterSpacing: 2,
          marginTop: Spacing.xs,
        }}>
          {broadcast.vibe.toUpperCase()} · {broadcast.length.toUpperCase()}
        </Text>
      </View>
    </Pressable>
  );
}

import { View, Text, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Surface, TextColors, Spacing, Typography, Radius } from '../../tokens/design-tokens';
import type { FeaturedBroadcast } from '../../engines/BroadcastCurationClient';

interface Props {
  broadcast: FeaturedBroadcast;
  onPress: () => void;
}

function freshness(createdAt: number): string {
  const ms = Date.now() - createdAt;
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return 'Earlier';
}

export function FeaturedBroadcastCard({ broadcast, onPress }: Props) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${broadcast.title}`}
      style={({ pressed }) => ({
        backgroundColor: Surface.container,
        borderLeftWidth: 2,
        borderLeftColor: Colors.accent,
        padding: Spacing.md,
        borderRadius: Radius.sm,
        marginBottom: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.75 : 1,
      })}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs, gap: Spacing.sm }}>
          <Text style={{
            color: Colors.accent,
            fontFamily: Typography.mono.family,
            fontSize: 10,
            letterSpacing: 2,
          }}>
            {broadcast.vibe.toUpperCase()} · {broadcast.length.toUpperCase()}
          </Text>
          <Text style={{ color: TextColors.outline, fontSize: 10 }}>·</Text>
          <Text style={{
            color: TextColors.outline,
            fontFamily: Typography.mono.family,
            fontSize: 10,
            letterSpacing: 1.5,
          }}>
            {freshness(broadcast.createdAt).toUpperCase()}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={TextColors.outline} style={{ marginLeft: Spacing.sm }} />
    </Pressable>
  );
}

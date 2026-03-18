import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Typography, Spacing, Tracking, Opacity, withAlpha } from '../tokens/design-tokens';
import type { Vibe } from '../cleo/fallbacks';

interface VibeSelectorProps {
  selected: Vibe;
  onSelect: (vibe: Vibe) => void;
}

const VIBES: { id: Vibe; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'morning', label: 'Morning', icon: 'sunny-outline' },
  { id: 'chill', label: 'Chill', icon: 'water-outline' },
  { id: 'workout', label: 'Workout', icon: 'flash-outline' },
  { id: 'lateNight', label: 'Late Night', icon: 'moon-outline' },
  { id: 'party', label: 'Party', icon: 'musical-notes-outline' },
];

const CARD_GAP = Spacing.md;
const CARD_COUNT = VIBES.length;
const HORIZONTAL_PADDING = Spacing.lg * 2;

export function VibeSelector({ selected, onSelect }: VibeSelectorProps) {
  const { width: screenWidth } = useWindowDimensions();
  const cardSize = Math.floor(
    (screenWidth - HORIZONTAL_PADDING - CARD_GAP * (CARD_COUNT - 1)) / CARD_COUNT
  );

  const handleSelect = (id: Vibe) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSelect(id);
  };

  return (
    <View style={styles.container}>
      {VIBES.map((vibe) => {
        const isSelected = selected === vibe.id;
        const theme = Colors.vibe[vibe.id];
        return (
          <Pressable
            key={vibe.id}
            style={[
              styles.card,
              {
                width: cardSize,
                height: cardSize,
                backgroundColor: theme.bg,
                borderColor: isSelected ? theme.accent : withAlpha(theme.text, 0.08),
                opacity: isSelected ? 1 : Opacity.secondary,
              },
            ]}
            onPress={() => handleSelect(vibe.id)}
          >
            <Ionicons
              name={vibe.icon}
              size={20}
              color={isSelected ? theme.accent : withAlpha(theme.text, 0.4)}
              style={styles.icon}
            />
            <Text style={[styles.label, { color: theme.text }]}>{vibe.label}</Text>
            {isSelected && <View style={[styles.accentDot, { backgroundColor: theme.accent }]} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: CARD_GAP,
    paddingHorizontal: Spacing.lg,
  },
  card: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  icon: {
    marginBottom: Spacing.sm,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: Tracking.normal,
    textTransform: 'uppercase',
  },
  accentDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: Spacing.sm,
  },
});

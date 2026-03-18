import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  { id: 'feelGood', label: 'Feel Good', icon: 'heart-outline' },
  { id: 'elevated', label: 'Elevated', icon: 'diamond-outline' },
  { id: 'throwback', label: 'Throwback', icon: 'time-outline' },
  { id: 'melancholy', label: 'Melancholy', icon: 'rainy-outline' },
  { id: 'sunday', label: 'Sunday', icon: 'cafe-outline' },
  { id: 'lateNight', label: 'Late Night', icon: 'moon-outline' },
  { id: 'focus', label: 'Focus', icon: 'eye-outline' },
  { id: 'workout', label: 'Workout', icon: 'flash-outline' },
  { id: 'party', label: 'Party', icon: 'musical-notes-outline' },
  { id: 'general', label: 'General', icon: 'radio-outline' },
];

const CARD_SIZE = 72;
const CARD_GAP = Spacing.md;

export function VibeSelector({ selected, onSelect }: VibeSelectorProps) {
  const handleSelect = (id: Vibe) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSelect(id);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {VIBES.map((vibe) => {
        const isSelected = selected === vibe.id;
        const theme = Colors.vibe[vibe.id];
        return (
          <Pressable
            key={vibe.id}
            style={[
              styles.card,
              {
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: CARD_GAP,
    paddingHorizontal: Spacing.lg,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
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

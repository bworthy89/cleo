import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../tokens/design-tokens';
import type { Vibe } from '../cleo/fallbacks';

interface VibeSelectorProps {
  selected: Vibe;
  onSelect: (vibe: Vibe) => void;
}

const VIBES: { id: Vibe; label: string; emoji: string }[] = [
  { id: 'morning', label: 'Morning', emoji: '☀️' },
  { id: 'chill', label: 'Chill', emoji: '🌊' },
  { id: 'workout', label: 'Workout', emoji: '🔥' },
  { id: 'lateNight', label: 'Late Night', emoji: '🌙' },
  { id: 'party', label: 'Party', emoji: '🎉' },
];

export function VibeSelector({ selected, onSelect }: VibeSelectorProps) {
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
              { backgroundColor: theme.bg, borderColor: isSelected ? theme.accent : 'transparent' },
            ]}
            onPress={() => onSelect(vibe.id)}
          >
            <Text style={styles.emoji}>{vibe.emoji}</Text>
            <Text style={[styles.label, { color: theme.text }]}>{vibe.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  card: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 4,
  },
  emoji: {
    fontSize: 28,
    marginBottom: Spacing.xs,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});

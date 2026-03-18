import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Typography, Spacing, Opacity } from '../tokens/design-tokens';
import type { Vibe } from '../cleo/fallbacks';

interface VibeSelectorProps {
  selected: Vibe;
  onSelect: (vibe: Vibe) => void;
}

const VIBES: { id: Vibe; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'chill', label: 'Chill' },
  { id: 'workout', label: 'Workout' },
  { id: 'lateNight', label: 'Late Night' },
  { id: 'party', label: 'Party' },
];

export function VibeSelector({ selected, onSelect }: VibeSelectorProps) {
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
                backgroundColor: theme.bg,
                borderColor: isSelected ? theme.accent : 'transparent',
                opacity: isSelected ? 1 : Opacity.secondary,
              },
            ]}
            onPress={() => handleSelect(vibe.id)}
          >
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
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});

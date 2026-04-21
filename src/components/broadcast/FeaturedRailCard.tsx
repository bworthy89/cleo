import { Pressable, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { SleeveArt } from '../crate/SleeveArt';
import type { FeaturedBroadcast } from '../../engines/BroadcastCurationClient';

interface Props {
  broadcast: FeaturedBroadcast;
  onPress: () => void;
}

function durationFor(broadcast: FeaturedBroadcast): string {
  const tracks = broadcast.manifest.tracks ?? [];
  const total = tracks.reduce((acc, t) => acc + (t.duration ?? 180), 0);
  const m = Math.round(total / 60);
  return `${tracks.length} TRACKS · ${m} MIN`;
}

/** Compact rail card — used for the scrolling row below the TONIGHT hero. */
export function FeaturedRailCard({ broadcast, onPress }: Props) {
  const artwork = broadcast.manifest.tracks?.[0]?.artworkUrl ?? null;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Play ${broadcast.title}`}
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.7 }]}
    >
      <SleeveArt title={broadcast.title} artist="ONAY" size={150} artworkUrl={artwork} />
      <Text style={styles.title} numberOfLines={2}>{broadcast.title.toUpperCase()}</Text>
      <Text style={styles.meta}>{durationFor(broadcast)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 150,
    marginRight: Space.s12,
  },
  title: {
    marginTop: 8,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s13,
    color: AM.ink,
    letterSpacing: 0.5,
    lineHeight: 16,
  },
  meta: {
    marginTop: 4,
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 1.5,
  },
});

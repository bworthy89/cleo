import { StyleSheet, Text } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { HairlineRow } from '../HairlineRow';
import type { FeaturedBroadcast } from '../../engines/BroadcastCurationClient';

interface Props {
  broadcast: FeaturedBroadcast;
  onPress: () => void;
  /** Index in the featured list, starting at 1. Used for the T01/T02 reel. */
  index?: number;
}

function durationFor(broadcast: FeaturedBroadcast): string {
  const tracks = broadcast.manifest.tracks ?? [];
  const total = tracks.reduce((acc, t) => acc + (t.duration ?? 180), 0);
  const m = Math.round(total / 60);
  return `${m}:00`;
}

function padReel(i: number): string {
  return `T${i.toString().padStart(2, '0')}`;
}

export function FeaturedBroadcastCard({ broadcast, onPress, index = 1 }: Props) {
  return (
    <HairlineRow
      topRule
      verticalPadding={Space.s14}
      leading={<Text style={styles.reel}>{padReel(index)}</Text>}
      leadingWidth={32}
      value={<Text style={styles.title} numberOfLines={1}>{broadcast.title}</Text>}
      trailing={<Text style={styles.duration}>{durationFor(broadcast)}</Text>}
      onPress={onPress}
      accessibilityLabel={`Play ${broadcast.title}`}
    />
  );
}

const styles = StyleSheet.create({
  reel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.amberDim,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.ink,
  },
  duration: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.inkDim,
  },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { SleeveArt } from '../crate/SleeveArt';
import { Halftone } from '../crate/Halftone';
import type { FeaturedBroadcast } from '../../engines/BroadcastCurationClient';

interface Props {
  broadcast: FeaturedBroadcast;
  onPress: () => void;
  /** Badge shown above the broadside label (e.g. "TONIGHT", "NEW"). */
  stamp?: string;
  /** Italic tagline shown under the title. */
  tagline?: string;
  /** When set, replaces the default "TONIGHT" stamp and bumps letter-spacing.
   *  Used by the twin-slot home layout to distinguish morning vs evening. */
  slotLabel?: string;
}

function durationFor(broadcast: FeaturedBroadcast): string {
  const tracks = broadcast.manifest.tracks ?? [];
  const total = tracks.reduce((acc, t) => acc + (t.duration ?? 180), 0);
  const m = Math.round(total / 60);
  return `${tracks.length} tracks · ${m} min`;
}

/**
 * Featured hero card — oxblood TONIGHT ON ONAY plate + bordered sleeve
 * block + "DROP THE NEEDLE" play strip. Mirrors FeaturedHero from the
 * crate-digger design.
 */
export function FeaturedBroadcastCard({ broadcast, onPress, stamp = 'TONIGHT', tagline, slotLabel }: Props) {
  const displayStamp = slotLabel ?? stamp;
  const tag = tagline ?? broadcast.description ?? '';
  const firstTrack = broadcast.manifest.tracks?.[0];
  const artwork = firstTrack?.artworkUrl ?? null;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress();
  };

  return (
    <View style={styles.wrap}>
      {/* Broadside label stripe — oxblood with halftone */}
      <View style={styles.plate}>
        <Halftone opacity={0.3} />
        <View style={styles.plateRow}>
          <Text style={styles.plateLabel}>TONIGHT ON ONAY</Text>
          <Text style={styles.plateStamp}>{displayStamp.toUpperCase()}</Text>
        </View>
      </View>

      {/* Sleeve + meta */}
      <View style={styles.card}>
        <View style={styles.sleeveWrap}>
          <SleeveArt title={broadcast.title} artist="ONAY" size={124} artworkUrl={artwork} />
          <View
            style={styles.bakedStamp}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.bakedText}>BAKED</Text>
          </View>
        </View>
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>{broadcast.title.toUpperCase()}</Text>
          {tag ? (
            <Text style={styles.tagline} numberOfLines={3}>{tag}</Text>
          ) : null}
          <Text style={styles.duration}>{durationFor(broadcast)}</Text>
        </View>
      </View>

      {/* Drop the needle play strip */}
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Play ${broadcast.title}`}
        style={({ pressed }) => [styles.play, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.playLabel}>▶ DROP THE NEEDLE</Text>
        <Text style={styles.playSub}>START SIDE A</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Space.s14,
  },
  plate: {
    backgroundColor: AM.oxblood,
    paddingVertical: 6,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  plateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  plateLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.cream,
    letterSpacing: 3,
  },
  plateStamp: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.cream,
    letterSpacing: 2,
    opacity: 0.7,
  },

  card: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: AM.oxblood,
    padding: 14,
    flexDirection: 'row',
    gap: 14,
  },
  sleeveWrap: {
    position: 'relative',
  },
  bakedStamp: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    backgroundColor: AM.bg,
    borderWidth: 1,
    borderColor: AM.oxblood,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bakedText: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.oxblood,
    letterSpacing: 2,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
    color: AM.ink,
    letterSpacing: 0.3,
    lineHeight: 26,
  },
  tagline: {
    marginTop: 6,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s12,
    color: AM.inkMid,
    lineHeight: TypeScale.s12 * 1.45,
  },
  duration: {
    marginTop: 10,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.amberDim,
    letterSpacing: 2,
  },

  play: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: AM.oxblood,
    backgroundColor: AM.oxblood,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playLabel: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.cream,
    letterSpacing: 2,
    lineHeight: 19,
  },
  playSub: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.cream,
    letterSpacing: 2,
    opacity: 0.75,
  },
});

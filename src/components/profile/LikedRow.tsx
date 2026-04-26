import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import type { LikedTrack } from '../../services/LikedTracksService.types';

interface Props {
  track: LikedTrack;
  onUnsave: (track: LikedTrack) => void;
}

function formatSavedDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

export function LikedRow({ track, onUnsave }: Props) {
  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onUnsave(track);
  };

  const albumLine = track.albumTitle
    ? `${track.artistName} · ${track.albumTitle.toUpperCase()}`
    : track.artistName;

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={`Liked: ${track.title} by ${track.artistName}, saved ${formatSavedDate(track.savedAt)}`}
    >
      {track.artworkUrl ? (
        <Image
          source={{ uri: track.artworkUrl }}
          style={styles.art}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <Text style={styles.artFallbackText}>ONAY</Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {track.title.toUpperCase()}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {albumLine}
        </Text>
      </View>

      <View style={styles.right}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from Liked`}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => [styles.heartPressable, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.heart}>♥</Text>
        </Pressable>
        <Text style={styles.date}>{formatSavedDate(track.savedAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.s10,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  art: {
    width: 40,
    height: 40,
    backgroundColor: AM.bgDeep,
  },
  artFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artFallbackText: {
    color: AM.inkDim,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
  },
  body: {
    flex: 1,
    marginLeft: Space.s12,
    marginRight: Space.s8,
  },
  title: {
    color: AM.ink,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    lineHeight: TypeScale.s14 * 1.2,
    letterSpacing: 0.5,
  },
  meta: {
    color: AM.inkMid,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s12,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  heartPressable: {
    width: 44,
    height: 28,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  heart: {
    color: AM.amber,
    fontSize: TypeScale.s20,
  },
  date: {
    color: AM.inkDim,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 1,
    marginTop: 2,
  },
});

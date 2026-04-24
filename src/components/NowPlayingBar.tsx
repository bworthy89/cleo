import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../tokens/design-tokens';
import { OnAirIndicator } from './OnAirIndicator';
import { useAppActive } from '../hooks/useAppActive';
import { broadcastPlayer } from '../engines/BroadcastPlayer.singleton';
import type { PlayerStatus } from '../engines/BroadcastPlayer.types';

const ACTIVE_STATES = new Set(['loading', 'playing_segment', 'playing_track', 'paused']);

/**
 * Persistent bar that appears above the tab bar whenever a broadcast is
 * playing and the player screen is not currently on top. Tapping it pushes
 * the player route so the user can get back to the listening surface. This
 * is the re-entry path for anyone who swipes back or navigates to another
 * tab while a broadcast is in flight.
 */
export function NowPlayingBar() {
  const router = useRouter();
  const pathname = usePathname();
  const appActive = useAppActive();
  const [status, setStatus] = useState<PlayerStatus>(() => broadcastPlayer.getStatus());

  useEffect(() => {
    if (!appActive) return;
    const tick = () => setStatus(broadcastPlayer.getStatus());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [appActive]);

  const active = ACTIVE_STATES.has(status.state);
  const onPlayer = pathname.endsWith('/player');

  if (!active || onPlayer) return null;

  const track = status.currentTrack;
  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push('/(main)/(broadcast)/player');
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Return to player. ${track ? `${track.title} by ${track.artistName}` : 'Broadcast in progress'}`}
      style={({ pressed }) => [styles.root, pressed && { opacity: 0.6 }]}
    >
      <OnAirIndicator active={status.state !== 'paused'} />
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {track?.title ?? (status.state === 'loading' ? 'tuning in…' : 'now playing')}
        </Text>
        {track?.artistName ? (
          <Text style={styles.artist} numberOfLines={1}>{track.artistName}</Text>
        ) : null}
      </View>
      <Text style={styles.chev}>{'↑'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s14,
    paddingHorizontal: Space.s22,
    paddingVertical: Space.s10,
    backgroundColor: AM.bg,
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s15,
    color: AM.ink,
    letterSpacing: 0.3,
    lineHeight: 18,
  },
  artist: {
    marginTop: 2,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s11,
    color: AM.inkMid,
  },
  chev: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.amberDim,
    lineHeight: 22,
  },
});

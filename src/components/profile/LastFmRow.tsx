import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import type { LastFmStatus } from '../../hooks/useLastFmIntegration';

interface Props {
  status: LastFmStatus;
  username: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function LastFmRow({ status, username, onConnect, onDisconnect }: Props) {
  const handlePrimary = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (status === 'connected') {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  const trailingLabel =
    status === 'connected' ? 'DISCONNECT' :
    status === 'needs-reconnect' ? 'RECONNECT' : 'CONNECT';

  const trailingColor =
    status === 'needs-reconnect' ? AM.amber :
    status === 'connected' ? AM.inkDim : AM.ink;

  return (
    <Pressable
      onPress={handlePrimary}
      accessibilityRole="button"
      accessibilityLabel={
        status === 'connected'
          ? `Last.fm connected as ${username ?? 'unknown'}. Tap to disconnect.`
          : status === 'needs-reconnect'
          ? `Last.fm needs reconnect. Tap to re-authorize.`
          : `Connect Last.fm to start scrobbling.`
      }
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.left}>
        {status === 'needs-reconnect' && <View style={styles.dot} />}
        <Text style={styles.kicker}>LAST.FM</Text>
      </View>

      <View style={styles.body}>
        {status === 'connected' || status === 'needs-reconnect' ? (
          <Text style={styles.username} numberOfLines={1}>
            connected as @{username ?? '—'}
          </Text>
        ) : (
          <Text style={styles.tagline} numberOfLines={1}>
            scrobble what ONAY plays
          </Text>
        )}
      </View>

      <Text style={[styles.trailing, { color: trailingColor }]}>{trailingLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.s12,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: AM.amber,
    marginRight: Space.s6,
  },
  kicker: {
    color: AM.amberDim,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
  },
  body: {
    flex: 1,
    marginHorizontal: Space.s12,
  },
  username: {
    color: AM.ink,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
  },
  tagline: {
    color: AM.inkMid,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
  },
  trailing: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s11,
    letterSpacing: 1.2,
  },
});

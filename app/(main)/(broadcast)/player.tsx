import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Surface, TextColors, Typography, Spacing, Radius } from '../../../src/tokens/design-tokens';
import { broadcastPlayer } from '../../../src/engines/BroadcastPlayer.singleton';
import type { PlayerStatus } from '../../../src/engines/BroadcastPlayer.types';
import { useAppActive } from '../../../src/hooks/useAppActive';

const monoLabel = {
  color: TextColors.secondary,
  fontFamily: Typography.mono.family,
  fontSize: 10,
  letterSpacing: 2.5,
};

function describeNowPlaying(status: PlayerStatus): string {
  if (status.state === 'idle') return 'No broadcast in flight.';
  if (status.state === 'loading') return 'Tuning in\u2026';
  if (status.state === 'ended') return 'Broadcast ended.';
  if (status.state === 'paused') return 'Paused.';
  const np = status.nowPlaying;
  if (np && 'segmentKind' in np) {
    return np.segmentKind === 'cold_open'
      ? 'ONAY \u2014 cold open'
      : np.segmentKind === 'sign_off'
        ? 'ONAY \u2014 sign off'
        : 'ONAY \u2014 transition';
  }
  if (np && 'trackId' in np) return `Track ${status.currentTrackIndex + 1}`;
  return status.state;
}

export default function BroadcastPlayerScreen() {
  const router = useRouter();
  const active = useAppActive();
  const [status, setStatus] = useState<PlayerStatus>(broadcastPlayer.getStatus());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => setStatus(broadcastPlayer.getStatus()), 500);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [active]);

  const handleEnd = async () => {
    await broadcastPlayer.end().catch(() => {});
    router.back();
  };

  const progressPct = Math.round(status.progress * 100);
  const paused = status.state === 'paused';
  const ended = status.state === 'ended' || status.state === 'idle';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.base.black }}
      contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.xxl }}
    >
      <Text style={{ ...monoLabel, marginBottom: Spacing.sm }}>NOW PLAYING</Text>
      <View style={{ height: 2, width: 40, backgroundColor: Colors.accent, marginBottom: Spacing.md }} />

      <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 28, marginBottom: Spacing.md }}>
        {describeNowPlaying(status)}
      </Text>

      <View style={{
        backgroundColor: Surface.container,
        borderLeftWidth: 2,
        borderLeftColor: Colors.accent,
        padding: Spacing.md,
        borderRadius: Radius.sm,
        marginBottom: Spacing.lg,
      }}>
        <Text style={{ ...monoLabel, marginBottom: Spacing.xs }}>PROGRESS</Text>
        <View style={{ height: 4, backgroundColor: Surface.high, borderRadius: 2, overflow: 'hidden', marginBottom: Spacing.sm }}>
          <View style={{ height: '100%', width: `${progressPct}%`, backgroundColor: Colors.accent }} />
        </View>
        <Text style={{ color: TextColors.secondary, fontSize: 12 }}>
          {progressPct}% \u2014 track {status.currentTrackIndex + 1} \u00B7 segment {status.currentSegmentIndex >= 0 ? status.currentSegmentIndex + 1 : '\u2013'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        {!paused ? (
          <Pressable
            onPress={() => { broadcastPlayer.pause().catch(() => {}); }}
            accessibilityRole="button"
            accessibilityLabel="Pause broadcast"
            disabled={ended}
            style={{ flex: 1, padding: Spacing.md, backgroundColor: Surface.container, borderRadius: Radius.sm }}
          >
            <Text style={{
              color: ended ? TextColors.outline : TextColors.primary,
              fontFamily: Typography.mono.family,
              textAlign: 'center',
              letterSpacing: 2,
            }}>
              PAUSE
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => { broadcastPlayer.resume().catch(() => {}); }}
            accessibilityRole="button"
            accessibilityLabel="Resume broadcast"
            style={{ flex: 1, padding: Spacing.md, backgroundColor: Colors.accent, borderRadius: Radius.sm }}
          >
            <Text style={{
              color: Colors.base.black,
              fontFamily: Typography.mono.family,
              textAlign: 'center',
              letterSpacing: 2,
            }}>
              RESUME
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={handleEnd}
          accessibilityRole="button"
          accessibilityLabel="End broadcast"
          style={{ flex: 1, padding: Spacing.md, backgroundColor: Surface.container, borderRadius: Radius.sm }}
        >
          <Text style={{
            color: Colors.error,
            fontFamily: Typography.mono.family,
            textAlign: 'center',
            letterSpacing: 2,
          }}>
            END
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

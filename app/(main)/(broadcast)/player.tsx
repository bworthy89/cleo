import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Surface, TextColors, Typography, Spacing, Radius, getVibeAccent } from '../../../src/tokens/design-tokens';
import { broadcastPlayer } from '../../../src/engines/BroadcastPlayer.singleton';
import type { PlayerStatus } from '../../../src/engines/BroadcastPlayer.types';
import { useAppActive } from '../../../src/hooks/useAppActive';

const monoLabel = {
  fontFamily: Typography.mono.family,
  fontSize: 10,
  letterSpacing: 2.5,
};

function segmentLabel(status: PlayerStatus): string | null {
  const np = status.nowPlaying;
  if (!np || !('segmentKind' in np)) return null;
  return np.segmentKind === 'cold_open'
    ? 'ONAY \u2014 cold open'
    : np.segmentKind === 'sign_off'
      ? 'ONAY \u2014 sign off'
      : 'ONAY \u2014 transition';
}

function stateCaption(status: PlayerStatus): string {
  if (status.state === 'idle') return 'No broadcast in flight';
  if (status.state === 'loading') return 'Tuning in\u2026';
  if (status.state === 'ended') return 'Broadcast ended';
  if (status.state === 'paused') return 'Paused';
  return 'Live';
}

function PulsingOrb({ active, accent }: { active: boolean; accent: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, scale]);
  return (
    <Animated.View
      style={{
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: accent,
        transform: [{ scale }],
      }}
    />
  );
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
  const accent = status.vibe ? getVibeAccent(status.vibe) : Colors.accent;
  const track = status.currentTrack;
  const segment = segmentLabel(status);
  const live = status.state === 'playing_track' || status.state === 'playing_segment';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.base.black }}
      contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.xxl }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md }}>
        <PulsingOrb active={live} accent={accent} />
        <Text style={{ ...monoLabel, color: accent }}>
          {stateCaption(status).toUpperCase()}
        </Text>
        {status.vibe && (
          <>
            <Text style={{ ...monoLabel, color: TextColors.outline }}>\u00B7</Text>
            <Text style={{ ...monoLabel, color: TextColors.secondary }}>
              {status.vibe.toUpperCase()}
            </Text>
          </>
        )}
      </View>

      {track?.artworkUrl ? (
        <Image
          source={{ uri: track.artworkUrl }}
          style={{
            width: '100%',
            aspectRatio: 1,
            borderRadius: Radius.md,
            marginBottom: Spacing.lg,
            backgroundColor: Surface.container,
          }}
          resizeMode="cover"
        />
      ) : (
        <View style={{
          width: '100%',
          aspectRatio: 1,
          borderRadius: Radius.md,
          marginBottom: Spacing.lg,
          backgroundColor: Surface.container,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Text style={{ ...monoLabel, color: accent }}>ONAY</Text>
        </View>
      )}

      {segment ? (
        <>
          <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 22, marginBottom: 2 }}>
            {segment}
          </Text>
          <Text style={{ color: TextColors.secondary, fontFamily: Typography.cleoVoice.family, fontStyle: 'italic', fontSize: 15 }}>
            Between the tracks\u2026
          </Text>
        </>
      ) : track ? (
        <>
          <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 24, marginBottom: 2 }} numberOfLines={2}>
            {track.title}
          </Text>
          <Text style={{ color: TextColors.secondary, fontSize: 15 }} numberOfLines={1}>
            {track.artistName}
          </Text>
        </>
      ) : (
        <Text style={{ color: TextColors.secondary, fontFamily: Typography.display.family, fontSize: 22 }}>
          {stateCaption(status)}
        </Text>
      )}

      <View style={{ marginTop: Spacing.lg, marginBottom: Spacing.lg }}>
        <Text style={{ ...monoLabel, color: TextColors.secondary, marginBottom: Spacing.xs }}>
          TRACK {Math.max(status.currentTrackIndex, 0) + 1} OF {Math.max(status.totalTracks, 1)}
        </Text>
        <View style={{ height: 4, backgroundColor: Surface.high, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${progressPct}%`, backgroundColor: accent }} />
        </View>
        <Text style={{ color: TextColors.outline, fontSize: 11, marginTop: Spacing.xs }}>
          {progressPct}% of the broadcast
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
            style={{ flex: 1, padding: Spacing.md, backgroundColor: accent, borderRadius: Radius.sm }}
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

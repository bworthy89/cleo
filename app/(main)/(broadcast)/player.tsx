import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Surface, TextColors, Typography, Spacing, Radius, getVibeAccent } from '../../../src/tokens/design-tokens';
import { broadcastPlayer } from '../../../src/engines/BroadcastPlayer.singleton';
import type { PlayerStatus } from '../../../src/engines/BroadcastPlayer.types';
import { useAppActive } from '../../../src/hooks/useAppActive';

const TUNING_STAGES = [
  'Curating your set…',
  'Writing your cold open…',
  'Finding ONAY\u2019s voice…',
  'Almost there.',
];

function useTuningStage(active: boolean): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) { setIdx(0); return; }
    let i = 0;
    setIdx(0);
    const t = setInterval(() => {
      i = Math.min(i + 1, TUNING_STAGES.length - 1);
      setIdx(i);
    }, 1800);
    return () => clearInterval(t);
  }, [active]);
  return TUNING_STAGES[idx];
}

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
  const appActive = useAppActive();
  useEffect(() => {
    if (!active || !appActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, appActive, scale]);
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

/** Large pulsing ring shown while the player is spinning up a broadcast. */
function TuningInCanvas({ accent }: { accent: string }) {
  const active = useAppActive();
  const ring = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1.1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0.7, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, ring]);
  return (
    <View style={{
      width: '100%',
      aspectRatio: 1,
      borderRadius: Radius.md,
      marginBottom: Spacing.lg,
      backgroundColor: Surface.container,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Animated.View style={{
        width: 180, height: 180, borderRadius: 90,
        borderWidth: 2, borderColor: accent,
        transform: [{ scale: ring }],
      }} />
      <Text style={{
        position: 'absolute',
        color: accent,
        fontFamily: Typography.mono.family,
        fontSize: 11,
        letterSpacing: 4,
      }}>
        TUNING IN
      </Text>
    </View>
  );
}

export default function BroadcastPlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useAppActive();
  const [status, setStatus] = useState<PlayerStatus>(broadcastPlayer.getStatus());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warmingNow = status.state === 'loading' || (status.state === 'idle' && status.broadcastId === null && status.totalTracks === 0);
  const tuningStage = useTuningStage(warmingNow);

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
  const warming = warmingNow;
  const accent = status.vibe ? getVibeAccent(status.vibe) : Colors.accent;
  const track = status.currentTrack;
  const segment = segmentLabel(status);
  const live = status.state === 'playing_track' || status.state === 'playing_segment';
  const trackNumber = Math.max(status.currentTrackIndex, 0) + 1;
  const totalTracks = Math.max(status.totalTracks, 1);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.base.black }}
      contentContainerStyle={{
        paddingHorizontal: Spacing.lg,
        paddingTop: insets.top + Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xxl,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 }}>
          <PulsingOrb active={live} accent={accent} />
          <Text style={{ ...monoLabel, color: accent }}>
            {stateCaption(status).toUpperCase()}
          </Text>
          {status.vibe && (
            <>
              <Text style={{ ...monoLabel, color: TextColors.outline }}>·</Text>
              <Text style={{ ...monoLabel, color: TextColors.secondary }}>
                {status.vibe.toUpperCase()}
              </Text>
            </>
          )}
        </View>
        <Pressable
          onPress={handleEnd}
          accessibilityRole="button"
          accessibilityLabel="End broadcast"
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="close" size={22} color={TextColors.secondary} />
        </Pressable>
      </View>

      {warming ? (
        <TuningInCanvas accent={accent} />
      ) : track?.artworkUrl ? (
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

      {warming ? (
        <>
          <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 24, marginBottom: 2 }}>
            Tuning in
          </Text>
          <Text style={{ color: TextColors.secondary, fontFamily: Typography.cleoVoice.family, fontStyle: 'italic', fontSize: 15 }}>
            {tuningStage}
          </Text>
        </>
      ) : segment ? (
        <>
          <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 22, marginBottom: 2 }}>
            {segment}
          </Text>
          <Text style={{ color: TextColors.secondary, fontFamily: Typography.cleoVoice.family, fontStyle: 'italic', fontSize: 15 }}>
            Between the tracks…
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
        <Text style={{
          color: TextColors.primary,
          fontFamily: Typography.mono.family,
          fontSize: 12,
          letterSpacing: 2.5,
          marginBottom: Spacing.sm,
        }}>
          TRACK {trackNumber} OF {totalTracks}
        </Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: totalTracks }).map((_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                backgroundColor: i < trackNumber ? accent : Surface.high,
                opacity: i < trackNumber - 1 ? 0.5 : 1,
              }}
            />
          ))}
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
            style={({ pressed }) => ({
              flex: 1,
              padding: Spacing.md,
              backgroundColor: Surface.container,
              borderRadius: Radius.sm,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: Spacing.sm,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Ionicons name="pause" size={18} color={ended ? TextColors.outline : TextColors.primary} />
            <Text style={{
              color: ended ? TextColors.outline : TextColors.primary,
              fontFamily: Typography.mono.family,
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
            style={({ pressed }) => ({
              flex: 1,
              padding: Spacing.md,
              backgroundColor: accent,
              borderRadius: Radius.sm,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: Spacing.sm,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="play" size={18} color={Colors.base.black} />
            <Text style={{
              color: Colors.base.black,
              fontFamily: Typography.mono.family,
              letterSpacing: 2,
            }}>
              RESUME
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

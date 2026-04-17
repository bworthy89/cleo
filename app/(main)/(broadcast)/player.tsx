import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, Animated, Easing, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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

/** Italic ONAY-voice caption that reflects player state. */
function voiceCaptionFor(status: PlayerStatus, tuningStage: string): string | null {
  if (status.state === 'loading') return tuningStage;
  if (status.state === 'paused') return 'Your move.';
  if (status.state === 'ended') return 'That\u2019s all for tonight.';
  const np = status.nowPlaying;
  if (np && 'segmentKind' in np) return 'Between the tracks\u2026';
  return null;
}

type OrbMode = 'tuning' | 'live-track' | 'live-segment' | 'paused' | 'ended';

function orbModeFor(status: PlayerStatus): OrbMode {
  if (status.state === 'loading') return 'tuning';
  if (status.state === 'paused') return 'paused';
  if (status.state === 'ended' || status.state === 'idle') return 'ended';
  if (status.state === 'playing_segment') return 'live-segment';
  return 'live-track';
}

const ORB_CONFIG: Record<OrbMode, { duration: number; amplitude: number; opacity: number }> = {
  tuning:         { duration: 900, amplitude: 1.25, opacity: 1 },
  'live-segment': { duration: 700, amplitude: 1.18, opacity: 1 },
  'live-track':   { duration: 1400, amplitude: 1.08, opacity: 1 },
  paused:         { duration: 0, amplitude: 1, opacity: 0.45 },
  ended:          { duration: 0, amplitude: 1, opacity: 0.25 },
};

function PulsingOrb({ mode, accent }: { mode: OrbMode; accent: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const appActive = useAppActive();
  const cfg = ORB_CONFIG[mode];
  useEffect(() => {
    scale.setValue(1);
    if (cfg.duration === 0 || !appActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: cfg.amplitude, duration: cfg.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: cfg.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [cfg.duration, cfg.amplitude, appActive, scale]);
  return (
    <Animated.View
      style={{
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: accent,
        opacity: cfg.opacity,
        transform: [{ scale }],
      }}
    />
  );
}

/** A pip in the track-progress strip. Pulses subtly for upcoming tracks. */
function TrackPip({ state, accent }: { state: 'past' | 'current' | 'upcoming'; accent: string }) {
  const appActive = useAppActive();
  const alpha = useRef(new Animated.Value(state === 'upcoming' ? 0.5 : 1)).current;
  useEffect(() => {
    if (state !== 'upcoming' || !appActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(alpha, { toValue: 0.85, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(alpha, { toValue: 0.4, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, appActive, alpha]);

  const bg = state === 'upcoming' ? Surface.high : accent;
  return (
    <Animated.View
      style={{
        flex: 1,
        height: state === 'current' ? 4 : 3,
        borderRadius: 2,
        backgroundColor: bg,
        opacity: state === 'past' ? 0.6 : state === 'upcoming' ? alpha : 1,
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await broadcastPlayer.end().catch(() => {});
    router.back();
  };

  const handlePause = () => {
    Haptics.selectionAsync().catch(() => {});
    broadcastPlayer.pause().catch(() => {});
  };

  const handleResume = () => {
    Haptics.selectionAsync().catch(() => {});
    broadcastPlayer.resume().catch(() => {});
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
  const orbMode = orbModeFor(status);
  const voiceCaption = voiceCaptionFor(status, tuningStage);

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
          <PulsingOrb mode={orbMode} accent={accent} />
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
      </View>

      {warming ? (
        <TuningInCanvas accent={accent} />
      ) : track?.artworkUrl ? (
        <View style={{
          width: '100%',
          aspectRatio: 1,
          borderRadius: Radius.md,
          marginBottom: Spacing.lg,
          backgroundColor: Surface.container,
          overflow: 'hidden',
        }}>
          {/* Blurred backdrop: same art, scaled up, softly diffused */}
          <Image
            source={{ uri: track.artworkUrl }}
            style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.6 }] }]}
            blurRadius={30}
            resizeMode="cover"
          />
          <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={{
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(13, 13, 13, 0.28)',
          }} />
          <Image
            source={{ uri: track.artworkUrl }}
            style={{
              width: '100%',
              height: '100%',
            }}
            resizeMode="cover"
          />
        </View>
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
        <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 24, marginBottom: 2 }}>
          Tuning in
        </Text>
      ) : segment ? (
        <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 22, marginBottom: 2 }}>
          {segment}
        </Text>
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

      {voiceCaption && (
        <Text style={{
          color: TextColors.secondary,
          fontFamily: Typography.cleoVoice.family,
          fontStyle: 'italic',
          fontSize: 15,
          marginTop: 4,
        }}>
          {voiceCaption}
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
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          {Array.from({ length: totalTracks }).map((_, i) => {
            const pipState: 'past' | 'current' | 'upcoming' =
              i < trackNumber - 1 ? 'past' : i === trackNumber - 1 ? 'current' : 'upcoming';
            return <TrackPip key={i} state={pipState} accent={accent} />;
          })}
        </View>
        <Text style={{ color: TextColors.outline, fontSize: 11, marginTop: Spacing.xs }}>
          {progressPct}% of the broadcast
        </Text>
      </View>

      {!paused ? (
        <Pressable
          onPress={handlePause}
          accessibilityRole="button"
          accessibilityLabel="Pause broadcast"
          disabled={ended}
          style={({ pressed }) => ({
            padding: Spacing.md,
            backgroundColor: Surface.container,
            borderRadius: Radius.sm,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: Spacing.sm,
            marginBottom: Spacing.sm,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Ionicons name="pause" size={20} color={ended ? TextColors.outline : TextColors.primary} />
          <Text style={{
            color: ended ? TextColors.outline : TextColors.primary,
            fontFamily: Typography.mono.family,
            fontSize: 13,
            letterSpacing: 2,
          }}>
            PAUSE
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={handleResume}
          accessibilityRole="button"
          accessibilityLabel="Resume broadcast"
          style={({ pressed }) => ({
            padding: Spacing.md,
            backgroundColor: accent,
            borderRadius: Radius.sm,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: Spacing.sm,
            marginBottom: Spacing.sm,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="play" size={20} color={Colors.base.black} />
          <Text style={{
            color: Colors.base.black,
            fontFamily: Typography.mono.family,
            fontSize: 13,
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
        style={({ pressed }) => ({
          paddingVertical: Spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="close" size={14} color={TextColors.outline} />
        <Text style={{
          color: TextColors.outline,
          fontFamily: Typography.mono.family,
          fontSize: 11,
          letterSpacing: 2,
        }}>
          END BROADCAST
        </Text>
      </Pressable>
    </ScrollView>
  );
}

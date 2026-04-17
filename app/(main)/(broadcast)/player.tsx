import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../../src/components/BroadcastBackdrop';
import { TuningInOverlay } from '../../../src/components/broadcast/TuningInOverlay';
import { broadcastPlayer } from '../../../src/engines/BroadcastPlayer.singleton';
import type { PlayerStatus } from '../../../src/engines/BroadcastPlayer.types';
import { useAppActive } from '../../../src/hooks/useAppActive';
import { storage, StorageKeys } from '../../../src/services/Storage';
import { setTTSVolume } from '../../../modules/expo-music-kit';

// ──────────────────────────── Helpers ────────────────────────────

function formatClock(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${suffix}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function useLiveClock(enabled: boolean): string {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    if (!enabled) return;
    setClock(formatClock(new Date()));
    const id = setInterval(() => setClock(formatClock(new Date())), 30_000);
    return () => clearInterval(id);
  }, [enabled]);
  return clock;
}

// ──────────────────────────── Screen ─────────────────────────────

export default function BroadcastPlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();

  const [status, setStatus] = useState<PlayerStatus>(broadcastPlayer.getStatus());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!appActive) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => setStatus(broadcastPlayer.getStatus()), 500);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [appActive]);

  const clock = useLiveClock(appActive);

  // Host volume — persisted in MMKV under HOST_VOLUME_MIX. Player is the
  // single source of truth now (moved from Profile in Task 6).
  const [hostVolume, setHostVolume] = useState<number>(() => {
    const saved = storage.getString(StorageKeys.HOST_VOLUME_MIX);
    return saved ? parseFloat(saved) : 0.7;
  });
  useEffect(() => { setTTSVolume(hostVolume); }, [hostVolume]);

  const onChangeVolume = useCallback((v: number) => {
    setHostVolume(v);
    storage.set(StorageKeys.HOST_VOLUME_MIX, v.toString());
  }, []);

  const warming = status.state === 'loading';
  const paused  = status.state === 'paused';
  const ended   = status.state === 'ended' || status.state === 'idle';

  const track = status.currentTrack;
  const trackIndex  = Math.max(status.currentTrackIndex, 0) + 1;
  const totalTracks = Math.max(status.totalTracks, 1);
  const progress    = Math.min(Math.max(status.progress, 0), 1);

  const onPause = () => {
    Haptics.selectionAsync().catch(() => {});
    broadcastPlayer.pause().catch(() => {});
  };
  const onResume = () => {
    Haptics.selectionAsync().catch(() => {});
    broadcastPlayer.resume().catch(() => {});
  };
  const onEnd = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await broadcastPlayer.end().catch(() => {});
    router.back();
  };

  return (
    <BroadcastBackdrop>
      <View style={[styles.safe, { paddingTop: insets.top + Space.s18, paddingBottom: insets.bottom + Space.s22 }]}>
        {/* Status strip */}
        <View style={styles.strip}>
          <Text style={styles.stripMono}>
            {warming ? 'tuning in' : ended ? 'broadcast ended' : paused ? 'paused' : `now playing \u00b7 track ${pad2(trackIndex)} / ${pad2(totalTracks)}`}
          </Text>
          <Text style={styles.stripMono}>on air {'\u00b7'} {clock}</Text>
        </View>

        {/* Hero artwork */}
        <View style={styles.heroWrap}>
          {track?.artworkUrl ? (
            <Image
              source={{ uri: track.artworkUrl }}
              style={styles.hero}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.hero, styles.heroFallback]}>
              <Text style={styles.heroFallbackText}>onay</Text>
            </View>
          )}
        </View>

        {/* Title + artist */}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={2}>
            {track?.title ?? (ended ? 'That\u2019s all for tonight.' : warming ? 'Building your set\u2026' : '\u2014')}
          </Text>
          {track?.artistName ? (
            <Text style={styles.artist} numberOfLines={1}>{track.artistName}</Text>
          ) : null}
        </View>

        {/* Metadata + progress */}
        <View style={styles.metaBlock}>
          <View style={styles.metaRule} />
          <View style={styles.metaRow}>
            <Text style={styles.metaMono}>track {pad2(trackIndex)} / {pad2(totalTracks)}</Text>
            <Text style={styles.metaMono}>{Math.round(progress * 100)}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </View>

        {/* Controls */}
        <Pressable
          onPress={paused ? onResume : onPause}
          disabled={ended || warming}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume broadcast' : 'Pause broadcast'}
          style={({ pressed }) => [styles.control, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.controlText, (ended || warming) && { color: AM.inkDim }]}>
            {paused ? 'resume' : 'pause'}
          </Text>
        </Pressable>

        {/* Host volume */}
        <View style={styles.volumeBlock}>
          <View style={styles.volumeHeader}>
            <Text style={styles.volumeLabel}>ONAY VOLUME</Text>
            <Text style={styles.volumeValue}>{Math.round(hostVolume * 100)}</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={hostVolume}
            onValueChange={onChangeVolume}
            minimumTrackTintColor={AM.amber}
            maximumTrackTintColor={AM.amberFaint}
            thumbTintColor={AM.amber}
            accessibilityLabel="ONAY host volume"
          />
        </View>

        <View style={{ flex: 1 }} />

        {/* End broadcast */}
        <Pressable
          onPress={onEnd}
          accessibilityRole="button"
          accessibilityLabel="End broadcast"
          style={({ pressed }) => [styles.endWrap, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.endText}>end broadcast</Text>
        </Pressable>
      </View>

      <TuningInOverlay visible={warming} />
    </BroadcastBackdrop>
  );
}

// ──────────────────────────── Styles ─────────────────────────────

const HERO_EDGE = '72%';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    paddingHorizontal: Space.s26,
  },

  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Space.s26,
  },
  stripMono: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 3,
    color: AM.inkDim,
  },

  heroWrap: {
    alignItems: 'center',
    marginBottom: Space.s22,
  },
  hero: {
    width: HERO_EDGE,
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: AM.amberFaint,
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  heroFallbackText: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s44,
    fontStyle: 'italic',
    color: AM.amberDim,
  },

  titleBlock: {
    marginBottom: Space.s22,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
    fontStyle: 'italic',
    color: AM.ink,
    letterSpacing: -0.3,
  },
  artist: {
    marginTop: Space.s6,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.inkMid,
  },

  metaBlock: {
    marginBottom: Space.s22,
  },
  metaRule: {
    height: 1,
    backgroundColor: AM.amberFaint,
  },
  metaRow: {
    marginTop: Space.s10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Space.s10,
  },
  metaMono: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.inkDim,
  },
  progressTrack: {
    height: 1,
    backgroundColor: AM.amberFaint,
  },
  progressFill: {
    height: 1,
    backgroundColor: AM.amber,
  },

  control: {
    alignSelf: 'center',
    paddingVertical: Space.s14,
    paddingHorizontal: Space.s32,
  },
  controlText: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    fontStyle: 'italic',
    color: AM.ink,
    letterSpacing: 0.5,
  },

  volumeBlock: {
    marginTop: Space.s22,
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
    paddingTop: Space.s14,
  },
  volumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  volumeLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  volumeValue: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.amberDim,
  },
  slider: {
    width: '100%',
    height: 30,
    marginTop: Space.s4,
  },

  endWrap: {
    alignSelf: 'center',
    paddingVertical: Space.s14,
  },
  endText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amberDim,
  },
});

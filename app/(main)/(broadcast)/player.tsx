import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../../src/components/BroadcastBackdrop';
import { TuningInOverlay } from '../../../src/components/broadcast/TuningInOverlay';
import { Tick, VUMeter, LinerNotes } from '../../../src/components/crate';
import { broadcastPlayer } from '../../../src/engines/BroadcastPlayer.singleton';
import type { PlayerStatus } from '../../../src/engines/BroadcastPlayer.types';
import { useAppActive } from '../../../src/hooks/useAppActive';
import { storage, StorageKeys } from '../../../src/services/Storage';
import { setTTSVolume } from '../../../modules/expo-music-kit';

// ──────────────────────────── Helpers ────────────────────────────

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

/**
 * 1..999 deterministic "show number" for the catalog header. Every UUID has
 * the same character length, so `id.length % 999` collapsed to a constant;
 * a full-string hash preserves the editorial feel while varying per session.
 */
function hashBroadcastNumber(id: string | null): number {
  if (!id) return 4;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 999) + 1;
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
  const playing = status.state === 'playing_track' || status.state === 'playing_segment';

  const track = status.currentTrack;
  const trackIndex  = Math.max(status.currentTrackIndex, 0) + 1;
  const totalTracks = Math.max(status.totalTracks, 1);
  const progress    = Math.min(Math.max(status.progress, 0), 1);
  const position    = progress * (track?.duration ?? 0);
  const duration    = track?.duration ?? 0;

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

  const broadcastNo = pad3(hashBroadcastNumber(status.broadcastId));
  const album = (track?.albumTitle ?? '').toUpperCase();
  const artist = track?.artistName ?? '';

  return (
    <BroadcastBackdrop>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + Space.s6, paddingBottom: insets.bottom + Space.s22 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* End broadcast chrome */}
        <View style={styles.strip}>
          <Pressable
            onPress={onEnd}
            accessibilityRole="button"
            accessibilityLabel="End broadcast"
            hitSlop={12}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.stripEnd}>← END BROADCAST</Text>
          </Pressable>
          <View style={styles.onAir}>
            <View style={styles.onAirDot} />
            <Text style={styles.onAirText}>ON AIR · {clock}</Text>
          </View>
        </View>

        {/* Broadcast + track catalog line */}
        <View style={styles.catalogLine}>
          <Text style={styles.catalogMono}>BROADCAST №{broadcastNo} / SIDE A</Text>
          <Text style={styles.catalogMono}>TRK {pad2(trackIndex)} / {pad2(totalTracks)}</Text>
        </View>

        {/* Hero sleeve with corner ticks */}
        <View style={styles.heroWrap}>
          <View style={styles.heroBox}>
            {track?.artworkUrl ? (
              <Image
                source={{ uri: track.artworkUrl }}
                style={styles.hero}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.hero, styles.heroFallback]}>
                <Text style={styles.heroFallbackText}>ONAY</Text>
              </View>
            )}
            <Tick pos="tl" color={AM.amber} bg={AM.bg} />
            <Tick pos="tr" color={AM.amber} bg={AM.bg} />
            <Tick pos="bl" color={AM.amber} bg={AM.bg} />
            <Tick pos="br" color={AM.amber} bg={AM.bg} />
          </View>
        </View>

        {/* Title block */}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={2}>
            {(track?.title ?? (ended ? 'That’s all for tonight.' : warming ? 'Building your set…' : '—')).toUpperCase()}
          </Text>
          {artist ? <Text style={styles.artist} numberOfLines={1}>{artist}</Text> : null}

          {/* Catalog line — source design has "YEAR · LABEL · ALBUM". The
              server manifest's ManifestTrack type carries only duration and
              album title, so we approximate with "duration · album" here.
              Restore the full trio by extending ManifestTrack with optional
              `year?: string` / `label?: string` and populating them from
              Genius/MusicBrainz enrichment on the server side. */}
          {(track?.duration || album) && (
            <View style={styles.catalogMeta}>
              <Text style={styles.catalogMonoInk}>{formatTime(track?.duration ?? 0)}</Text>
              {album ? <Text style={styles.catalogMonoInk}>{album}</Text> : null}
            </View>
          )}
        </View>

        {/* Progress */}
        <View style={styles.progressBlock}>
          <View style={styles.progressRow}>
            <Text style={styles.progressMono}>{formatTime(position)}</Text>
            <Text style={styles.progressMono}>{formatTime(duration)}</Text>
          </View>
          <View style={styles.progressRail}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            <View style={[styles.progressTick, { left: `${progress * 100}%` }]} />
          </View>
          <View style={styles.vuRow}>
            <VUMeter level={0.82} animate={playing} barWidth={3} />
            <Text style={styles.vuLabel}>VU · L</Text>
          </View>
        </View>

        {/* Transport — previous/next are decorative. ONAY broadcasts are
            no-skip by design, so both side buttons are intentionally
            non-interactive. Flagged disabled so VoiceOver announces them
            correctly instead of implying a tappable control. */}
        <View style={styles.transport}>
          <View
            style={styles.smallBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Previous — not available during this broadcast"
            accessibilityState={{ disabled: true }}
          >
            <Text style={styles.smallBtnText}>‖</Text>
          </View>
          <Pressable
            onPress={paused ? onResume : onPause}
            disabled={ended || warming}
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume broadcast' : 'Pause broadcast'}
            style={({ pressed }) => [styles.bigBtn, pressed && { opacity: 0.75 }, (ended || warming) && { opacity: 0.35 }]}
          >
            <Text style={styles.bigBtnText}>{paused ? '▶' : '❙❙'}</Text>
            <Text style={styles.bigBtnSub}>{paused ? 'PLAY' : 'PAUSE'}</Text>
          </Pressable>
          <View
            style={styles.smallBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Skip forward — not available during this broadcast"
            accessibilityState={{ disabled: true }}
          >
            <Text style={[styles.smallBtnText, { color: AM.inkGhost }]}>⟶|</Text>
          </View>
        </View>

        <Text style={styles.commitment}>NO SKIPS · SIT WITH IT</Text>

        {/* Liner notes — ONAY between tracks */}
        <View style={styles.linerBlock}>
          <Text style={styles.linerHeader}>BETWEEN TRACKS</Text>
          <LinerNotes>
            Coming up — a Philly Groove single from 1970, and it still hits.
          </LinerNotes>
        </View>

        {/* Host volume — notched dial */}
        <View style={styles.volumeBlock}>
          <View style={styles.volumeHeader}>
            <Text style={styles.volumeLabel}>HOST VOLUME</Text>
            <Text style={styles.volumeValue}>{Math.round(hostVolume * 100)}</Text>
          </View>
          {/* Dial is the visible control. Slider below is a transparent touch
              layer — drag/tap still adjusts volume and keeps VoiceOver support,
              but no Slider chrome competes with the dial. */}
          <View style={styles.volumeDialWrap}>
            <VolumeDial value={hostVolume} />
            <Slider
              style={styles.sliderOverlay}
              minimumValue={0}
              maximumValue={1}
              step={0.05}
              value={hostVolume}
              onValueChange={onChangeVolume}
              minimumTrackTintColor="transparent"
              maximumTrackTintColor="transparent"
              thumbTintColor="transparent"
              accessibilityLabel="ONAY host volume"
            />
          </View>
          <View style={styles.volumeScale}>
            <Text style={styles.volumeScaleLabel}>QUIET</Text>
            <Text style={styles.volumeScaleLabel}>BETWEEN</Text>
            <Text style={styles.volumeScaleLabel}>FOREFRONT</Text>
          </View>
        </View>

        <View style={{ height: Space.s22 }} />
      </ScrollView>

      <TuningInOverlay visible={warming} />
    </BroadcastBackdrop>
  );
}

// ──────────────────────────── Volume dial bars ─────────────────────
// 24 notched bars — every 4th taller. Amber up to the volume, ghosted past.

function VolumeDial({ value }: { value: number }) {
  const bars = 24;
  const activeCount = Math.round(value * bars);
  return (
    <View style={styles.dialRow}>
      {Array.from({ length: bars }).map((_, i) => {
        const major = i % 4 === 0;
        const active = i < activeCount;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              height: major ? 12 : 7,
              marginRight: i < bars - 1 ? 2 : 0,
              backgroundColor: active ? AM.amber : AM.inkGhost,
            }}
          />
        );
      })}
    </View>
  );
}

// ──────────────────────────── Styles ─────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: Space.s22,
  },

  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  stripEnd: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.oxblood,
  },
  onAir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  onAirDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: AM.oxblood,
    shadowColor: AM.oxblood,
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  onAirText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2.5,
    color: AM.inkDim,
  },

  catalogLine: {
    marginTop: Space.s22,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  catalogMono: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
  },

  heroWrap: {
    alignItems: 'center',
  },
  heroBox: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
  },
  hero: {
    width: '100%',
    height: '100%',
    backgroundColor: AM.bgDeep,
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AM.amberFaint,
  },
  heroFallbackText: {
    fontFamily: Fonts.display,
    fontSize: 80,
    color: AM.amberDim,
    letterSpacing: 2,
  },

  titleBlock: {
    marginTop: Space.s22,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s28,
    color: AM.ink,
    letterSpacing: 0.3,
    lineHeight: TypeScale.s28,
  },
  artist: {
    marginTop: Space.s8,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s18,
    color: AM.inkMid,
    lineHeight: TypeScale.s18 * 1.2,
  },
  catalogMeta: {
    marginTop: Space.s14,
    flexDirection: 'row',
    gap: Space.s16,
    flexWrap: 'wrap',
  },
  catalogMonoInk: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 1.5,
  },

  progressBlock: {
    marginTop: Space.s22,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Space.s8,
  },
  progressMono: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  progressRail: {
    position: 'relative',
    height: 1,
    backgroundColor: AM.rule,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: AM.amber,
    shadowColor: AM.amber,
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  progressTick: {
    position: 'absolute',
    top: -4,
    width: 1,
    height: 9,
    backgroundColor: AM.amber,
  },
  vuRow: {
    marginTop: Space.s14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s12,
  },
  vuLabel: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 2,
  },

  transport: {
    marginTop: Space.s22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  smallBtn: {
    width: 44, height: 44,
    borderWidth: 1,
    borderColor: AM.inkGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    color: AM.inkDim,
  },
  bigBtn: {
    width: 76, height: 76,
    borderWidth: 1.5,
    borderColor: AM.amber,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bigBtnText: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: AM.amber,
    lineHeight: 28,
  },
  bigBtnSub: {
    position: 'absolute',
    bottom: -18,
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.amberDim,
    letterSpacing: 2,
  },

  commitment: {
    marginTop: Space.s30,
    textAlign: 'center',
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 3,
  },

  linerBlock: {
    marginTop: Space.s30,
  },
  linerHeader: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxblood,
    letterSpacing: 2.5,
    marginBottom: Space.s10,
  },

  volumeBlock: {
    marginTop: Space.s30,
    paddingTop: Space.s14,
    borderTopWidth: 0.5,
    borderTopColor: AM.rule,
  },
  volumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Space.s10,
  },
  volumeLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  volumeValue: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 1,
    color: AM.amberDim,
  },
  dialRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  volumeDialWrap: {
    position: 'relative',
  },
  sliderOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
  },
  volumeScale: {
    marginTop: Space.s8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  volumeScaleLabel: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: AM.inkDim,
  },
});

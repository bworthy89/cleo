import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { BroadcastBackdrop } from '../../components/BroadcastBackdrop';
import { AmberCTA } from '../../components/AmberCTA';
import { HairlineRow } from '../../components/HairlineRow';
import { OnAirIndicator } from '../../components/OnAirIndicator';
import { TuningInOverlay } from '../../components/broadcast/TuningInOverlay';
import { SetupSheet, type SetupResult } from '../../components/broadcast/SetupSheet';
import { FeaturedBroadcastCard } from '../../components/broadcast/FeaturedBroadcastCard';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import {
  BroadcastCurationClient,
  type FeaturedBroadcast,
} from '../../engines/BroadcastCurationClient';
import { BroadcastManifestClient } from '../../engines/BroadcastManifestClient';
import { broadcastPlayer } from '../../engines/BroadcastPlayer.singleton';
import { BroadcastResumer } from '../../engines/BroadcastResumer';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import type { Manifest } from '../../engines/BroadcastPlayer.types';
import {
  getBroadcastHistory,
  getCachedPlaylists,
  type BroadcastHistoryEntry,
} from '../../services/Storage';
import { useAppActive } from '../../hooks/useAppActive';

type Vibe   = Manifest['vibe'];
type Length = Manifest['length'];

const VIBE_LABEL: Record<Vibe, string> = {
  morning:    'Morning',
  focus:      'Focus',
  workout:    'Workout',
  feelGood:   'Feel Good',
  lateNight:  'Late Night',
  melancholy: 'Melancholy',
  party:      'Party',
};

/** Phrase used in the hero's amber middle line: "Tonight, / a late-night / broadcast." */
const VIBE_HERO: Record<Vibe, string> = {
  morning:    'a morning',
  focus:      'a focused',
  workout:    'a workout',
  feelGood:   'a feel-good',
  lateNight:  'a late-night',
  melancholy: 'a slow',
  party:      'a party',
};

const LENGTH_LABEL: Record<Length, string> = {
  quick:    'Quick \u2014 5 tracks \u00b7 15 min',
  standard: 'Standard \u2014 9 tracks \u00b7 30 min',
  long:     'Long Drive \u2014 15 tracks \u00b7 60 min',
};

const ACTIVE_STATES = new Set(['loading', 'playing_segment', 'playing_track', 'paused']);

// ───────────────────────── Helpers ─────────────────────────

function formatClock(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${suffix}`;
}

function titleFor(entry: BroadcastHistoryEntry, playlists: MusicPlaylist[]): string {
  const { manifest } = entry;
  if (manifest.playlistId) {
    const match = playlists.find(p => p.id === manifest.playlistId);
    if (match?.name) return match.name;
  }
  return `${VIBE_LABEL[manifest.vibe]} \u00b7 ${manifest.tracks.length} tracks`;
}

function durationFor(entry: BroadcastHistoryEntry): string {
  const total = entry.manifest.tracks.reduce((acc, t) => acc + (t.duration ?? 180), 0);
  const m = Math.round(total / 60);
  return `${m}:00`;
}

function padIndex(i: number): string {
  return i.toString().padStart(3, '0');
}

// ───────────────────────── Section label ─────────────────────────

function SectionLabel({ text, style }: { text: string; style?: TextStyle }) {
  return <Text style={[styles.sectionLabel, style]}>{text}</Text>;
}

// ───────────────────────── Status strip ─────────────────────────

function StatusStrip({ broadcastActive }: { broadcastActive: boolean }) {
  const appActive = useAppActive();
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    if (!appActive) return;
    setClock(formatClock(new Date()));
    const id = setInterval(() => setClock(formatClock(new Date())), 30_000);
    return () => clearInterval(id);
  }, [appActive]);

  return (
    <View style={styles.status}>
      <Text style={styles.statusMono}>onay</Text>
      <View style={styles.statusRight}>
        <OnAirIndicator active={broadcastActive} />
        <Text style={styles.statusMono}>{broadcastActive ? 'on air' : 'off air'}</Text>
        <Text style={styles.statusMono}>{'\u00b7'}</Text>
        <Text style={styles.statusMono}>{clock}</Text>
      </View>
    </View>
  );
}

// ───────────────────────── Main screen ─────────────────────────

export default function HomeBroadcastScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();

  // Selection state — lives only on this screen; no MMKV persistence.
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [length, setLength] = useState<Length | null>(null);

  // Sheet control
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetInitialStep, setSheetInitialStep] = useState<0 | 1 | 2>(0);

  // Data
  const [featured, setFeatured] = useState<FeaturedBroadcast[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>(() => getCachedPlaylists() ?? []);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tuning, setTuning] = useState(false);
  const [recent, setRecent] = useState<BroadcastHistoryEntry[]>([]);

  // Broadcast active state for status strip
  const [broadcastActive, setBroadcastActive] = useState(false);
  useEffect(() => {
    if (!appActive) return;
    const tick = () => setBroadcastActive(ACTIVE_STATES.has(broadcastPlayer.getStatus().state));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [appActive]);

  const refreshRecent = useCallback(() => setRecent(getBroadcastHistory()), []);
  useFocusEffect(useCallback(() => refreshRecent(), [refreshRecent]));

  const loadPlaylists = useCallback(async () => {
    setPlaylistsLoading(true);
    setPlaylistsError(null);
    try {
      const pls = await musicKitPlayer.fetchPlaylists();
      setPlaylists(pls);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Couldn\u2019t reach Apple Music.';
      console.warn('[HomeBroadcast] fetchPlaylists failed:', err);
      setPlaylistsError(msg);
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const feats = await new BroadcastCurationClient().listFeatured();
        if (!mounted) return;
        setFeatured(feats);
      } finally {
        if (mounted) setLoading(false);
      }
      await loadPlaylists();

      // Resume-after-terminate
      const resumer = new BroadcastResumer();
      const persisted = await resumer.check();
      if (!mounted || !persisted) return;
      const firstReadySlot = persisted.segmentSlots.find(s => s.status === 'ready');
      const urls = firstReadySlot?.audioUrls ?? [];
      Alert.alert(
        'Resume broadcast?',
        `${persisted.tracks.length} tracks left in your session.`,
        [
          { text: 'Start fresh', style: 'cancel', onPress: () => { resumer.decline(); } },
          {
            text: 'Resume',
            onPress: () => {
              router.push('/(main)/(broadcast)/player');
              broadcastPlayer.start(persisted, urls).catch((e: unknown) =>
                console.warn('[HomeBroadcast] resume failed', e),
              );
            },
          },
        ],
      );
    })();
    return () => { mounted = false; };
  }, [router, loadPlaylists]);

  // Selected playlist name (for FROM row)
  const playlistName = useMemo(() => {
    if (!playlistId) return null;
    return playlists.find(p => p.id === playlistId)?.name ?? null;
  }, [playlistId, playlists]);

  // Pick row taps open the sheet at the relevant step.
  const openSheetAt = useCallback((step: 0 | 1 | 2) => {
    setSheetInitialStep(step);
    setSheetOpen(true);
  }, []);

  // Begin-broadcast tap: if fully configured, run it; else deep-link to the
  // first missing step.
  const onBegin = useCallback(() => {
    if (!playlistId) return openSheetAt(0);
    if (!vibe)       return openSheetAt(1);
    if (!length)     return openSheetAt(2);
    // Fully configured — kick off the bake.
    void playUserSourced({ playlistId, vibe, length });
  }, [playlistId, vibe, length, openSheetAt]);

  const playUserSourced = useCallback(async (result: SetupResult) => {
    setTuning(true);
    try {
      const tracks = await musicKitPlayer.fetchPlaylistTracks(result.playlistId);
      const client = new BroadcastManifestClient();
      const { manifest, firstSegmentUrls } = await client.createBroadcast({
        playlistId: result.playlistId,
        vibe: result.vibe,
        length: result.length,
        userContext: {
          timeOfDay: new Date().toTimeString().slice(0, 5),
          dayOfWeek: new Date().toLocaleDateString(undefined, { weekday: 'long' }),
          firstTimeUser: false,
        },
        tracks: tracks.slice(0, 20).map(t => ({
          id: t.id,
          title: t.title,
          artistName: t.artistName,
          albumTitle: t.albumTitle ?? '',
          duration: t.duration ?? 180,
          artworkUrl: t.artworkUrl,
        })),
      });
      router.push('/(main)/(broadcast)/player');
      broadcastPlayer.start(manifest, firstSegmentUrls).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        Alert.alert('Broadcast error', msg);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Try again.';
      Alert.alert('Broadcast unavailable', msg);
    } finally {
      setTuning(false);
    }
  }, [router]);

  const onSheetSubmit = useCallback((r: SetupResult) => {
    setSheetOpen(false);
    setPlaylistId(r.playlistId);
    setVibe(r.vibe);
    setLength(r.length);
    void playUserSourced(r);
  }, [playUserSourced]);

  const playRecent = useCallback((entry: BroadcastHistoryEntry) => {
    router.push('/(main)/(broadcast)/player');
    broadcastPlayer.start(entry.manifest, entry.firstSegmentUrls).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    });
  }, [router]);

  const playFeatured = useCallback((fb: FeaturedBroadcast) => {
    const firstSlot = fb.manifest.segmentSlots[0];
    const firstUrls = firstSlot?.audioUrls ?? [];
    router.push('/(main)/(broadcast)/player');
    broadcastPlayer.start(fb.manifest, firstUrls).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    });
  }, [router]);

  if (loading) {
    return (
      <BroadcastBackdrop>
        <View style={styles.loading}>
          <ActivityIndicator color={AM.amber} />
        </View>
      </BroadcastBackdrop>
    );
  }

  // Hero renders 3 lines; the middle amber line is only present once a vibe
  // is selected. Before that, "Tonight, / a / broadcast." with amber empty
  // middle reads weird — collapse to "Tonight, / a broadcast." (2 lines).
  const heroMiddle = vibe ? VIBE_HERO[vibe] : null;

  return (
    <BroadcastBackdrop>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Space.s18,
            // Leaves room for the tab bar + the NowPlayingBar mini-bar when
            // a broadcast is active. Over-padding is harmless when the
            // mini-bar is hidden.
            paddingBottom: insets.bottom + 120,
          },
        ]}
      >
        <StatusStrip broadcastActive={broadcastActive} />

        <View style={styles.heroBlock}>
          <Text style={styles.heroLine}>Tonight,</Text>
          {heroMiddle ? (
            <>
              <Text style={[styles.heroLine, styles.heroAmber]}>{heroMiddle}</Text>
              <Text style={styles.heroLine}>broadcast.</Text>
            </>
          ) : (
            <Text style={styles.heroLine}>a broadcast.</Text>
          )}
        </View>

        {/* Pick rows */}
        <HairlineRow
          leading={<Text style={styles.pickLabel}>FROM</Text>}
          leadingWidth={54}
          value={
            <Text style={styles.pickValue} numberOfLines={1}>
              {playlistName ?? 'Pick a playlist'}
            </Text>
          }
          trailing={<Text style={styles.chev}>{'\u203A'}</Text>}
          onPress={() => openSheetAt(0)}
          accessibilityLabel={`From ${playlistName ?? 'not set'}`}
        />
        <HairlineRow
          leading={<Text style={styles.pickLabel}>VIBE</Text>}
          leadingWidth={54}
          value={
            <Text style={styles.pickValue} numberOfLines={1}>
              {vibe ? VIBE_LABEL[vibe] : 'Pick a vibe'}
            </Text>
          }
          trailing={<Text style={styles.chev}>{'\u203A'}</Text>}
          onPress={() => openSheetAt(1)}
          accessibilityLabel={`Vibe ${vibe ? VIBE_LABEL[vibe] : 'not set'}`}
        />
        <HairlineRow
          leading={<Text style={styles.pickLabel}>LENGTH</Text>}
          leadingWidth={54}
          value={
            <Text style={styles.pickValue} numberOfLines={1}>
              {length ? LENGTH_LABEL[length] : 'Pick a length'}
            </Text>
          }
          trailing={<Text style={styles.chev}>{'\u203A'}</Text>}
          onPress={() => openSheetAt(2)}
          accessibilityLabel={`Length ${length ?? 'not set'}`}
        />

        <View style={{ height: Space.s34 }} />

        <AmberCTA
          label="Begin broadcast"
          onPress={onBegin}
          accessibilityHint={
            playlistId && vibe && length
              ? 'Starts your broadcast'
              : 'Opens the setup sheet to finish choosing'
          }
        />
        <Text style={styles.commitment}>
          no skips {'\u00b7'} no shuffle {'\u00b7'} sit with it
        </Text>

        {/* Earlier · 24h */}
        {recent.length > 0 && (
          <>
            <View style={{ height: Space.s52 }} />
            <SectionLabel text={'earlier \u00b7 24h'} />
            <View style={{ height: Space.s6 }} />
            {recent.map((entry, i) => (
              <HairlineRow
                key={entry.manifest.broadcastId}
                topRule
                verticalPadding={Space.s14}
                leading={<Text style={styles.reelNum}>{padIndex(recent.length - i)}</Text>}
                leadingWidth={32}
                value={
                  <Text style={styles.reelTitle} numberOfLines={1}>
                    {titleFor(entry, playlists)}
                  </Text>
                }
                trailing={<Text style={styles.reelDuration}>{durationFor(entry)}</Text>}
                onPress={() => playRecent(entry)}
                accessibilityLabel={`Replay ${titleFor(entry, playlists)}`}
              />
            ))}
          </>
        )}

        {/* Tonight on onay */}
        {featured.length > 0 && (
          <>
            <View style={{ height: Space.s52 }} />
            <SectionLabel text="tonight on onay" />
            <View style={{ height: Space.s6 }} />
            {featured.map((fb, i) => (
              <FeaturedBroadcastCard
                key={fb.id}
                broadcast={fb}
                index={i + 1}
                onPress={() => playFeatured(fb)}
              />
            ))}
          </>
        )}

        {/* Ask ONAY peer block */}
        <View style={{ height: Space.s52 }} />
        <HairlineRow
          topRule
          verticalPadding={Space.s22}
          value={
            <View>
              <Text style={styles.askLabel}>ONAY</Text>
              <Text style={styles.askLine}>Want something different tonight? Ask me.</Text>
            </View>
          }
          trailing={<Text style={styles.chev}>{'\u203A'}</Text>}
          onPress={() => router.push('/(main)/(broadcast)/ask-onay')}
          accessibilityLabel="Ask ONAY to curate"
        />

        {playlistsError && (
          <Text style={styles.errorNote}>
            {playlistsError} — pull to retry.
          </Text>
        )}
        {playlistsLoading && (
          <Text style={styles.loadingNote}>{'Loading your Apple Music playlists\u2026'}</Text>
        )}
      </ScrollView>

      <SetupSheet
        visible={sheetOpen}
        playlists={playlists}
        playlistsLoading={playlistsLoading}
        playlistsError={playlistsError}
        onRetryPlaylists={loadPlaylists}
        initialStep={sheetInitialStep}
        initialSelection={{ playlistId, vibe, length }}
        onAskOnay={() => {
          setSheetOpen(false);
          router.push('/(main)/(broadcast)/ask-onay');
        }}
        onClose={() => setSheetOpen(false)}
        onSubmit={onSheetSubmit}
      />

      <TuningInOverlay visible={tuning} />
    </BroadcastBackdrop>
  );
}

// ───────────────────────── Styles ─────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Space.s26,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s6,
  },
  statusMono: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 3,
  },

  // Hero
  heroBlock: {
    marginTop: Space.s34,
    marginBottom: Space.s32,
  },
  heroLine: {
    fontFamily: Fonts.displayThin,
    fontSize: TypeScale.s44,
    lineHeight: TypeScale.s44 * 1.05,
    letterSpacing: -0.8,
    color: AM.ink,
    fontStyle: 'italic',
  },
  heroAmber: {
    color: AM.amber,
  },

  // Pick rows
  pickLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  pickValue: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    fontStyle: 'italic',
    color: AM.ink,
  },
  chev: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.inkDim,
  },

  commitment: {
    marginTop: Space.s10,
    textAlign: 'center',
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.inkDim,
  },

  sectionLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2.5,
    color: AM.inkDim,
  },

  // Recent rows
  reelNum: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.amberDim,
  },
  reelTitle: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.ink,
  },
  reelDuration: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.inkDim,
  },

  // Ask ONAY block
  askLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2.5,
    color: AM.amberDim,
    marginBottom: Space.s6,
  },
  askLine: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    fontStyle: 'italic',
    color: AM.ink,
    lineHeight: TypeScale.s18 * 1.4,
  },

  errorNote: {
    marginTop: Space.s16,
    textAlign: 'center',
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.inkDim,
  },
  loadingNote: {
    marginTop: Space.s16,
    textAlign: 'center',
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.inkDim,
  },
});

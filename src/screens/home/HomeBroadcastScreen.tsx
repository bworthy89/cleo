import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { BroadcastBackdrop } from '../../components/BroadcastBackdrop';
import { TuningInOverlay } from '../../components/broadcast/TuningInOverlay';
import { SetupSheet, type SetupResult } from '../../components/broadcast/SetupSheet';
import { FeaturedBroadcastCard } from '../../components/broadcast/FeaturedBroadcastCard';
import { FeaturedRailCard } from '../../components/broadcast/FeaturedRailCard';
import {
  StatusStrip,
  StampButton,
  SectionMarker,
  LinerNotes,
  CatalogRow,
} from '../../components/crate';
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
  morning:    'MORNING',
  focus:      'FOCUS',
  workout:    'WORKOUT',
  feelGood:   'FEEL GOOD',
  lateNight:  'LATE NIGHT',
  melancholy: 'MELANCHOLY',
  party:      'PARTY',
};

const LENGTH_LABEL: Record<Length, string> = {
  quick:    'QUICK · 5 · 15 MIN',
  standard: 'STANDARD · 9 · 30 MIN',
  long:     'LONG · 15 · 60 MIN',
};

const ACTIVE_STATES = new Set(['loading', 'playing_segment', 'playing_track', 'paused']);

// ───────────────────────── Helpers ─────────────────────────

function titleFor(entry: BroadcastHistoryEntry, playlists: MusicPlaylist[]): string {
  const { manifest } = entry;
  if (manifest.playlistId) {
    const match = playlists.find(p => p.id === manifest.playlistId);
    if (match?.name) return match.name.toUpperCase();
  }
  return `${VIBE_LABEL[manifest.vibe]} · ${manifest.tracks.length} TRACKS`;
}

function durationFor(entry: BroadcastHistoryEntry): string {
  const total = entry.manifest.tracks.reduce((acc, t) => acc + (t.duration ?? 180), 0);
  const m = Math.round(total / 60);
  return `${m}:00`;
}

function padIndex(i: number): string {
  return i.toString().padStart(3, '0');
}

function dateLabel(entry: BroadcastHistoryEntry): string {
  const d = new Date(entry.createdAt);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  const prefix = sameDay ? 'TODAY' : d.toDateString() === yesterday ? 'YESTERDAY' :
    d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
  return `${prefix} · ${h}:${m}`;
}

// ───────────────────────── Main screen ─────────────────────────

export default function HomeBroadcastScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();

  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [length, setLength] = useState<Length | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetInitialStep, setSheetInitialStep] = useState<0 | 1 | 2>(0);

  const [featured, setFeatured] = useState<FeaturedBroadcast[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>(() => getCachedPlaylists() ?? []);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tuning, setTuning] = useState(false);
  const [recent, setRecent] = useState<BroadcastHistoryEntry[]>([]);

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
      const msg = err instanceof Error ? err.message : 'Couldn’t reach Apple Music.';
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
      } catch (err) {
        console.warn('[HomeBroadcast] listFeatured failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
      await loadPlaylists();

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

  const playlistName = useMemo(() => {
    if (!playlistId) return null;
    return playlists.find(p => p.id === playlistId)?.name?.toUpperCase() ?? null;
  }, [playlistId, playlists]);

  const openSheetAt = useCallback((step: 0 | 1 | 2) => {
    setSheetInitialStep(step);
    setSheetOpen(true);
  }, []);

  const onBegin = useCallback(() => {
    if (!playlistId) return openSheetAt(0);
    if (!vibe)       return openSheetAt(1);
    if (!length)     return openSheetAt(2);
    void playUserSourced({ playlistId, vibe, length });
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const [hero, ...rest] = featured;

  return (
    <BroadcastBackdrop>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Space.s6,
            paddingBottom: insets.bottom + 120,
          },
        ]}
      >
        <StatusStrip onAir={broadcastActive} num="004" />

        {/* TONIGHT ON ONAY hero */}
        {hero ? (
          <FeaturedBroadcastCard
            broadcast={hero}
            onPress={() => playFeatured(hero)}
            tagline={hero.description}
          />
        ) : (
          <View style={styles.featuredEmpty}>
            <Text style={styles.featuredEmptyHead}>Fresh broadcasts baking.</Text>
            <Text style={styles.featuredEmptySub}>
              check back soon · or build your own below
            </Text>
          </View>
        )}

        {/* Rail — additional featured broadcasts.
            snapToInterval = card width (150) + inter-card gap (12) so each
            card settles fully into view; decelerationRate="fast" makes the
            snap feel physical rather than drifty. */}
        {rest.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            snapToInterval={162}
            decelerationRate="fast"
            snapToAlignment="start"
          >
            {rest.map(fb => (
              <FeaturedRailCard key={fb.id} broadcast={fb} onPress={() => playFeatured(fb)} />
            ))}
          </ScrollView>
        )}

        {/* Liner note from ONAY */}
        <View style={{ marginTop: Space.s26 }}>
          <LinerNotes>
            {hero?.description
              ? `Tonight — ${hero.description.toLowerCase()}. Stay with it through the first side.`
              : 'Picked records, not algorithms. Stay with them.'}
          </LinerNotes>
        </View>

        {/* Roll your own */}
        <SectionMarker num="B·01" title="ROLL YOUR OWN" side="FROM YOUR LIBRARY" />
        <View style={{ marginTop: 4 }}>
          <CatalogRow
            label="FROM"
            placeholder="pick a playlist"
            value={playlistName}
            onPress={() => openSheetAt(0)}
          />
          <CatalogRow
            label="VIBE"
            placeholder="pick a vibe"
            value={vibe ? VIBE_LABEL[vibe] : null}
            onPress={() => openSheetAt(1)}
          />
          <CatalogRow
            label="LENGTH"
            placeholder="pick a length"
            value={length ? LENGTH_LABEL[length] : null}
            onPress={() => openSheetAt(2)}
          />
        </View>

        <View style={{ height: Space.s22 }} />
        <StampButton
          label="BEGIN BROADCAST"
          sub="NO SKIPS · SIT WITH IT"
          onPress={onBegin}
          accessibilityHint={
            playlistId && vibe && length
              ? 'Starts your broadcast'
              : 'Opens the setup sheet to finish choosing'
          }
        />

        {/* Ask ONAY — dashed invitation */}
        <SectionMarker num="B·02" title="ASK ONAY" side="TELL HER A MOOD" />
        <Pressable
          onPress={() => router.push('/(main)/(crates)')}
          accessibilityRole="button"
          accessibilityLabel="Ask ONAY to curate"
          style={({ pressed }) => [styles.askCard, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.askQuote}>
            &ldquo;rainy, autumn, a little melancholy &mdash; nothing obvious&rdquo;
          </Text>
          <Text style={styles.askHint}>ONAY PULLS FROM THE CRATE →</Text>
        </Pressable>

        {/* Earlier tonight */}
        {recent.length > 0 && (
          <>
            <SectionMarker num="B·03" title="EARLIER TONIGHT" side="24 HOURS" />
            {recent.map((entry, i) => (
              <Pressable
                key={entry.manifest.broadcastId}
                onPress={() => playRecent(entry)}
                accessibilityRole="button"
                accessibilityLabel={`Replay ${titleFor(entry, playlists)}`}
                style={({ pressed }) => [styles.recentRow, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.recentNum}>{padIndex(recent.length - i)}</Text>
                <View style={styles.recentBody}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {titleFor(entry, playlists)}
                  </Text>
                  <Text style={styles.recentDate}>{dateLabel(entry)}</Text>
                </View>
                <Text style={styles.recentDuration}>{durationFor(entry)}</Text>
              </Pressable>
            ))}
          </>
        )}

        {/* Colophon */}
        <View style={styles.colophon}>
          <Text style={styles.colophonText}>ONAY RADIO · EST. 2026</Text>
          <Text style={styles.colophonText}>
            NO ALGORITHMS · NO SHUFFLE · SIDE A → SIDE B
          </Text>
        </View>

        {playlistsError && (
          <Text style={styles.errorNote}>{playlistsError} — pull to retry.</Text>
        )}
        {playlistsLoading && (
          <Text style={styles.loadingNote}>{'Loading your Apple Music playlists…'}</Text>
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
          router.push('/(main)/(crates)');
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
    paddingHorizontal: Space.s20,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rail: {
    paddingVertical: Space.s10,
    paddingRight: Space.s10,
  },

  featuredEmpty: {
    marginTop: Space.s22,
    paddingTop: Space.s22,
    paddingBottom: Space.s22,
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
    gap: Space.s6,
  },
  featuredEmptyHead: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.ink,
    letterSpacing: 0.5,
  },
  featuredEmptySub: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },

  askCard: {
    marginTop: 4,
    padding: Space.s18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: AM.amber,
  },
  askQuote: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s16,
    color: AM.ink,
    lineHeight: TypeScale.s16 * 1.35,
  },
  askHint: {
    marginTop: Space.s8,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.amberDim,
    letterSpacing: 2,
  },

  recentRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: Space.s14,
    gap: Space.s12,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  recentNum: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amberDim,
    letterSpacing: 1,
    width: 32,
  },
  recentBody: {
    flex: 1,
  },
  recentTitle: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s15,
    color: AM.ink,
    letterSpacing: 0.5,
    lineHeight: 18,
  },
  recentDate: {
    marginTop: 3,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 1.5,
  },
  recentDuration: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.inkMid,
    letterSpacing: 1,
  },

  colophon: {
    marginTop: Space.s40,
    paddingTop: Space.s16,
    borderTopWidth: 0.5,
    borderTopColor: AM.rule,
    alignItems: 'center',
    gap: 4,
  },
  colophonText: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: AM.inkDim,
    textAlign: 'center',
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

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
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { BroadcastBackdrop } from '../../components/BroadcastBackdrop';
import { TuningInOverlay } from '../../components/broadcast/TuningInOverlay';
import { SetupSheet, type SetupResult } from '../../components/broadcast/SetupSheet';
import { FeaturedBroadcastCard } from '../../components/broadcast/FeaturedBroadcastCard';
import { FeaturedRailCard } from '../../components/broadcast/FeaturedRailCard';
import { SlotPlaceholderCard } from '../../components/broadcast/SlotPlaceholderCard';
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
import { BroadcastManifestClient, sanitizeTracksForBake } from '../../engines/BroadcastManifestClient';
import { broadcastPlayer } from '../../engines/BroadcastPlayer.singleton';
import { BroadcastResumer } from '../../engines/BroadcastResumer';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import type { Manifest } from '../../engines/BroadcastPlayer.types';
import {
  getBroadcastHistory,
  getCachedPlaylists,
  getPersistedBroadcast,
  removeBroadcastFromHistory,
  clearPersistedBroadcast,
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

type HomeCtaMode =
  | { kind: 'fresh' }
  | { kind: 'resume'; manifest: Manifest; trackCursor: number }
  | { kind: 'now-playing'; manifest: Manifest; trackIndex: number };

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
  const [mode, setMode] = useState<HomeCtaMode>({ kind: 'fresh' });

  useEffect(() => {
    if (!appActive) return;
    const tick = () => {
      const status = broadcastPlayer.getStatus();
      const active = ACTIVE_STATES.has(status.state);
      setBroadcastActive(active);
      // Keep mode.now-playing track index in sync with the live player;
      // drop to fresh when the player stops.
      setMode(prev => {
        if (prev.kind !== 'now-playing') return prev;
        if (!active) return { kind: 'fresh' };
        if (status.currentTrackIndex === prev.trackIndex) return prev;
        return { ...prev, trackIndex: Math.max(0, status.currentTrackIndex) };
      });
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [appActive]);

  const refreshRecent = useCallback(() => setRecent(getBroadcastHistory()), []);

  // On focus: show cached history immediately, then verify each entry
  // against the server in parallel. Entries whose broadcast returned 404
  // are pruned (R2 eviction, server-side wipe, etc.). Non-404 errors keep
  // the entry so we don't destroy history on a flaky connection.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const initial = getBroadcastHistory();
    setRecent(initial);
    if (initial.length === 0) return;
    const client = new BroadcastManifestClient();
    (async () => {
      const deadIds: string[] = [];
      await Promise.all(initial.map(async (entry) => {
        try {
          await client.fetchManifest(entry.manifest.broadcastId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('404')) deadIds.push(entry.manifest.broadcastId);
        }
      }));
      if (cancelled || deadIds.length === 0) return;
      deadIds.forEach(id => removeBroadcastFromHistory(id));
      setRecent(getBroadcastHistory());
    })();
    return () => { cancelled = true; };
  }, []));

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

  // Load featured broadcasts + playlists. Independent of the CTA mode
  // resolution below so the Resume card can surface without waiting on
  // Apple Music / editorial HTTP.
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
    })();
    return () => { mounted = false; };
  }, [loadPlaylists]);

  // Derive the primary-CTA mode from two signals:
  //  (a) is the BroadcastPlayer singleton currently active in memory, and
  //  (b) is there a resumable persisted record that passes freshness.
  // Runs in parallel with the featured/playlists load above so the Resume
  // card resolves on its own fast path — otherwise the user can tap the
  // top "Earlier Tonight" entry before the check finishes and get a
  // start-from-top replay instead of a true resume.
  useEffect(() => {
    let mounted = true;
    (async () => {
      // If a broadcast is already active in memory, show Now Playing and
      // skip the resume check — the live player is authoritative.
      const status = broadcastPlayer.getStatus();
      if (ACTIVE_STATES.has(status.state) && status.broadcastId) {
        try {
          const m = await new BroadcastManifestClient().fetchManifest(status.broadcastId);
          if (!mounted) return;
          setMode({
            kind: 'now-playing',
            manifest: m,
            trackIndex: Math.max(0, status.currentTrackIndex),
          });
          return;
        } catch (err) {
          console.warn('[HomeBroadcast] live-manifest fetch failed', err);
        }
      }

      try {
        const resumer = new BroadcastResumer();
        const result = await resumer.check();
        if (!mounted) return;
        if (result) {
          setMode({
            kind: 'resume',
            manifest: result.manifest,
            trackCursor: result.trackCursor,
          });
        }
      } catch (err) {
        console.warn('[HomeBroadcast] resumer.check failed', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

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
      const sanitized = sanitizeTracksForBake(tracks).slice(0, 20);
      if (sanitized.length < 5) {
        throw new Error(
          `Playlist has only ${sanitized.length} playable track${sanitized.length === 1 ? '' : 's'} (need at least 5).`,
        );
      }
      const { manifest, firstSegmentUrls } = await client.createBroadcast({
        playlistId: result.playlistId,
        vibe: result.vibe,
        length: result.length,
        userContext: {
          timeOfDay: new Date().toTimeString().slice(0, 5),
          dayOfWeek: new Date().toLocaleDateString(undefined, { weekday: 'long' }),
          firstTimeUser: false,
        },
        tracks: sanitized,
      });
      router.push('/(main)/(broadcast)/player');
      broadcastPlayer.start(manifest, firstSegmentUrls).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        Alert.alert('Broadcast error', msg);
      });
    } catch (err) {
      if (err instanceof Error && /playable tracks?/i.test(err.message)) {
        Alert.alert(
          'Playlist changed',
          'This playlist no longer has enough playable tracks. Pick another.',
          [{ text: 'OK', onPress: () => openSheetAt(0) }],
        );
        return;
      }
      const msg = err instanceof Error ? err.message : 'Try again.';
      Alert.alert('Broadcast unavailable', msg);
    } finally {
      setTuning(false);
    }
  }, [router, openSheetAt]);

  const onSheetSubmit = useCallback((r: SetupResult) => {
    setSheetOpen(false);
    setPlaylistId(r.playlistId);
    setVibe(r.vibe);
    setLength(r.length);
    void playUserSourced(r);
  }, [playUserSourced]);

  const onResume = useCallback(() => {
    if (mode.kind !== 'resume') return;
    const { manifest: m, trackCursor } = mode;
    router.push('/(main)/(broadcast)/player');
    broadcastPlayer.resume(m, trackCursor).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    });
  }, [mode, router]);

  const onStartFresh = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert(
      'Start a new broadcast?',
      "You'll lose your place in tonight's set.",
      [
        { text: 'Keep current', style: 'cancel' },
        {
          text: 'Start fresh',
          style: 'destructive',
          onPress: () => {
            clearPersistedBroadcast();
            setMode({ kind: 'fresh' });
          },
        },
      ],
    );
  }, []);

  const onOpenNowPlaying = useCallback(() => {
    router.push('/(main)/(broadcast)/player');
  }, [router]);

  const playRecent = useCallback(async (entry: BroadcastHistoryEntry) => {
    // Verify the broadcast still exists server-side before trying to play.
    // If the manifest is 404 the backing R2 audio is gone and playback would
    // fail opaquely — prune from history and tell the user directly.
    // Use the fresh manifest when we can get it (slots may have flipped
    // pending→ready since the history entry was cached).
    let freshManifest: Manifest | null = null;
    try {
      freshManifest = await new BroadcastManifestClient().fetchManifest(entry.manifest.broadcastId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404')) {
        removeBroadcastFromHistory(entry.manifest.broadcastId);
        refreshRecent();
        Alert.alert('Broadcast unavailable', 'This broadcast is no longer on the server. Removed from your history.');
        return;
      }
      // Transient error: let the user try anyway; start()/resume() will
      // surface any real playback issue.
      console.warn('[HomeBroadcast] recent verify failed (playing anyway):', msg);
    }
    const manifest = freshManifest ?? entry.manifest;

    // If the tapped entry matches the persisted-cursor record, resume from
    // the last track the user heard instead of replaying from the top.
    // Catches the common "user taps Earlier Tonight before Resume CTA
    // resolves on cold launch" case that looked identical to 'start over'.
    const persisted = getPersistedBroadcast();
    const isResumable =
      persisted !== undefined
      && persisted.manifest.broadcastId === entry.manifest.broadcastId
      && persisted.trackCursor >= 0;

    router.push('/(main)/(broadcast)/player');
    const onErr = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    };
    if (isResumable && persisted) {
      broadcastPlayer.resume(manifest, persisted.trackCursor).catch(onErr);
    } else {
      broadcastPlayer.start(manifest, entry.firstSegmentUrls).catch(onErr);
    }
  }, [router, refreshRecent]);

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

  const morningCard = featured.find(b => b.slot === 'morning') ?? null;
  const eveningCard = featured.find(b => b.slot === 'evening') ?? null;
  const legacyCards = featured.filter(b => !b.slot);
  const lead = morningCard ?? eveningCard ?? null;

  // Hide the resumable broadcast from "Earlier Tonight" — it's already
  // surfaced at the top as the Resume (or Now Playing) CTA, so showing
  // it twice is confusing.
  const hiddenBroadcastId =
    mode.kind === 'resume' ? mode.manifest.broadcastId
    : mode.kind === 'now-playing' ? mode.manifest.broadcastId
    : null;
  const visibleRecent = hiddenBroadcastId
    ? recent.filter(e => e.manifest.broadcastId !== hiddenBroadcastId)
    : recent;

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

        {/* TONIGHT ON ONAY — twin-slot stack */}
        {morningCard ? (
          <FeaturedBroadcastCard
            broadcast={morningCard}
            onPress={() => playFeatured(morningCard)}
            tagline={morningCard.description}
            slotLabel="MORNING"
          />
        ) : (
          <SlotPlaceholderCard slotLabel="MORNING" />
        )}

        {eveningCard ? (
          <FeaturedBroadcastCard
            broadcast={eveningCard}
            onPress={() => playFeatured(eveningCard)}
            tagline={eveningCard.description}
            slotLabel="EVENING"
          />
        ) : (
          <SlotPlaceholderCard slotLabel="EVENING" />
        )}

        {legacyCards.length > 0 && (
          <>
            <SectionMarker num="B·04" title="MORE FROM ONAY" side="ARCHIVE" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
              snapToInterval={162}
              decelerationRate="fast"
              snapToAlignment="start"
            >
              {legacyCards.map(fb => (
                <FeaturedRailCard key={fb.id} broadcast={fb} onPress={() => playFeatured(fb)} />
              ))}
            </ScrollView>
          </>
        )}

        {/* Liner note from ONAY */}
        <View style={{ marginTop: Space.s26 }}>
          <LinerNotes>
            {lead?.description
              ? `Tonight — ${lead.description.toLowerCase()}. Stay with it through the first side.`
              : 'Picked records, not algorithms. Stay with them.'}
          </LinerNotes>
        </View>

        {/* Primary CTA — tri-state: fresh / resume / now-playing */}
        {mode.kind === 'resume' && (
          <>
            <SectionMarker num="B·01" title="RESUME TONIGHT" side="PICK UP WHERE YOU LEFT" />
            <View style={{ marginTop: 4 }}>
              <CatalogRow
                label="FROM"
                placeholder=""
                value={
                  playlists.find(p => p.id === mode.manifest.playlistId)?.name?.toUpperCase()
                  ?? `${VIBE_LABEL[mode.manifest.vibe]} · ${mode.manifest.tracks.length} TRACKS`
                }
                onPress={onResume}
              />
              <CatalogRow
                label="VIBE"
                placeholder=""
                value={VIBE_LABEL[mode.manifest.vibe]}
                onPress={onResume}
              />
              <CatalogRow
                label="TRACK"
                placeholder=""
                value={`${Math.max(0, mode.trackCursor) + 1} OF ${mode.manifest.tracks.length}`}
                onPress={onResume}
              />
            </View>

            <View style={{ height: Space.s22 }} />
            <StampButton
              label="RESUME"
              sub={`TRACK ${Math.max(0, mode.trackCursor) + 1} OF ${mode.manifest.tracks.length}`}
              onPress={onResume}
              accessibilityHint="Resume the broadcast where you left off"
            />
            <Pressable
              onPress={onStartFresh}
              accessibilityRole="button"
              accessibilityLabel="Start a fresh broadcast"
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={({ pressed }) => [styles.startFresh, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.startFreshText}>START FRESH</Text>
            </Pressable>
          </>
        )}

        {mode.kind === 'now-playing' && (
          <>
            <SectionMarker num="B·01" title="NOW PLAYING" side="ON AIR" />
            <View style={{ marginTop: 4 }}>
              <CatalogRow
                label="FROM"
                placeholder=""
                value={
                  playlists.find(p => p.id === mode.manifest.playlistId)?.name?.toUpperCase()
                  ?? `${VIBE_LABEL[mode.manifest.vibe]} · ${mode.manifest.tracks.length} TRACKS`
                }
                onPress={onOpenNowPlaying}
              />
              <CatalogRow
                label="VIBE"
                placeholder=""
                value={VIBE_LABEL[mode.manifest.vibe]}
                onPress={onOpenNowPlaying}
              />
              <CatalogRow
                label="TRACK"
                placeholder=""
                value={`${Math.max(0, mode.trackIndex) + 1} OF ${mode.manifest.tracks.length}`}
                onPress={onOpenNowPlaying}
              />
            </View>

            <View style={{ height: Space.s22 }} />
            <StampButton
              label="OPEN PLAYER"
              sub={`TRACK ${Math.max(0, mode.trackIndex) + 1} OF ${mode.manifest.tracks.length}`}
              onPress={onOpenNowPlaying}
              accessibilityHint="Opens the Now Playing screen"
            />
          </>
        )}

        {mode.kind === 'fresh' && (
          <>
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
          </>
        )}

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
        {visibleRecent.length > 0 && (
          <>
            <SectionMarker num="B·03" title="EARLIER TONIGHT" side="24 HOURS" />
            {visibleRecent.map((entry, i) => (
              <Pressable
                key={entry.manifest.broadcastId}
                onPress={() => playRecent(entry)}
                accessibilityRole="button"
                accessibilityLabel={`Replay ${titleFor(entry, playlists)}`}
                style={({ pressed }) => [styles.recentRow, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.recentNum}>{padIndex(visibleRecent.length - i)}</Text>
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

      <TuningInOverlay visible={tuning} onCancel={() => setTuning(false)} />
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

  startFresh: {
    marginTop: 8,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  startFreshText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s12,
    letterSpacing: 2,
    color: AM.amber,
    textDecorationLine: 'underline',
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

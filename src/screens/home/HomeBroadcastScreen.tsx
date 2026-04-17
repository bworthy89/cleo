import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert, Animated, Easing, Pressable, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Surface, TextColors, Spacing, Typography, Radius } from '../../tokens/design-tokens';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import {
  BroadcastCurationClient,
  type FeaturedBroadcast,
} from '../../engines/BroadcastCurationClient';
import { BroadcastManifestClient } from '../../engines/BroadcastManifestClient';
import { broadcastPlayer } from '../../engines/BroadcastPlayer.singleton';
import { BroadcastResumer } from '../../engines/BroadcastResumer';
import { FeaturedBroadcastCard } from '../../components/broadcast/FeaturedBroadcastCard';
import { YourBroadcastSetup, AskOnayButton } from '../../components/broadcast/YourBroadcastSetup';
import { TuningInOverlay } from '../../components/broadcast/TuningInOverlay';
import type { SetupResult } from '../../components/broadcast/SetupSheet';
import { useAppActive } from '../../hooks/useAppActive';
import {
  getBroadcastHistory,
  type BroadcastHistoryEntry,
} from '../../services/Storage';

const monoLabel = {
  color: Colors.accent,
  fontFamily: Typography.mono.family,
  fontSize: 10,
  letterSpacing: 3,
};

function FeaturedEmptyState() {
  const active = useAppActive();
  const ring = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1.0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0.7, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, ring]);
  return (
    <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
      <Animated.View style={{
        width: 80, height: 80, borderRadius: 40,
        borderWidth: 1.5, borderColor: Colors.accent,
        opacity: 0.4,
        marginBottom: Spacing.md,
        transform: [{ scale: ring }],
      }} />
      <Text style={{
        color: TextColors.primary,
        fontFamily: Typography.display.family,
        fontSize: 18,
        textAlign: 'center',
        marginBottom: Spacing.xs,
      }}>
        Fresh broadcasts baking.
      </Text>
      <Text style={{ color: TextColors.secondary, fontSize: 13, textAlign: 'center' }}>
        Check back soon — or build your own above.
      </Text>
    </View>
  );
}

/** Small pulsing dot that anchors the "live" editorial label. */
function LiveDot() {
  const active = useAppActive();
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.4, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.7, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, scale, opacity]);
  return (
    <Animated.View
      style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: Colors.accent,
        marginRight: Spacing.xs,
        transform: [{ scale }],
        opacity,
      }}
    />
  );
}

function freshness(createdAt: number): string {
  const ms = Date.now() - createdAt;
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return 'Yesterday';
}

function RecentBroadcastRow({
  entry, onPress,
}: { entry: BroadcastHistoryEntry; onPress: () => void }) {
  const { manifest } = entry;
  const firstTrack = manifest.tracks[0];
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Replay ${manifest.vibe} broadcast with ${manifest.tracks.length} tracks`}
      style={({ pressed }) => ({
        backgroundColor: Surface.container,
        borderLeftWidth: 2,
        borderLeftColor: Colors.accent,
        padding: Spacing.md,
        borderRadius: Radius.sm,
        marginBottom: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {firstTrack?.artworkUrl ? (
        <Image
          source={{ uri: firstTrack.artworkUrl }}
          style={{ width: 56, height: 56, borderRadius: Radius.sm, marginRight: Spacing.md }}
        />
      ) : (
        <View style={{
          width: 56, height: 56, borderRadius: Radius.sm,
          marginRight: Spacing.md, backgroundColor: Surface.high,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="radio" size={22} color={Colors.accent} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 16 }}
          numberOfLines={1}
        >
          Your {manifest.vibe} broadcast
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: Spacing.sm }}>
          <Text style={{
            color: Colors.accent, fontFamily: Typography.mono.family,
            fontSize: 10, letterSpacing: 2,
          }}>
            {manifest.length.toUpperCase()} · {manifest.tracks.length} TRACKS
          </Text>
          <Text style={{ color: TextColors.outline, fontSize: 10 }}>·</Text>
          <Text style={{
            color: TextColors.outline, fontFamily: Typography.mono.family,
            fontSize: 10, letterSpacing: 1.5,
          }}>
            {freshness(entry.createdAt).toUpperCase()}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={TextColors.outline} style={{ marginLeft: Spacing.sm }} />
    </Pressable>
  );
}

function SectionLabel({ text, live }: { text: string; live?: boolean }) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xs }}>
        {live && <LiveDot />}
        <Text style={monoLabel}>{text}</Text>
      </View>
      <View style={{ height: 2, width: 40, backgroundColor: Colors.accent, marginBottom: Spacing.md }} />
    </>
  );
}

export default function HomeBroadcastScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [featured, setFeatured] = useState<FeaturedBroadcast[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tuning, setTuning] = useState(false);
  const [recent, setRecent] = useState<BroadcastHistoryEntry[]>([]);

  // Recompute on every focus so the list reflects new bakes that happened
  // on the /player screen and prunes anything that aged out of retention.
  const refreshRecent = useCallback(() => {
    setRecent(getBroadcastHistory());
  }, []);

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
      setPlaylists([]);
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    refreshRecent();
  }, [refreshRecent]));

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

      // Resume-after-terminate: if a broadcast was persisted within the last
      // 2 hours, offer to resume it.
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

  const playRecent = useCallback((entry: BroadcastHistoryEntry) => {
    router.push('/(main)/(broadcast)/player');
    // Zero-cost replay: reuses stored manifest + R2 URLs from the original
    // bake. No LLM/TTS calls, no /broadcast/create roundtrip.
    broadcastPlayer.start(entry.manifest, entry.firstSegmentUrls).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    });
  }, [router]);

  const playFeatured = useCallback((fb: FeaturedBroadcast) => {
    const firstSlot = fb.manifest.segmentSlots[0];
    const firstUrls = firstSlot?.audioUrls ?? [];
    // Navigate first — the player screen shows its own "Tuning in" UI while
    // the first segment is fetched. Don't set the home-screen overlay here;
    // there's nothing to await on this path.
    router.push('/(main)/(broadcast)/player');
    broadcastPlayer.start(fb.manifest, firstUrls).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    });
  }, [router]);

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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.base.black, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: Colors.base.black }}
        contentContainerStyle={{
          paddingHorizontal: Spacing.lg,
          paddingTop: insets.top + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xxl,
        }}
      >
        <SectionLabel text="YOUR BROADCAST" />
        <YourBroadcastSetup
          playlists={playlists}
          playlistsLoading={playlistsLoading}
          playlistsError={playlistsError}
          onRetryPlaylists={loadPlaylists}
          onOpenAskOnay={() => router.push('/(main)/(broadcast)/ask-onay')}
          onSubmit={playUserSourced}
        />
        <AskOnayButton onPress={() => router.push('/(main)/(broadcast)/ask-onay')} />

        {recent.length > 0 && (
          <>
            <View style={{ height: Spacing.xl }} />
            <SectionLabel text="RECENT BROADCASTS" />
            {recent.map(entry => (
              <RecentBroadcastRow
                key={entry.manifest.broadcastId}
                entry={entry}
                onPress={() => playRecent(entry)}
              />
            ))}
            <Text style={{
              color: TextColors.outline,
              fontFamily: Typography.mono.family,
              fontSize: 10,
              letterSpacing: 1.5,
              marginTop: Spacing.xs,
            }}>
              SAVED FOR 24 HOURS
            </Text>
          </>
        )}

        <View style={{ height: Spacing.xl }} />

        <SectionLabel text="TONIGHT ON ONAY" live />

        {featured.length === 0 ? (
          <FeaturedEmptyState />
        ) : (
          featured.map(fb => (
            <FeaturedBroadcastCard key={fb.id} broadcast={fb} onPress={() => playFeatured(fb)} />
          ))
        )}
      </ScrollView>

      <TuningInOverlay visible={tuning} />
    </>
  );
}

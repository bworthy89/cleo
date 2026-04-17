import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Surface, TextColors, Spacing, Typography } from '../../tokens/design-tokens';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import {
  BroadcastCurationClient,
  type FeaturedBroadcast,
} from '../../engines/BroadcastCurationClient';
import { BroadcastManifestClient } from '../../engines/BroadcastManifestClient';
import { broadcastPlayer } from '../../engines/BroadcastPlayer.singleton';
import { FeaturedBroadcastCard } from '../../components/broadcast/FeaturedBroadcastCard';
import { YourBroadcastSetup } from '../../components/broadcast/YourBroadcastSetup';
import { TuningInOverlay } from '../../components/broadcast/TuningInOverlay';
import type { SetupResult } from '../../components/broadcast/SetupSheet';

const monoLabel = {
  color: Colors.accent,
  fontFamily: Typography.mono.family,
  fontSize: 10,
  letterSpacing: 3,
};

export default function HomeBroadcastScreen() {
  const router = useRouter();
  const [featured, setFeatured] = useState<FeaturedBroadcast[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [tuning, setTuning] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [feats, pls] = await Promise.all([
          new BroadcastCurationClient().listFeatured(),
          musicKitPlayer.fetchPlaylists().catch(() => [] as MusicPlaylist[]),
        ]);
        if (!mounted) return;
        setFeatured(feats);
        setPlaylists(pls);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const playFeatured = useCallback(async (fb: FeaturedBroadcast) => {
    setTuning(true);
    try {
      const firstSlot = fb.manifest.segmentSlots[0];
      const firstUrls = firstSlot?.audioUrls ?? [];
      router.push('/(main)/(broadcast)/broadcast-player');
      // fire-and-forget — player runs for the lifetime of the session
      broadcastPlayer.start(fb.manifest, firstUrls).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Playback failed';
        Alert.alert('Broadcast error', msg);
      });
    } finally {
      setTuning(false);
    }
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
      router.push('/(main)/(broadcast)/broadcast-player');
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
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.xxl }}
      >
        <Text style={{ ...monoLabel, marginBottom: Spacing.xs }}>TONIGHT ON ONAY</Text>
        <View style={{ height: 2, width: 40, backgroundColor: Colors.accent, marginBottom: Spacing.md }} />

        {featured.length === 0 ? (
          <View style={{
            backgroundColor: Surface.container,
            borderLeftWidth: 2,
            borderLeftColor: Colors.accent,
            padding: Spacing.md,
            marginBottom: Spacing.xl,
          }}>
            <Text style={{ color: TextColors.secondary }}>
              New broadcasts coming soon.
            </Text>
          </View>
        ) : (
          featured.map(fb => (
            <FeaturedBroadcastCard key={fb.id} broadcast={fb} onPress={() => playFeatured(fb)} />
          ))
        )}

        <View style={{ height: Spacing.xl }} />

        <Text style={{ ...monoLabel, marginBottom: Spacing.xs }}>YOUR BROADCAST</Text>
        <View style={{ height: 2, width: 40, backgroundColor: Colors.accent, marginBottom: Spacing.md }} />

        <YourBroadcastSetup playlists={playlists} onSubmit={playUserSourced} />
      </ScrollView>

      <TuningInOverlay visible={tuning} />
    </>
  );
}

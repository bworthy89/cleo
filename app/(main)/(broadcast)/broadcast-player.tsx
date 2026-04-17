import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Colors, Surface, TextColors, Typography, Spacing, Radius } from '../../../src/tokens/design-tokens';
import { broadcastPlayer } from '../../../src/engines/BroadcastPlayer.singleton';
import { BroadcastManifestClient } from '../../../src/engines/BroadcastManifestClient';
import type { PlayerStatus, Vibe, BroadcastLength, ManifestTrack } from '../../../src/engines/BroadcastPlayer.types';
import { musicKitPlayer } from '../../../src/services/MusicKitPlayer';
import { useAppActive } from '../../../src/hooks/useAppActive';

const client = new BroadcastManifestClient();

const VIBES: Vibe[] = ['morning', 'chill', 'lateNight', 'feelGood', 'focus'];
const LENGTHS: BroadcastLength[] = ['quick', 'standard', 'long'];

type Playlist = { id: string; name: string };

export default function BroadcastPlayerScreen() {
  const active = useAppActive();
  const [status, setStatus] = useState<PlayerStatus>(broadcastPlayer.getStatus());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [vibe, setVibe] = useState<Vibe>('morning');
  const [length, setLength] = useState<BroadcastLength>('quick');
  const [baking, setBaking] = useState(false);
  const [bakeLog, setBakeLog] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    musicKitPlayer.fetchPlaylists()
      .then(list => setPlaylists(list.slice(0, 30).map(p => ({ id: p.id, name: p.name }))))
      .catch(err => log(`[playlists] ${err.message ?? err}`));
  }, []);

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

  function log(line: string) {
    setBakeLog(prev => [...prev.slice(-20), line]);
  }

  async function handleBakeAndPlay() {
    if (!selectedPlaylist) {
      Alert.alert('Pick a playlist first');
      return;
    }
    setBaking(true);
    setBakeLog([]);
    try {
      log(`Fetching tracks for "${selectedPlaylist.name}"...`);
      const tracks = await musicKitPlayer.fetchPlaylistTracks(selectedPlaylist.id);
      const manifestTracks: ManifestTrack[] = tracks.map(t => ({
        id: t.id,
        title: t.title,
        artistName: t.artistName,
        albumTitle: t.albumTitle ?? '',
        duration: t.duration ?? 180,
        artworkUrl: t.artworkUrl,
      }));
      log(`Got ${manifestTracks.length} tracks. Baking broadcast...`);

      const now = new Date();
      const result = await client.createBroadcast({
        playlistId: selectedPlaylist.id,
        vibe,
        length,
        userContext: {
          timeOfDay: now.toTimeString().slice(0, 5),
          dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
          firstTimeUser: false,
        },
        tracks: manifestTracks,
      });

      log(`Bake returned ${result.firstSegmentUrls.length} cold-open variants.`);
      log(`broadcastId: ${result.manifest.broadcastId}`);
      log('Starting player...');
      await broadcastPlayer.start(result.manifest, result.firstSegmentUrls);
      log('Player done.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`ERROR: ${msg}`);
      Alert.alert('Bake failed', msg);
    } finally {
      setBaking(false);
    }
  }

  const monoStyle = { color: TextColors.secondary, fontFamily: Typography.mono.family, fontSize: 10, letterSpacing: 2.5 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.base.black }} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing.xxl }}>
      <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 28, marginBottom: Spacing.lg }}>
        Broadcast Dev
      </Text>

      <Text style={{ ...monoStyle, marginBottom: Spacing.sm }}>STATE</Text>
      <Text style={{ color: TextColors.primary, marginBottom: Spacing.md }}>
        {status.state} — t={status.currentTrackIndex} s={status.currentSegmentIndex} ({(status.progress * 100).toFixed(0)}%)
      </Text>

      {status.state === 'idle' && (
        <>
          <Text style={{ ...monoStyle, marginBottom: Spacing.sm }}>VIBE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md }}>
            {VIBES.map(v => (
              <Pressable
                key={v}
                accessibilityRole="button"
                accessibilityLabel={`Select vibe ${v}`}
                onPress={() => setVibe(v)}
                style={{
                  paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
                  backgroundColor: vibe === v ? Colors.accent : Surface.container,
                  borderRadius: Radius.sm,
                }}
              >
                <Text style={{ color: vibe === v ? Colors.base.black : TextColors.primary, fontFamily: Typography.mono.family, fontSize: 11 }}>
                  {v.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ ...monoStyle, marginBottom: Spacing.sm }}>LENGTH</Text>
          <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md }}>
            {LENGTHS.map(l => (
              <Pressable
                key={l}
                accessibilityRole="button"
                accessibilityLabel={`Select length ${l}`}
                onPress={() => setLength(l)}
                style={{
                  paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
                  backgroundColor: length === l ? Colors.accent : Surface.container,
                  borderRadius: Radius.sm,
                }}
              >
                <Text style={{ color: length === l ? Colors.base.black : TextColors.primary, fontFamily: Typography.mono.family, fontSize: 11 }}>
                  {l.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ ...monoStyle, marginBottom: Spacing.sm }}>PLAYLIST</Text>
          {playlists.length === 0 ? (
            <Text style={{ color: TextColors.secondary, marginBottom: Spacing.md }}>Loading playlists...</Text>
          ) : (
            <View style={{ marginBottom: Spacing.md }}>
              {playlists.map(p => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Select playlist ${p.name}`}
                  onPress={() => setSelectedPlaylist(p)}
                  style={{
                    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
                    backgroundColor: selectedPlaylist?.id === p.id ? Surface.high : Surface.container,
                    borderLeftWidth: selectedPlaylist?.id === p.id ? 2 : 0,
                    borderLeftColor: Colors.accent,
                    marginBottom: 2,
                  }}
                >
                  <Text style={{ color: TextColors.primary, fontSize: 14 }} numberOfLines={1}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Bake and play broadcast"
            disabled={baking || !selectedPlaylist}
            onPress={handleBakeAndPlay}
            style={{
              padding: Spacing.md,
              backgroundColor: baking || !selectedPlaylist ? Surface.high : Colors.accent,
              borderRadius: Radius.sm,
              marginBottom: Spacing.sm,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: Spacing.sm,
            }}
          >
            {baking && <ActivityIndicator color={Colors.base.black} />}
            <Text style={{ color: Colors.base.black, fontFamily: Typography.mono.family, fontSize: 12, letterSpacing: 2 }}>
              {baking ? 'BAKING...' : 'BAKE & PLAY'}
            </Text>
          </Pressable>
        </>
      )}

      <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pause broadcast"
          onPress={() => { broadcastPlayer.pause().catch(() => {}); }}
          style={{ flex: 1, padding: Spacing.md, backgroundColor: Surface.container, borderRadius: Radius.sm }}
        >
          <Text style={{ color: TextColors.primary, fontFamily: Typography.mono.family, textAlign: 'center' }}>PAUSE</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume broadcast"
          onPress={() => { broadcastPlayer.resume().catch(() => {}); }}
          style={{ flex: 1, padding: Spacing.md, backgroundColor: Surface.container, borderRadius: Radius.sm }}
        >
          <Text style={{ color: TextColors.primary, fontFamily: Typography.mono.family, textAlign: 'center' }}>RESUME</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="End broadcast"
          onPress={() => { broadcastPlayer.end().catch(() => {}); }}
          style={{ flex: 1, padding: Spacing.md, backgroundColor: Surface.container, borderRadius: Radius.sm }}
        >
          <Text style={{ color: TextColors.primary, fontFamily: Typography.mono.family, textAlign: 'center' }}>END</Text>
        </Pressable>
      </View>

      {status.state === 'idle' && bakeLog.length > 0 && (
        <>
          <Text style={{ ...monoStyle, marginBottom: Spacing.sm }}>LOG</Text>
          <View style={{ backgroundColor: Surface.lowest, padding: Spacing.sm, borderRadius: Radius.sm }}>
            {bakeLog.map((line, i) => (
              <Text key={i} style={{ color: TextColors.secondary, fontSize: 11, fontFamily: Typography.mono.family }}>{line}</Text>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Alert } from 'react-native';
import { Colors, Typography, Spacing } from '../../tokens/design-tokens';
import { StationCard } from '../../components/StationCard';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { generateSegment } from '../../services/CleoScriptGenerator';
import { synthesizeAndPlay } from '../../services/CleoVoiceEngine';
import {
  getStations,
  addStation,
  addRecentlyPlayedTrack,
  type Station,
} from '../../services/Storage';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';

type AuthState = 'loading' | 'unauthorized' | 'ready' | 'playing';

interface NowPlayingInfo {
  title: string;
  artistName: string;
}

export function HomeScreen() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [stations, setStations] = useState<Station[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [cleoSpeaking, setCleoSpeaking] = useState(false);

  const handleTestCleo = useCallback(async () => {
    if (!nowPlaying || cleoSpeaking) return;
    setCleoSpeaking(true);
    try {
      const script = await generateSegment({
        segmentType: 'song_intro',
        vibe: 'chill',
        currentTrack: {
          title: nowPlaying.title,
          artistName: nowPlaying.artistName,
        },
      });
      console.log('Cleo says:', script);
      await synthesizeAndPlay(script);
    } catch (error) {
      console.error('Test Cleo failed:', error);
    } finally {
      setCleoSpeaking(false);
    }
  }, [nowPlaying, cleoSpeaking]);

  // Check auth on mount
  useEffect(() => {
    (async () => {
      const authorized = await musicKitPlayer.isAuthorized();
      if (authorized) {
        setAuthState('ready');
        loadData();
      } else {
        setAuthState('unauthorized');
      }
    })();
  }, []);

  // Listen for track changes
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged((event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        refreshNowPlaying();
      }
    });
    return unsub;
  }, []);

  async function loadData() {
    setStations(getStations());
    try {
      const lists = await musicKitPlayer.fetchPlaylists();
      setPlaylists(lists);
    } catch {
      // playlists may fail in simulator — non-fatal
    }
    await refreshNowPlaying();
  }

  async function refreshNowPlaying() {
    const np = await musicKitPlayer.getNowPlaying();
    if (np) {
      setNowPlaying({ title: np.title, artistName: np.artistName });
      setAuthState('playing');
    }
  }

  const handleAuthorize = useCallback(async () => {
    const result = await musicKitPlayer.authorize();
    if (result.status === 'authorized') {
      setAuthState('ready');
      loadData();
    }
  }, []);

  const handlePlaylistPress = useCallback(
    (playlist: MusicPlaylist) => {
      const existing = stations.find((s) => s.playlistId === playlist.id);
      if (!existing) {
        const station: Station = {
          id: `station-${Date.now()}`,
          name: playlist.name,
          playlistId: playlist.id,
          defaultVibe: 'morning',
          artworkUrl: playlist.artworkUrl,
          createdAt: new Date().toISOString(),
        };
        addStation(station);
        setStations(getStations());
      }
    },
    [stations],
  );

  const handleStationPress = useCallback(async (station: Station) => {
    try {
      const tracks = await musicKitPlayer.fetchPlaylistTracks(
        station.playlistId,
      );
      if (tracks.length > 0) {
        await musicKitPlayer.play(tracks.map((t) => t.id));
        setAuthState('playing');
        refreshNowPlaying();
      }
    } catch {
      // playback may fail in simulator
    }
  }, []);

  // ── Unauthorized ────────────────────────────────────────────────────
  if (authState === 'unauthorized') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>CLEO</Text>
          <Text style={styles.subtitle}>AI RADIO HOST</Text>
          <Pressable style={styles.authButton} onPress={handleAuthorize}>
            <Text style={styles.authButtonText}>Connect Apple Music</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────
  if (authState === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.mono}>LOADING...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Ready / Playing ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CLEO</Text>
        <Text style={styles.onAir}>ON AIR</Text>
      </View>

      {nowPlaying && (
        <View style={styles.nowPlaying}>
          <Text style={styles.mono}>NOW PLAYING</Text>
          <Text style={styles.nowPlayingTitle}>{nowPlaying.title}</Text>
          <Text style={styles.nowPlayingArtist}>{nowPlaying.artistName}</Text>
          <Pressable
            style={[styles.testButton, cleoSpeaking && styles.testButtonDisabled]}
            onPress={handleTestCleo}
            disabled={cleoSpeaking}
          >
            <Text style={styles.testButtonText}>
              {cleoSpeaking ? 'CLEO SPEAKING...' : 'TEST CLEO'}
            </Text>
          </Pressable>
        </View>
      )}

      {stations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>YOUR STATIONS</Text>
          <FlatList
            data={stations}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <StationCard
                name={item.name}
                artworkUrl={item.artworkUrl}
                onPress={() => handleStationPress(item)}
              />
            )}
          />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PLAYLISTS</Text>
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <StationCard
              name={item.name}
              artworkUrl={item.artworkUrl}
              onPress={() => handlePlaylistPress(item)}
            />
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 42,
    color: Colors.vibe.morning.text,
    letterSpacing: 4,
  },
  subtitle: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 12,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: Spacing.sm,
  },
  onAir: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.accent,
    letterSpacing: 3,
  },
  mono: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.accent,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  nowPlaying: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  nowPlayingTitle: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: Colors.vibe.morning.text,
    marginTop: Spacing.xs,
  },
  nowPlayingArtist: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    color: Colors.vibe.morning.text,
    opacity: 0.7,
    marginTop: Spacing.xs,
  },
  section: {
    marginTop: Spacing.lg,
  },
  sectionTitle: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  authButton: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.vibe.morning.accent,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: 8,
  },
  authButtonText: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
    color: Colors.base.white,
  },
  testButton: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    alignSelf: 'flex-start',
    marginTop: Spacing.md,
  },
  testButtonDisabled: {
    opacity: 0.5,
  },
  testButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.base.white,
    letterSpacing: 2,
  },
});

import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Colors, Typography, Spacing } from '../../tokens/design-tokens';
import { StationCard } from '../../components/StationCard';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import type { Vibe } from '../../cleo/fallbacks';
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

interface HomeScreenProps {
  onNavigateToPlayer?: (params: {
    stationName: string;
    playlistId: string;
    stationId: string;
    vibe: Vibe;
  }) => void;
  onNavigateToSettings?: () => void;
}

export function HomeScreen({ onNavigateToPlayer, onNavigateToSettings }: HomeScreenProps) {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [stations, setStations] = useState<Station[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);

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

  // Listen for track changes — update now playing info only
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          setNowPlaying({ title: np.title, artistName: np.artistName });
          setAuthState('playing');
        }
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
    if (onNavigateToPlayer) {
      onNavigateToPlayer({
        stationName: station.name,
        playlistId: station.playlistId,
        stationId: station.id,
        vibe: (station.defaultVibe as Vibe) ?? 'chill',
      });
    }
  }, [onNavigateToPlayer]);

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
        <View style={styles.headerRight}>
          <Text style={styles.onAir}>ON AIR</Text>
          <Pressable onPress={onNavigateToSettings}>
            <Text style={styles.settingsButton}>SETTINGS</Text>
          </Pressable>
        </View>
      </View>

      {nowPlaying && (
        <View style={styles.nowPlaying}>
          <Text style={styles.mono}>NOW PLAYING</Text>
          <Text style={styles.nowPlayingTitle}>{nowPlaying.title}</Text>
          <Text style={styles.nowPlayingArtist}>{nowPlaying.artistName}</Text>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.md,
  },
  onAir: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.accent,
    letterSpacing: 3,
  },
  settingsButton: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.text,
    letterSpacing: 2,
    opacity: 0.5,
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
});

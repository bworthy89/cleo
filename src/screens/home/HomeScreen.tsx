import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
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
  getCachedPlaylists,
  setCachedPlaylists,
  type Station,
} from '../../services/Storage';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';

type AuthState = 'loading' | 'unauthorized' | 'ready' | 'playing';

interface NowPlayingInfo {
  title: string;
  artistName: string;
  artworkUrl?: string;
}

interface HomeScreenProps {
  onNavigateToPlayer?: (params: {
    stationName: string;
    playlistId: string;
    stationId: string;
    vibe: Vibe;
  }) => void;
  onNavigateToSettings?: () => void;
  onNavigateToActivePlayer?: () => void;
}

export function HomeScreen({ onNavigateToPlayer, onNavigateToSettings, onNavigateToActivePlayer }: HomeScreenProps) {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [stations, setStations] = useState<Station[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [playlistsLoading, setPlaylistsLoading] = useState(true);

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

  // Listen for track changes — update now playing info
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          setNowPlaying({ title: np.title, artistName: np.artistName, artworkUrl: np.artworkUrl });
          setAuthState('playing');
        }
      }
    });
    return unsub;
  }, []);

  async function loadData() {
    setStations(getStations());

    // Show cached playlists immediately
    const cached = getCachedPlaylists();
    if (cached) {
      setPlaylists(cached);
    }

    // Fetch fresh in background
    try {
      const lists = await musicKitPlayer.fetchPlaylists();
      setPlaylists(lists);
      setCachedPlaylists(lists);
    } catch {
      // playlists may fail in simulator — non-fatal
    } finally {
      setPlaylistsLoading(false);
    }
    await refreshNowPlaying();
  }

  async function refreshNowPlaying() {
    const np = await musicKitPlayer.getNowPlaying();
    if (np) {
      setNowPlaying({ title: np.title, artistName: np.artistName, artworkUrl: np.artworkUrl });
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
          <Text style={styles.heroTitle}>CLEO</Text>
          <View style={styles.heroAccentLine} />
          <Text style={styles.heroTagline}>AI RADIO HOST</Text>
          <Text style={styles.heroDescription}>
            Your personal DJ. Plays your music,{'\n'}tells the stories behind the songs.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.authButton, pressed && styles.buttonPressed]}
            onPress={handleAuthorize}
          >
            <Text style={styles.authButtonText}>CONNECT APPLE MUSIC</Text>
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
          <Text style={styles.heroTitle}>CLEO</Text>
          <ActivityIndicator style={{ marginTop: Spacing.lg }} color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Ready / Playing ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>CLEO</Text>
        <Pressable
          style={({ pressed }) => [styles.settingsButton, pressed && styles.buttonPressed]}
          onPress={onNavigateToSettings}
          hitSlop={12}
        >
          <Text style={styles.settingsText}>{'\u2699'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Now Playing Bar */}
        {nowPlaying && (
          <Pressable
            style={({ pressed }) => [styles.nowPlaying, pressed && styles.nowPlayingPressed]}
            onPress={onNavigateToActivePlayer}
          >
            <View style={styles.nowPlayingAccent} />
            {nowPlaying.artworkUrl ? (
              <Image source={{ uri: nowPlaying.artworkUrl }} style={styles.nowPlayingArt} />
            ) : (
              <View style={[styles.nowPlayingArt, styles.nowPlayingArtPlaceholder]} />
            )}
            <View style={styles.nowPlayingInfo}>
              <Text style={styles.nowPlayingLabel}>NOW PLAYING</Text>
              <Text style={styles.nowPlayingTitle} numberOfLines={1}>{nowPlaying.title}</Text>
              <Text style={styles.nowPlayingArtist} numberOfLines={1}>{nowPlaying.artistName}</Text>
            </View>
            <Text style={styles.nowPlayingArrow}>{'\u203A'}</Text>
          </Pressable>
        )}

        {/* Your Stations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>YOUR STATIONS</Text>
          {stations.length > 0 ? (
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
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>{'\uD83D\uDCFB'}</Text>
              <Text style={styles.emptyText}>No stations yet</Text>
              <Text style={styles.emptyHint}>
                Tap a playlist below to create your first station
              </Text>
            </View>
          )}
        </View>

        {/* Playlists */}
        <View style={[styles.section, { marginBottom: Spacing.xxl }]}>
          <Text style={styles.sectionTitle}>PLAYLISTS</Text>
          {playlists.length === 0 && playlistsLoading ? (
            <ActivityIndicator style={{ marginTop: Spacing.lg }} color={Colors.accent} />
          ) : (
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
          )}
        </View>
      </ScrollView>
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
    paddingHorizontal: Spacing.xl,
  },
  scrollContent: {
    flex: 1,
  },

  // ── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
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
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsText: {
    fontSize: 18,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
  },

  // ── Hero (unauthorized/loading) ─────────────────────────────────────
  heroTitle: {
    fontFamily: Typography.display.family,
    fontSize: 72,
    color: Colors.vibe.morning.text,
    letterSpacing: 8,
  },
  heroAccentLine: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    marginVertical: Spacing.lg,
  },
  heroTagline: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: Colors.accent,
    letterSpacing: 4,
  },
  heroDescription: {
    fontFamily: Typography.label.family,
    fontSize: 15,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: Spacing.md,
  },
  authButton: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.base.black,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  authButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.base.white,
    letterSpacing: 3,
  },

  // ── Now Playing Bar ─────────────────────────────────────────────────
  nowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    backgroundColor: Colors.base.cream,
    borderRadius: 4,
    overflow: 'hidden',
  },
  nowPlayingPressed: {
    opacity: 0.8,
  },
  nowPlayingAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: Colors.accent,
  },
  nowPlayingArt: {
    width: 56,
    height: 56,
    marginLeft: 3,
  },
  nowPlayingArtPlaceholder: {
    backgroundColor: Colors.base.black,
  },
  nowPlayingInfo: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  nowPlayingLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 8,
    color: Colors.accent,
    letterSpacing: 2,
  },
  nowPlayingTitle: {
    fontFamily: Typography.display.family,
    fontSize: 17,
    color: Colors.vibe.morning.text,
    marginTop: 2,
  },
  nowPlayingArtist: {
    fontFamily: Typography.label.family,
    fontSize: 12,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    marginTop: 1,
  },
  nowPlayingArrow: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: Colors.vibe.morning.text,
    opacity: 0.2,
    paddingRight: Spacing.md,
  },

  // ── Sections ────────────────────────────────────────────────────────
  section: {
    marginTop: Spacing.xl,
  },
  sectionTitle: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    opacity: 0.4,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },

  // ── Empty State ─────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  emptyEmoji: {
    fontSize: 32,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 15,
    color: Colors.vibe.morning.text,
    opacity: 0.6,
  },
  emptyHint: {
    fontFamily: Typography.label.family,
    fontSize: 13,
    color: Colors.vibe.morning.text,
    opacity: 0.35,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },

  // ── Shared ──────────────────────────────────────────────────────────
  buttonPressed: {
    opacity: 0.7,
  },
});

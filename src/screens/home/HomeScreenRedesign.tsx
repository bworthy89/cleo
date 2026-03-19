import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Colors,
  Surface,
  TextColors,
  Typography,
  Spacing,
  Radius,
  Opacity,
  Gradient,
  Glow,
  AppHeaderTokens,
} from '../../tokens/design-tokens';
import { AppHeader } from '../../components/AppHeader';
import { WaveformBars } from '../../components/WaveformBars';
import { CleoOrb } from '../../components/CleoOrb';
import { StationCard } from '../../components/StationCard';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import type { Vibe } from '../../cleo/fallbacks';
import {
  getStations,
  addStation,
  addRecentlyPlayedTrack,
  getCachedPlaylists,
  setCachedPlaylists,
  getUser,
  type Station,
} from '../../services/Storage';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';

// ── Types ──────────────────────────────────────────────────────────────
type AuthState = 'loading' | 'unauthorized' | 'ready' | 'playing';

interface NowPlayingInfo {
  title: string;
  artistName: string;
  artworkUrl?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

// ── Loading Screen ─────────────────────────────────────────────────────
function LoadingScreen() {
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View style={[styles.fullScreen, { backgroundColor: Surface.base }]}>
      <Animated.Text
        style={[
          {
            fontFamily: Typography.display.family,
            fontSize: 72,
            letterSpacing: 6,
            color: Colors.accent,
          },
          { opacity },
        ]}
      >
        CLEO
      </Animated.Text>
    </View>
  );
}

// ── Unauthorized Screen ────────────────────────────────────────────────
function UnauthorizedScreen({ onAuthorize }: { onAuthorize: () => void }) {
  return (
    <View style={[styles.fullScreen, { backgroundColor: Surface.base }]}>
      <Text style={styles.unauthTitle}>CLEO</Text>
      <View style={styles.unauthAccentLine} />
      <Text style={styles.unauthTagline}>AI RADIO HOST</Text>
      <Text style={styles.unauthDescription}>
        Your personal DJ. Plays your music,{'\n'}tells the stories behind the songs.
      </Text>
      <Pressable
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
        onPress={onAuthorize}
        accessibilityLabel="Connect Apple Music"
        accessibilityRole="button"
      >
        <LinearGradient
          colors={Gradient.cta.colors}
          start={Gradient.cta.start}
          end={Gradient.cta.end}
          style={[styles.ctaButton, Glow.ctaShadow]}
        >
          <Text style={styles.ctaButtonText}>CONNECT APPLE MUSIC</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

// ── Main Component ─────────────────────────────────────────────────────
export function HomeScreenRedesign() {
  const insets = useSafeAreaInsets();
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [stations, setStations] = useState<Station[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [playlistsLoading, setPlaylistsLoading] = useState(true);
  const [activeStation, setActiveStation] = useState<Station | null>(null);

  // ── Auth check ─────────────────────────────────────────────────────
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

  // ── Track change listener ──────────────────────────────────────────
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

  // ── Data loading ───────────────────────────────────────────────────
  async function loadData() {
    setStations(getStations());

    const cached = getCachedPlaylists();
    if (cached) {
      setPlaylists(cached);
    }

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

  // ── Handlers ───────────────────────────────────────────────────────
  const handleAuthorize = useCallback(async () => {
    const result = await musicKitPlayer.authorize();
    if (result.status === 'authorized') {
      setAuthState('ready');
      loadData();
    }
  }, []);

  const handlePlaylistPress = useCallback(
    (playlist: MusicPlaylist) => {
      let station = stations.find((s) => s.playlistId === playlist.id);
      if (!station) {
        station = {
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setActiveStation(station);
      router.push({
        pathname: '/(main)/(broadcast)/player',
        params: {
          stationName: station.name,
          playlistId: station.playlistId,
          stationId: station.id,
          vibe: (station.defaultVibe as Vibe) ?? 'chill',
        },
      });
    },
    [stations],
  );

  const handleStationPress = useCallback(async (station: Station) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setActiveStation(station);
    router.push({
      pathname: '/(main)/(broadcast)/player',
      params: {
        stationName: station.name,
        playlistId: station.playlistId,
        stationId: station.id,
        vibe: (station.defaultVibe as Vibe) ?? 'chill',
      },
    });
  }, []);

  const handleNowPlayingPress = useCallback(() => {
    if (!activeStation) return;
    router.push({
      pathname: '/(main)/(broadcast)/player',
      params: {
        stationName: activeStation.name,
        playlistId: activeStation.playlistId,
        stationId: activeStation.id,
        vibe: (activeStation.defaultVibe as Vibe) ?? 'chill',
      },
    });
  }, [activeStation]);

  // ── Render: Loading ────────────────────────────────────────────────
  if (authState === 'loading') {
    return <LoadingScreen />;
  }

  // ── Render: Unauthorized ───────────────────────────────────────────
  if (authState === 'unauthorized') {
    return <UnauthorizedScreen onAuthorize={handleAuthorize} />;
  }

  // ── Render: Ready / Playing ────────────────────────────────────────
  const headerHeight = AppHeaderTokens.height + insets.top;

  return (
    <View style={[styles.screen, { backgroundColor: Surface.base }]}>
      <AppHeader
        rightContent={
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {(getUser()?.name ?? 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: 100,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ──────────────────────────────────────────── */}
        <View style={styles.greetingContainer}>
          <Text style={styles.greetingLabel}>LIVE BROADCAST</Text>
          <Text style={styles.greetingTitle}>{getGreeting()}</Text>
          <View style={styles.greetingAccent} />
          <Text style={styles.greetingSubtext}>Your radio is ready.</Text>
        </View>

        {/* ── Now Playing Mini ──────────────────────────────────── */}
        {nowPlaying && (
          <Pressable
            onPress={handleNowPlayingPress}
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
            accessibilityLabel={`Now playing: ${nowPlaying.title} by ${nowPlaying.artistName}`}
            accessibilityRole="button"
          >
            <View style={styles.nowPlayingCard}>
              <View style={styles.nowPlayingGoldEdge} />
              <View style={styles.nowPlayingInner}>
                {nowPlaying.artworkUrl ? (
                  <Image source={{ uri: nowPlaying.artworkUrl }} style={styles.nowPlayingArt} />
                ) : (
                  <View style={[styles.nowPlayingArt, { backgroundColor: Surface.high }]} />
                )}
                <View style={styles.nowPlayingInfo}>
                  <Text style={styles.nowPlayingLabel}>NOW PLAYING</Text>
                  <Text style={styles.nowPlayingTitle} numberOfLines={1}>
                    {nowPlaying.title}
                  </Text>
                  <Text style={styles.nowPlayingArtist} numberOfLines={1}>
                    {nowPlaying.artistName}
                  </Text>
                </View>
                <WaveformBars />
              </View>
            </View>
          </Pressable>
        )}

        {/* ── Your Stations ─────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabelText}>YOUR STATIONS</Text>
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
              <Text style={styles.emptyCleoVoice}>
                Pick a playlist. I'll do the rest.
              </Text>
              <Text style={styles.emptyHint}>
                Tap a playlist below to create your first station
              </Text>
            </View>
          )}
        </View>

        {/* ── Playlists ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabelText}>PLAYLISTS</Text>
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

        {/* ── Cleo Suggestion ───────────────────────────────────── */}
        <View style={styles.suggestionCard}>
          <View style={styles.suggestionGoldEdge} />
          <View style={styles.suggestionInner}>
            <CleoOrb size={40} />
            <View style={styles.suggestionContent}>
              <Text style={styles.suggestionLabel}>CLEO SAYS</Text>
              <Text style={styles.suggestionText}>
                {stations.length > 0
                  ? `\u201CReady when you are. Tap a station and let\u2019s go.\u201D`
                  : `\u201CPick a playlist. I\u2019ll do the rest.\u201D`}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },

  // ── Unauthorized ───────────────────────────────────────────────────
  unauthTitle: {
    fontFamily: Typography.display.family,
    fontSize: 72,
    letterSpacing: 6,
    color: TextColors.primary,
  },
  unauthAccentLine: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    marginVertical: Spacing.lg,
  },
  unauthTagline: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    letterSpacing: 2.4,
    color: Colors.accent,
  },
  unauthDescription: {
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: Spacing.md,
  },
  ctaButton: {
    marginTop: Spacing.xl,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
  },
  ctaButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    letterSpacing: 2.4,
    color: TextColors.primary,
    fontWeight: '500',
  },

  // ── Avatar ─────────────────────────────────────────────────────────
  avatarPlaceholder: {
    width: AppHeaderTokens.avatarSize,
    height: AppHeaderTokens.avatarSize,
    borderRadius: AppHeaderTokens.avatarSize / 2,
    backgroundColor: Surface.high,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Typography.body.familySemiBold,
    fontSize: 13,
    color: TextColors.secondary,
  },

  // ── Greeting ───────────────────────────────────────────────────────
  greetingContainer: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  greetingLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    marginBottom: Spacing.sm,
  },
  greetingTitle: {
    fontFamily: Typography.display.family,
    fontSize: 32,
    color: TextColors.primary,
  },
  greetingAccent: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  greetingSubtext: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
  },

  // ── Now Playing Mini ───────────────────────────────────────────────
  nowPlayingCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    flexDirection: 'row',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  nowPlayingGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
  },
  nowPlayingInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm + 2,
  },
  nowPlayingArt: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
  },
  nowPlayingInfo: {
    flex: 1,
    marginHorizontal: Spacing.md,
  },
  nowPlayingLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.accent,
    marginBottom: 2,
  },
  nowPlayingTitle: {
    fontFamily: Typography.body.familySemiBold,
    fontSize: 14,
    color: TextColors.primary,
  },
  nowPlayingArtist: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.secondary,
    marginTop: 2,
  },

  // ── Sections ───────────────────────────────────────────────────────
  section: {
    marginTop: Spacing.xl,
  },
  sectionLabelText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },

  // ── Empty State ────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  emptyCleoVoice: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 18,
    color: Colors.accent,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  emptyHint: {
    fontFamily: Typography.body.family,
    fontSize: 13,
    color: TextColors.secondary,
    opacity: Opacity.muted,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },

  // ── Cleo Suggestion ────────────────────────────────────────────────
  suggestionCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    flexDirection: 'row',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  suggestionGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
  },
  suggestionInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.md,
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.accent,
    marginBottom: Spacing.xs,
  },
  suggestionText: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 16,
    color: TextColors.secondary,
  },
});

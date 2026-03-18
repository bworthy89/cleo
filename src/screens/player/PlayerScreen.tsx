import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GrainOverlay } from '../../components/GrainOverlay';
import { Colors, Typography, Spacing, Radius, Opacity, Tracking, withAlpha, isDarkVibe } from '../../tokens/design-tokens';
import { WordByWordSubtitle } from '../../components/WordByWordSubtitle';
import { PullQuoteOverlay } from '../../components/PullQuoteOverlay';
import { OnAirIndicator } from '../../components/OnAirIndicator';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { audioCoordinator } from '../../engines/AudioCoordinator';
import { segmentController } from '../../engines/SegmentController';
import { queueManager } from '../../engines/QueueManager';
import { sessionEngine } from '../../engines/SessionEngine';
import { addRecentlyPlayedTrack } from '../../services/Storage';
import type { Vibe } from '../../cleo/fallbacks';
import type { NowPlaying } from '../../../modules/expo-music-kit';

interface PlayerScreenProps {
  stationName: string;
  playlistId: string;
  stationId: string;
  vibe: Vibe;
  onBack: () => void;
}

export function PlayerScreen({
  stationName,
  playlistId,
  stationId,
  vibe,
  onBack,
}: PlayerScreenProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [cleoText, setCleoText] = useState('');
  const [cleoSpeaking, setCleoSpeaking] = useState(false);
  const [isPullQuote, setIsPullQuote] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const durationRef = useRef(0);
  const artOpacity = useRef(new Animated.Value(1)).current;
  const accentLineOpacity = useRef(new Animated.Value(0.5)).current;
  const bgColorAnim = useRef(new Animated.Value(0)).current;

  const vibeTheme = Colors.vibe[vibe] ?? Colors.vibe.chill;

  // Start session on mount — skip if already playing this station
  useEffect(() => {
    (async () => {
      const existing = sessionEngine.getSession();
      if (existing && existing.stationId === stationId && existing.tracksPlayed.length > 0) {
        setSessionStarted(true);
        refreshNowPlaying();
        return;
      }

      segmentController.startSession(stationId, vibe);
      await queueManager.initializeSession(playlistId, vibe, stationId);
      setSessionStarted(true);
      refreshNowPlaying();
    })();
  }, []);

  // Background entrance animation
  useEffect(() => {
    Animated.timing(bgColorAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, []);

  // Art dim effect when Cleo speaks
  useEffect(() => {
    Animated.timing(artOpacity, {
      toValue: cleoSpeaking ? 0.85 : 1,
      duration: cleoSpeaking ? 300 : 400,
      useNativeDriver: true,
    }).start();
  }, [cleoSpeaking]);

  // Listen for playback state + progress
  useEffect(() => {
    const unsub = musicKitPlayer.onPlaybackStateChanged((event) => {
      setIsPlaying(event.status === 'playing');
      const dur = durationRef.current;
      if (dur > 0) {
        const pct = Math.min(event.playbackTime / dur, 1);
        setProgress(pct);
        Animated.timing(progressAnim, {
          toValue: pct,
          duration: 400,
          useNativeDriver: false,
        }).start();
      }
    });
    return unsub;
  }, []);

  const handlePlayPause = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      // Check actual status from MusicKit rather than relying on event state
      const status = await musicKitPlayer.getPlaybackStatus();
      if (status === 'playing') {
        await musicKitPlayer.pause();
        setIsPlaying(false);
      } else {
        await musicKitPlayer.play();
        setIsPlaying(true);
      }
    } catch {
      // MusicKit may throw if queue is empty — non-fatal
    }
  };

  // Listen for track changes
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        // Reset progress
        setProgress(0);
        progressAnim.setValue(0);

        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          const profile = queueManager.getTrackProfile(event.trackId);
          const artworkUrl = profile?.artworkUrl ?? np.artworkUrl;
          durationRef.current = np.duration ?? 0;
          setNowPlaying({ ...np, artworkUrl });

          // Accent line flash on track change
          Animated.sequence([
            Animated.timing(accentLineOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
            Animated.timing(accentLineOpacity, { toValue: 0.5, duration: 500, useNativeDriver: true }),
          ]).start();

          await audioCoordinator.handleTrackChangeWithResult(
            {
              id: np.id,
              title: np.title,
              artistName: np.artistName,
              albumTitle: np.albumTitle,
              duration: np.duration,
              genre: np.genreNames?.[0],
            },
            undefined,
            (segment) => {
              setCleoText(segment.text);
              setIsPullQuote(segment.type === 'track_story' || segment.type === 'post_track_reflection');
              setCleoSpeaking(true);
            }
          );
          setTimeout(() => {
            setCleoSpeaking(false);
          }, 1500);
        }
      }
    });
    return unsub;
  }, []);

  async function refreshNowPlaying() {
    const np = await musicKitPlayer.getNowPlaying();
    if (np) {
      durationRef.current = np.duration ?? 0;
      setNowPlaying(np);
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const elapsed = nowPlaying?.duration ? progress * nowPlaying.duration : 0;
  const remaining = nowPlaying?.duration ? nowPlaying.duration - elapsed : 0;

  return (
    <Animated.View style={[styles.container, {
      flex: 1,
      backgroundColor: bgColorAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [Colors.base.cream, vibeTheme.bg],
      }),
    }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <GrainOverlay />
        <PullQuoteOverlay text={cleoText} visible={isPullQuote && cleoSpeaking} onFinish={() => setIsPullQuote(false)} />

        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={12} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={22} color={vibeTheme.text} />
          </Pressable>
          <Text style={[styles.stationName, { color: vibeTheme.text }]}>{stationName.toUpperCase()}</Text>
        </View>

        {/* Accent Line */}
        <Animated.View style={[styles.accentLine, { backgroundColor: vibeTheme.accent, opacity: accentLineOpacity }]} />

        {/* Album Art with Title Over */}
        <View style={styles.artworkContainer}>
          <Animated.View style={{ width: '100%', height: '100%', opacity: artOpacity }}>
            {nowPlaying?.artworkUrl ? (
              <Image source={{ uri: nowPlaying.artworkUrl }} style={styles.artwork} resizeMode="cover" />
            ) : (
              <View style={[styles.artwork, styles.artworkPlaceholder]} />
            )}
          </Animated.View>
          {isDarkVibe(vibeTheme.bg) && (
            <View style={[styles.vibeGlow, { backgroundColor: vibeTheme.accent }]} />
          )}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.artGradient}>
            <Text style={styles.songTitle} numberOfLines={2}>
              {(nowPlaying?.title ?? 'Loading...').toUpperCase()}
            </Text>
          </LinearGradient>
        </View>

        {/* Artist + Album */}
        <View style={styles.trackInfo}>
          <Text style={[styles.artistName, { color: vibeTheme.text }]} numberOfLines={1}>
            {[nowPlaying?.artistName, nowPlaying?.albumTitle].filter(Boolean).join(' \u00B7 ')}
          </Text>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressSection}>
          <View style={[styles.progressTrack, { backgroundColor: withAlpha(vibeTheme.text, 0.1) }]}>
            <Animated.View style={[styles.progressFill, {
              backgroundColor: vibeTheme.accent,
              width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }]} />
          </View>
          <View style={styles.progressTimes}>
            <Text style={[styles.timeText, { color: vibeTheme.text }]}>{formatTime(elapsed)}</Text>
            <Text style={[styles.timeText, { color: vibeTheme.text }]}>-{formatTime(remaining)}</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <Pressable onPress={handlePlayPause} style={({ pressed }) => [styles.playPauseButton, { borderColor: vibeTheme.accent }, pressed && styles.pressed]}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color={vibeTheme.text} style={!isPlaying ? { marginLeft: 3 } : undefined} />
          </Pressable>
        </View>

        {/* Cleo Section */}
        <View style={styles.cleoSection}>
          <OnAirIndicator active={cleoSpeaking} paused={!isPlaying} accentColor={vibeTheme.accent} />
          {!isPullQuote && cleoSpeaking ? (
            <WordByWordSubtitle text={cleoText} visible={cleoSpeaking} accentColor={vibeTheme.accent} />
          ) : !cleoSpeaking ? (
            <Text style={[styles.cleoResting, { color: vibeTheme.text }]}>
              CLEO {'\u00B7'} {stationName.toUpperCase()}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pressed: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, position: 'relative' },
  backButton: { width: 44, height: 44, justifyContent: 'center' },
  stationName: { fontFamily: Typography.mono.family, fontSize: 10, letterSpacing: Tracking.wide, opacity: Opacity.muted, position: 'absolute', left: 0, right: 0, textAlign: 'center', zIndex: -1 },
  accentLine: { height: 1, marginHorizontal: Spacing.lg, marginTop: Spacing.xs },
  artworkContainer: { marginTop: Spacing.sm, aspectRatio: 1, position: 'relative' },
  artwork: { width: '100%', height: '100%' },
  artworkPlaceholder: { backgroundColor: Colors.base.black },
  vibeGlow: { position: 'absolute', bottom: -20, left: '20%', right: '20%', height: 80, borderRadius: 40, opacity: 0.08 },
  artGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', justifyContent: 'flex-end', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  songTitle: { fontFamily: Typography.display.family, fontSize: 56, color: Colors.base.white, textTransform: 'uppercase', letterSpacing: 0.5, lineHeight: 62, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  trackInfo: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  artistName: { fontFamily: Typography.label.familyMedium, fontSize: 13, textTransform: 'uppercase', letterSpacing: Tracking.normal, opacity: Opacity.secondary },
  progressSection: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  progressTrack: { height: 3, borderRadius: 1.5, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 1.5 },
  progressTimes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
  timeText: { fontFamily: Typography.mono.family, fontSize: 10, opacity: Opacity.muted, letterSpacing: Tracking.normal },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: Spacing.md, gap: Spacing.xl },
  playPauseButton: { width: 56, height: 56, borderRadius: Radius.lg, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cleoSection: { flex: 1, justifyContent: 'flex-end', paddingBottom: Spacing.xl, minHeight: 100 },
  cleoResting: { fontFamily: Typography.mono.family, fontSize: 9, letterSpacing: Tracking.wide, textAlign: 'center', opacity: Opacity.ghost, paddingBottom: Spacing.sm },
});

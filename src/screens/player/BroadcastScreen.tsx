import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  Colors,
  Surface,
  TextColors,
  Typography,
  Glass,
  Glow,
  Gradient,
  Spacing,
  Radius,
  Animation,
  Opacity,
  ZIndex,
  AppHeaderTokens,
  TabBar,
  withAlpha,
  getVibeAccent,
} from '../../tokens/design-tokens';
import { GlassCard } from '../../components/GlassCard';
import { AppHeader } from '../../components/AppHeader';
import { WaveformBars } from '../../components/WaveformBars';
import { CleoSpeakingOverlay } from '../../components/CleoSpeakingOverlay';
import { CleoOrb } from '../../components/CleoOrb';
import { SectionLabel } from '../../components/SectionLabel';
import { router } from 'expo-router';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { audioCoordinator } from '../../engines/AudioCoordinator';
import { segmentController } from '../../engines/SegmentController';
import { queueManager } from '../../engines/QueueManager';
import { sessionEngine } from '../../engines/SessionEngine';
import { addRecentlyPlayedTrack } from '../../services/Storage';
import type { SegmentType, Vibe } from '../../cleo/fallbacks';
import type { NowPlaying } from '../../../modules/expo-music-kit';

interface BroadcastScreenProps {
  stationName: string;
  playlistId: string;
  stationId: string;
  vibe: Vibe;
}

export function BroadcastScreen({
  stationName,
  playlistId,
  stationId,
  vibe,
}: BroadcastScreenProps) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [cleoText, setCleoText] = useState('');
  const [cleoSpeaking, setCleoSpeaking] = useState(false);
  const [isPullQuote, setIsPullQuote] = useState(false);
  const [segmentType, setSegmentType] = useState<SegmentType | 'cold_open' | 'session_close' | null>(null);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const durationRef = useRef(0);

  const vibeAccent = getVibeAccent(vibe);

  const FULL_OVERLAY_TYPES: Array<SegmentType | 'cold_open' | 'session_close'> = [
    'song_intro', 'track_story', 'post_track_reflection', 'cold_open', 'session_close',
  ];
  const isFullOverlay = cleoSpeaking && segmentType != null && FULL_OVERLAY_TYPES.includes(segmentType);

  // --- RN Animated values ---
  const artOpacity = useRef(new Animated.Value(1)).current;
  const contentDim = useRef(new Animated.Value(1)).current;
  const progressWidth = useRef(new Animated.Value(0)).current;

  // Art dim when Cleo speaks
  useEffect(() => {
    Animated.timing(artOpacity, {
      toValue: cleoSpeaking ? 0.85 : 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [cleoSpeaking]);

  // Content dim when full overlay is active
  useEffect(() => {
    Animated.timing(contentDim, {
      toValue: isFullOverlay ? 0.3 : 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
    if (isFullOverlay) setOverlayMounted(true);
  }, [isFullOverlay]);

  // Progress bar animation (width % - no native driver)
  useEffect(() => {
    Animated.timing(progressWidth, {
      toValue: progress,
      duration: 100,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const progressWidthPercent = progressWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // --- Session initialization ---
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

  // --- Playback state + progress listener ---
  useEffect(() => {
    const unsub = musicKitPlayer.onPlaybackStateChanged((event) => {
      setIsPlaying(event.status === 'playing');
      const dur = durationRef.current;
      if (dur > 0) {
        const pct = Math.min(event.playbackTime / dur, 1);
        setProgress(pct);
      }
    });
    return unsub;
  }, []);

  // --- Track change listener ---
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        setProgress(0);
        progressWidth.setValue(0);

        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          const profile = queueManager.getTrackProfile(event.trackId);
          const artworkUrl = profile?.artworkUrl ?? np.artworkUrl;
          durationRef.current = np.duration ?? 0;
          setNowPlaying({ ...np, artworkUrl });

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
              setSegmentType(segment.type);
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

  const handlePlayPause = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const status = await musicKitPlayer.getPlaybackStatus();
      if (status === 'playing') {
        await musicKitPlayer.pause();
        setIsPlaying(false);
      } else {
        await musicKitPlayer.play();
        setIsPlaying(true);
      }
    } catch {
      // MusicKit may throw if queue is empty
    }
  };

  const handleNext = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await musicKitPlayer.skip();
    } catch {
      // skip may throw if at end of queue
    }
  };

  const elapsed = nowPlaying?.duration ? progress * nowPlaying.duration : 0;
  const remaining = nowPlaying?.duration ? nowPlaying.duration - elapsed : 0;

  // Get next track info for "Up Next" card
  const nextTrackId = sessionEngine.getNextTrackId();
  const nextTrack = nextTrackId ? queueManager.getTrackProfile(nextTrackId) : null;

  return (
    <View style={styles.container}>
      <AppHeader
        leftContent={
          <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
            <Ionicons name="chevron-back" size={22} color={TextColors.primary} />
          </Pressable>
        }
      />

      <Animated.View style={[{ flex: 1 }, { opacity: contentDim }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Album Art Hero */}
        <Animated.View style={[styles.artHero, { opacity: artOpacity }]}>
          {nowPlaying?.artworkUrl ? (
            <Image
              source={{ uri: nowPlaying.artworkUrl }}
              style={styles.artImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.artImage, styles.artPlaceholder]} />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.75)']}
            style={styles.artGradient}
          >
            {cleoSpeaking && (
              <View style={styles.cleoTalkingBadge}>
                <WaveformBars color={Colors.accent} />
                <Text style={styles.cleoTalkingLabel}>CLEO IS TALKING</Text>
              </View>
            )}
          </LinearGradient>
        </Animated.View>

        {/* Track Info */}
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={2}>
            {nowPlaying?.title ?? 'Loading...'}
          </Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {nowPlaying?.artistName ?? ''}
          </Text>
        </View>

        {/* Host Commentary Card */}
        {cleoText.length > 0 && (
          <GlassCard style={styles.commentaryCard}>
            <View style={styles.commentaryInner}>
              <View style={styles.commentaryHeader}>
                <CleoOrb size={28} />
                <Text style={styles.commentaryLabel}>HOST COMMENTARY</Text>
              </View>
              <Text style={styles.commentaryText}>{cleoText}</Text>
            </View>
          </GlassCard>
        )}

        {/* Progress Bar */}
        <View style={styles.progressSection}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidthPercent }]}>
              <LinearGradient
                colors={[Colors.accent, vibeAccent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
          <View style={styles.progressTimes}>
            <Text style={styles.timeText}>{formatTime(elapsed)}</Text>
            <Text style={styles.timeText}>-{formatTime(remaining)}</Text>
          </View>
        </View>

        {/* Playback Controls */}
        <View style={styles.controls}>
          <Pressable
            hitSlop={12}
            style={({ pressed }) => [styles.secondaryControl, pressed && styles.pressed]}
            accessibilityLabel="Shuffle"
          >
            <Ionicons name="shuffle" size={22} color={TextColors.outline} />
          </Pressable>

          <Pressable
            hitSlop={12}
            style={({ pressed }) => [styles.secondaryControl, pressed && styles.pressed]}
            accessibilityLabel="Previous track"
          >
            <Ionicons name="play-skip-back" size={24} color={TextColors.primary} />
          </Pressable>

          <Pressable
            onPress={handlePlayPause}
            style={({ pressed }) => [pressed && styles.pressed]}
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            accessibilityRole="button"
          >
            <LinearGradient
              colors={[Colors.accent, Colors.accentDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.playButton, Glow.ctaShadow]}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={28}
                color={Surface.base}
                style={!isPlaying ? { paddingLeft: 3 } : undefined}
              />
            </LinearGradient>
          </Pressable>

          <Pressable
            onPress={handleNext}
            hitSlop={12}
            style={({ pressed }) => [styles.secondaryControl, pressed && styles.pressed]}
            accessibilityLabel="Next track"
            accessibilityRole="button"
          >
            <Ionicons name="play-skip-forward" size={24} color={TextColors.primary} />
          </Pressable>

          <Pressable
            hitSlop={12}
            style={({ pressed }) => [styles.secondaryControl, pressed && styles.pressed]}
            accessibilityLabel="Repeat"
          >
            <Ionicons name="repeat" size={22} color={TextColors.outline} />
          </Pressable>
        </View>

        {/* Synchronized Next (Up Next) */}
        {nextTrack && (
          <GlassCard style={styles.upNextCard}>
            <View style={styles.upNextInner}>
              <SectionLabel style={styles.upNextLabel}>UP NEXT</SectionLabel>
              <View style={styles.upNextRow}>
                {nextTrack.artworkUrl ? (
                  <Image
                    source={{ uri: nextTrack.artworkUrl }}
                    style={styles.upNextArt}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.upNextArt, styles.artPlaceholder]} />
                )}
                <View style={styles.upNextInfo}>
                  <Text style={styles.upNextTitle} numberOfLines={1}>
                    {nextTrack.title}
                  </Text>
                  <Text style={styles.upNextArtist} numberOfLines={1}>
                    {nextTrack.artistName}
                  </Text>
                </View>
              </View>
            </View>
          </GlassCard>
        )}
      </ScrollView>
      </Animated.View>

      {/* Full-screen Cleo Speaking overlay for disruptive segment types */}
      {overlayMounted && (
        <CleoSpeakingOverlay
          text={cleoText}
          visible={isFullOverlay}
          onDismiss={() => {
            setOverlayMounted(false);
            setCleoSpeaking(false);
            setSegmentType(null);
          }}
          vibeAccent={vibeAccent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: AppHeaderTokens.height + 44, // header + safe area approx
    paddingBottom: TabBar.height + Spacing.lg,
  },
  pressed: {
    opacity: 0.6,
  },

  // Album Art Hero
  artHero: {
    aspectRatio: 1,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    marginHorizontal: Spacing.lg,
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  artPlaceholder: {
    backgroundColor: Surface.container,
  },
  artGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  cleoTalkingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cleoTalkingLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.6,
    color: Colors.accent,
    textTransform: 'uppercase',
  },

  // Track Info
  trackInfo: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  trackTitle: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: TextColors.primary,
    textAlign: 'center',
    lineHeight: 34,
  },
  trackArtist: {
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: TextColors.secondary,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },

  // Host Commentary
  commentaryCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  commentaryInner: {
    padding: Spacing.md,
  },
  commentaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  commentaryLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 1.6,
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  commentaryText: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: Typography.cleoVoice.style,
    fontSize: 16,
    lineHeight: 24,
    color: TextColors.primary,
  },

  // Progress
  progressSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  progressTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: withAlpha(TextColors.primary, 0.1),
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2.5,
    overflow: 'hidden',
  },
  progressTimes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  timeText: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    color: TextColors.outline,
    letterSpacing: 0.5,
  },

  // Controls
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
  },
  secondaryControl: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Up Next
  upNextCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
  },
  upNextInner: {
    padding: Spacing.md,
  },
  upNextLabel: {
    marginBottom: Spacing.sm,
  },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  upNextArt: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
  },
  upNextInfo: {
    flex: 1,
  },
  upNextTitle: {
    fontFamily: Typography.body.familySemiBold,
    fontSize: 14,
    color: TextColors.primary,
  },
  upNextArtist: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.secondary,
    marginTop: 2,
  },
});

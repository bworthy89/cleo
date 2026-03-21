import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Colors,
  Surface,
  TextColors,
  Typography,
  Glow,
  Spacing,
  Radius,
  AppHeaderTokens,
  TabBar,
  withAlpha,
  getVibeAccent,
} from '../../tokens/design-tokens';
import { AppHeader } from '../../components/AppHeader';
import { WaveformBars } from '../../components/WaveformBars';
import { CleoSpeakingOverlay } from '../../components/CleoSpeakingOverlay';
import { CleoOrb } from '../../components/CleoOrb';
import { router } from 'expo-router';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { audioCoordinator } from '../../engines/AudioCoordinator';
import { segmentController } from '../../engines/SegmentController';
import { queueManager } from '../../engines/QueueManager';
import { sessionEngine } from '../../engines/SessionEngine';
import { addRecentlyPlayedTrack } from '../../services/Storage';
import { transitionPreloader } from '../../engines/TransitionPreloader';
import type { SegmentType, Vibe } from '../../cleo/fallbacks';
import { getNextInQueue, type NowPlaying } from '../../../modules/expo-music-kit';
import type { TrackInfo } from '../../types/TrackInfo';

const FULL_OVERLAY_TYPES: Array<SegmentType | 'cold_open' | 'session_close'> = [
  'song_intro', 'track_story', 'post_track_reflection', 'cold_open', 'session_close',
];

function buildTrackInfo(np: NowPlaying): TrackInfo {
  return {
    id: np.id,
    title: np.title,
    artistName: np.artistName,
    albumTitle: np.albumTitle,
    duration: np.duration,
    genre: np.genreNames?.[0],
    genreNames: np.genreNames,
  };
}

interface BroadcastScreenProps {
  stationName: string;
  playlistId: string;
  stationId: string;
  vibe: Vibe;
  resume?: boolean;
}

export function BroadcastScreen({
  stationName,
  playlistId,
  stationId,
  vibe,
  resume = false,
}: BroadcastScreenProps) {
  const insets = useSafeAreaInsets();
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [cleoText, setCleoText] = useState('');
  const [cleoSpeaking, setCleoSpeaking] = useState(false);
  const [segmentType, setSegmentType] = useState<SegmentType | 'cold_open' | 'session_close' | null>(null);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [nextUp, setNextUp] = useState<{ title: string; artistName: string; artworkUrl?: string } | null>(null);
  const durationRef = useRef(0);
  const manualSkipRef = useRef(false);
  const cleoSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vibeAccent = getVibeAccent(vibe);

  // Refresh "Synchronized Next" from MusicKit's actual queue
  const refreshNextUp = useCallback(async () => {
    try {
      const real = await getNextInQueue();
      if (real) {
        const profile = real.id ? queueManager.getTrackProfile(real.id) : null;
        setNextUp({
          title: real.title,
          artistName: real.artistName,
          artworkUrl: profile?.artworkUrl,
        });
      } else {
        setNextUp(null);
      }
    } catch {
      setNextUp(null);
    }
  }, []);

  // Get next track from MusicKit's actual queue (not session plan index) for spoken content
  const getNextTrackForPreloader = useCallback(async (): Promise<{ title: string; artistName: string } | undefined> => {
    try {
      const realNext = await getNextInQueue();
      if (realNext) return { title: realNext.title, artistName: realNext.artistName };
    } catch {}
    const nextId = sessionEngine.getNextTrackId();
    const profile = nextId ? queueManager.getTrackProfile(nextId) : null;
    return profile ? { title: profile.title, artistName: profile.artistName } : undefined;
  }, []);

  // Cleanup speaking timer on unmount
  useEffect(() => {
    return () => {
      if (cleoSpeakingTimerRef.current) {
        clearTimeout(cleoSpeakingTimerRef.current);
      }
    };
  }, []);

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
      const startEjectPreGen = async (retries = 3) => {
        const np = await musicKitPlayer.getNowPlaying();
        if (!np) return;
        // Duration may be 0 when track just started — retry after 2s
        if ((!np.duration || np.duration <= 0) && retries > 0) {
          setTimeout(() => startEjectPreGen(retries - 1), 2000);
          return;
        }
        const nextTrackForPreloader = await getNextTrackForPreloader();
        audioCoordinator.handleTrackStart(buildTrackInfo(np), nextTrackForPreloader);
      };

      // Resume: just refresh UI state, don't touch the session or queue
      if (resume) {
        refreshNowPlaying();
        return;
      }

      const existing = sessionEngine.getSession();
      if (existing && existing.stationId === stationId && existing.tracksPlayed.length > 0) {
        refreshNowPlaying();
        // Enrich tracks if not already done (enrichment only runs on new sessions otherwise)
        queueManager.enrichExistingSession(playlistId);
        await startEjectPreGen();
        return;
      }

      segmentController.startSession(stationId, vibe);
      audioCoordinator.setVibe(vibe);
      await queueManager.initializeSession(playlistId, vibe, stationId);
      refreshNowPlaying();
      await startEjectPreGen();
    })();
  }, []);

  // --- Playback state listener (for play/pause visual state) ---
  useEffect(() => {
    // Set initial state
    musicKitPlayer.getPlaybackStatus().then((status) => {
      setIsPlaying(status === 'playing');
    }).catch(() => {});

    const unsub = musicKitPlayer.onPlaybackStateChanged((event) => {
      setIsPlaying(event.status === 'playing');
    });
    return unsub;
  }, []);

  // --- Progress polling (always active, 1s interval) ---
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await musicKitPlayer.getPlaybackStatus();
        const playing = status === 'playing';
        if (playing !== isPlaying) setIsPlaying(playing);
        if (!playing) return;

        // If we don't have a duration yet, try to fetch it
        if (durationRef.current <= 0) {
          const np = await musicKitPlayer.getNowPlaying();
          if (np?.duration && np.duration > 0) {
            durationRef.current = np.duration;
            setNowPlaying((prev) => prev ? { ...prev, duration: np.duration } : np);
          }
        }
        const time = await musicKitPlayer.getPlaybackTime();
        const dur = durationRef.current;
        if (dur > 0) {
          setProgress(Math.min(time / dur, 1));
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, []);

  // --- Track change listener (fallback path) ---
  // Only runs when onTrackChanged is NOT suppressed (eject not active).
  // Skips the old Cleo timing when the preloader is already generating/ready for this track,
  // since the eject system will handle the transition at the end of the track.
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        const isManualSkip = manualSkipRef.current;
        manualSkipRef.current = false;

        addRecentlyPlayedTrack(event.trackId);
        setProgress(0);
        progressWidth.setValue(0);

        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          const profile = queueManager.getTrackProfile(event.trackId);
          const artworkUrl = profile?.artworkUrl ?? np.artworkUrl;
          durationRef.current = np.duration ?? 0;
          setNowPlaying({ ...np, artworkUrl });

          const trackInfo = buildTrackInfo(np);

          // Always cancel old preloader — if onTrackChanged fired, the eject
          // didn't happen, so the preloader is stale regardless of skip type.
          transitionPreloader.cancel();

          // Clear any pending speaking timer from previous track
          if (cleoSpeakingTimerRef.current) {
            clearTimeout(cleoSpeakingTimerRef.current);
            cleoSpeakingTimerRef.current = null;
          }

          // Run Cleo's speech for this track change (cold open, pre_song, post_song).
          await audioCoordinator.handleTrackChangeWithResult(
            trackInfo,
            undefined,
            (segment) => {
              setCleoText(segment.text);
              setSegmentType(segment.type);
              setCleoSpeaking(true);
            },
            isManualSkip
          );
          cleoSpeakingTimerRef.current = setTimeout(() => {
            cleoSpeakingTimerRef.current = null;
            setCleoSpeaking(false);
          }, 1500);

          // Start fresh preloader for the new track
          const nextTrackForPreloader = await getNextTrackForPreloader();
          audioCoordinator.handleTrackStart(
            trackInfo,
            nextTrackForPreloader
          );
        }
      }
    });
    return unsub;
  }, []);

  // --- Eject transition completed listener ---
  useEffect(() => {
    const unsub = musicKitPlayer.onEjectTrackChanged(async (event) => {
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

          const ejectSegment = transitionPreloader.getCachedSegment();
          if (ejectSegment) {
            if (cleoSpeakingTimerRef.current) {
              clearTimeout(cleoSpeakingTimerRef.current);
            }
            setCleoText(ejectSegment.text);
            setSegmentType(ejectSegment.type);
            setCleoSpeaking(true);
            cleoSpeakingTimerRef.current = setTimeout(() => {
              cleoSpeakingTimerRef.current = null;
              setCleoSpeaking(false);
            }, 1500);
          }

          audioCoordinator.handleEjectComplete();

          const nextTrackForPreloader = await getNextTrackForPreloader();
          audioCoordinator.handleTrackStart(buildTrackInfo(np), nextTrackForPreloader);
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
    refreshNextUp();
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
    manualSkipRef.current = true;
    try {
      await musicKitPlayer.skip();
    } catch {
      // skip may throw if at end of queue
    }
  };

  const elapsed = nowPlaying?.duration ? progress * nowPlaying.duration : 0;
  const remaining = nowPlaying?.duration ? nowPlaying.duration - elapsed : 0;

  const nextTrack = nextUp;

  return (
    <View style={styles.container}>
      <AppHeader
        leftContent={
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={22} color={TextColors.primary} />
          </Pressable>
        }
      />

      <Animated.View style={[{ flex: 1 }, { opacity: contentDim }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: AppHeaderTokens.height + insets.top },
        ]}
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
                <Text style={styles.cleoTalkingLabel}>ONAY IS TALKING</Text>
              </View>
            )}
          </LinearGradient>
        </Animated.View>

        {/* Track Info */}
        <View style={styles.trackInfo}>
          <Text style={styles.stationNameLabel}>{stationName}</Text>
          <Text style={styles.trackTitle} numberOfLines={2}>
            {nowPlaying?.title ?? 'Loading...'}
          </Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {nowPlaying?.artistName ? `\u2014 ${nowPlaying.artistName}` : ''}
          </Text>
        </View>

        {/* Editorial Insight Card */}
        {cleoText.length > 0 && (
          <View style={styles.commentaryCard}>
            <View style={styles.commentaryGoldEdge} />
            <View style={styles.commentaryInner}>
              <View style={styles.commentaryHeader}>
                <CleoOrb size={28} />
                <Text style={styles.commentaryLabel}>EDITORIAL INSIGHT</Text>
              </View>
              <Text style={styles.commentaryText}>
                {'\u201C'}{cleoText}{'\u201D'}
              </Text>
            </View>
          </View>
        )}

        {/* Progress Bar */}
        <View style={styles.progressSection}>
          <Text style={styles.progressLabel}>LIVE CONNECTION</Text>
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
          <View style={[styles.secondaryControl, styles.controlDisabled]}>
            <Ionicons name="shuffle" size={22} color={TextColors.outline} />
          </View>

          <View style={[styles.secondaryControl, styles.controlDisabled]}>
            <Ionicons name="play-skip-back" size={24} color={TextColors.outline} />
          </View>

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

          <View style={[styles.secondaryControl, styles.controlDisabled]}>
            <Ionicons name="repeat" size={22} color={TextColors.outline} />
          </View>
        </View>

        {/* Synchronized Next */}
        {nextTrack && (
          <View style={styles.upNextCard}>
            <View style={styles.upNextGoldEdge} />
            <View style={styles.upNextInner}>
              <Text style={styles.upNextLabel}>SYNCHRONIZED NEXT</Text>
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
          </View>
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  stationNameLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.accent,
    marginBottom: Spacing.xs,
  },
  trackTitle: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: TextColors.primary,
    lineHeight: 34,
  },
  trackArtist: {
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: TextColors.secondary,
    marginTop: Spacing.xs,
  },

  // Editorial Insight
  commentaryCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    flexDirection: 'row',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  commentaryGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
  },
  commentaryInner: {
    flex: 1,
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
  progressLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.accent,
    marginBottom: Spacing.sm,
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
  controlDisabled: {
    opacity: 0.35,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Synchronized Next
  upNextCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    flexDirection: 'row',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  upNextGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
  },
  upNextInner: {
    flex: 1,
    padding: Spacing.md,
  },
  upNextLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.accent,
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

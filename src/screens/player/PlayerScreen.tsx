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
import { Colors, Typography, Spacing } from '../../tokens/design-tokens';
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

      segmentController.startSession();
      segmentController.setVibe(vibe);
      await queueManager.initializeSession(playlistId, vibe, stationId);
      setSessionStarted(true);
      refreshNowPlaying();
    })();
  }, []);

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
    try {
      if (isPlaying) {
        await musicKitPlayer.pause();
      } else {
        await musicKitPlayer.play();
      }
    } catch {
      // MusicKit may throw if queue is empty — non-fatal
    }
  };

  const handleSkip = async () => {
    await musicKitPlayer.skip();
  };

  const handlePrevious = async () => {
    // If more than 3s in, restart current track; otherwise go to previous
    const time = await musicKitPlayer.getPlaybackTime();
    if (time > 3) {
      await musicKitPlayer.seekTo(0);
    } else {
      // No native "previous" in our queue — just restart
      await musicKitPlayer.seekTo(0);
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

          await audioCoordinator.handleTrackChangeWithResult(
            {
              id: np.id,
              title: np.title,
              artistName: np.artistName,
              albumTitle: np.albumTitle,
            },
            undefined,
            (segment) => {
              setCleoText(segment.text);
              setIsPullQuote(segment.type === 'track_story');
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
    <SafeAreaView style={[styles.container, { backgroundColor: vibeTheme.bg }]}>
      {/* Pull Quote Overlay */}
      <PullQuoteOverlay
        text={cleoText}
        visible={isPullQuote && cleoSpeaking}
        onFinish={() => setIsPullQuote(false)}
      />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={[styles.backButton, { color: vibeTheme.text }]}>
            {'\u2039'}
          </Text>
        </Pressable>
        <Text style={[styles.stationName, { color: vibeTheme.text }]}>
          {stationName.toUpperCase()}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Accent Line */}
      <View style={[styles.accentLine, { backgroundColor: vibeTheme.accent }]} />

      {/* Album Art */}
      <View style={styles.artworkContainer}>
        {nowPlaying?.artworkUrl ? (
          <Image
            source={{ uri: nowPlaying.artworkUrl }}
            style={styles.artwork}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]} />
        )}
      </View>

      {/* Track Info */}
      <View style={styles.trackInfo}>
        <Text
          style={[styles.songTitle, { color: vibeTheme.text }]}
          numberOfLines={2}
        >
          {nowPlaying?.title ?? 'Loading...'}
        </Text>
        <Text style={[styles.artistName, { color: vibeTheme.text }]} numberOfLines={1}>
          {nowPlaying?.artistName ?? ''}
        </Text>
        {nowPlaying?.albumTitle ? (
          <Text style={[styles.albumName, { color: vibeTheme.text }]} numberOfLines={1}>
            {nowPlaying.albumTitle}
          </Text>
        ) : null}
      </View>

      {/* Progress Bar */}
      <View style={styles.progressSection}>
        <View style={[styles.progressTrack, { backgroundColor: vibeTheme.text }]}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                backgroundColor: vibeTheme.accent,
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
        <View style={styles.progressTimes}>
          <Text style={[styles.timeText, { color: vibeTheme.text }]}>
            {formatTime(elapsed)}
          </Text>
          <Text style={[styles.timeText, { color: vibeTheme.text }]}>
            -{formatTime(remaining)}
          </Text>
        </View>
      </View>

      {/* Playback Controls */}
      <View style={styles.controls}>
        <Pressable
          onPress={handlePrevious}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Text style={[styles.secondaryIcon, { color: vibeTheme.text }]}>
            {'\u25C0\u25C0'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handlePlayPause}
          style={({ pressed }) => [
            styles.playPauseButton,
            { borderColor: vibeTheme.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.playPauseIcon, { color: vibeTheme.text }]}>
            {isPlaying ? '\u275A\u275A' : '\u25B6'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleSkip}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Text style={[styles.secondaryIcon, { color: vibeTheme.text }]}>
            {'\u25B6\u25B6'}
          </Text>
        </Pressable>
      </View>

      {/* ON AIR / Cleo Section */}
      <View style={styles.cleoSection}>
        <OnAirIndicator active={cleoSpeaking} accentColor={vibeTheme.accent} />

        {!isPullQuote && cleoSpeaking ? (
          <WordByWordSubtitle text={cleoText} visible={cleoSpeaking} />
        ) : !cleoSpeaking ? (
          <Text style={[styles.cleoResting, { color: vibeTheme.text }]}>
            CLEO {'\u00B7'} {stationName.toUpperCase()}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },

  // ── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  backButton: {
    fontSize: 32,
    fontFamily: Typography.display.family,
    lineHeight: 36,
  },
  headerSpacer: {
    width: 32,
  },
  stationName: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 3,
    opacity: 0.5,
  },
  accentLine: {
    height: 1,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
  },

  // ── Artwork ─────────────────────────────────────────────────────────
  artworkContainer: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    aspectRatio: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  artworkPlaceholder: {
    backgroundColor: Colors.base.black,
  },

  // ── Track Info ──────────────────────────────────────────────────────
  trackInfo: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  songTitle: {
    fontFamily: Typography.display.family,
    fontSize: 26,
    letterSpacing: 0.5,
    lineHeight: 32,
  },
  artistName: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 14,
    opacity: 0.7,
    marginTop: Spacing.xs,
  },
  albumName: {
    fontFamily: Typography.label.family,
    fontSize: 13,
    opacity: 0.4,
    marginTop: 2,
  },

  // ── Progress ────────────────────────────────────────────────────────
  progressSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    opacity: 0.1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
    opacity: 10, // counteracts parent 0.1 opacity: 10 * 0.1 = 1.0
  },
  progressTimes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  timeText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    opacity: 0.35,
    letterSpacing: 1,
  },

  // ── Controls ────────────────────────────────────────────────────────
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.md,
    gap: Spacing.xl,
  },
  playPauseButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseIcon: {
    fontSize: 22,
  },
  secondaryButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryIcon: {
    fontSize: 13,
    opacity: 0.5,
    letterSpacing: -4,
  },

  // ── Cleo Section ────────────────────────────────────────────────────
  cleoSection: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.xl,
  },
  cleoResting: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 3,
    textAlign: 'center',
    opacity: 0.2,
    paddingBottom: Spacing.sm,
  },
});

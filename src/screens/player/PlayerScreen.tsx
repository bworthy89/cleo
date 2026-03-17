import { useCallback, useEffect, useState } from 'react';
import {
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

  const vibeTheme = Colors.vibe[vibe] ?? Colors.vibe.chill;

  // Start session on mount
  useEffect(() => {
    (async () => {
      segmentController.startSession();
      segmentController.setVibe(vibe);
      await queueManager.initializeSession(playlistId, vibe, stationId);
      setSessionStarted(true);
      refreshNowPlaying();
    })();
  }, []);

  // Listen for playback state
  useEffect(() => {
    const unsub = musicKitPlayer.onPlaybackStateChanged((event) => {
      setIsPlaying(event.status === 'playing');
    });
    return unsub;
  }, []);

  const handlePlayPause = async () => {
    if (isPlaying) {
      await musicKitPlayer.pause();
    } else {
      await musicKitPlayer.play();
    }
  };

  const handleSkip = async () => {
    await musicKitPlayer.skip();
  };

  // Listen for track changes
  useEffect(() => {
    const unsub = musicKitPlayer.onTrackChanged(async (event) => {
      if (event.trackId) {
        addRecentlyPlayedTrack(event.trackId);
        const np = await musicKitPlayer.getNowPlaying();
        if (np) {
          // Use artwork from cached track profiles (catalog URLs) if available
          const profile = queueManager.getTrackProfile(event.trackId);
          const artworkUrl = profile?.artworkUrl ?? np.artworkUrl;
          setNowPlaying({ ...np, artworkUrl });

          // Auto-trigger Cleo — callback fires when text is ready, before audio plays
          await audioCoordinator.handleTrackChangeWithResult(
            {
              id: np.id,
              title: np.title,
              artistName: np.artistName,
              albumTitle: np.albumTitle,
            },
            undefined,
            (segment) => {
              // This fires right before audio starts — sync words with speech
              setCleoText(segment.text);
              setIsPullQuote(segment.type === 'track_story');
              setCleoSpeaking(true);
            }
          );
          // Audio finished — hide words after brief hold
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
    if (np) setNowPlaying(np);
  }

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
        <Pressable onPress={onBack}>
          <Text style={[styles.backButton, { color: vibeTheme.text }]}>
            {'\u2190'}
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
          {nowPlaying?.title?.toUpperCase() ?? 'LOADING...'}
        </Text>
        <Text style={[styles.artistName, { color: vibeTheme.text }]}>
          {nowPlaying?.artistName ?? ''}
          {nowPlaying?.albumTitle ? `  \u00B7  ${nowPlaying.albumTitle}` : ''}
        </Text>
      </View>

      {/* Playback Controls */}
      <View style={styles.controls}>
        <Pressable onPress={handlePlayPause} style={styles.playPauseButton}>
          <Text style={[styles.playPauseIcon, { color: vibeTheme.text }]}>
            {isPlaying ? '\u275A\u275A' : '\u25B6'}
          </Text>
        </Pressable>
        <Pressable onPress={handleSkip} style={styles.skipButton}>
          <Text style={[styles.skipIcon, { color: vibeTheme.text }]}>
            {'\u25B6\u25B6'}
          </Text>
        </Pressable>
      </View>

      {/* ON AIR Indicator */}
      <OnAirIndicator active={cleoSpeaking} accentColor={vibeTheme.accent} />

      {/* Cleo's Words */}
      {!isPullQuote && (
        <WordByWordSubtitle
          text={cleoText}
          visible={cleoSpeaking}
        />
      )}

      {/* Progress Line */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressLine, { backgroundColor: vibeTheme.accent }]} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  backButton: {
    fontSize: 24,
    fontFamily: Typography.label.family,
  },
  headerSpacer: {
    width: 24,
  },
  stationName: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    letterSpacing: 3,
  },
  accentLine: {
    height: 1,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  artworkContainer: {
    width: '100%',
    aspectRatio: 1,
    marginTop: Spacing.md,
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  artworkPlaceholder: {
    backgroundColor: Colors.base.black,
  },
  trackInfo: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  songTitle: {
    fontFamily: Typography.display.family,
    fontSize: 32,
    letterSpacing: 1,
    lineHeight: 38,
  },
  artistName: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    opacity: 0.7,
    marginTop: Spacing.xs,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.lg,
    gap: Spacing.xl,
  },
  playPauseButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(128,128,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseIcon: {
    fontSize: 22,
  },
  skipButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipIcon: {
    fontSize: 14,
    opacity: 0.6,
    letterSpacing: -4,
  },
  progressContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  progressLine: {
    height: 2,
    width: '100%',
    opacity: 0.3,
  },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Colors,
  Opacity,
  Surface,
  TextColors,
  Typography,
  ZIndex,
  withAlpha,
} from '../tokens/design-tokens';
import { WaveformBars } from './WaveformBars';
import { useAppActive } from '../hooks/useAppActive';

interface CleoSpeakingOverlayProps {
  text: string;
  visible: boolean;
  onDismiss: () => void;
  vibeAccent: string;
  audioDuration?: number;
}

// ---- word helpers ----

interface WordToken {
  raw: string;        // original text (may include *asterisks*)
  display: string;    // cleaned for display
  emphasis: boolean;  // wrapped in *...*
}

function tokenize(text: string): WordToken[] {
  return text.split(/\s+/).filter(Boolean).map((raw) => {
    const emphasis = raw.startsWith('*') && raw.endsWith('*') && raw.length > 2;
    const display = emphasis ? raw.slice(1, -1) : raw;
    return { raw, display, emphasis };
  });
}

// ---- component ----

export function CleoSpeakingOverlay({
  text,
  visible,
  onDismiss,
  vibeAccent,
  audioDuration,
}: CleoSpeakingOverlayProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [mounted, setMounted] = useState(visible);
  const appActive = useAppActive();

  const words = useMemo(() => tokenize(text), [text]);
  const wordCount = words.length;
  const perWord = audioDuration && wordCount > 0
    ? (audioDuration / wordCount) * 1000  // seconds -> ms
    : 200;

  // ---- animated values ----
  const scanlineY = useRef(new Animated.Value(-0.05)).current;
  const titleX = useRef(new Animated.Value(-30)).current;
  const titleSkew = useRef(new Animated.Value(-5)).current;
  const barWidth = useRef(new Animated.Value(0)).current;
  const quoteScale = useRef(new Animated.Value(0.9)).current;
  const quoteRotate = useRef(new Animated.Value(0)).current;
  const wordProgress = useRef(new Animated.Value(0)).current;
  const badgePulse = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const overlayTranslateY = useRef(new Animated.Value(0)).current;

  // ---- reduce motion check ----
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // ---- mount / unmount logic ----
  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
  }, [visible]);

  // ---- enter animations ----
  // Track looping animations so they can be stopped when backgrounded
  const loopAnimsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    if (!visible || !mounted) return;

    if (reduceMotion) {
      Animated.timing(overlayOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      Animated.timing(wordProgress, {
        toValue: wordCount,
        duration: wordCount * perWord,
        useNativeDriver: false,
      }).start();
      return;
    }

    // Reset values
    overlayOpacity.setValue(0);
    overlayTranslateY.setValue(0);
    scanlineY.setValue(-0.05);
    titleX.setValue(-30);
    titleSkew.setValue(-5);
    barWidth.setValue(0);
    quoteScale.setValue(0.9);
    quoteRotate.setValue(0);
    wordProgress.setValue(0);
    badgePulse.setValue(1);

    // Fade in container
    Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();

    // 1  Scanline loop
    const scanlineAnim = Animated.loop(
      Animated.timing(scanlineY, {
        toValue: 1.05,
        duration: 3500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    scanlineAnim.start();

    // 2  Title glitch-in then jitter
    const titleJitterAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(titleX, { toValue: 1.5, duration: 120, useNativeDriver: false }),
        Animated.timing(titleX, { toValue: -1, duration: 100, useNativeDriver: false }),
        Animated.timing(titleX, { toValue: 0, duration: 80, useNativeDriver: false }),
      ]),
    );
    Animated.sequence([
      Animated.timing(titleX, {
        toValue: 0,
        duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start(() => titleJitterAnim.start());

    // Title skew (useNativeDriver: false since skewX isn't natively supported as string transform)
    Animated.timing(titleSkew, {
      toValue: 0,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // 3  Gold bar flash (width animation - no native driver)
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(barWidth, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();

    // 4  Quote box slam (spring)
    Animated.sequence([
      Animated.delay(500),
      Animated.spring(quoteScale, {
        toValue: 1,
        damping: 12,
        stiffness: 200,
        mass: 0.8,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.sequence([
      Animated.delay(500),
      Animated.sequence([
        Animated.timing(quoteRotate, { toValue: -2, duration: 200, useNativeDriver: true }),
        Animated.spring(quoteRotate, {
          toValue: -1.5,
          damping: 14,
          stiffness: 180,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // 6  Word-by-word highlight (not native driver - drives opacity per word via interpolation)
    const totalWordDuration = wordCount * perWord;
    Animated.sequence([
      Animated.delay(600),
      Animated.timing(wordProgress, {
        toValue: wordCount,
        duration: totalWordDuration,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]).start();

    // 7  Speaking badge pulse
    const badgeAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(badgePulse, { toValue: 0.4, duration: 1500, useNativeDriver: true }),
        Animated.timing(badgePulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ]),
    );
    badgeAnim.start();

    // Store looping animations for background pause
    loopAnimsRef.current = [scanlineAnim, titleJitterAnim, badgeAnim];

    return () => {
      scanlineAnim.stop();
      titleJitterAnim.stop();
      badgeAnim.stop();
      loopAnimsRef.current = [];
    };
  }, [visible, mounted, reduceMotion]);

  // ---- pause/resume loops when app backgrounds/foregrounds ----
  useEffect(() => {
    if (!appActive) {
      loopAnimsRef.current.forEach((a) => a.stop());
    } else if (visible && mounted && !reduceMotion) {
      // Restart loops when returning to foreground
      loopAnimsRef.current.forEach((a) => a.start());
    }
  }, [appActive]);

  // ---- exit animation ----
  useEffect(() => {
    if (visible || !mounted) return;

    const finish = () => {
      setMounted(false);
      onDismiss();
    };

    if (reduceMotion) {
      Animated.timing(overlayOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        finish();
      });
      return;
    }

    Animated.timing(overlayOpacity, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => {
      // Always call finish regardless of whether animation completed or was interrupted
      finish();
    });
    Animated.timing(overlayTranslateY, { toValue: -20, duration: 600, useNativeDriver: true }).start();
  }, [visible]);

  // ---- interpolations ----

  const scanlineTranslateY = scanlineY.interpolate({
    inputRange: [-0.05, 1.05],
    outputRange: [-0.05 * windowHeight, 1.05 * windowHeight],
  });

  const titleSkewInterpolated = titleSkew.interpolate({
    inputRange: [-5, 0],
    outputRange: ['-5deg', '0deg'],
  });

  const barWidthPercent = barWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const quoteRotateInterpolated = quoteRotate.interpolate({
    inputRange: [-2, 0],
    outputRange: ['-2deg', '0deg'],
    extrapolate: 'extend',
  });

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.overlay, {
      opacity: overlayOpacity,
      transform: [{ translateY: overlayTranslateY }],
    }]}>
      {/* 1  Scanline */}
      <Animated.View style={[styles.scanline, {
        transform: [{ translateY: scanlineTranslateY }],
      }]} />

      <View style={styles.content}>
        {/* 2  Title with chromatic aberration */}
        <Animated.View style={{
          transform: [
            { translateX: titleX },
            { skewX: titleSkewInterpolated },
          ],
        }}>
          <View style={styles.titleContainer}>
            {/* Chromatic aberration layers */}
            <Text
              style={[
                styles.title,
                styles.titleShadowWhite,
              ]}
            >
              HOST{'\n'}INTERJECTION
            </Text>
            <Text
              style={[
                styles.title,
                styles.titleShadowGold,
                { color: vibeAccent },
              ]}
            >
              HOST{'\n'}INTERJECTION
            </Text>
            <Text style={styles.title}>
              HOST{'\n'}INTERJECTION
            </Text>
          </View>
        </Animated.View>

        {/* 3  Gold bar */}
        <View style={styles.barTrack}>
          <Animated.View style={[styles.goldBar, { width: barWidthPercent }]}>
            <View style={styles.goldBarGlow} />
          </Animated.View>
        </View>

        {/* 4  Quote box */}
        <Animated.View style={[styles.quoteBox, {
          transform: [
            { scale: quoteScale },
            { rotate: quoteRotateInterpolated },
          ],
        }]}>
          {/* Waveform + TRANSMISSION ACTIVE */}
          <View style={styles.transmissionRow}>
            <WaveformBars color={Colors.accent} />
            <Text style={styles.transmissionLabel}>TRANSMISSION ACTIVE</Text>
          </View>

          {/* 6  Word-by-word text */}
          <View style={styles.wordsContainer}>
            {words.map((w, i) => (
              <WordSpan
                key={i}
                index={i}
                token={w}
                progress={wordProgress}
              />
            ))}
          </View>

          {/* Signal metadata */}
          <Text style={styles.signalMeta}>
            SIGNAL: 104.2 MHZ / LATENCY: 0.003MS / ENCODING: AI_VOX_V4
          </Text>

          {/* 7  Speaking badge */}
          <Animated.View style={[styles.speakingBadge, { opacity: badgePulse }]}>
            <Text style={styles.speakingBadgeText}>ONAY IS SPEAKING...</Text>
          </Animated.View>
        </Animated.View>

        {/* 5  Glitch decoration lines */}
        <View style={styles.glitchLines}>
          <View style={[styles.glitchLine, { width: '60%', opacity: 0.12 }]} />
          <View style={[styles.glitchLine, { width: '35%', opacity: 0.08, marginTop: 4 }]} />
          <View style={[styles.glitchLine, { width: '45%', opacity: 0.06, marginTop: 4 }]} />
        </View>
      </View>
    </Animated.View>
  );
}

// ---- Word span with animated opacity ----

function WordSpan({
  index,
  token,
  progress,
}: {
  index: number;
  token: WordToken;
  progress: Animated.Value;
}) {
  // Use interpolate to derive opacity from progress
  // When progress < index: muted (0.35)
  // When progress = index: transitioning (0.35 -> 1)
  // When progress > index+1: settled (0.6)
  const opacity = progress.interpolate({
    inputRange: [
      Math.max(0, index - 0.01),
      index,
      index + 1,
      index + 1.01,
    ],
    outputRange: [Opacity.muted, Opacity.muted, 1, 0.6],
    extrapolate: 'clamp',
  });

  return (
    <Animated.Text
      style={[
        styles.word,
        token.emphasis && styles.wordEmphasis,
        { opacity },
      ]}
    >
      {token.display}{' '}
    </Animated.Text>
  );
}

// ---- styles ----

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: ZIndex.modal,
    backgroundColor: withAlpha(Surface.base, 0.85),
    justifyContent: 'center',
  },
  scanline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: Colors.accent,
    opacity: 0.6,
  },
  content: {
    paddingHorizontal: 24,
  },

  // Title with chromatic aberration
  titleContainer: {
    position: 'relative',
  },
  title: {
    fontFamily: Typography.mono.family,
    fontSize: 42,
    fontWeight: 'bold',
    letterSpacing: 2,
    color: Colors.accent,
    textTransform: 'uppercase',
    lineHeight: 48,
  },
  titleShadowWhite: {
    position: 'absolute',
    left: 2,
    top: 0,
    color: TextColors.primary,
    opacity: 0.3,
  },
  titleShadowGold: {
    position: 'absolute',
    left: -2,
    top: 0,
    opacity: 0.4,
  },

  // Gold bar
  barTrack: {
    height: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  goldBar: {
    height: 3,
    backgroundColor: Colors.accent,
  },
  goldBarGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },

  // Quote box
  quoteBox: {
    marginTop: 20,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderColor: Colors.accent,
    backgroundColor: withAlpha(Surface.base, 0.4),
    padding: 16,
  },
  transmissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  transmissionLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 1.6,
    color: Colors.accent,
    textTransform: 'uppercase',
  },

  // Words
  wordsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  word: {
    fontFamily: Typography.mono.family,
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.accent,
    textTransform: 'uppercase',
    lineHeight: 32,
  },
  wordEmphasis: {
    backgroundColor: withAlpha(Colors.accent, 0.25),
    color: Colors.accent,
  },

  // Signal metadata
  signalMeta: {
    fontFamily: Typography.mono.family,
    fontSize: 7,
    color: TextColors.outline,
    opacity: Opacity.muted,
    marginTop: 12,
    letterSpacing: 0.5,
  },

  // Speaking badge
  speakingBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
  },
  speakingBadgeText: {
    fontFamily: Typography.mono.family,
    fontSize: 8,
    letterSpacing: 1.2,
    color: Colors.accent,
    textTransform: 'uppercase',
  },

  // Glitch lines
  glitchLines: {
    marginTop: 16,
  },
  glitchLine: {
    height: 1,
    backgroundColor: Colors.accent,
  },
});

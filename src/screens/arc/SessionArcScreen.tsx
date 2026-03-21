import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, AppState, View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Surface, TextColors, Typography, Spacing, Radius, Opacity, AppHeaderTokens, withAlpha, getVibeAccent } from '../../tokens/design-tokens';
import { AppHeader } from '../../components/AppHeader';
import { CleoOrb } from '../../components/CleoOrb';
import { WaveformBars } from '../../components/WaveformBars';
import { sessionEngine, type Session, type SessionPhase } from '../../engines/SessionEngine';
import { getStations, type Station } from '../../services/Storage';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { getUpcomingQueue, type NowPlaying, type UpcomingTrack } from '../../../modules/expo-music-kit';

// ---------- helpers ----------

const PHASE_ORDER: SessionPhase[] = ['coldOpen', 'earlySession', 'build', 'peak', 'resolution', 'signOff'];

function phaseProgress(phase: SessionPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 0) return 0;
  return idx / (PHASE_ORDER.length - 1);
}

function formatMinutes(m: number): string {
  if (m < 1) return 'Just started';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function stationForSession(session: Session): Station | undefined {
  return getStations().find((s) => s.id === session.stationId);
}

// Highlight first word with gold
function renderSessionTitle(name: string, accentColor: string) {
  const words = name.split(' ');
  if (words.length <= 1) {
    return <Text style={[styles.sessionName, { color: accentColor }]}>{name}</Text>;
  }
  const idx = Math.min(1, words.length - 1);
  return (
    <Text style={styles.sessionName}>
      {words.map((w, i) => (
        <Text key={i} style={i === idx ? { color: accentColor } : undefined}>
          {i > 0 ? ' ' : ''}{w}
        </Text>
      ))}
    </Text>
  );
}

// ---------- sub-components ----------

const AnimatedCircle = RNAnimated.createAnimatedComponent(Circle);

function ArcVisualization({ phase, vibeAccent }: { phase: SessionPhase; vibeAccent: string }) {
  const progress = phaseProgress(phase);
  const pulseScale = useRef(new RNAnimated.Value(6)).current;
  const pulseOpacity = useRef(new RNAnimated.Value(0.4)).current;

  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.parallel([
          RNAnimated.timing(pulseScale, { toValue: 14, duration: 1000, useNativeDriver: false }),
          RNAnimated.timing(pulseOpacity, { toValue: 0, duration: 1000, useNativeDriver: false }),
        ]),
        RNAnimated.parallel([
          RNAnimated.timing(pulseScale, { toValue: 6, duration: 0, useNativeDriver: false }),
          RNAnimated.timing(pulseOpacity, { toValue: 0.4, duration: 0, useNativeDriver: false }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const W = 320;
  const H = 160;
  const PAD_BOTTOM = 30;

  // The path is hand-crafted so nodes sit exactly on the line.
  // Points: start → intro → build → peak → resolution → end
  const pts = {
    intro: { x: 70, y: 120 },
    build: { x: 155, y: 72 },
    peak:  { x: 230, y: 22 },
  };

  // SVG path that passes through all node positions
  const pathD = `M10 ${H - 10} C30 ${H - 10}, 50 ${pts.intro.y}, ${pts.intro.x} ${pts.intro.y} S120 ${pts.build.y}, ${pts.build.x} ${pts.build.y} S200 ${pts.peak.y}, ${pts.peak.x} ${pts.peak.y} S290 70, 310 80`;

  const nodes = [
    { ...pts.intro, label: 'INTRO', size: 8 },
    { ...pts.build, label: 'BUILD', size: 10 },
    { ...pts.peak, label: 'PEAK', size: 14 },
  ];

  // "You are here" interpolated between node positions
  const phasePositions = [
    { x: 10, y: H - 10 },    // coldOpen (0)
    pts.intro,                 // earlySession (0.2)
    pts.build,                 // build (0.4)
    pts.peak,                  // peak (0.6)
    { x: 280, y: 60 },        // resolution (0.8)
    { x: 310, y: 80 },        // signOff (1.0)
  ];

  const getPosition = (t: number) => {
    const seg = t * (phasePositions.length - 1);
    const i = Math.min(Math.floor(seg), phasePositions.length - 2);
    const f = seg - i;
    return {
      x: phasePositions[i].x + (phasePositions[i + 1].x - phasePositions[i].x) * f,
      y: phasePositions[i].y + (phasePositions[i + 1].y - phasePositions[i].y) * f,
    };
  };

  const youAreHere = getPosition(progress);

  return (
    <View style={[styles.arcContainer, { height: H + PAD_BOTTOM }]}>
      <Svg width={W} height={H + PAD_BOTTOM} viewBox={`0 0 ${W} ${H + PAD_BOTTOM}`}>
        <Defs>
          <SvgLinearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={Colors.accent} stopOpacity="1" />
            <Stop offset="100%" stopColor={vibeAccent} stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>
        <Path
          d={pathD}
          stroke="url(#arcGrad)"
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />
        {/* Phase nodes */}
        {nodes.map((node, i) => {
          const isPeak = node.label === 'PEAK';
          return (
            <Circle
              key={i}
              cx={node.x}
              cy={node.y}
              r={node.size / 2}
              fill={isPeak ? vibeAccent : withAlpha(Colors.accent, 0.3)}
              stroke={Colors.accent}
              strokeWidth={isPeak ? 2 : 1}
            />
          );
        })}
        {/* You are here — pulse ring */}
        <AnimatedCircle cx={youAreHere.x} cy={youAreHere.y} r={pulseScale} fill="none" stroke={Colors.base.white} strokeWidth={1.5} opacity={pulseOpacity} />
        <Circle cx={youAreHere.x} cy={youAreHere.y} r={4} fill={Colors.base.white} />
      </Svg>
      {/* Node labels */}
      {nodes.map((node, i) => (
        <Text
          key={`label-${i}`}
          style={[
            styles.nodeLabel,
            { left: node.x - 20, top: node.y + (node.size / 2) + 4 },
          ]}
        >
          {node.label}
        </Text>
      ))}
      {/* You are here label */}
      <Text
        style={[
          styles.youAreHere,
          { left: youAreHere.x - 24, top: youAreHere.y + 10 },
        ]}
      >
        YOU ARE HERE
      </Text>
    </View>
  );
}

function CurrentTrackCard({ nowPlaying, vibeAccent }: { nowPlaying: NowPlaying; vibeAccent: string }) {
  const genre = nowPlaying.genreNames?.[0];

  return (
    <View style={styles.trackCard}>
      <View style={styles.trackCardGoldEdge} />
      <View style={styles.trackCardInner}>
        {nowPlaying.artworkUrl ? (
          <Image source={{ uri: nowPlaying.artworkUrl }} style={styles.trackArt} />
        ) : (
          <View style={[styles.trackArt, styles.trackArtPlaceholder]} />
        )}
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{nowPlaying.title}</Text>
          <Text style={styles.trackArtist} numberOfLines={1}>{'\u2014 '}{nowPlaying.artistName}</Text>
          {genre ? (
            <View style={styles.chipRow}>
              <View style={styles.chip}>
                <Text style={styles.chipText}>{genre}</Text>
              </View>
            </View>
          ) : null}
        </View>
        <View style={styles.nowIndicator}>
          <WaveformBars color={vibeAccent} />
          <Text style={[styles.nowLabel, { color: vibeAccent }]}>NOW</Text>
        </View>
      </View>
    </View>
  );
}

function SessionPulse({ session, vibeAccent }: { session: Session; vibeAccent: string }) {
  const duration = Math.floor((Date.now() - session.startTime) / 60000);
  const played = session.tracksPlayed.length;
  const totalTracks = session.queuePlan?.queue.length ?? 0;
  const progressPct = totalTracks > 0 ? Math.min(100, Math.round((played / totalTracks) * 100)) : 0;
  const skipped = session.skippedTracks.length;

  // Estimate remaining: average time per track so far, times tracks left
  const avgPerTrack = played > 0 ? duration / played : 3.5; // fallback ~3.5 min
  const tracksRemaining = Math.max(0, totalTracks - played);
  const estimatedRemaining = Math.round(avgPerTrack * tracksRemaining);

  return (
    <View style={styles.pulseCard}>
      <Text style={styles.sectionLabel}>SESSION PULSE</Text>
      <View style={styles.pulseRow}>
        <Text style={styles.pulseLabel}>Session Progress</Text>
        <Text style={styles.pulseValue}>{progressPct}%</Text>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${progressPct}%`, backgroundColor: Colors.accent }]} />
      </View>
      <View style={[styles.pulseRow, { marginTop: Spacing.md }]}>
        <Text style={styles.pulseLabel}>Time Elapsed</Text>
        <Text style={styles.pulseValue}>{formatMinutes(duration)}</Text>
      </View>
      <View style={[styles.pulseRow, { marginTop: Spacing.sm }]}>
        <Text style={styles.pulseLabel}>Estimated Remaining</Text>
        <Text style={[styles.pulseValue, { color: vibeAccent }]}>~{formatMinutes(estimatedRemaining)}</Text>
      </View>
      <View style={[styles.pulseRow, { marginTop: Spacing.sm }]}>
        <Text style={styles.pulseLabel}>Tracks Played</Text>
        <Text style={styles.pulseValue}>{played}{totalTracks > 0 ? ` / ${totalTracks}` : ''}</Text>
      </View>
      {skipped > 0 && (
        <View style={[styles.pulseRow, { marginTop: Spacing.sm }]}>
          <Text style={styles.pulseLabel}>Skipped</Text>
          <Text style={styles.pulseValue}>{skipped}</Text>
        </View>
      )}
    </View>
  );
}

function UpcomingManifest({ upcoming, vibeAccent }: { upcoming: UpcomingTrack[]; vibeAccent: string }) {
  if (upcoming.length === 0) {
    return (
      <View style={styles.manifestSection}>
        <Text style={styles.sectionLabel}>UPCOMING MANIFEST</Text>
        <Text style={styles.manifestEmpty}>Queue building...</Text>
      </View>
    );
  }

  const items: { type: 'track' | 'cleo'; track?: UpcomingTrack; key: string }[] = [];
  upcoming.forEach((track, i) => {
    items.push({ type: 'track', track, key: track.id ?? `track-${i}` });
    // Insert a ONAY commentary node after every 2 tracks
    if ((i + 1) % 2 === 0 && i < upcoming.length - 1) {
      items.push({ type: 'cleo', key: `cleo-${i}` });
    }
  });

  return (
    <View style={styles.manifestSection}>
      <Text style={styles.sectionLabel}>UPCOMING MANIFEST</Text>
      {items.map((item) => {
        if (item.type === 'cleo') {
          return (
            <View key={item.key} style={[styles.cleoNode, { backgroundColor: withAlpha(vibeAccent, 0.15) }]}>
              <CleoOrb size={20} />
              <Text style={styles.cleoNodeText}>ONAY commentary</Text>
            </View>
          );
        }
        const t = item.track!;
        return (
          <View key={item.key} style={styles.manifestTrack}>
            <View style={styles.manifestTrackInner}>
              {t.artworkUrl ? (
                <Image source={{ uri: t.artworkUrl }} style={styles.manifestArt} />
              ) : (
                <View style={[styles.manifestArt, styles.trackArtPlaceholder]} />
              )}
              <View style={styles.manifestTrackInfo}>
                <Text style={styles.manifestTrackTitle} numberOfLines={1}>
                  {t.title}
                </Text>
                <Text style={styles.manifestTrackArtist} numberOfLines={1}>
                  {t.artistName}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------- empty state ----------

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <CleoOrb size={64} showGlow />
      <Text style={styles.emptyText}>Start a broadcast to see your session arc</Text>
    </View>
  );
}

// ---------- main screen ----------

export function SessionArcScreen() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<Session | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingTrack[]>([]);
  const appActiveRef = useRef(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActiveRef.current = state === 'active';
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const refresh = async () => {
      if (!appActiveRef.current) return;
      const s = sessionEngine.getSession();
      if (s) {
        s.currentPhase = sessionEngine.getCurrentPhase();
      }
      setSession(s ? { ...s } : null);

      try {
        const [np, queue] = await Promise.all([
          musicKitPlayer.getNowPlaying(),
          getUpcomingQueue(6),
        ]);
        setNowPlaying(np);
        setUpcoming(queue);
      } catch (err) {
        console.warn('[SessionArcScreen] Refresh failed:', err);
        setNowPlaying(null);
        setUpcoming([]);
      }
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  const vibeAccent = session ? getVibeAccent(session.vibe) : Colors.accent;
  const station = useMemo(
    () => (session ? stationForSession(session) : undefined),
    [session?.stationId],
  );
  const sessionName = station?.name ?? 'Untitled Session';

  return (
    <View style={styles.root}>
      <AppHeader />
      {!session ? (
        <EmptyState />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: AppHeaderTokens.height + insets.top + Spacing.lg },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Session Title Area */}
          <View style={styles.titleArea}>
            <Text style={[styles.liveTag, { color: vibeAccent }]}>LIVE SESSION</Text>
            {renderSessionTitle(sessionName, vibeAccent)}
            <Text style={styles.sessionDesc}>
              {session.currentPhase.replace(/([A-Z])/g, ' $1').trim()} phase
              {' \u00B7 '}{formatMinutes(sessionEngine.getSessionDuration())} in
            </Text>
          </View>

          {/* Arc Visualization */}
          <ArcVisualization phase={session.currentPhase} vibeAccent={vibeAccent} />

          {/* Current Track Card */}
          {nowPlaying && <CurrentTrackCard nowPlaying={nowPlaying} vibeAccent={vibeAccent} />}

          {/* Session Pulse */}
          <SessionPulse session={session} vibeAccent={vibeAccent} />

          {/* Upcoming Manifest */}
          <UpcomingManifest upcoming={upcoming} vibeAccent={vibeAccent} />

          <View style={{ height: 120 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ---------- styles ----------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
  },

  // Section label (shared editorial style)
  sectionLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    marginBottom: Spacing.md,
  },

  // Title area
  titleArea: {
    marginBottom: Spacing.lg,
  },
  liveTag: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  sessionName: {
    fontFamily: Typography.display.family,
    fontSize: 30,
    color: TextColors.primary,
    marginBottom: Spacing.xs,
  },
  sessionDesc: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
  },

  // Arc visualization
  arcContainer: {
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  nodeLabel: {
    position: 'absolute',
    fontFamily: Typography.mono.family,
    fontSize: 8,
    color: TextColors.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    width: 40,
    textAlign: 'center',
  },
  youAreHere: {
    position: 'absolute',
    fontFamily: Typography.mono.family,
    fontSize: 7,
    color: Colors.base.white,
    letterSpacing: 1,
    textTransform: 'uppercase',
    width: 48,
    textAlign: 'center',
    opacity: Opacity.secondary,
  },

  // Current track card
  trackCard: {
    marginBottom: Spacing.lg,
    flexDirection: 'row',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  trackCardGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
  },
  trackCardInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
  },
  trackArt: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
  },
  trackArtPlaceholder: {
    backgroundColor: Surface.container,
  },
  trackInfo: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  trackTitle: {
    fontFamily: Typography.display.family,
    fontSize: 16,
    color: TextColors.primary,
  },
  trackArtist: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.secondary,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  chip: {
    backgroundColor: Surface.low,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  chipText: {
    fontFamily: Typography.mono.family,
    fontSize: 8,
    color: TextColors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nowIndicator: {
    alignItems: 'center',
    marginLeft: Spacing.sm,
  },
  nowLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 8,
    letterSpacing: 1,
    marginTop: 2,
  },

  // Session Pulse
  pulseCard: {
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  pulseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pulseLabel: {
    fontFamily: Typography.body.family,
    fontSize: 13,
    color: TextColors.secondary,
  },
  pulseValue: {
    fontFamily: Typography.display.family,
    fontSize: 18,
    color: TextColors.primary,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: Surface.low,
    borderRadius: 2,
    marginTop: Spacing.sm,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },

  // Upcoming Manifest
  manifestSection: {
    marginBottom: Spacing.lg,
  },
  manifestEmpty: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
    opacity: Opacity.secondary,
  },
  manifestTrack: {
    marginBottom: Spacing.sm,
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  manifestTrackInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  manifestArt: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
  },
  manifestTrackInfo: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  manifestTrackTitle: {
    fontFamily: Typography.display.family,
    fontSize: 14,
    color: TextColors.primary,
  },
  manifestTrackArtist: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.secondary,
    marginTop: 2,
  },
  cleoNode: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  cleoNodeText: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: Typography.cleoVoice.style,
    fontSize: 13,
    color: TextColors.primary,
    opacity: Opacity.secondary,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  emptyText: {
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: TextColors.secondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
});

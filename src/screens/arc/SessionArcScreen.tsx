import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle } from 'react-native-svg';
import { Colors, Surface, TextColors, Typography, Glass, Spacing, Radius, Opacity, withAlpha, getVibeAccent } from '../../tokens/design-tokens';
import { AppHeader } from '../../components/AppHeader';
import { GlassCard } from '../../components/GlassCard';
import { CleoOrb } from '../../components/CleoOrb';
import { SectionLabel } from '../../components/SectionLabel';
import { WaveformBars } from '../../components/WaveformBars';
import { sessionEngine, type Session, type SessionPhase } from '../../engines/SessionEngine';
import { queueManager } from '../../engines/QueueManager';
import { segmentController } from '../../engines/SegmentController';
import { getStations, type Station } from '../../services/Storage';

// ---------- helpers ----------

const PHASE_ORDER: SessionPhase[] = ['coldOpen', 'earlySession', 'build', 'peak', 'resolution', 'signOff'];

function phaseProgress(phase: SessionPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 0) return 0;
  return idx / (PHASE_ORDER.length - 1);
}

function energyFromPhase(phase: SessionPhase): number {
  const map: Record<SessionPhase, number> = {
    coldOpen: 20,
    earlySession: 35,
    build: 60,
    peak: 90,
    resolution: 55,
    signOff: 25,
  };
  return map[phase] ?? 40;
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
    return <Text style={[styles.sessionName, { color: Colors.accent }]}>{name}</Text>;
  }
  // Make the second word gold (feels more natural than first)
  const idx = Math.min(1, words.length - 1);
  return (
    <Text style={styles.sessionName}>
      {words.map((w, i) => (
        <Text key={i} style={i === idx ? { color: Colors.accent } : undefined}>
          {i > 0 ? ' ' : ''}{w}
        </Text>
      ))}
    </Text>
  );
}

// ---------- sub-components ----------

function ArcVisualization({ phase, vibeAccent }: { phase: SessionPhase; vibeAccent: string }) {
  const progress = phaseProgress(phase);
  const arcWidth = 340;
  const arcHeight = 180;

  // Node positions along the curve (t parameter roughly)
  const nodes = [
    { t: 0.2, label: 'Intro', size: 10 },
    { t: 0.5, label: 'Build', size: 12 },
    { t: 0.75, label: 'Peak', size: 16 },
  ];

  // Approximate x,y on the bezier for a given t
  function bezierPoint(t: number): { x: number; y: number } {
    // Simplified cubic bezier approximation matching the SVG path
    const x = 10 + t * (arcWidth - 20);
    // Inverted parabola peaking around t=0.75
    const peak = 0.75;
    const spread = 0.6;
    const normalizedDist = Math.abs(t - peak) / spread;
    const y = arcHeight - 20 - (1 - normalizedDist * normalizedDist) * (arcHeight - 50);
    return { x: Math.max(10, Math.min(arcWidth - 10, x)), y: Math.max(20, Math.min(arcHeight - 10, y)) };
  }

  const youAreHere = bezierPoint(progress);

  return (
    <View style={styles.arcContainer}>
      <Svg width={arcWidth} height={arcHeight} viewBox={`0 0 ${arcWidth} ${arcHeight}`}>
        <Defs>
          <SvgLinearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={Colors.accent} stopOpacity="1" />
            <Stop offset="100%" stopColor={vibeAccent} stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>
        <Path
          d="M10 160 C60 160, 80 100, 150 100 S230 30, 260 30 S320 80, 330 80"
          stroke="url(#arcGrad)"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
        {/* Cleo moment nodes */}
        {nodes.map((node, i) => {
          const pt = bezierPoint(node.t);
          const isPeak = node.label === 'Peak';
          return (
            <Circle
              key={i}
              cx={pt.x}
              cy={pt.y}
              r={node.size / 2}
              fill={isPeak ? vibeAccent : withAlpha(Colors.accent, 0.3)}
              stroke={Colors.accent}
              strokeWidth={isPeak ? 2 : 1}
            />
          );
        })}
        {/* You are here indicator */}
        <Circle cx={youAreHere.x} cy={youAreHere.y} r={4} fill={Colors.base.white} />
        <Path
          d={`M${youAreHere.x} ${youAreHere.y + 4} L${youAreHere.x} ${youAreHere.y + 20}`}
          stroke={Colors.base.white}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeOpacity={0.6}
        />
      </Svg>
      {/* Node labels */}
      {nodes.map((node, i) => {
        const pt = bezierPoint(node.t);
        return (
          <Text
            key={`label-${i}`}
            style={[
              styles.nodeLabel,
              { left: pt.x - 20, top: pt.y + (node.size / 2) + 6 },
            ]}
          >
            {node.label}
          </Text>
        );
      })}
      {/* You are here label */}
      <Text
        style={[
          styles.youAreHere,
          { left: youAreHere.x - 24, top: youAreHere.y + 22 },
        ]}
      >
        YOU ARE HERE
      </Text>
    </View>
  );
}

function CurrentTrackCard({ session, vibeAccent }: { session: Session; vibeAccent: string }) {
  const currentTrackId = session.tracksPlayed[session.tracksPlayed.length - 1];
  const profile = currentTrackId ? queueManager.getTrackProfile(currentTrackId) : undefined;

  const title = profile?.title ?? 'Loading...';
  const artist = profile?.artistName ?? '';
  const artworkUrl = profile?.artworkUrl
    ? profile.artworkUrl.replace('{w}', '96').replace('{h}', '96')
    : undefined;
  const tags = profile?.tags ?? [];
  const genreNames = profile?.genreNames ?? [];
  const genre = genreNames[0];

  const chipItems: string[] = [];
  if (genre) chipItems.push(genre);
  if (tags.length > 0) chipItems.push(...tags.slice(0, 2));

  return (
    <GlassCard style={styles.trackCard}>
      <View style={styles.trackCardInner}>
        {artworkUrl ? (
          <Image source={{ uri: artworkUrl }} style={styles.trackArt} />
        ) : (
          <View style={[styles.trackArt, styles.trackArtPlaceholder]} />
        )}
        <View style={styles.trackInfo}>
          <Text style={styles.trackTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.trackArtist} numberOfLines={1}>{artist}</Text>
          {chipItems.length > 0 && (
            <View style={styles.chipRow}>
              {chipItems.map((chip, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={styles.nowIndicator}>
          <WaveformBars color={vibeAccent} />
          <Text style={[styles.nowLabel, { color: vibeAccent }]}>NOW</Text>
        </View>
      </View>
    </GlassCard>
  );
}

function SessionPulse({ session, vibeAccent }: { session: Session; vibeAccent: string }) {
  const duration = sessionEngine.getSessionDuration();
  const energy = energyFromPhase(session.currentPhase);
  // Estimate ~60 min total session
  const estimatedTotal = 60;
  const remaining = Math.max(0, estimatedTotal - duration);

  return (
    <View style={styles.pulseCard}>
      <SectionLabel>SESSION PULSE</SectionLabel>
      <View style={styles.pulseRow}>
        <Text style={styles.pulseLabel}>Energy Level</Text>
        <Text style={styles.pulseValue}>{energy}%</Text>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${energy}%`, backgroundColor: Colors.accent }]} />
      </View>
      <View style={[styles.pulseRow, { marginTop: Spacing.md }]}>
        <Text style={styles.pulseLabel}>Time Remaining</Text>
        <Text style={[styles.pulseValue, { color: vibeAccent }]}>~{formatMinutes(remaining)}</Text>
      </View>
      <View style={[styles.pulseRow, { marginTop: Spacing.sm }]}>
        <Text style={styles.pulseLabel}>Tracks Played</Text>
        <Text style={styles.pulseValue}>{session.tracksPlayed.length}</Text>
      </View>
    </View>
  );
}

function UpcomingManifest({ session, vibeAccent }: { session: Session; vibeAccent: string }) {
  const upcomingIds = sessionEngine.getNextTrackIds(6);

  if (upcomingIds.length === 0) {
    return (
      <View style={styles.manifestSection}>
        <Text style={styles.manifestTitle}>Upcoming Manifest</Text>
        <Text style={styles.manifestEmpty}>Queue building...</Text>
      </View>
    );
  }

  const items: { type: 'track' | 'cleo'; id: string; index: number }[] = [];
  upcomingIds.forEach((id, i) => {
    items.push({ type: 'track', id, index: i });
    // Insert a Cleo commentary node after every 2 tracks
    if ((i + 1) % 2 === 0 && i < upcomingIds.length - 1) {
      items.push({ type: 'cleo', id: `cleo-${i}`, index: i });
    }
  });

  return (
    <View style={styles.manifestSection}>
      <Text style={styles.manifestTitle}>Upcoming Manifest</Text>
      {items.map((item) => {
        if (item.type === 'cleo') {
          return (
            <View key={item.id} style={[styles.cleoNode, { backgroundColor: withAlpha(vibeAccent, 0.15) }]}>
              <CleoOrb size={20} />
              <Text style={styles.cleoNodeText}>Cleo commentary</Text>
            </View>
          );
        }
        const profile = queueManager.getTrackProfile(item.id);
        const artworkUrl = profile?.artworkUrl
          ? profile.artworkUrl.replace('{w}', '96').replace('{h}', '96')
          : undefined;
        return (
          <GlassCard key={item.id} style={styles.manifestTrack}>
            <View style={styles.manifestTrackInner}>
              {artworkUrl ? (
                <Image source={{ uri: artworkUrl }} style={styles.manifestArt} />
              ) : (
                <View style={[styles.manifestArt, styles.trackArtPlaceholder]} />
              )}
              <View style={styles.manifestTrackInfo}>
                <Text style={styles.manifestTrackTitle} numberOfLines={1}>
                  {profile?.title ?? 'Unknown Track'}
                </Text>
                <Text style={styles.manifestTrackArtist} numberOfLines={1}>
                  {profile?.artistName ?? ''}
                </Text>
              </View>
            </View>
          </GlassCard>
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
  const [session, setSession] = useState<Session | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Poll session state every 3 seconds for live updates
    setSession(sessionEngine.getSession());
    const interval = setInterval(() => {
      setSession(sessionEngine.getSession());
      setTick((t) => t + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const vibeAccent = session ? getVibeAccent(session.vibe) : Colors.accent;
  const station = session ? stationForSession(session) : undefined;
  const sessionName = station?.name ?? 'Untitled Session';

  return (
    <View style={styles.root}>
      <AppHeader />
      {!session ? (
        <EmptyState />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
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
          <CurrentTrackCard session={session} vibeAccent={vibeAccent} />

          {/* Session Pulse */}
          <SessionPulse session={session} vibeAccent={vibeAccent} />

          {/* Upcoming Manifest */}
          <UpcomingManifest session={session} vibeAccent={vibeAccent} />

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
    paddingTop: 100, // below AppHeader
    paddingHorizontal: Spacing.lg,
  },

  // Title area
  titleArea: {
    marginBottom: Spacing.lg,
  },
  liveTag: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 1.6,
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
    height: 200,
    backgroundColor: Surface.low,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    overflow: 'hidden',
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
    padding: Spacing.md,
  },
  trackCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
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
    backgroundColor: Surface.low,
    borderRadius: Radius.lg,
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
    backgroundColor: Surface.container,
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
  manifestTitle: {
    fontFamily: Typography.display.family,
    fontSize: 16,
    color: TextColors.primary,
    marginBottom: Spacing.md,
  },
  manifestEmpty: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
    opacity: Opacity.secondary,
  },
  manifestTrack: {
    marginBottom: Spacing.sm,
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

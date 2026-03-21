import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Colors,
  Surface,
  TextColors,
  Typography,
  Spacing,
  Radius,
  AppHeaderTokens,
  withAlpha,
} from '../../tokens/design-tokens';
import { AppHeader } from '../../components/AppHeader';
import { CleoOrb } from '../../components/CleoOrb';
import { getStations, setStations as persistStations, getCachedPlaylists, type Station } from '../../services/Storage';
import { loadSessionMemory } from '../../services/SessionMemory';
import type { Vibe } from '../../cleo/fallbacks';

// ── Types ──────────────────────────────────────────────────────────────

type FilterTab = 'latest' | 'byMood' | 'byDate';

const VIBE_LABELS: Record<string, string> = {
  morning: 'Morning',
  chill: 'Chill',
  lateNight: 'Late Night',
  workout: 'Workout',
  party: 'Party',
  general: 'General',
  focus: 'Focus',
  feelGood: 'Feel Good',
  throwback: 'Throwback',
  elevated: 'Elevated',
  melancholy: 'Melancholy',
  sunday: 'Sunday',
};

function formatDate(dateString: string): string {
  const d = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const FILTERS: { key: FilterTab; label: string }[] = [
  { key: 'latest', label: 'Latest' },
  { key: 'byMood', label: 'By Mood' },
  { key: 'byDate', label: 'By Date' },
];

// ── Empty State ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <CleoOrb size={64} showGlow />
      <Text style={styles.emptyTitle}>No Broadcasts Yet</Text>
      <Text style={styles.emptySubtext}>
        Start a broadcast and it will appear here. Every session tells a story.
      </Text>
    </View>
  );
}

// ── Station Archive Card ────────────────────────────────────────────────

function ArchiveCard({
  station,
  isLastPlayed,
  onPress,
}: {
  station: Station;
  isLastPlayed: boolean;
  onPress: () => void;
}) {
  const vibeLabel = VIBE_LABELS[station.defaultVibe] ?? 'General';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      accessibilityLabel={`${station.name}, ${vibeLabel} broadcast${isLastPlayed ? ', last played' : ''}`}
      accessibilityRole="button"
    >
      <View style={styles.card}>
        {/* Artwork */}
        <View style={styles.cardArtContainer}>
          {station.artworkUrl ? (
            <Image source={{ uri: station.artworkUrl }} style={styles.cardArt} />
          ) : (
            <View style={[styles.cardArt, styles.cardArtPlaceholder]} />
          )}
          {/* Vibe tag overlay */}
          <View style={styles.cardVibeTag}>
            <Text style={styles.cardVibeText}>{vibeLabel}</Text>
          </View>
          {isLastPlayed && (
            <View style={styles.cardEditorPick}>
              <Text style={styles.cardEditorPickText}>LAST PLAYED</Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <View style={styles.cardGoldEdge} />
          <View style={styles.cardInfoInner}>
            <Text style={styles.cardDate}>{formatDate(station.createdAt)}</Text>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {station.name}
            </Text>
            <View style={styles.cardMeta}>
              <Text style={styles.cardMetaText}>{vibeLabel} Broadcast</Text>
            </View>
            <View style={styles.cardAction}>
              <Text style={styles.cardActionText}>RESUME BROADCAST</Text>
              <Text style={styles.cardActionArrow}>{'\u25B6'}</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────

export function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const [stations, setStations] = useState<Station[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('latest');
  const [lastStationId, setLastStationId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let current = getStations();

      // Refresh artwork from cached playlists
      const playlists = getCachedPlaylists();
      if (playlists) {
        let updated = false;
        current = current.map((s) => {
          const match = playlists.find((p) => p.id === s.playlistId);
          if (match?.artworkUrl && match.artworkUrl !== s.artworkUrl) {
            updated = true;
            return { ...s, artworkUrl: match.artworkUrl };
          }
          return s;
        });
        if (updated) persistStations(current);
      }

      setStations(current);
      const mem = loadSessionMemory();
      setLastStationId(mem?.lastStationId ?? null);
    }, []),
  );

  const handleStationPress = useCallback((station: Station) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

  const sortedStations = [...stations].sort((a, b) => {
    if (activeFilter === 'byMood') {
      return a.defaultVibe.localeCompare(b.defaultVibe);
    }
    if (activeFilter === 'byDate') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    // 'latest' — last played first, then by creation date
    if (a.id === lastStationId) return -1;
    if (b.id === lastStationId) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <View style={styles.root}>
      <AppHeader />

      {stations.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={sortedStations}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: AppHeaderTokens.height + insets.top + Spacing.lg },
          ]}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.headerLabel}>BROADCAST ARCHIVES</Text>
              <View style={styles.headerAccent} />
              <Text style={styles.headerTitle}>
                Broadcast{'\n'}Archives
              </Text>
              <Text style={styles.headerSubtext}>
                Your listening story, preserved for discovery.
              </Text>

              {/* Filter tabs */}
              <View style={styles.filterRow}>
                {FILTERS.map((f) => (
                  <Pressable
                    key={f.key}
                    onPress={() => setActiveFilter(f.key)}
                    style={[
                      styles.filterTab,
                      activeFilter === f.key && styles.filterTabActive,
                    ]}
                    accessibilityLabel={`Filter by ${f.label}${activeFilter === f.key ? ', selected' : ''}`}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.filterTabText,
                        activeFilter === f.key && styles.filterTabTextActive,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <ArchiveCard
              station={item}
              isLastPlayed={item.id === lastStationId}
              onPress={() => handleStationPress(item)}
            />
          )}
        />
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 120,
  },

  // Header
  header: {
    marginBottom: Spacing.xl,
  },
  headerLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    marginBottom: Spacing.sm,
  },
  headerAccent: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    marginBottom: Spacing.md,
  },
  headerTitle: {
    fontFamily: Typography.display.family,
    fontSize: 34,
    color: TextColors.primary,
    lineHeight: 42,
    marginBottom: Spacing.sm,
  },
  headerSubtext: {
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.secondary,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },

  // Filters
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  filterTab: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: TextColors.outlineVariant,
    borderRadius: Radius.full,
  },
  filterTabActive: {
    borderColor: Colors.accent,
    backgroundColor: withAlpha(Colors.accent, 0.12),
  },
  filterTabText: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    letterSpacing: 1,
    color: TextColors.outline,
  },
  filterTabTextActive: {
    color: Colors.accent,
  },

  // Archive Card
  card: {
    marginBottom: Spacing.lg,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Surface.container,
  },
  cardArtContainer: {
    aspectRatio: 16 / 9,
    position: 'relative',
  },
  cardArt: {
    width: '100%',
    height: '100%',
  },
  cardArtPlaceholder: {
    backgroundColor: Surface.high,
  },
  cardVibeTag: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: withAlpha(Surface.base, 0.7),
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
  },
  cardVibeText: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 1.5,
    color: TextColors.primary,
  },
  cardEditorPick: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.accent,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
  },
  cardEditorPickText: {
    fontFamily: Typography.mono.family,
    fontSize: 8,
    letterSpacing: 1.5,
    color: Surface.base,
  },
  cardInfo: {
    flexDirection: 'row',
  },
  cardGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
  },
  cardInfoInner: {
    flex: 1,
    padding: Spacing.md,
  },
  cardDate: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 1.5,
    color: TextColors.outline,
    marginBottom: Spacing.xs,
  },
  cardTitle: {
    fontFamily: Typography.display.family,
    fontSize: 20,
    color: TextColors.primary,
    lineHeight: 26,
    marginBottom: Spacing.sm,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  cardMetaText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1,
    color: TextColors.secondary,
  },
  cardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardActionText: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.accent,
  },
  cardActionArrow: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.accent,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    fontFamily: Typography.display.family,
    fontSize: 22,
    color: TextColors.primary,
  },
  emptySubtext: {
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});

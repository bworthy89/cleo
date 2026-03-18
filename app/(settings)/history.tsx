import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing, Opacity, Tracking, withAlpha } from '../../src/tokens/design-tokens';
import { storage, StorageKeys, getUser } from '../../src/services/Storage';

interface SessionRecord {
  id: string;
  stationId: string;
  vibe: string;
  startTime: number;
  tracksPlayed: string[];
}

function getSessionHistory(): SessionRecord[] {
  const raw = storage.getString(StorageKeys.SESSIONS);
  return raw ? JSON.parse(raw) : [];
}

export default function HistoryScreen() {
  const sessions = getSessionHistory();

  const user = getUser();
  const userVibe = (user?.defaultVibe as keyof typeof Colors.vibe) ?? 'morning';
  const vibeTheme = Colors.vibe[userVibe] ?? Colors.vibe.morning;

  if (sessions.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: vibeTheme.bg }]}>
        <Text style={[styles.emptyCleoVoice, { color: vibeTheme.accent }]}>
          We haven't started yet. But I'm ready when you are.
        </Text>
        <Text style={[styles.emptySubtext, { color: vibeTheme.text }]}>
          Start listening to build your history
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={[styles.container, { backgroundColor: vibeTheme.bg }]}
      data={sessions}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        const date = new Date(item.startTime);
        const duration = item.tracksPlayed.length;
        return (
          <View style={[styles.row, { borderBottomColor: withAlpha(vibeTheme.text, 0.08) }]}>
            <Text style={[styles.date, { color: vibeTheme.text }]}>
              {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <Text style={[styles.detail, { color: vibeTheme.text }]}>
              {duration} tracks · {item.vibe}
            </Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emptyCleoVoice: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  emptySubtext: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    opacity: 0.5,
    marginTop: Spacing.sm,
  },
  row: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
  },
  date: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
  },
  detail: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    opacity: 0.5,
    letterSpacing: 1,
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
  },
});

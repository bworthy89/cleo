import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { storage } from '../../src/services/Storage';

interface SessionRecord {
  id: string;
  stationId: string;
  vibe: string;
  startTime: number;
  tracksPlayed: string[];
}

function getSessionHistory(): SessionRecord[] {
  const raw = storage.getString('sessionHistory');
  return raw ? JSON.parse(raw) : [];
}

export default function HistoryScreen() {
  const sessions = getSessionHistory();

  if (sessions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No sessions yet</Text>
        <Text style={styles.emptySubtext}>Start listening to build your history</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={sessions}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        const date = new Date(item.startTime);
        const duration = item.tracksPlayed.length;
        return (
          <View style={styles.row}>
            <Text style={styles.date}>
              {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <Text style={styles.detail}>
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
    backgroundColor: Colors.vibe.morning.bg,
  },
  empty: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 18,
    color: Colors.vibe.morning.text,
  },
  emptySubtext: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    marginTop: Spacing.sm,
  },
  row: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  date: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
    color: Colors.vibe.morning.text,
  },
  detail: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    letterSpacing: 1,
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
  },
});

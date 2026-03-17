import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';

export default function HostSettingsScreen() {
  const [commentary, setCommentary] = useState(true);
  const [pullQuotes, setPullQuotes] = useState(true);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Cleo Commentary</Text>
          <Text style={styles.rowSubtitle}>Cleo speaks between tracks</Text>
        </View>
        <Switch value={commentary} onValueChange={setCommentary} />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Pull Quotes</Text>
          <Text style={styles.rowSubtitle}>Full-screen track story moments</Text>
        </View>
        <Switch value={pullQuotes} onValueChange={setPullQuotes} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
    paddingTop: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  rowText: {
    flex: 1,
    marginRight: Spacing.md,
  },
  rowTitle: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
    color: Colors.vibe.morning.text,
  },
  rowSubtitle: {
    fontFamily: Typography.label.family,
    fontSize: 13,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    marginTop: Spacing.xs,
  },
});

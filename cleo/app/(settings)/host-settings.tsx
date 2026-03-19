import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Colors, Typography, Spacing, Opacity, withAlpha } from '../../src/tokens/design-tokens';
import { getUser } from '../../src/services/Storage';

export default function HostSettingsScreen() {
  const [commentary, setCommentary] = useState(true);
  const [pullQuotes, setPullQuotes] = useState(true);

  const user = getUser();
  const userVibe = (user?.defaultVibe as keyof typeof Colors.vibe) ?? 'morning';
  const vibeTheme = Colors.vibe[userVibe] ?? Colors.vibe.morning;

  return (
    <View style={[styles.container, { backgroundColor: vibeTheme.bg }]}>
      <View style={[styles.row, { borderBottomColor: withAlpha(vibeTheme.text, 0.08) }]}>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: vibeTheme.text }]}>Cleo Commentary</Text>
          <Text style={[styles.rowSubtitle, { color: vibeTheme.text }]}>Cleo speaks between tracks</Text>
        </View>
        <Switch
          value={commentary}
          onValueChange={setCommentary}
          thumbColor={vibeTheme.accent}
          trackColor={{ true: vibeTheme.accent, false: withAlpha(vibeTheme.text, 0.15) }}
        />
      </View>

      <View style={[styles.row, { borderBottomColor: withAlpha(vibeTheme.text, 0.08) }]}>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: vibeTheme.text }]}>Pull Quotes</Text>
          <Text style={[styles.rowSubtitle, { color: vibeTheme.text }]}>Full-screen track story moments</Text>
        </View>
        <Switch
          value={pullQuotes}
          onValueChange={setPullQuotes}
          thumbColor={vibeTheme.accent}
          trackColor={{ true: vibeTheme.accent, false: withAlpha(vibeTheme.text, 0.15) }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
  },
  rowText: {
    flex: 1,
    marginRight: Spacing.md,
  },
  rowTitle: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
  },
  rowSubtitle: {
    fontFamily: Typography.label.family,
    fontSize: 13,
    opacity: 0.5,
    marginTop: Spacing.xs,
  },
});

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, TypeScale } from '../../tokens/design-tokens';
import { useAppActive } from '../../hooks/useAppActive';
import { useSettings } from '../../contexts/SettingsContext';

interface Props {
  onAir?: boolean;
  num?: string;
  /** Override clock value. If omitted, ticks live via useAppActive. */
  clock?: string;
  /**
   * Force-hide the settings cog. By default the cog shows whenever a
   * SettingsProvider is in the tree (i.e. on (main) screens). Login /
   * onboarding screens pass `hideSettings` to suppress it.
   */
  hideSettings?: boolean;
}

function formatClock(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${suffix}`;
}

/**
 * Ticker-tape strip at the top of every primary screen. "Onay · № 004 ·
 * OFF AIR · 11:42 pm" with an optional cog that opens the settings drawer.
 */
export function StatusStrip({ onAir = false, num = '001', clock, hideSettings }: Props) {
  const appActive = useAppActive();
  const settings = useSettings();
  const [live, setLive] = useState(() => formatClock(new Date()));

  useEffect(() => {
    if (!appActive || clock) return;
    setLive(formatClock(new Date()));
    const id = setInterval(() => setLive(formatClock(new Date())), 30_000);
    return () => clearInterval(id);
  }, [appActive, clock]);

  const displayClock = clock ?? live;
  const showCog = !hideSettings && settings.isActive;

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.mark}>ONAY</Text>
        <Text style={styles.num}>№ {num}</Text>
      </View>
      <View style={styles.right}>
        <View style={[
          styles.dot,
          { backgroundColor: onAir ? AM.oxblood : AM.inkDim,
            shadowColor: onAir ? AM.oxblood : 'transparent',
            shadowOpacity: onAir ? 1 : 0,
            shadowRadius: 6,
          },
        ]} />
        <Text style={styles.num}>{onAir ? 'ON AIR' : 'OFF AIR'} · {displayClock}</Text>
        {showCog && (
          <Pressable
            onPress={settings.open}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            hitSlop={10}
            style={({ pressed }) => [styles.cog, pressed && { opacity: 0.5 }]}
          >
            <View style={styles.cogBar} />
            <View style={[styles.cogBar, { marginTop: 3 }]} />
            <View style={[styles.cogBar, { marginTop: 3 }]} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: AM.ink,
    letterSpacing: 1,
    lineHeight: 18,
  },
  num: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cog: {
    padding: 4,
  },
  cogBar: {
    width: 14,
    height: 1,
    backgroundColor: AM.inkDim,
  },
});

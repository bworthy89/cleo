import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, TypeScale } from '../../tokens/design-tokens';
import { useAppActive } from '../../hooks/useAppActive';
import { OnAirIndicator } from '../OnAirIndicator';
import { SettingsCog } from './SettingsCog';

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
  const [live, setLive] = useState(() => formatClock(new Date()));

  useEffect(() => {
    if (!appActive || clock) return;
    setLive(formatClock(new Date()));
    const id = setInterval(() => setLive(formatClock(new Date())), 30_000);
    return () => clearInterval(id);
  }, [appActive, clock]);

  const displayClock = clock ?? live;

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.mark}>ONAY</Text>
        <Text style={styles.num}>№ {num}</Text>
      </View>
      <View style={styles.right}>
        <OnAirIndicator active={onAir} />
        <Text style={styles.num}>{onAir ? 'ON AIR' : 'OFF AIR'} · {displayClock}</Text>
        {!hideSettings && <SettingsCog />}
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
    lineHeight: 22,
  },
  num: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
  },
});

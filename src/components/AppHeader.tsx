import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AM, Fonts, Space, TypeScale, ZIndex } from '../tokens/design-tokens';
import { useAppActive } from '../hooks/useAppActive';
import { broadcastPlayer } from '../engines/BroadcastPlayer.singleton';
import { OnAirIndicator } from './OnAirIndicator';
import { LiquidGlassView } from '../../modules/expo-liquid-glass';

interface AppHeaderProps {
  /** Optional override — show rightContent instead of the on-air strip. */
  rightContent?: ReactNode;
}

const ACTIVE_STATES = new Set(['loading', 'playing_segment', 'playing_track', 'paused']);

function useBroadcastActive(): boolean {
  const [active, setActive] = useState(false);
  const appActive = useAppActive();

  useEffect(() => {
    if (!appActive) return;
    const tick = () => setActive(ACTIVE_STATES.has(broadcastPlayer.getStatus().state));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [appActive]);

  return active;
}

function formatClock(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${suffix}`;
}

function useLiveClock(enabled: boolean): string {
  const [now, setNow] = useState(() => formatClock(new Date()));
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setNow(formatClock(new Date()));
    ref.current = setInterval(() => setNow(formatClock(new Date())), 30_000);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [enabled]);

  return now;
}

export function AppHeader({ rightContent }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const active = useBroadcastActive();
  const appActive = useAppActive();
  const clock = useLiveClock(appActive);

  return (
    <LiquidGlassView style={[styles.container, { paddingTop: insets.top, height: HEADER_HEIGHT + insets.top }]}>
      <View style={styles.inner}>
        <Text style={styles.wordmark} accessibilityRole="header">onay</Text>
        {rightContent ?? (
          <View style={styles.right} accessibilityLabel={active ? `on air, ${clock}` : clock}>
            <OnAirIndicator active={active} />
            <Text style={styles.status}>{active ? 'on air' : 'off air'}</Text>
            <Text style={styles.dotSep}>·</Text>
            <Text style={styles.status}>{clock}</Text>
          </View>
        )}
      </View>
    </LiquidGlassView>
  );
}

const HEADER_HEIGHT = 44;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: ZIndex.header,
    backgroundColor: 'transparent',
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Space.s26,
  },
  wordmark: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 3,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s8,
  },
  status: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 3,
  },
  dotSep: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
  },
});

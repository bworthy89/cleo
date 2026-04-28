import { useEffect, useState } from 'react';
import { StyleSheet, Text, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { AM, Fonts, Space } from '../tokens/design-tokens';
import { LiquidGlassView, isLiquidGlassAvailable } from '../../modules/expo-liquid-glass';

export function useNetworkStatus() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOffline(!(state.isConnected ?? true));
    });
    return () => unsub();
  }, []);

  return isOffline;
}

export function OfflineBanner({ isOffline }: { isOffline: boolean }) {
  const [translateY] = useState(new Animated.Value(-50));

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: isOffline ? 0 : -50,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOffline]);

  if (!isOffline) return null;

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY }] }]}>
      <LiquidGlassView style={styles.glassFill}>
        <Text style={styles.text}>NO CONNECTION — MUSIC CONTINUES, ONAY IS QUIET</Text>
      </LiquidGlassView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: isLiquidGlassAvailable ? 'transparent' : AM.bg,
    zIndex: 100,
    borderBottomWidth: 1,
    borderBottomColor: AM.amber,
  },
  glassFill: {
    paddingVertical: Space.s8,
    paddingHorizontal: Space.s16,
    alignItems: 'center',
  },
  text: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: AM.amber,
  },
});

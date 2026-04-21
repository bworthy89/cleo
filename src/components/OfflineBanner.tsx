import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Colors, Surface, Typography, Spacing } from '../tokens/design-tokens';

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
      <Text style={styles.text}>NO CONNECTION — MUSIC CONTINUES, ONAY IS QUIET</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: Surface.high,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    zIndex: 100,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
  },
  text: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 2,
    color: Colors.accent,
  },
});

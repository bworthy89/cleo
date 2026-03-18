import { Image, StyleSheet, View } from 'react-native';

interface GrainOverlayProps {
  isDark?: boolean;
}

export function GrainOverlay({ isDark }: GrainOverlayProps) {
  return (
    <View style={styles.container} pointerEvents="none">
      <Image
        source={require('../../assets/textures/grain.png')}
        style={[styles.grain, { opacity: isDark ? 0.035 : 0.06 }]}
        resizeMode="repeat"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  grain: {
    width: '100%',
    height: '100%',
  },
});

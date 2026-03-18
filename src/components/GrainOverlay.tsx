import { Image, StyleSheet, View } from 'react-native';
import { Grain, ZIndex } from '../tokens/design-tokens';

interface GrainOverlayProps {
  isDark?: boolean;
}

export function GrainOverlay({ isDark }: GrainOverlayProps) {
  return (
    <View style={styles.container} pointerEvents="none">
      <Image
        source={require('../../assets/textures/grain.png')}
        style={[styles.grain, { opacity: isDark ? Grain.dark : Grain.light }]}
        resizeMode="repeat"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: ZIndex.base,
  },
  grain: {
    width: '100%',
    height: '100%',
  },
});

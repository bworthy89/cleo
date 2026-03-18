import { Image, StyleSheet } from 'react-native';

export function GrainOverlay() {
  return (
    <Image
      source={require('../../assets/textures/grain.png')}
      style={styles.grain}
      resizeMode="repeat"
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  grain: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.05,
    zIndex: 1,
  },
});
